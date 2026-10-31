/**
 * Resource Pack Generator — pure orchestration logic tested without the
 * Tauri runtime. Every command is injected; assertions verify what was
 * actually written to disk.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createResourcePack,
  type ResourcePackCmds,
  type ResourcePackOptions,
  packMetaJson,
  buildLangFiles,
  itemModelJson,
  blockModelJson,
  blockstateJson,
} from "./resourcePackService";

const baseOptions: ResourcePackOptions = {
  storageBase: "/workspace",
  projectRel: "projects/prison-pack",
  packName: "Prison Pack",
  packDescription: "A prison-themed resource pack",
  modId: "nexus_prison",
  language: "pt_br",
  items: [
    {
      id: "prison_coin",
      textureStyle: "gem",
      primary: "#fbbf24",
      secondary: "#a78bfa",
      frames: 4,
      displayName: "Prison Coin",
    },
    {
      id: "prison_pickaxe",
      textureStyle: "sword",
      primary: "#7a7a7a",
      secondary: "#fbbf24",
      frames: 1,
      displayName: "Prison Pickaxe",
    },
  ],
  blocks: [
    {
      id: "prison_bar",
      textureStyle: "panel",
      primary: "#1f2937",
      secondary: "#fbbf24",
      displayName: "Prison Bar",
    },
  ],
  generateSounds: true,
};

function makeCmds(overrides: Partial<ResourcePackCmds> = {}): ResourcePackCmds & {
  writes: Array<{ relPath: string; content: string }>;
  textures: Array<{ itemId: string; frames?: number }>;
} {
  const writes: Array<{ relPath: string; content: string }> = [];
  const textures: Array<{ itemId: string; frames?: number }> = [];
  return {
    generateItemTexture: vi.fn().mockImplementation(async (payload) => {
      textures.push({ itemId: payload.itemId, frames: payload.frames });
      return { wrotePath: `/workspace/${payload.projectRel}/${payload.itemId}.png`, pngBase64: "iVBORw0KGgo=" };
    }),
    writeProjectFile: vi.fn().mockImplementation(async (_base, relPath, content) => {
      writes.push({ relPath, content });
    }),
    writes,
    textures,
    ...overrides,
  };
}

describe("Resource Pack Generator — pure helpers", () => {
  it("packMetaJson produces valid pack.mcmeta", () => {
    const meta = JSON.parse(packMetaJson("My Pack", "A test pack"));
    expect(meta.pack.pack_format).toBe(15);
    expect(meta.pack.description).toContain("My Pack");
  });

  it("buildLangFiles creates entries for items and blocks", () => {
    const { enUs, ptBr } = buildLangFiles(
      [{ id: "coin", textureStyle: "gem", primary: "#fff", secondary: "#000", displayName: "Coin" }],
      [{ id: "bar", textureStyle: "panel", primary: "#fff", secondary: "#000", displayName: "Bar" }],
    );
    expect(enUs["item.coin"]).toBe("Coin");
    expect(enUs["block.bar"]).toBe("Bar");
    expect(ptBr["item.coin"]).toBe("Coin");
    expect(ptBr["block.bar"]).toBe("Bar");
  });

  it("itemModelJson points to the item texture", () => {
    const model = JSON.parse(itemModelJson("nexus_prison", "prison_coin"));
    expect(model.parent).toBe("item/generated");
    expect(model.textures.layer0).toBe("nexus_prison:item/prison_coin");
  });

  it("blockModelJson points to the block texture", () => {
    const model = JSON.parse(blockModelJson("nexus_prison", "prison_bar"));
    expect(model.parent).toBe("block/cube_all");
    expect(model.textures.all).toBe("nexus_prison:block/prison_bar");
  });

  it("blockstateJson references the block model", () => {
    const state = JSON.parse(blockstateJson("nexus_prison", "prison_bar"));
    expect(state.variants[""].model).toBe("nexus_prison:block/prison_bar");
  });
});

describe("Resource Pack Generator — full orchestration", () => {
  it("writes pack.mcmeta, lang files, models, textures, and sounds", async () => {
    const cmds = makeCmds();
    const result = await createResourcePack(baseOptions, cmds);

    // pack.mcmeta written
    expect(cmds.writes.some((w) => w.relPath.endsWith("pack.mcmeta"))).toBe(true);

    // lang files written (pt_br + en_us fallback)
    expect(cmds.writes.some((w) => w.relPath.endsWith("pt_br.json"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("en_us.json"))).toBe(true);

    // item models written
    expect(cmds.writes.some((w) => w.relPath.endsWith("prison_coin.json") && w.relPath.includes("models/item"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("prison_pickaxe.json") && w.relPath.includes("models/item"))).toBe(true);

    // block models + blockstates written
    expect(cmds.writes.some((w) => w.relPath.endsWith("prison_bar.json") && w.relPath.includes("models/block"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("prison_bar.json") && w.relPath.includes("blockstates"))).toBe(true);

    // textures generated (real pixel art via Rust)
    expect(cmds.textures.some((t) => t.itemId === "prison_coin")).toBe(true);
    expect(cmds.textures.some((t) => t.itemId === "prison_pickaxe")).toBe(true);
    expect(cmds.textures.some((t) => t.itemId === "prison_bar")).toBe(true);

    // coin is animated (frames > 0)
    const coinTexture = cmds.textures.find((t) => t.itemId === "prison_coin");
    expect(coinTexture?.frames).toBe(4);

    // sounds skeleton written
    expect(cmds.writes.some((w) => w.relPath.endsWith("sounds.json"))).toBe(true);

    // result summary
    expect(result.summary).toContain("Prison Pack");
    expect(result.summary).toContain("2 items");
    expect(result.summary).toContain("1 blocks");
    expect(result.itemsWritten.length).toBe(2);
    expect(result.blocksWritten.length).toBe(1);
  });

  it("generateSounds=false skips sounds.json", async () => {
    const cmds = makeCmds();
    await createResourcePack({ ...baseOptions, generateSounds: false }, cmds);
    expect(cmds.writes.some((w) => w.relPath.endsWith("sounds.json"))).toBe(false);
  });

  it("en_us language writes en_us first, pt_br as fallback", async () => {
    const cmds = makeCmds();
    await createResourcePack({ ...baseOptions, language: "en_us" }, cmds);

    const ptBrFile = cmds.writes.find((w) => w.relPath.endsWith("pt_br.json"));
    const enUsFile = cmds.writes.find((w) => w.relPath.endsWith("en_us.json"));
    expect(enUsFile).toBeDefined();
    expect(ptBrFile).toBeDefined();
  });
});
