import { invoke } from "@tauri-apps/api/core";

/**
 * Reference Board — user-provided images inside `.voxel/references/`.
 * Images are stored in the project, listed, attached to chat messages as
 * vision parts, and removable. All paths go through the Rust path guard.
 */

export interface ReferenceImage {
  relPath: string;
  fileName: string;
  sizeBytes: number;
}

interface FileEntryLike {
  path: string;
  is_dir: boolean;
  size_bytes: number;
}

let storageBaseCache: string | null = null;

export async function setReferenceStorageBase(base: string): Promise<void> {
  storageBaseCache = base;
}

function base(): string {
  if (!storageBaseCache) throw new Error("Storage base not configured");
  return storageBaseCache;
}

const REF_DIR = ".voxel/references";

export async function listReferences(projectSlug: string): Promise<ReferenceImage[]> {
  const files = await invoke<FileEntryLike[]>("list_project_files", {
    basePath: base(),
    projectRel: `projects/${projectSlug}`,
  });
  return files
    .filter((f) => !f.is_dir && f.path.startsWith(`${REF_DIR}/`))
    .map((f) => ({
      relPath: f.path,
      fileName: f.path.split("/").pop() ?? f.path,
      sizeBytes: f.size_bytes,
    }));
}

export async function importReference(
  projectSlug: string,
  sourcePath: string,
): Promise<string> {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? "reference";
  const destRel = `${REF_DIR}/${fileName}`;
  await invoke("import_project_file", {
    basePath: base(),
    projectRel: `projects/${projectSlug}`,
    destRel,
    sourcePath,
  });
  return destRel;
}

export async function readReferenceBase64(
  projectSlug: string,
  relPath: string,
): Promise<{ base64: string; mediaType: string }> {
  const result = await invoke<{ data: string; media_type: string; size_bytes: number }>(
    "read_project_file_base64",
    {
      basePath: base(),
      rel: `projects/${projectSlug}/${relPath}`,
    },
  );
  return { base64: result.data, mediaType: result.media_type };
}

export async function deleteReference(
  projectSlug: string,
  relPath: string,
): Promise<void> {
  await invoke("delete_project_entry", {
    basePath: base(),
    rel: `projects/${projectSlug}/${relPath}`,
  });
}
