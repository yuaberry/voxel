/**
 * Project ↔ Server connection — deploy the project's datapack (structures,
 * dimensions, advancements) into a server's world/datapacks/ so what you
 * build in the mod is live on your server. Same-project deploys replace
 * atomically; other packs are never touched.
 */
import { invoke } from "@tauri-apps/api/core";

export interface ProjectDeployResult {
  filesCopied: number;
  datapackDir: string;
  hasStructures: boolean;
  hasDimensions: boolean;
}

export function deployProjectDatapack(
  storageBase: string,
  projectSlug: string,
  serverSlug: string,
): Promise<ProjectDeployResult> {
  return invoke<ProjectDeployResult>("project_deploy_datapack", {
    payload: { storageBase, projectSlug, serverSlug },
  });
}
