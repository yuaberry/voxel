/**
 * The custom pickaxe texture was silently broken for the owner.
 *
 * The generator shipped the PNG with a bare `resource_pack/...` path, so
 * the installer wrote it NEXT TO THE SERVER ROOT instead of inside the
 * datapack. The pack inside `world/datapacks/nexus_rank/resource_pack/`
 * ended up with 4 files and NO image: the model
 * (`custom_pickaxe.json`) referenced a texture that did not exist, so
 * the pickaxe the module promises never showed its art.
 *
 * These tests are the guard: the pack is validated STRUCTURALLY — every
 * texture every model references must exist in the pack, the PNG must be
 * a real image, and nothing of the pack may escape the datapack folder.
 */

import { describe, expect, it } from "vitest";
import { generateModuleFiles } from "./serverModules";
import { MINE_RANK_PICKAXE_TEXTURE_PNG_BASE64 } from "./mineRankServer";

/** Decodes a base64 PNG and validates the header + IHDR dimensions. */
function readPng(base64: string): { width: number; height: number; colorType: number } {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect(Array.from(bytes.subarray(0, 8))).toEqual(signature);
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    colorType: bytes[25],
  };
}

describe("the Mine Rank resource pack is complete", () => {
  const files = generateModuleFiles("mine_rank");
  const packFiles = files.filter((f) =>
    f.path.startsWith("world/datapacks/nexus_rank/resource_pack/"),
  );
  const byPath = new Map(packFiles.map((f) => [f.path, f]));

  it("ships the 5 files of the pack, the PNG included", () => {
    expect(packFiles).toHaveLength(5);
    expect([...byPath.keys()].sort()).toEqual([
      "world/datapacks/nexus_rank/resource_pack/assets/mine_rank/lang/pt_br.json",
      "world/datapacks/nexus_rank/resource_pack/assets/mine_rank/models/item/custom_pickaxe.json",
      "world/datapacks/nexus_rank/resource_pack/assets/mine_rank/textures/item/custom_pickaxe.png",
      "world/datapacks/nexus_rank/resource_pack/assets/minecraft/models/item/diamond_pickaxe.json",
      "world/datapacks/nexus_rank/resource_pack/pack.mcmeta",
    ]);
  });

  it("writes the PNG as bytes with a real 16x16 RGBA image", () => {
    const png = byPath.get(
      "world/datapacks/nexus_rank/resource_pack/assets/mine_rank/textures/item/custom_pickaxe.png",
    );
    expect(png?.base64, "the texture must travel as base64 (it is binary)").toBeTruthy();
    const { width, height, colorType } = readPng(png!.base64!);
    expect([width, height]).toEqual([16, 16]);
    expect(colorType).toBe(6); // RGBA
  });

  it("resolves every texture the pack's models reference", () => {
    // the pack has NO filesystem to read from — resolve against the pack
    // itself, exactly like the game does. A `minecraft:` reference is
    // satisfied by the BASE game (the pack only overrides the model, it
    // does not need to carry the vanilla art); a `mine_rank:` one has to
    // be in the pack.
    const textures = new Set(
      packFiles
        .filter((f) => f.path.endsWith(".png"))
        .map((f) =>
          f.path
            .replace(/.*\/resource_pack\/assets\//, "")
            .replace(/\.png$/, "")
            .replace(/^([a-z_0-9]+)\//, "$1:")
            .replace("textures/", ""),
        ),
    );
    expect(textures).toContain("mine_rank:item/custom_pickaxe");

    const models = packFiles.filter((f) => f.path.includes("/models/") && f.path.endsWith(".json"));
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      const parsed = JSON.parse(model.content) as { textures?: Record<string, string> };
      for (const layer of Object.values(parsed.textures ?? {})) {
        if (layer.startsWith("minecraft:")) continue; // from the base game
        expect(
          textures.has(layer),
          `${model.path} references "${layer}" — the texture must exist in the pack`,
        ).toBe(true);
      }
    }
  });

  it("keys the override on custom_model_data 1, the value the item carries", () => {
    const model = byPath.get(
      "world/datapacks/nexus_rank/resource_pack/assets/minecraft/models/item/diamond_pickaxe.json",
    );
    const parsed = JSON.parse(model!.content) as {
      overrides?: { predicate?: { custom_model_data?: number }; model?: string }[];
    };
    expect(parsed.overrides).toHaveLength(1);
    expect(parsed.overrides?.[0]?.predicate).toEqual({ custom_model_data: 1 });
    expect(parsed.overrides?.[0]?.model).toBe("mine_rank:item/custom_pickaxe");
  });

  it("keeps the embedded texture the single source of truth", () => {
    const png = byPath.get(
      "world/datapacks/nexus_rank/resource_pack/assets/mine_rank/textures/item/custom_pickaxe.png",
    );
    expect(png?.base64).toBe(MINE_RANK_PICKAXE_TEXTURE_PNG_BASE64);
  });
});
