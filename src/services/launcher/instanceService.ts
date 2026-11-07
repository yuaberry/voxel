import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MinecraftAccount, ProjectRecord } from "@/types";

/**
 * Instance service (Fase 5) — prepare, deploy and launch with progress
 * events. All downloads flow through the Rust launcher (official sources,
 * SHA-1 verified) and land in the shared workspace cache.
 */

export interface PrepareResult {
  instanceDir: string;
  downloaded: number;
  skipped: number;
}

export interface LaunchProgress {
  done: number;
  total: number;
  detail: string;
}

export async function prepareInstance(
  basePath: string,
  projectSlug: string,
  mcVersion: string,
  loaderVersion: string,
  onProgress?: (progress: LaunchProgress) => void,
): Promise<PrepareResult> {
  let unlisten: UnlistenFn | null = null;
  try {
    if (onProgress) {
      unlisten = await listen<{
        project: string;
        done: number;
        total: number;
        detail: string;
      }>("launcher:progress", (event) => {
        if (event.payload.project !== projectSlug) return;
        onProgress({
          done: event.payload.done,
          total: event.payload.total,
          detail: event.payload.detail,
        });
      });
    }
    return await invoke<PrepareResult>("launcher_prepare", {
      basePath,
      projectSlug,
      mcVersion,
      loaderVersion,
    });
  } finally {
    unlisten?.();
  }
}

export async function copyModJar(
  basePath: string,
  projectSlug: string,
  projectRel: string,
): Promise<string | null> {
  return invoke<string | null>("launcher_copy_mod_jar", {
    basePath,
    projectSlug,
    projectRel,
  });
}

export async function launchGame(options: {
  basePath: string;
  projectSlug: string;
  mcVersion: string;
  account: MinecraftAccount;
  javaPath?: string;
  ramMb?: number;
  onLog?: (line: string) => void;
  onExit?: (success: boolean) => void;
}): Promise<string> {
  const key = `launch/${options.projectSlug}`;
  const unlistenLog = await listen<{ project: string; line: string; stream: string }>(
    "launch:log",
    (event) => {
      if (event.payload.project !== key) return;
      options.onLog?.(event.payload.line);
    },
  );
  const unlistenExit = await listen<{ project: string; success: boolean }>(
    "launch:exit",
    (event) => {
      if (event.payload.project !== key) return;
      options.onExit?.(event.payload.success);
    },
  );
  void unlistenLog;
  void unlistenExit;

  return invoke<string>("launcher_launch", {
    basePath: options.basePath,
    projectSlug: options.projectSlug,
    mcVersion: options.mcVersion,
    account: {
      provider: options.account.provider,
      username: options.account.username,
      uuid: options.account.uuid,
      accessToken: options.account.accessToken,
    },
    javaPath: options.javaPath,
    ramMb: options.ramMb,
  });
}

export async function stopGame(projectSlug: string): Promise<void> {
  await invoke("stop_process", { key: `launch/${projectSlug}` });
}

/** Checks whether an instance folder already exists for the project. */
export async function instanceExists(
  basePath: string,
  projectSlug: string,
): Promise<boolean> {
  try {
    const { readProjectFile } = await import("@/services/projects/projectsService");
    await readProjectFile(basePath, `instances/${projectSlug}/options.txt`);
    return true;
  } catch {
    return false;
  }
}

export interface InstanceRecordInput {
  id: string;
  projectId: string;
  name: string;
  mcVersion: string;
  loaderVersion: string;
  path: string;
}

export async function registerInstance(
  instance: InstanceRecordInput,
): Promise<void> {
  try {
    const { getDb } = await import("@/services/db/client");
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO instances
        (id, project_id, name, minecraft_version, loader, path, ram_mb, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))`,
      [
        instance.id,
        instance.projectId,
        instance.name,
        instance.mcVersion,
        "fabric",
        instance.path,
        4096,
      ],
    );
  } catch (error) {
    console.warn("Failed to register instance row:", error);
  }
}

/** Resolves the Fabric loader version from the version catalog (live data). */
export async function resolveLoaderVersion(project: ProjectRecord): Promise<string> {
  try {
    const { getVersion } = await import("@/services/minecraft/versionCatalog");
    const info = await getVersion(project.minecraft_version);
    return info?.fabric?.loader ?? "0.16.9";
  } catch {
    return "0.16.9";
  }
}
