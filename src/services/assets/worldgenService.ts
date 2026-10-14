/**
 * World Studio v1 — REAL custom dimensions as datapack files inside the
 * project's mod jar. Two JSONs (dimension_type + dimension), era-factual
 * schemas, honest about the supported range (1.20.1-1.21.1).
 */
import { invoke } from "@tauri-apps/api/core";

export const WORLD_PRESETS = [
  "eternal_realm",
  "depths",
  "ember_wastes",
  "void_sanctum",
] as const;
export type WorldPresetId = (typeof WORLD_PRESETS)[number];

export interface DimensionGenResult {
  dimensionTypePath: string;
  dimensionPath: string;
  traits: string[];
}

export function createDimension(payload: {
  storageBase: string;
  projectRel: string;
  dimensionId: string;
  preset: WorldPresetId;
  mcVersion: string;
}): Promise<DimensionGenResult> {
  return invoke<DimensionGenResult>("worldgen_create_dimension", { payload });
}

/** Honest support check for the wizard UI (mirrors the Rust guard). */
export function dimensionSchemaSupported(mcVersion: string): boolean {
  const parts = mcVersion.trim().split(".").map((n) => Number(n) || 0);
  const [major, minor, patch] = [
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0,
  ];
  return (
    [major, minor, patch] >= [1, 20, 1] && [major, minor, patch] < [1, 21, 2]
  );
}
