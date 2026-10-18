import { invoke } from "@tauri-apps/api/core";
import type {
  CreateProjectRequest,
  CreateProjectResult,
  ProjectFileEntry,
  SnapshotEntry,
} from "@/types";

// ---------------------------------------------------------------------------
// Slug / naming helpers (shared by wizard + palette)
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function toModId(slug: string): string {
  return slug.replace(/-/g, "_").slice(0, 64);
}

export function toPascalCase(modId: string): string {
  return modId
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function defaultPackageFor(modId: string): string {
  const clean = modId.replace(/_/g, "");
  return `com.voxel.${clean}`;
}

// ---------------------------------------------------------------------------
// Tauri command wrappers — all paths are relative to the storage base and
// validated by the Rust path guard.
// ---------------------------------------------------------------------------

export async function createProject(
  request: CreateProjectRequest,
): Promise<CreateProjectResult> {
  return invoke<CreateProjectResult>("create_project", { payload: request });
}

export async function listProjectFiles(
  basePath: string,
  projectRel: string,
): Promise<ProjectFileEntry[]> {
  return invoke<ProjectFileEntry[]>("list_project_files", {
    basePath,
    projectRel,
  });
}

export async function readProjectFile(
  basePath: string,
  rel: string,
): Promise<string> {
  const result = await invoke<{ content: string }>("read_project_file", {
    basePath,
    rel,
  });
  return result.content;
}

export async function writeProjectFile(
  basePath: string,
  rel: string,
  content: string,
): Promise<void> {
  await invoke("write_project_file", { basePath, rel, content });
}

export async function createProjectDirectory(
  basePath: string,
  rel: string,
): Promise<void> {
  await invoke("create_project_directory", { basePath, rel });
}

export async function deleteProjectEntry(
  basePath: string,
  rel: string,
): Promise<void> {
  await invoke("delete_project_entry", { basePath, rel });
}

export async function renameProjectEntry(
  basePath: string,
  rel: string,
  newName: string,
): Promise<void> {
  await invoke("rename_project_entry", { basePath, rel, newName });
}

export async function createSnapshot(
  basePath: string,
  projectRel: string,
  reason: string,
): Promise<SnapshotEntry> {
  return invoke<SnapshotEntry>("project_create_snapshot", {
    basePath,
    projectRel,
    reason,
  });
}

export async function listSnapshots(
  basePath: string,
  projectRel: string,
): Promise<SnapshotEntry[]> {
  return invoke<SnapshotEntry[]>("project_list_snapshots", {
    basePath,
    projectRel,
  });
}

export async function restoreSnapshot(
  basePath: string,
  projectRel: string,
  sha: string,
): Promise<void> {
  await invoke("project_snapshot_restore", { basePath, projectRel, sha });
}

export async function projectGitStatus(
  basePath: string,
  projectRel: string,
): Promise<string> {
  return invoke<string>("project_git_status", { basePath, projectRel });
}

/** Deletes a whole project directory from disk (Rust-guarded). */
export async function deleteProjectFromDisk(
  basePath: string,
  projectRel: string,
): Promise<void> {
  // The dedicated command stops the project's Gradle daemon first (it
  // holds the folder on Windows), retries, and names the blocked file.
  const slug = projectRel.trim().replace(/^projects\//, "").replace(/\/$/, "");
  if (!slug || slug.includes("/") || slug.includes("..")) {
    throw new Error("Invalid project path");
  }
  await invoke("project_delete", { basePath, projectSlug: slug });
}

// ---------------------------------------------------------------------------
// VOXEL Agent tool wrappers (Phase 3)
// ---------------------------------------------------------------------------

export interface EditFileResult {
  occurrences: number;
  new_length: number;
}

export async function editProjectFile(
  basePath: string,
  rel: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): Promise<EditFileResult> {
  return invoke<EditFileResult>("edit_project_file", {
    basePath,
    rel,
    find,
    replace,
    replaceAll,
  });
}

export interface SearchMatch {
  path: string;
  line_number: number;
  line_text: string;
}

export async function searchProject(
  basePath: string,
  projectRel: string,
  query: string,
  caseSensitive = false,
  maxResults = 50,
): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>("search_project", {
    basePath,
    projectRel,
    query,
    caseSensitive,
    maxResults,
  });
}

export async function projectGitDiff(
  basePath: string,
  projectRel: string,
): Promise<string> {
  return invoke<string>("project_git_diff", { basePath, projectRel });
}
