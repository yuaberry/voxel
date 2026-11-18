/**
 * The version catalog of the launcher — Java Edition from the official
 * Mojang manifest, and the honest truth about Bedrock.
 *
 * The catalog lives in Rust (the same perimeter that downloads the runtime):
 * it reads the official piston-meta manifest, marks what is already on this
 * machine by the shared cache, and states that Bedrock cannot be installed
 * from a Linux desktop instead of offering a button that cannot work.
 */

import { invoke } from "@tauri-apps/api/core";

export type VersionKind = "release" | "snapshot" | "old_beta" | "old_alpha";

export interface VersionCatalogEntry {
  id: string;
  kind: VersionKind;
  releaseTime: string;
  installed: boolean;
  /** Can this launcher open it? (the classic/alpha/beta eras cannot) */
  runnable: boolean;
  notRunnableReason: string;
}

export interface BedrockEdition {
  name: string;
  platform: string;
  url: string;
}

export interface BedrockInfo {
  installable: boolean;
  reason: string;
  editions: BedrockEdition[];
}

export interface VersionCatalog {
  java: VersionCatalogEntry[];
  bedrock: BedrockInfo;
}

/** The instance a downloaded version plays in (vanilla, no project). */
export function vanillaInstanceSlug(mcVersion: string): string {
  return `vanilla-${mcVersion}`;
}

export async function listVersionCatalog(basePath: string): Promise<VersionCatalog> {
  return invoke<VersionCatalog>("launcher_version_catalog", { basePath });
}

/** The PT-BR label of a version kind (the manifest speaks English). */
export function versionKindLabel(kind: VersionKind): string {
  switch (kind) {
    case "release":
      return "estável";
    case "snapshot":
      return "experimental";
    case "old_beta":
      return "beta antiga";
    case "old_alpha":
      return "alpha antiga";
    default:
      return kind;
  }
}

/** A date the owner can read (the manifest ships ISO-8601). */
export function versionReleased(releaseTime: string): string {
  if (!releaseTime) return "";
  const date = new Date(releaseTime);
  if (Number.isNaN(date.getTime())) return releaseTime;
  return date.toLocaleDateString("pt-BR");
}