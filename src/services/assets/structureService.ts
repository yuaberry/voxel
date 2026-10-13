/**
 * Structure Studio (roadmap §9.6) — REAL .nbt structures, procedurally
 * generated in the Rust perimeter. The block map feeds the isometric
 * preview; the nbt bytes are exactly what a structure block loads.
 */
import { invoke } from "@tauri-apps/api/core";

export const STRUCTURE_KINDS = ["watchtower", "cottage", "obelisk", "ruin"] as const;
export type StructureKindId = (typeof STRUCTURE_KINDS)[number];

export interface StructureBlock {
  x: number;
  y: number;
  z: number;
  block: string;
}

export interface StructureGenResult {
  size: [number, number, number];
  blocks: StructureBlock[];
  blockCount: number;
  nbtBase64: string;
  wrotePath: string | null;
}

export function generateStructure(payload: {
  storageBase: string;
  projectRel: string;
  structureId: string;
  kind: StructureKindId;
  seed: number;
  mcVersion: string;
  previewOnly: boolean;
}): Promise<StructureGenResult> {
  return invoke<StructureGenResult>("structure_generate", { payload });
}

/** Block → base color for the isometric preview (vanilla-faithful feel). */
export const BLOCK_COLORS: Record<string, string> = {
  "minecraft:stone": "#7f7f7f",
  "minecraft:stone_bricks": "#7a7a7a",
  "minecraft:mossy_stone_bricks": "#6e7d5f",
  "minecraft:cracked_stone_bricks": "#8a8a8a",
  "minecraft:stone_brick_wall": "#767676",
  "minecraft:cobblestone": "#7d7d7d",
  "minecraft:mossy_cobblestone": "#6f7f6a",
  "minecraft:polished_deepslate": "#4a4d55",
  "minecraft:chiseled_deepslate": "#454850",
  "minecraft:deepslate_tiles": "#3a3c44",
  "minecraft:spruce_planks": "#6e4f2c",
  "minecraft:spruce_log": "#4a3520",
  "minecraft:spruce_stairs": "#6e4f2c",
  "minecraft:dark_oak_planks": "#3f2c17",
  "minecraft:dark_oak_fence": "#3f2c17",
  "minecraft:glass_pane": "#cfe8ef",
  "minecraft:lantern": "#e8b23c",
  "minecraft:crafting_table": "#7c5a34",
  "minecraft:amethyst_block": "#8b6ad1",
  "minecraft:large_amethyst_bud": "#a37ddb",
  "minecraft:small_amethyst_bud": "#c4a7ee",
  "minecraft:candle": "#e8dcc0",
};

/** Neutral fallback so unknown blocks still render as something honest. */
export function colorForBlock(id: string): string {
  return BLOCK_COLORS[id.split("[")[0]] ?? "#5a5f6b";
}
