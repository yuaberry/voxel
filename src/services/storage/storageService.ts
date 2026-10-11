import { invoke } from "@tauri-apps/api/core";
import type { AppPaths, StorageInfo } from "@/types";

export async function getDefaultStorageBase(): Promise<string> {
  return invoke<string>("get_default_storage_base");
}

export async function ensureStorageDirs(basePath: string): Promise<StorageInfo> {
  return invoke<StorageInfo>("ensure_storage_dirs", { basePath });
}

export async function getAppPaths(): Promise<AppPaths> {
  return invoke<AppPaths>("get_app_paths");
}

export async function openInFileManager(path: string): Promise<void> {
  await invoke("open_in_file_manager", { path });
}

/** Opens a Microsoft sign-in page in the system browser (Rust-guarded). */
export async function workspaceLegacyStatus(): Promise<{
  exists: boolean;
  path: string;
}> {
  return invoke("workspace_legacy_status");
}

export async function workspaceMigrateLegacy(): Promise<string> {
  return invoke<string>("workspace_migrate_legacy");
}

export async function openAuthUrl(url: string): Promise<void> {
  await invoke("open_auth_url", { url });
}
