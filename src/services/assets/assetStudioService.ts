/**
 * Asset Studio (roadmap §9.6) — real 16x16 pixel-art generation in the
 * Rust security perimeter. Same recipes as the premium template sprites,
 * any palette. Preview returns base64 without touching disk.
 */
import { invoke } from "@tauri-apps/api/core";

export const ITEM_STYLES = [
  "sword",
  "gem",
  "ingot",
  "orb",
  "apple",
  "book",
  "wand",
] as const;

export type ItemStyle = (typeof ITEM_STYLES)[number];

export interface TextureGenRequest {
  storageBase: string;
  projectRel: string;
  modId: string;
  itemId: string;
  style: ItemStyle;
  primary: string;
  secondary: string;
  previewOnly: boolean;
}

export interface TextureGenResult {
  pngBase64: string;
  wrotePath: string | null;
}

export function generateItemTexture(
  payload: TextureGenRequest,
): Promise<TextureGenResult> {
  return invoke<TextureGenResult>("generate_item_texture", { payload });
}
