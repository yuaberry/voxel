import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  CatalogStatus,
  MinecraftVersionInfo,
  McVersionKind,
} from "@/types/catalog";
import type { CreateProjectRequest, ProjectLoader } from "@/types";
import { getDb } from "@/services/db/client";

/**
 * Auto-updating Minecraft Version Catalog.
 *
 * Sources (official + community, all fetched live):
 *  - Mojang piston-meta:      version_manifest_v2.json   (all releases/snapshots)
 *  - Fabric meta:             game / loader / yarn       (loader availability)
 *  - Fabric maven:            fabric-api maven-metadata  (API version per MC)
 *  - Forge files:             promotions_slim.json       (recommended builds)
 *  - NeoForge maven:          maven-metadata.xml         (latest builds)
 *  - PaperMC API:             supported server versions
 *
 * Cache: SQLite (minecraft_versions). TTL: 12h. A minimal embedded fallback
 * keeps the app usable fully offline on a cold cache.
 */

const CATALOG_TTL_HOURS = 12;
const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_GAME_URL = "https://meta.fabricmc.net/v2/versions/game?limit=1000";
const FABRIC_LOADER_URL = "https://meta.fabricmc.net/v2/versions/loader?limit=1";
const FABRIC_YARN_URL = "https://meta.fabricmc.net/v2/versions/yarn?limit=2000";
const FABRIC_API_METADATA_URL =
  "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml";
const FORGE_PROMOS_URL =
  "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_METADATA_URL =
  "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const PAPER_PROJECTS_URL = "https://fill.papermc.io/v3/projects/paper";

/** Minimal offline fallback so project creation never hard-fails. */
const FALLBACK_CATALOG: MinecraftVersionInfo[] = [
  {
    version: "1.20.1",
    kind: "release",
    releaseTime: "2023-06-12T13:23:42+00:00",
    loaders: ["fabric"],
    serverSoftware: ["vanilla", "paper"],
    javaRelease: 17,
    experimental: false,
    fabric: {
      yarn: "1.20.1+build.10",
      fabricApi: "0.92.12+1.20.1",
      loader: "0.19.5",
    },
    forge: { recommended: "47.4.10" },
    neoforge: { latest: "47.1.104" },
  },
  {
    version: "1.21.1",
    kind: "release",
    releaseTime: "2024-08-08T13:23:42+00:00",
    loaders: ["fabric"],
    serverSoftware: ["vanilla", "paper"],
    javaRelease: 21,
    experimental: false,
    fabric: {
      yarn: "1.21.1+build.3",
      fabricApi: "0.116.17+1.21.1",
      loader: "0.19.5",
    },
    forge: { recommended: "52.1.0" },
    neoforge: { latest: "21.1.209" },
  },
];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function compareMc(a: string, b: string): number {
  const pa = a.split(/[+~-]/)[0].split(".").map(Number);
  const pb = b.split(/[+~-]/)[0].split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Java release required by a Minecraft version.
 * Handles both schemes: legacy "1.20.1" and the modern "26.3" (YY.M).
 */
export function javaReleaseFor(version: string): number {
  const clean = version.split(/[+~-]/)[0];
  if (!clean.startsWith("1.")) {
    // Modern scheme (26.3, 26.4-snapshot, 25w46a snapshot weeks) => Java 21
    return 21;
  }
  const parts = clean.split(".").map(Number);
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

/** fabric.mod.json `minecraft` dependency for a version. */
export function mcDependsFor(version: string, kind: McVersionKind): string {
  if (kind === "release") return `~${version}`;
  // Snapshots can't be expressed as stable semver ranges
  return "*";
}

/**
 * Versions above 1.21.1 use changed registration APIs (keyed item groups).
 * The template targets <= 1.21.1 — newer releases are allowed but flagged.
 */
export function isExperimental(version: string, kind: McVersionKind): boolean {
  if (kind !== "release") return true;
  return compareMc(version, "1.21.1") > 0;
}

function parseMavenVersions(xml: string): string[] {
  const out: string[] = [];
  const re = /<version>([^<]+)<\/version>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    out.push(match[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live fetch
// ---------------------------------------------------------------------------

interface MojangManifest {
  latest: { release: string; snapshot: string };
  versions: Array<{
    id: string;
    type: McVersionKind;
    releaseTime: string;
    url: string;
  }>;
}

async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await Promise.race([
    tauriFetch(url, { method: "GET" }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeoutMs),
    ),
  ]);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function getText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await Promise.race([
    tauriFetch(url, { method: "GET" }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeoutMs),
    ),
  ]);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

export async function fetchCatalog(): Promise<MinecraftVersionInfo[]> {
  const [mojang, fabricGame, fabricLoader, yarnXml, fabricApiXml, forgePromos, neoforgeXml, paper] =
    await Promise.allSettled([
      getJson<MojangManifest>(MANIFEST_URL),
      getJson<Array<{ version: string; stable: boolean }>>(FABRIC_GAME_URL),
      getJson<Array<{ version: string }>>(FABRIC_LOADER_URL),
      getJson<Array<{ version: string }>>(FABRIC_YARN_URL),
      getText(FABRIC_API_METADATA_URL),
      getJson<{ promos: Record<string, string> }>(FORGE_PROMOS_URL),
      getText(NEOFORGE_METADATA_URL),
      getJson<{ versions: Record<string, string[]> }>(PAPER_PROJECTS_URL),
    ]);

  // Mojang is the backbone — without it there is no catalog
  if (mojang.status !== "fulfilled") {
    throw new Error(
      "Could not reach Mojang's version manifest — check your connection.",
    );
  }

  // Fabric data (partial failures degrade gracefully)
  const fabricGameSet = new Set<string>();
  const fabricStable = new Set<string>();
  if (fabricGame.status === "fulfilled") {
    for (const entry of fabricGame.value) {
      fabricGameSet.add(entry.version);
      if (entry.stable) fabricStable.add(entry.version);
    }
  }
  const loaderVersion =
    fabricLoader.status === "fulfilled" && fabricLoader.value[0]
      ? fabricLoader.value[0].version
      : "0.16.9";

  // Yarn per MC: group builds, keep the highest
  const yarnByMc = new Map<string, string>();
  if (yarnXml.status === "fulfilled") {
    for (const entry of yarnXml.value) {
      const idx = entry.version.indexOf("+build.");
      if (idx <= 0) continue;
      const mc = entry.version.slice(0, idx);
      const build = Number(entry.version.slice(idx + 7));
      const current = yarnByMc.get(mc);
      if (!current || compareMc(entry.version, current) > 0) {
        yarnByMc.set(mc, entry.version);
        void build;
      }
    }
  }

  // Fabric API per MC: versions look like "0.92.2+1.20.1"
  const fabricApiByMc = new Map<string, string>();
  if (fabricApiXml.status === "fulfilled") {
    for (const version of parseMavenVersions(fabricApiXml.value)) {
      const idx = version.indexOf("+");
      if (idx <= 0) continue;
      const mc = version.slice(idx + 1);
      const current = fabricApiByMc.get(mc);
      if (!current || version > current) {
        fabricApiByMc.set(mc, version);
      }
    }
  }

  // Forge recommended per MC
  const forgeByMc = new Map<string, string>();
  if (forgePromos.status === "fulfilled") {
    for (const [key, value] of Object.entries(forgePromos.value.promos ?? {})) {
      const mc = key.replace(/-recommended$|-latest$/, "");
      if (key.endsWith("-recommended")) {
        forgeByMc.set(mc, value);
      }
    }
  }

  // NeoForge per MC — two schemes:
  //   legacy:  "47.1.x" => 1.20.1 · "20.4.x" => 1.20.4 · "21.1.x" => 1.21.1
  //   modern:  "26.3.0.x" => 26.3 (first two segments mirror the MC version)
  const neoforgeByMc = new Map<string, string>();
  if (neoforgeXml.status === "fulfilled") {
    for (const version of parseMavenVersions(neoforgeXml.value)) {
      const parts = version.split(".");
      const first = Number(parts[0]);
      let mc: string | null = null;
      if (version.startsWith("47.")) {
        mc = "1.20.1";
      } else if (first >= 20 && first <= 21) {
        mc = `1.${parts[0]}.${parts[1]}`;
      } else if (first >= 25) {
        mc = `${parts[0]}.${parts[1]}`;
      }
      if (!mc) continue;
      const current = neoforgeByMc.get(mc);
      if (!current || compareMc(version, current) > 0) {
        neoforgeByMc.set(mc, version);
      }
    }
  }

  // Paper Fill API: { versions: { family: [exact MC versions with builds] } }
  const paperSet = new Set<string>();
  if (paper.status === "fulfilled") {
    const families = paper.value.versions ?? {};
    for (const builds of Object.values(families)) {
      for (const exact of builds) paperSet.add(exact);
    }
  }

  // Compose the catalog: every Mojang release + current snapshot window
  const releases = mojang.value.versions.filter((v) => v.type === "release");
  const snapshots = mojang.value.versions.filter((v) => v.type === "snapshot");

  const chosen = [
    ...releases,
    ...snapshots.slice(0, 10), // recent experimental window
  ];

  const catalog: MinecraftVersionInfo[] = chosen.map((entry) => {
    const kind = entry.type;
    const hasFabric = fabricGameSet.has(entry.id);
    const yarn = yarnByMc.get(entry.id) ?? null;
    const fabricApi = fabricApiByMc.get(entry.id) ?? null;
    const forge = forgeByMc.get(entry.id);
    const neoforge = neoforgeByMc.get(entry.id);

    // Fabric is usable with either yarn mappings (legacy scheme) or the
    // official Mojang mappings (newer versions where yarn has no coverage).
    const loaders: MinecraftVersionInfo["loaders"] = [];
    if (hasFabric && fabricApi) loaders.push("fabric");
    if (forge) loaders.push("forge");
    if (neoforge) loaders.push("neoforge");

    const serverSoftware: string[] = ["vanilla"];
    if (paperSet.has(entry.id)) serverSoftware.push("paper");

    return {
      version: entry.id,
      kind,
      releaseTime: entry.releaseTime,
      loaders,
      serverSoftware,
      javaRelease: javaReleaseFor(entry.id),
      experimental: isExperimental(entry.id, kind),
      fabric:
        hasFabric && fabricApi
          ? { yarn, fabricApi, loader: loaderVersion }
          : null,
      forge: forge ? { recommended: forge } : null,
      neoforge: neoforge ? { latest: neoforge } : null,
    };
  });

  if (catalog.length === 0) {
    throw new Error("Catalog came back empty");
  }
  return catalog;
}

// ---------------------------------------------------------------------------
// Persistence (SQLite cache) + TTL
// ---------------------------------------------------------------------------

interface CatalogRow {
  version: string;
  kind: string;
  release_time: string | null;
  loaders: string;
  server_software: string;
  java_release: number;
  experimental: number;
  yarn_mappings: string | null;
  fabric_api: string | null;
  fabric_loader: string | null;
  forge_recommended: string | null;
  neoforge_latest: string | null;
  fetched_at: string;
}

function rowToInfo(row: CatalogRow): MinecraftVersionInfo {
  const loaders = row.loaders ? (row.loaders.split(",") as MinecraftVersionInfo["loaders"]) : [];
  const serverSoftware = row.server_software
    ? row.server_software.split(",")
    : ["vanilla"];
  const fabric = row.fabric_api
    ? {
        yarn: row.yarn_mappings,
        fabricApi: row.fabric_api,
        loader: row.fabric_loader ?? "0.19.5",
      }
    : null;
  return {
    version: row.version,
    kind: (row.kind as McVersionKind) ?? "release",
    releaseTime: row.release_time,
    loaders,
    serverSoftware,
    javaRelease: row.java_release,
    experimental: row.experimental === 1,
    fabric,
    forge: row.forge_recommended ? { recommended: row.forge_recommended } : null,
    neoforge: row.neoforge_latest ? { latest: row.neoforge_latest } : null,
  };
}

async function readCache(): Promise<{
  info: MinecraftVersionInfo[];
  lastFetchedAt: string | null;
}> {
  const db = await getDb();
  const rows = await db.select<CatalogRow[]>(
    "SELECT * FROM minecraft_versions",
  );
  const info = rows.map(rowToInfo).sort((a, b) => compareMc(b.version, a.version));
  const lastFetchedAt =
    rows.length > 0
      ? rows.map((r) => r.fetched_at).sort().reverse()[0] ?? null
      : null;
  return { info, lastFetchedAt };
}

async function writeCache(catalog: MinecraftVersionInfo[]): Promise<void> {
  const db = await getDb();
  const stamp = new Date().toISOString();
  await db.execute("DELETE FROM minecraft_versions");
  const rows = catalog.map((v) => [
    v.version,
    v.kind,
    v.releaseTime,
    v.loaders.join(","),
    v.serverSoftware.join(","),
    v.javaRelease,
    v.experimental ? 1 : 0,
    v.fabric?.yarn ?? null,
    v.fabric?.fabricApi ?? null,
    v.fabric?.loader ?? null,
    v.forge?.recommended ?? null,
    v.neoforge?.latest ?? null,
    stamp,
  ]);
  // Chunked inserts (SQLite parameter limits)
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const flat = chunk.flat();
    await db.execute(
      `INSERT INTO minecraft_versions
        (version, kind, release_time, loaders, server_software, java_release,
         experimental, yarn_mappings, fabric_api, fabric_loader,
         forge_recommended, neoforge_latest, fetched_at)
       VALUES ${values}`,
      flat,
    );
  }
}

function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const ageMs = Date.now() - new Date(lastFetchedAt).getTime();
  return ageMs > CATALOG_TTL_HOURS * 3600 * 1000;
}

/**
 * Ensures a usable catalog: fresh fetch when stale, cache otherwise.
 * Falls back to cache (even if stale) or the embedded fallback on failure.
 */
export async function ensureCatalog(force = false): Promise<CatalogStatus> {
  const cached = await readCache();
  if (!force && cached.info.length > 0 && !isStale(cached.lastFetchedAt)) {
    return {
      lastFetchedAt: cached.lastFetchedAt,
      count: cached.info.length,
      source: "cache",
    };
  }

  try {
    const fresh = await fetchCatalog();
    await writeCache(fresh);
    return {
      lastFetchedAt: new Date().toISOString(),
      count: fresh.length,
      source: "fresh",
    };
  } catch (error) {
    if (cached.info.length > 0) {
      console.warn("Catalog refresh failed — serving cache:", error);
      return {
        lastFetchedAt: cached.lastFetchedAt,
        count: cached.info.length,
        source: "cache",
      };
    }
    await writeCache(FALLBACK_CATALOG);
    return {
      lastFetchedAt: null,
      count: FALLBACK_CATALOG.length,
      source: "fallback",
    };
  }
}

export async function getVersions(): Promise<MinecraftVersionInfo[]> {
  const cached = await readCache();
  if (cached.info.length === 0) {
    await ensureCatalog();
    return (await readCache()).info;
  }
  return cached.info;
}

export async function getVersion(version: string): Promise<MinecraftVersionInfo | null> {
  const all = await getVersions();
  return all.find((v) => v.version === version) ?? null;
}

/**
 * Resolves the full template parameters for a Minecraft version + loader.
 * Guaranteed to return usable values (catalog -> fallback chain).
 *
 * Dependency formats differ by loader (honest to each ecosystem):
 *  - fabric:        SemVer-ish tilde ("~1.20.1") in fabric.mod.json
 *  - forge/neoforge: Maven ranges ("[1.20.1,1.21)") in mods.toml
 */
export interface TemplateParams {
  minecraftVersion: string;
  javaRelease: number;
  yarnMappings: string | null;
  mappingsLine: string;
  loaderVersion: string;
  loaderMin: string;
  fabricApiVersion: string;
  mcDepends: string;
  packFormat: number;
  templateId: string;
  experimental: boolean;
}

/** Resource/data pack format per MC version (factual, from the game). */
const PACK_FORMATS: Record<string, number> = {
  "1.20.1": 15,
  "1.20.2": 18,
  "1.20.3": 22,
  "1.20.4": 22,
  "1.20.5": 32,
  "1.20.6": 32,
  "1.21": 34,
  "1.21.1": 34,
};

/** Semantic segment comparison: 1 == equal, >0 == a is newer. */
export function compareMcVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Loader coverage, honest to the embedded templates:
 *  - forge: the ForgeGradle-6 MDK covers Forge 47-52 (MC 1.20.1-1.21.1)
 *  - neoforge: three eras, each with its own embedded template — the 1.20.1
 *    lineage (net.neoforged:forge, FG6), NeoGradle 7 (1.20.2-1.21.1) and
 *    ModDevGradle 2 (1.21.4-1.21.8)
 */
function loaderAvailable(
  info: MinecraftVersionInfo,
  loader: ProjectLoader,
): boolean {
  switch (loader) {
    case "fabric":
      return info.loaders.includes("fabric");
    case "forge":
      return (
        info.loaders.includes("forge") &&
        !!info.forge &&
        compareMcVersions(info.version, "1.20.1") >= 0 &&
        compareMcVersions(info.version, "1.21.1") <= 0
      );
    case "neoforge":
      return (
        !!info.neoforge &&
        (info.version === "1.20.1" ||
          (compareMcVersions(info.version, "1.20.2") >= 0 &&
            compareMcVersions(info.version, "1.21.8") <= 0))
      );
  }
}

/** Availability probe for the wizard's loader chips. */
export function isLoaderAvailable(
  info: Pick<MinecraftVersionInfo, "version" | "loaders" | "forge" | "neoforge">,
  loader: ProjectLoader,
): boolean {
  return loaderAvailable(info as MinecraftVersionInfo, loader);
}

/** Maven range for mods.toml: [current, next minor). */
export function mavenRangeFor(version: string): string {
  const parts = version.split(".");
  if (parts.length < 2) return `[${version},)`;
  const nextMinor = Number(parts[1]) + 1;
  return `[${version},${parts[0]}.${nextMinor})`;
}

export async function resolveTemplateParams(
  version: string,
  loader: ProjectLoader = "fabric",
): Promise<TemplateParams> {
  const info = (await getVersion(version)) ?? FALLBACK_CATALOG[0];
  const fallback = FALLBACK_CATALOG[0];
  const kind = info.kind;
  const yarn = info.fabric?.yarn ?? null;

  if (!loaderAvailable(info, loader)) {
    throw new Error(
      `Loader "${loader}" is not available for Minecraft ${info.version}`,
    );
  }

  // Per-loader version resolution — all from the live catalog.
  const loaderVersion =
    loader === "fabric"
      ? (info.fabric?.loader ?? fallback.fabric!.loader)
      : loader === "forge"
        ? (info.forge?.recommended ?? fallback.forge!.recommended)
        : (info.neoforge?.latest ?? fallback.neoforge!.latest);

  // fabric: ">=0.16.0" (SemVer); forge/neoforge: "[47,)" (Maven).
  const loaderMin =
    loader === "fabric"
      ? `>=${loaderVersion.split(".").slice(0, 2).join(".")}.0`
      : `[${loaderVersion.split(".")[0]},)`;

  const mcDepends =
    loader === "fabric"
      ? mcDependsFor(info.version, kind)
      : mavenRangeFor(info.version);

  return {
    minecraftVersion: info.version,
    javaRelease: info.javaRelease,
    yarnMappings: loader === "fabric" ? yarn : null,
    mappingsLine:
      loader === "fabric"
        ? yarn
          ? `mappings "net.fabricmc:yarn:${yarn}:v2"`
          : "mappings loom.officialMojangMappings()"
        : "mappings channel: 'official'",
    loaderVersion,
    loaderMin,
    fabricApiVersion:
      loader === "fabric"
        ? (info.fabric?.fabricApi ?? fallback.fabric!.fabricApi)
        : "",
    mcDepends,
    packFormat: PACK_FORMATS[info.version] ?? PACK_FORMATS["1.20.1"],
    // Three NeoForge eras, each with its own embedded template: the 1.20.1
    // Forge drop-in, NeoGradle 7 (1.20.2-1.21.1), ModDevGradle 2 (1.21.4+).
    templateId:
      loader === "neoforge" && compareMcVersions(info.version, "1.21.4") >= 0
        ? "neoforge-1.21.4-mod"
        : loader === "neoforge" && info.version !== "1.20.1"
          ? "neoforge-1.20.2-mod"
          : `${loader}-1.20.1-mod`,
    experimental: isExperimental(info.version, kind),
  };
}

/** Builds the Rust create_project payload fields for a version. */
export function templateParamsToPayload(
  params: Awaited<ReturnType<typeof resolveTemplateParams>>,
  loader: ProjectLoader,
): Pick<
  CreateProjectRequest,
  | "minecraftVersion"
  | "javaRelease"
  | "yarnMappings"
  | "mappingsLine"
  | "loaderVersion"
  | "loaderMin"
  | "fabricApiVersion"
  | "mcDepends"
  | "loader"
  | "packFormat"
> {
  return {
    minecraftVersion: params.minecraftVersion,
    javaRelease: params.javaRelease,
    yarnMappings: params.yarnMappings ?? "",
    mappingsLine: params.mappingsLine,
    loaderVersion: params.loaderVersion,
    loaderMin: params.loaderMin,
    fabricApiVersion: params.fabricApiVersion,
    mcDepends: params.mcDepends,
    loader,
    packFormat: params.packFormat,
  };
}
