/**
 * Full Pack Generator (Super Prompt — "one command generates everything").
 * Every command is injected, so these tests run pure orchestration logic
 * without the Tauri runtime: the server is created, modules installed,
 * commands written, structures placed, assets generated and the pack
 * zipped — all with real assertions on what was actually produced.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createFullPack,
  type FullPackCmds,
  type FullPackOptions,
  prisonCustomCommands,
  prisonAssets,
  prisonStructures,
  modulesFor,
} from "./fullPackService";

const baseOptions: FullPackOptions = {
  basePath: "/workspace",
  slug: "prison-server",
  name: "My Prison",
  software: "paper",
  mcVersion: "1.20.1",
  port: 25565,
  ramMb: 2048,
  acceptEula: true,
  moduleKind: "prison",
  currencyName: "VoxelCoin",
  currencySymbol: "₦",
  prisonPrestigeMultiplier: 2,
  seed: 777,
  generateStructures: true,
  generateAssets: true,
  generateResourcePack: true,
  generateMod: true,
  modLoader: "fabric",
  createServerPack: true,
};

function makeCmds(overrides: Partial<FullPackCmds> = {}): FullPackCmds & {
  calls: { createServer: number; write: number; structure: number; texture: number; pack: number };
  writes: Array<{ relPath: string; content: string }>;
  createServerMock: ReturnType<typeof vi.fn>;
  structureMock: ReturnType<typeof vi.fn>;
  textureMock: ReturnType<typeof vi.fn>;
  packMock: ReturnType<typeof vi.fn>;
  resourcePackMock: ReturnType<typeof vi.fn>;
  modJavaMock: ReturnType<typeof vi.fn>;
} {
  const writes: Array<{ relPath: string; content: string }> = [];
  const calls = { createServer: 0, write: 0, structure: 0, texture: 0, pack: 0 };
  const createServerMock = vi.fn().mockResolvedValue({
    serverDir: "/workspace/servers/prison-server",
    jarPath: "/workspace/servers/prison-server/server.jar",
  });
  const writeMock = vi.fn().mockImplementation(async (_base: string, relPath: string, content: string) => {
    calls.write += 1;
    writes.push({ relPath, content });
  });
  const structureMock = vi.fn().mockImplementation(async () => {
    calls.structure += 1;
    return { wrotePath: `/workspace/servers/prison-server/world/datapacks/nexus_prison/structures/${Math.random().toString(36).slice(2)}.nbt` };
  });
  const textureMock = vi.fn().mockImplementation(async () => {
    calls.texture += 1;
    return { wrotePath: "/workspace/servers/prison-server/assets/textures/item/coin.png", pngBase64: "iVBORw0KGgo=" };
  });
  const packMock = vi.fn().mockResolvedValue({
    zipPath: "/workspace/server_packs/my-prison-server.zip",
    modCount: 42,
  });
  const resourcePackMock = vi.fn().mockResolvedValue({
    packPath: "/workspace/projects/prison-server-resourcepack",
    fileCount: 10,
    totalBytes: 50000,
    summary: "Resource pack created",
  });
  const modJavaMock = vi.fn().mockResolvedValue({
    modPath: "/workspace/projects/prison-server-mod",
    fileCount: 15,
    totalBytes: 100000,
    summary: "Mod created",
  });

  const cmds: FullPackCmds = {
    createServer: createServerMock,
    writeProjectFile: writeMock,
    generateStructure: structureMock,
    generateItemTexture: textureMock,
    exportServerPack: packMock,
    createResourcePack: resourcePackMock,
    createModJava: modJavaMock,
    ...overrides,
  };
  return { ...cmds, calls, writes, createServerMock, structureMock, textureMock, packMock, resourcePackMock, modJavaMock };
}

describe("Full Pack Generator — one command, everything real", () => {
  it("creates the server with prison properties and returns the setup result", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    expect(cmds.createServer).toHaveBeenCalledTimes(1);
    const [opts] = cmds.createServerMock.mock.calls[0];
    expect(opts.slug).toBe("prison-server");
    expect(opts.name).toBe("My Prison");
    expect(opts.mcVersion).toBe("1.20.1");
    expect(opts.acceptEula).toBe(true);
    expect(opts.properties["motd"]).toContain("My Prison");
    expect(opts.properties["enable-command-block"]).toBe("true");
    expect(opts.properties["difficulty"]).toBe("normal");
  });

  it("installs the prison + economy modules as datapack files", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    const moduleWrites = cmds.writes.filter((w) =>
      w.relPath.includes("world/datapacks/nexus_prison") ||
      w.relPath.includes("world/datapacks/nexus_economy"),
    );
    expect(moduleWrites.length).toBeGreaterThan(0);
    // pack.mcmeta is the honest signal a datapack was installed
    expect(cmds.writes.some((w) => w.relPath.endsWith("world/datapacks/nexus_prison/pack.mcmeta"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("world/datapacks/nexus_economy/pack.mcmeta"))).toBe(true);
  });

  it("writes custom /trigger commands (ranks, convert, prestige)", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    const commandWrites = cmds.writes.filter((w) =>
      w.relPath.includes("world/datapacks/nexus_custom"),
    );
    expect(commandWrites.length).toBeGreaterThan(0);
    // The /convert command carries tiers
    const convertFile = cmds.writes.find((w) =>
      w.relPath.includes("nexus_custom") && w.content.includes("convert"),
    );
    expect(convertFile).toBeDefined();
    // Tiers are written somewhere in the command datapack files
    const hasTier = cmds.writes.some((w) => w.content.includes("1000") || w.content.includes("tiers"));
    expect(hasTier).toBe(true);
  });

  it("generates procedural structures (prison block + mines A/B/C) with the seed", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    expect(cmds.generateStructure).toHaveBeenCalledTimes(4);
    const kinds = cmds.structureMock.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(["prison", "mine", "mine", "mine"]);
    // seed-driven: every structure uses the seed (or seed + offset)
    const seeds = cmds.structureMock.mock.calls.map((c) => c[0].seed);
    expect(seeds[0]).toBe(777);
    expect(seeds.every((s) => typeof s === "number")).toBe(true);
    // outputKind is server_module so structures land in the server datapack
    expect(cmds.structureMock.mock.calls.every((c) => c[0].outputKind === "server_module")).toBe(true);
    expect(cmds.structureMock.mock.calls.every((c) => c[0].previewOnly === false)).toBe(true);
  });

  it("generates real pixel-art assets (animated coin, pickaxe, panel)", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    expect(cmds.generateItemTexture).toHaveBeenCalledTimes(3);
    const ids = cmds.textureMock.mock.calls.map((c) => c[0].itemId);
    expect(ids).toContain("prison_coin");
    expect(ids).toContain("prison_pickaxe");
    expect(ids).toContain("prison_bar");
    // The coin is animated (frames > 0)
    const coin = cmds.textureMock.mock.calls.find((c) => c[0].itemId === "prison_coin");
    expect(coin![0].frames).toBe(4);
    expect(coin![0].primary).toBe("#fbbf24");
  });

  it("exports the whole server as a deployable pack ZIP", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);

    expect(cmds.exportServerPack).toHaveBeenCalledTimes(1);
    const [packOpts] = cmds.packMock.mock.calls[0];
    expect(packOpts.slug).toBe("prison-server");
    expect(packOpts.packName).toBe("My Prison");
  });

  it("moduleKind economy installs only economy (no prison datapack files)", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, moduleKind: "economy" }, cmds);

    const prisonWrites = cmds.writes.filter((w) =>
      w.relPath.includes("world/datapacks/nexus_prison"),
    );
    expect(prisonWrites.length).toBe(0);
    const ecoWrites = cmds.writes.filter((w) =>
      w.relPath.includes("world/datapacks/nexus_economy"),
    );
    expect(ecoWrites.length).toBeGreaterThan(0);
  });

  it("generateStructures=false skips structures entirely", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, generateStructures: false }, cmds);
    expect(cmds.generateStructure).toHaveBeenCalledTimes(0);
  });

  it("generateAssets=false skips assets entirely", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, generateAssets: false }, cmds);
    expect(cmds.generateItemTexture).toHaveBeenCalledTimes(0);
  });

  it("createServerPack=false skips the pack ZIP", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, createServerPack: false }, cmds);
    expect(cmds.exportServerPack).toHaveBeenCalledTimes(0);
  });

  it("generateResourcePack=false skips resource pack", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, generateResourcePack: false }, cmds);
    expect(cmds.createResourcePack).toHaveBeenCalledTimes(0);
  });

  it("generateMod=false skips Java mod generation", async () => {
    const cmds = makeCmds();
    await createFullPack({ ...baseOptions, generateMod: false }, cmds);
    expect(cmds.createModJava).toHaveBeenCalledTimes(0);
  });

  it("resource pack is generated when enabled", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);
    expect(cmds.createResourcePack).toHaveBeenCalledTimes(1);
    const [rpOpts] = cmds.resourcePackMock.mock.calls[0];
    expect(rpOpts.modId).toBe("nexus_prison");
    expect(rpOpts.packName).toBe("My Prison");
  });

  it("Java mod is generated when enabled", async () => {
    const cmds = makeCmds();
    await createFullPack(baseOptions, cmds);
    expect(cmds.createModJava).toHaveBeenCalledTimes(1);
    const [mjOpts] = cmds.modJavaMock.mock.calls[0];
    expect(mjOpts.modId).toBe("nexus_prison");
    expect(mjOpts.modName).toBe("My Prison Mod");
    expect(mjOpts.loader).toBe("fabric");
  });

  it("returns an honest summary with every section counted", async () => {
    const cmds = makeCmds();
    const result = await createFullPack(baseOptions, cmds);

    expect(result.server.serverDir).toContain("prison-server");
    expect(result.modules.length).toBe(2); // prison + economy
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.structures.length).toBe(4);
    expect(result.assets.length).toBe(3);
    expect(result.resourcePack?.fileCount).toBe(10);
    expect(result.modJava?.fileCount).toBe(15);
    expect(result.serverPack?.zipPath).toContain("server_packs");
    expect(result.summary).toContain("My Prison");
    expect(result.summary).toContain("ready to boot");
  });
});

describe("Full Pack — pure helpers", () => {
  it("prisonCustomCommands includes ranks, convert and mine info", () => {
    const cmds = prisonCustomCommands({ currencySymbol: "₦", currencyName: "VoxelCoin", prisonPrestigeMultiplier: 3 });
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain("nexus_rank");
    expect(ids).toContain("nexus_prestige");
    expect(ids).toContain("nexus_convert");
    expect(ids).toContain("nexus_mine_info");
    const convert = cmds.find((c) => c.id === "nexus_convert");
    expect(convert!.actions[0].kind).toBe("convert");
    expect((convert!.actions[0] as { tiers: number[] }).tiers).toContain(1000);
  });

  it("prisonAssets returns animated coin + pickaxe + panel", () => {
    const assets = prisonAssets();
    expect(assets.map((a) => a.id)).toEqual(["prison_coin", "prison_pickaxe", "prison_bar"]);
    const coin = assets.find((a) => a.id === "prison_coin");
    expect(coin!.frames).toBe(4);
    expect(coin!.assetKind).toBe("item");
    const bar = assets.find((a) => a.id === "prison_bar");
    expect(bar!.assetKind).toBe("block");
  });

  it("prisonStructures is seed-driven", () => {
    const s1 = prisonStructures(1);
    const s2 = prisonStructures(2);
    expect(s1.map((s) => s.id)).toEqual(["prison_block", "mine_a", "mine_b", "mine_c"]);
    expect(s1[0].seed).toBe(1);
    expect(s2[0].seed).toBe(2);
    // different seeds → different variants
    expect(s1.some((s, i) => s.seed !== s2[i].seed)).toBe(true);
  });

  it("modulesFor picks the right modules per flavour", () => {
    expect(modulesFor("prison")).toContain("prison");
    expect(modulesFor("prison")).toContain("economy");
    expect(modulesFor("economy")).toEqual(["economy"]);
    expect(modulesFor("full").length).toBeGreaterThan(4);
  });
});
