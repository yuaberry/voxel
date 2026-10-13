/**
 * Modrinth catalog (Modpack Creator v3) — search/version resolution against
 * the official public API (no key, documented rate limits). The actual file
 * download goes through the Rust command with SHA-1 verification; this
 * service only resolves WHICH file.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectLoader } from "@/types";

const API = "https://api.modrinth.com/v2";
const USER_AGENT = "VOXEL/0.3.8 (https://github.com/yuaberry/voxel)";

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  icon_url: string | null;
  license: string | null;
  author: string;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  hashes: { sha1?: string; sha512?: string };
}

export interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  dependency_type: "required" | "optional" | "embedded" | "incompatible";
}

export interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  files: ModrinthVersionFile[];
  dependencies?: ModrinthDependency[];
}

/** Facet filter so search results actually load on the target game+loader. */
export function buildFacets(mcVersion: string, loader: ProjectLoader): string {
  return JSON.stringify([
    ["project_type:mod"],
    [`versions:${mcVersion}`],
    [`categories:${loader}`],
  ]);
}

export async function searchModrinthMods(
  query: string,
  mcVersion: string,
  loader: ProjectLoader,
  limit = 12,
): Promise<ModrinthSearchHit[]> {
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(
    buildFacets(mcVersion, loader),
  )}&limit=${limit}`;
  const response = await tauriFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Modrinth search failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { hits: ModrinthSearchHit[] };
  return data.hits;
}

export async function getModrinthVersions(
  projectId: string,
  mcVersion: string,
  loader: ProjectLoader,
): Promise<ModrinthVersion[]> {
  const url = `${API}/project/${encodeURIComponent(projectId)}/version?game_versions=${encodeURIComponent(
    JSON.stringify([mcVersion]),
  )}&loaders=${encodeURIComponent(JSON.stringify([loader]))}`;
  const response = await tauriFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Modrinth version lookup failed: HTTP ${response.status}`);
  }
  return (await response.json()) as ModrinthVersion[];
}

export interface PickedModFile {
  url: string;
  sha1: string;
  fileName: string;
  versionNumber: string;
}

/**
 * Picks the best installable file from newest-first versions: the primary
 * file with a published SHA-1. Versions without a SHA-1 are honestly
 * skipped — we never install an unverifiable file.
 */
export function pickModrinthFile(versions: ModrinthVersion[]): PickedModFile | null {
  for (const version of versions) {
    const primary = version.files.find((f) => f.primary && f.hashes.sha1);
    const fallback = version.files.find((f) => f.hashes.sha1);
    const file = primary ?? fallback;
    if (file) {
      return {
        url: file.url,
        sha1: file.hashes.sha1!,
        fileName: file.filename,
        versionNumber: version.version_number,
      };
    }
  }
  return null;
}

export interface ModrinthDownloadResult {
  filePath: string;
  bytes: number;
  sha1Verified: boolean;
}

export function downloadModrinthMod(
  storageBase: string,
  instanceSlug: string,
  picked: PickedModFile,
): Promise<ModrinthDownloadResult> {
  return invoke<ModrinthDownloadResult>("modrinth_download", {
    payload: {
      storageBase,
      instanceSlug,
      url: picked.url,
      sha1: picked.sha1,
      fileName: picked.fileName,
    },
  });
}

export interface ResolvedMod {
  projectId: string;
  titleHint: string;
  versionNumber: string;
  fileName: string;
  url: string;
  sha1: string;
  requiredBy: string | null;
}

export interface ModrinthTree {
  mods: ResolvedMod[];
  skippedOptional: string[];
}

/** Hard stop against pathological graphs. */
export const MAX_RESOLVED_MODS = 25;

/**
 * Resolves the full installable tree for a Modrinth project: the root's
 * newest compatible version plus every REQUIRED transitive dependency
 * (each resolved against the same game version + loader).
 *
 * Honest by construction:
 * - optional deps are returned as `skippedOptional` (user choice, not ours)
 * - embedded deps ship inside the jar already — never downloaded twice
 * - an `incompatible` edge against anything being installed FAILS the resolve
 * - a required dep with no installable (SHA-1-carrying) version FAILS too —
 *   a broken modpack is never silently assembled
 */
export async function resolveModrinthTree(
  rootProjectId: string,
  mcVersion: string,
  loader: ProjectLoader,
  fetchVersions: (
    projectId: string,
    mc: string,
    loader: ProjectLoader,
  ) => Promise<ModrinthVersion[]> = getModrinthVersions,
): Promise<ModrinthTree> {
  const mods: ResolvedMod[] = [];
  const skippedOptional: string[] = [];
  const installed = new Set<string>();
  const queue: Array<{ projectId: string; requiredBy: string | null }> = [
    { projectId: rootProjectId, requiredBy: null },
  ];

  while (queue.length > 0) {
    if (mods.length >= MAX_RESOLVED_MODS) {
      throw new Error(
        `Dependency graph exceeds ${MAX_RESOLVED_MODS} mods — refusing to install blindly`,
      );
    }
    const { projectId, requiredBy } = queue.shift()!;
    if (installed.has(projectId)) continue;
    installed.add(projectId);

    const versions = await fetchVersions(projectId, mcVersion, loader);
    const picked = pickModrinthFile(versions);
    if (!picked) {
      throw new Error(
        requiredBy
          ? `Required dependency ${projectId} has no SHA-1-verified version for MC ${mcVersion} (${loader})`
          : `No SHA-1-verified version for MC ${mcVersion} (${loader})`,
      );
    }
    mods.push({
      projectId,
      titleHint: projectId,
      versionNumber: picked.versionNumber,
      fileName: picked.fileName,
      url: picked.url,
      sha1: picked.sha1,
      requiredBy,
    });

    const chosen = versions.find((v) => v.version_number === picked.versionNumber);
    for (const dep of chosen?.dependencies ?? []) {
      if (dep.dependency_type === "embedded") continue;
      if (dep.dependency_type === "optional") {
        if (dep.project_id) skippedOptional.push(dep.project_id);
        continue;
      }
      if (dep.dependency_type === "incompatible") {
        if (dep.project_id && installed.has(dep.project_id)) {
          throw new Error(
            `Incompatibility declared: ${projectId} is incompatible with ${dep.project_id}`,
          );
        }
        continue;
      }
      // required — but a dependency edge may carry only a version_id
      if (dep.project_id) {
        if (!installed.has(dep.project_id)) {
          queue.push({ projectId: dep.project_id, requiredBy: projectId });
        }
      } else {
        throw new Error(
          `Unresolvable required dependency in ${projectId} (no project reference)`,
        );
      }
    }
  }

  return { mods, skippedOptional };
}
