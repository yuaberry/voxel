/**
 * Runtime service — the automatic Minecraft download.
 *
 * The owner's requirement: when a Microsoft or Ely.by account is configured,
 * VOXEL downloads Minecraft by itself — no "run Prepare first" ritual, no
 * game that refuses to start because a jar was never fetched.
 *
 * The runtime lives in the shared cache (`<workspace>/minecraft/`), so a
 * second project of the same version costs almost nothing: the SHA-1 check
 * turns every already-present file into a "skipped" one.
 */

import {
  prepareInstance,
  runtimeStatus,
  runtimeLoaderFor,
  type LaunchProgress,
  type RuntimeLoader,
} from "./instanceService";
import { resolveLoaderVersion } from "./instanceService";
import type { ProjectRecord } from "@/types";

export interface RuntimeTarget {
  project: ProjectRecord;
  loader: RuntimeLoader;
  loaderVersion: string;
}

export interface RuntimeDownloadPlan {
  /** Projects whose runtime still has to be downloaded. */
  pending: RuntimeTarget[];
  /** Projects whose runtime is already complete on disk. */
  ready: ProjectRecord[];
}

export interface RuntimeDownloadResult {
  downloadedFiles: number;
  skippedFiles: number;
  prepared: ProjectRecord[];
  failed: { project: ProjectRecord; error: string }[];
}

/** Normalizes the project list into the runtimes that must exist. */
export function runtimeTargets(projects: ProjectRecord[]): RuntimeTarget[] {
  return projects.map((project) => ({
    project,
    loader: runtimeLoaderFor(project),
    loaderVersion: "",
  }));
}

/**
 * Probes every project runtime and tells what still has to be downloaded.
 * A runtime that is already complete is never re-downloaded.
 */
export async function planRuntimeDownloads(
  basePath: string,
  projects: ProjectRecord[],
): Promise<RuntimeDownloadPlan> {
  const pending: RuntimeTarget[] = [];
  const ready: ProjectRecord[] = [];

  for (const target of runtimeTargets(projects)) {
    const { project, loader } = target;
    const loaderVersion = await resolveLoaderVersion(project);
    const status = await runtimeStatus(
      basePath,
      project.minecraft_version,
      loader,
      project.slug,
    ).catch(() => null);

    if (status?.ready) {
      ready.push(project);
      continue;
    }
    pending.push({ ...target, loaderVersion });
  }

  return { pending, ready };
}

/**
 * Downloads the missing runtimes (the automatic download after sign-in).
 *
 * Never throws: a failed download is reported per project so one broken
 * version cannot stop the others (and cannot break the sign-in that
 * triggered it).
 */
export async function downloadProjectRuntimes(
  basePath: string,
  projects: ProjectRecord[],
  onProgress?: (progress: LaunchProgress & { project: ProjectRecord }) => void,
): Promise<RuntimeDownloadResult> {
  const result: RuntimeDownloadResult = {
    downloadedFiles: 0,
    skippedFiles: 0,
    prepared: [],
    failed: [],
  };
  if (!basePath || projects.length === 0) return result;

  const plan = await planRuntimeDownloads(basePath, projects);

  for (const target of plan.pending) {
    const { project, loader, loaderVersion } = target;
    try {
      const prepared = await prepareInstance(
        basePath,
        project.slug,
        project.minecraft_version,
        loader,
        loaderVersion,
        onProgress
          ? (progress) => onProgress({ ...progress, project })
          : undefined,
      );
      result.downloadedFiles += prepared.downloaded;
      result.skippedFiles += prepared.skipped;
      result.prepared.push(project);
    } catch (error) {
      result.failed.push({
        project,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
