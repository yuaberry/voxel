/**
 * Mod Java Generator — pure orchestration logic tested without the
 * Tauri runtime. Every command is injected; assertions verify what was
 * actually written to disk.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createModJava,
  type ModJavaCmds,
  type ModJavaOptions,
  buildGradle,
  fabricModJson,
  modsToml,
  mainModClass,
  javaClassName,
} from "./modGeneratorService";

const baseOptions: ModJavaOptions = {
  storageBase: "/workspace",
  projectRel: "projects/prison-mod",
  modId: "nexus_prison",
  modName: "Prison Module",
  version: "1.0.0",
  minecraftVersion: "1.20.1",
  loader: "fabric",
  items: [
    { id: "prison_coin", displayName: "Prison Coin", creativeTab: true },
  ],
  blocks: [
    { id: "prison_bar", displayName: "Prison Bar", material: "metal", hardness: 2.0, resistance: 6.0 },
  ],
  group: "com.voxel",
  archiveBaseName: "prison-mod",
};

function makeCmds(overrides: Partial<ModJavaCmds> = {}): ModJavaCmds & {
  writes: Array<{ relPath: string; content: string }>;
} {
  const writes: Array<{ relPath: string; content: string }> = [];
  return {
    writeProjectFile: vi.fn().mockImplementation(async (_base, relPath, content) => {
      writes.push({ relPath, content });
    }),
    generateItemTexture: vi.fn().mockImplementation(async () => ({
      wrotePath: "/workspace/projects/prison-mod/src/main/resources/assets/nexus_prison/textures/item/item.png",
      pngBase64: "iVBORw0KGgo=",
    })),
    writes,
    ...overrides,
  };
}

describe("Mod Java Generator — pure helpers", () => {
  it("buildGradle produces a Fabric build file", () => {
    const gradle = buildGradle(baseOptions);
    expect(gradle).toContain("net.fabricmc.fabric-plugin");
    expect(gradle).toContain("fabric-api:0.80.0+1.20.1");
    expect(gradle).toContain("com.mojang:minecraft:1.20.1");
    expect(gradle).toContain("group = 'com.voxel'");
  });

  it("buildGradle produces a NeoForge build file", () => {
    const gradle = buildGradle({ ...baseOptions, loader: "neoforge" });
    expect(gradle).toContain("net.neoforged.gradle");
    expect(gradle).toContain("net.neoforged:neoforge:");
    expect(gradle).not.toContain("fabric-api");
  });

  it("fabricModJson has correct structure", () => {
    const modJson = JSON.parse(fabricModJson(baseOptions));
    expect(modJson.id).toBe("nexus_prison");
    expect(modJson.name).toBe("Prison Module");
    expect(modJson.entrypoints.main[0]).toContain("PrisonMod");
  });

  it("modsToml has correct structure", () => {
    const toml = modsToml({ ...baseOptions, loader: "neoforge" });
    expect(toml).toContain('modId="nexus_prison"');
    expect(toml).toContain("versionRange=");
  });

  it("mainModClass produces valid Fabric code", () => {
    const main = mainModClass(baseOptions);
    expect(main).toContain("implements ModInitializer");
    expect(main).toContain("MOD_ID = \"nexus_prison\"");
    expect(main).toContain("registerItem");
    expect(main).toContain("registerBlock");
    expect(main).toContain("onInitialize");
  });

  it("mainModClass produces valid NeoForge code", () => {
    const main = mainModClass({ ...baseOptions, loader: "neoforge" });
    expect(main).toContain("@Mod(\"nexus_prison\")");
    expect(main).toContain("DeferredRegister");
  });

  it("javaClassName converts snake_case to PascalCase", () => {
    expect(javaClassName("nexus_prison", "prison_coin")).toBe("NexusPrisonPrisonCoin");
    expect(javaClassName("my_mod", "cool_item")).toBe("MyModCoolItem");
  });
});

describe("Mod Java Generator — full orchestration", () => {
  it("writes build.gradle, mod metadata, main class, lang, and textures", async () => {
    const cmds = makeCmds();
    const result = await createModJava(baseOptions, cmds);

    // build.gradle
    expect(cmds.writes.some((w) => w.relPath.endsWith("build.gradle"))).toBe(true);

    // fabric.mod.json (loader is fabric)
    expect(cmds.writes.some((w) => w.relPath.endsWith("fabric.mod.json"))).toBe(true);

    // main class
    expect(cmds.writes.some((w) => w.relPath.endsWith("NexusPrisonMod.java"))).toBe(true);

    // lang files
    expect(cmds.writes.some((w) => w.relPath.endsWith("en_us.json"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("pt_br.json"))).toBe(true);

    // textures generated (via generateItemTexture command)
    expect(cmds.generateItemTexture).toHaveBeenCalled();
    const calls = (cmds.generateItemTexture as any).mock.calls;
    expect(calls.some((c: any) => c[0].projectRel.includes("textures/item"))).toBe(true);
    expect(calls.some((c: any) => c[0].projectRel.includes("textures/block"))).toBe(true);

    // summary
    expect(result.summary).toContain("Prison Module");
    expect(result.summary).toContain("1 items");
    expect(result.summary).toContain("1 blocks");
    expect(result.fileCount).toBeGreaterThan(0);
  });

  it("NeoForge loader writes mods.toml instead of fabric.mod.json", async () => {
    const cmds = makeCmds();
    await createModJava({ ...baseOptions, loader: "neoforge" }, cmds);

    expect(cmds.writes.some((w) => w.relPath.endsWith("mods.toml"))).toBe(true);
    expect(cmds.writes.some((w) => w.relPath.endsWith("fabric.mod.json"))).toBe(false);
    // main class should use @Mod annotation
    const mainFile = cmds.writes.find((w) => w.relPath.endsWith(".java"));
    expect(mainFile?.content).toContain("@Mod");
  });

  it("items and blocks are registered in lang files", async () => {
    const cmds = makeCmds();
    await createModJava(baseOptions, cmds);

    const enUsFile = cmds.writes.find((w) => w.relPath.endsWith("en_us.json"));
    expect(enUsFile).toBeDefined();
    if (enUsFile) {
      const lang = JSON.parse(enUsFile.content);
      expect(lang["item.prison_coin"]).toBe("Prison Coin");
      expect(lang["block.prison_bar"]).toBe("Prison Bar");
    }
  });
});
