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

export interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  files: ModrinthVersionFile[];
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
