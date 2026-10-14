/**
 * Modpack Creator v1 (roadmap §9.5) — export/import with zero external
 * sources: jars built by THIS workspace and shaderpacks authored HERE.
 */
import { invoke } from "@tauri-apps/api/core";

export interface ExportableJar {
  projectSlug: string;
  projectName: string;
  jarFile: string;
}

export interface ExportableAssets {
  jars: ExportableJar[];
  shaderPacks: string[];
}

export interface ModpackExportRequest {
  storageBase: string;
  name: string;
  mcVersion: string;
  loader: string;
  version: string;
  mods: Array<{ projectSlug: string; jarFile: string }>;
  shaderPacks: string[];
}

export interface ModpackExportResult {
  zipPath: string;
  modCount: number;
  shaderCount: number;
}

export interface ModpackImportResult {
  modpackName: string;
  mcVersion: string;
  loader: string;
  modCount: number;
  shaderCount: number;
}

export function getExportableAssets(storageBase: string): Promise<ExportableAssets> {
  return invoke<ExportableAssets>("modpack_exportable_assets", { storageBase });
}

export function exportModpack(payload: ModpackExportRequest): Promise<ModpackExportResult> {
  return invoke<ModpackExportResult>("modpack_export", { payload });
}

export function importModpackInto(
  storageBase: string,
  zipPath: string,
  instanceSlug: string,
): Promise<ModpackImportResult> {
  return invoke<ModpackImportResult>("modpack_import_into", {
    storageBase,
    zipPath,
    instanceSlug,
  });
}

export interface CompatCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ModpackCompatibility {
  checks: CompatCheck[];
  score: number;
  modCount: number;
}

export function checkModpackCompatibility(
  storageBase: string,
  mods: Array<{ projectSlug: string; jarFile: string }>,
): Promise<ModpackCompatibility> {
  return invoke<ModpackCompatibility>("modpack_check_compatibility", {
    storageBase,
    mods,
  });
}

export interface SavedModpack {
  fileName: string;
  name: string;
  version: string;
  mcVersion: string;
  loader: string;
  modCount: number;
  shaderPackCount: number;
  createdAt: string;
  sizeBytes: number;
  fullPath: string;
}

export function listModpacks(storageBase: string): Promise<SavedModpack[]> {
  return invoke<SavedModpack[]>("modpack_list", { storageBase });
}

export function deleteModpack(storageBase: string, fileName: string): Promise<void> {
  return invoke("modpack_delete", { storageBase, fileName });
}

export function updateModpackManifest(payload: {
  storageBase: string;
  fileName: string;
  name: string;
  version: string;
}): Promise<string> {
  return invoke("modpack_update_manifest", { payload });
}
