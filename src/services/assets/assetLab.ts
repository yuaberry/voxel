/**
 * VOXEL Asset Lab (Super Prompt §6, Fase B) — the asset library that reads
 * the REAL workspace: every texture/model/lang/structure across projects,
 * shaderpacks and modpacks, with the consistency checker the prompt asks
 * for — broken references (model → missing texture), missing
 * implementation files per registered item, duplicate files (byte-hash),
 * and validated image import (real PNG header inspection).
 */
import { invoke } from "@tauri-apps/api/core";
import { listProjectFiles, readProjectFile } from "@/services/projects/projectsService";
import { scanProject } from "@/services/gameplay/gameplayDesigner";
import type { ProjectRecord } from "@/types";

export type AssetKind =
  | "texture"
  | "model"
  | "lang"
  | "recipe"
  | "structure"
  | "advancement"
  | "shader"
  | "sound"
  | "other";

export interface AssetEntry {
  kind: AssetKind;
  projectId: string;
  projectSlug: string;
  rel: string; // workspace-relative path
  name: string;
  sizeBytes: number;
}

export interface ConsistencyIssue {
  projectId: string;
  severity: "broken" | "missing" | "duplicate" | "orphan";
  message: string;
}

/** Classifies a workspace file by its path — the kind drives the whole UI. */
export function classifyAsset(rel: string): AssetKind {
  const p = rel.toLowerCase();
  if (p.includes("/textures/") && p.endsWith(".png")) return "texture";
  if (p.includes("/models/") && p.endsWith(".json")) return "model";
  if (p.includes("/lang/") && p.endsWith(".json")) return "lang";
  if (p.includes("/recipes/") && p.endsWith(".json")) return "recipe";
  if ((p.includes("/structures/") || p.includes("/structure/")) && p.endsWith(".nbt")) return "structure";
  if (p.includes("/advancements/") && p.endsWith(".json")) return "advancement";
  if (p.startsWith("shaderpacks/")) return "shader";
  if (p.includes("/sounds/") && (p.endsWith(".ogg") || p.endsWith(".wav"))) return "sound";
  return "other";
}

export async function scanWorkspaceAssets(
  basePath: string,
  projects: ProjectRecord[],
): Promise<AssetEntry[]> {
  const assets: AssetEntry[] = [];
  for (const project of projects) {
    const relRoot = `projects/${project.slug}`;
    const files = await listProjectFiles(basePath, relRoot).catch(() => []);
    for (const file of files) {
      if (file.is_dir) continue;
      const rel = `${relRoot}/${file.path}`;
      // only the folders the game actually reads
      const p = file.path.toLowerCase();
      if (
        !p.includes("/textures/") &&
        !p.includes("/models/") &&
        !p.includes("/lang/") &&
        !p.includes("/recipes/") &&
        !p.includes("/structures/") &&
        !p.includes("/structure/") &&
        !p.includes("/advancements/") &&
        !p.includes("/sounds/")
      ) {
        continue;
      }
      const kind = classifyAsset(rel);
      if (kind === "other") continue;
      assets.push({
        kind,
        projectId: project.id,
        projectSlug: project.slug,
        rel,
        name: file.path.split("/").pop() ?? file.path,
        sizeBytes: file.size_bytes,
      });
    }
  }
  // shaderpacks are workspace-level authored assets too
  const packs = await listProjectFiles(basePath, "shaderpacks").catch(() => []);
  for (const file of packs) {
    if (file.is_dir) continue;
    const rel = `shaderpacks/${file.path}`;
    const kind = classifyAsset(rel);
    if (kind === "other") continue;
    assets.push({
      kind,
      projectId: "",
      projectSlug: "",
      rel,
      name: file.path.split("/").pop() ?? file.path,
      sizeBytes: file.size_bytes,
    });
  }
  return assets;
}

// ---------------------------------------------------------------------------
// Consistency checker — reads the files and compares with the registry
// ---------------------------------------------------------------------------

export async function checkProjectConsistency(
  basePath: string,
  project: ProjectRecord,
): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];
  const scan = await scanProject(basePath, project);
  const modId = scan.modId;
  const projectRel = `projects/${project.slug}`;

  // 1. registered items missing implementation files (the designer's pills,
  //    aggregated so the owner sees EVERYTHING at once)
  for (const item of scan.items) {
    if (!item.model) {
      issues.push({
        projectId: project.id,
        severity: "missing",
        message: `Item "${item.id}" has no model (${modId}:models/item/${item.id}.json)`,
      });
    }
    if (!item.lang) {
      issues.push({
        projectId: project.id,
        severity: "missing",
        message: `Item "${item.id}" has no lang entry (item.${modId}.${item.id})`,
      });
    }
    if (!item.texture) {
      issues.push({
        projectId: project.id,
        severity: "missing",
        message: `Item "${item.id}" has no texture (${modId}:textures/item/${item.id}.png) — the game would show the missing-texture checkerboard`,
      });
    }
  }

  // 2. broken references: every model's layer0 must exist as a texture file
  const assets = await scanWorkspaceAssets(basePath, [project]);
  const textureRels = new Set(
    assets.filter((a) => a.kind === "texture").map((a) => a.rel),
  );
  for (const model of assets.filter((a) => a.kind === "model")) {
    try {
      const raw = await readProjectFile(basePath, model.rel);
      const parsed = JSON.parse(raw) as { textures?: Record<string, string> };
      for (const ref of Object.values(parsed.textures ?? {})) {
        // "modid:item/foo" -> assets/<modid>/textures/item/foo.png
        const m = /^([a-z0-9_]+):(.+)$/.exec(ref);
        if (!m) continue;
        const [, ns, path] = m;
        const textureRel = `${projectRel}/src/main/resources/assets/${ns}/textures/${path}.png`;
        if (!textureRels.has(textureRel)) {
          issues.push({
            projectId: project.id,
            severity: "broken",
            message: `Model ${model.name} points to ${ref} — that texture does not exist`,
          });
        }
      }
    } catch {
      issues.push({
        projectId: project.id,
        severity: "broken",
        message: `Model ${model.name} is not valid JSON`,
      });
    }
  }

  // 3. orphan lang keys: item.<modid>.<id> entries whose item is not registered
  try {
    const langRel = `${projectRel}/src/main/resources/assets/${modId}/lang/en_us.json`;
    const raw = await readProjectFile(basePath, langRel);
    const lang = JSON.parse(raw) as Record<string, string>;
    const registered = new Set(scan.items.map((i) => i.id));
    for (const key of Object.keys(lang)) {
      const m = /^item\.[a-z0-9_]+\.([a-z0-9_]+)$/.exec(key);
      if (m && !registered.has(m[1])) {
        issues.push({
          projectId: project.id,
          severity: "orphan",
          message: `Lang key "${key}" has no registered item ("${m[1]}" is not in ModItems.java)`,
        });
      }
    }
  } catch {
    // no lang file at all — the missing checks above already cover it
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Duplicates — byte-hash of texture files (djb2 over the base64 payload)
// ---------------------------------------------------------------------------

function quickHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export interface DuplicateGroup {
  hash: string;
  rels: string[];
}

export async function findDuplicateTextures(
  basePath: string,
  assets: AssetEntry[],
): Promise<DuplicateGroup[]> {
  const byHash = new Map<string, string[]>();
  for (const asset of assets.filter((a) => a.kind === "texture")) {
    try {
      const result = await invoke<{ data: string }>("read_project_file_base64", {
        basePath,
        rel: asset.rel,
      });
      const hash = quickHash(result.data);
      byHash.set(hash, [...(byHash.get(hash) ?? []), asset.rel]);
    } catch {
      continue; // unreadable files are reported elsewhere, not duplicated
    }
  }
  const groups: DuplicateGroup[] = [];
  for (const [hash, rels] of byHash) {
    if (rels.length > 1) groups.push({ hash, rels });
  }
  return groups.sort((a, b) => b.rels.length - a.rels.length);
}

// ---------------------------------------------------------------------------
// Validated image import — a REAL PNG header inspection, not a guess
// ---------------------------------------------------------------------------

export interface ImportedImage {
  name: string;
  width: number;
  height: number;
  bytes: number;
}

/** Inspects a real PNG header: signature + IHDR width/height. */
export function inspectPng(bytes: Uint8Array): { ok: boolean; width: number; height: number; reason?: string } {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) {
    return { ok: false, width: 0, height: 0, reason: "File too small to be a PNG" };
  }
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) {
      return { ok: false, width: 0, height: 0, reason: "Not a PNG file (signature mismatch)" };
    }
  }
  // IHDR: length(4) + "IHDR"(4) + width(4, big-endian) + height(4)
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { ok: true, width, height };
}

export async function importTexture(
  basePath: string,
  project: ProjectRecord,
  targetId: string,
  sourcePath: string,
): Promise<{ accepted: boolean; reason?: string; rel?: string }> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(targetId)) {
    return { accepted: false, reason: "Invalid texture id (lowercase letters/digits/_)" };
  }
  const modId = project.slug.replace(/-/g, "_");
  const projectRel = `projects/${project.slug}`;
  const destRel = `src/main/resources/assets/${modId}/textures/item/${targetId}.png`;

  // import first (guarded copy), then validate the REAL bytes that landed
  await invoke("import_project_file", {
    basePath,
    projectRel,
    destRel,
    sourcePath,
  });
  const remove = () =>
    invoke("delete_project_entry", { basePath, rel: `${projectRel}/${destRel}` }).catch(() => {});

  try {
    const result = await invoke<{ data: string; size_bytes: number }>(
      "read_project_file_base64",
      { basePath, rel: `${projectRel}/${destRel}` },
    );
    if (result.size_bytes > 1024 * 1024) {
      await remove();
      return { accepted: false, reason: "Textures are limited to 1 MB" };
    }
    const bytes = base64ToBytes(result.data);
    const header = inspectPng(bytes);
    if (!header.ok) {
      await remove();
      return { accepted: false, reason: header.reason };
    }
    if (header.width !== header.height) {
      await remove();
      return { accepted: false, reason: `Textures must be square — this is ${header.width}x${header.height}` };
    }
    if (![16, 32, 64, 128].includes(header.width)) {
      await remove();
      return { accepted: false, reason: "Use a 16/32/64/128 px square texture (the Minecraft standard)" };
    }
    return { accepted: true, rel: `${projectRel}/${destRel}` };
  } catch (error) {
    await remove();
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
