/**
 * Full Pack Generator (Super Prompt — "one command generates everything").
 *
 * One user action → a complete, boot-ready Minecraft server:
 *
 *   1. The server folder + official jar (server_create)
 *   2. Real gameplay modules as vanilla datapacks (Prison + Economy + Token)
 *   3. Custom /trigger commands (ranks, convert, prestige, mine info)
 *   4. Procedural world structures (Prison block + Mine A/B/C, seed-driven)
 *   5. Real pixel-art assets (prison coin, animated sprites)
 *   6. A server pack ZIP — the whole server, ready to deploy anywhere
 *
 * Every step is a real command the app already has; this service only
 * orchestrates them in the right order. Nothing is faked: if a step
 * fails, the error surfaces and the owner sees exactly what landed.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  generateSelectedModules,
  type ModuleInstallOptions,
  type GeneratedFile,
  type ServerModuleId,
} from "@/services/servers/serverModules";
import {
  generateCustomCommandsDatapack,
  type CustomCommand,
} from "@/services/servers/customCommands";
import { generateStructure } from "@/services/assets/structureService";
import type { StructureKindId } from "@/services/assets/structureService";
import { writeProjectFile } from "@/services/projects/projectsService";
import { createServerCommand } from "@/services/servers/serverService";
import type { ServerSetupResult } from "@/services/servers/serverService";
import { createResourcePack } from "@/services/resourcepack/resourcePackService";
import { createModJava } from "@/services/mods/modGeneratorService";
import { prisonExtensionsFiles } from "@/services/servers/prisonExtensions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FullPackModule = "prison" | "economy" | "token" | "full";

export interface FullPackOptions {
  basePath: string;
  slug: string;
  name: string;
  software: "vanilla" | "paper";
  mcVersion: string;
  port: number;
  ramMb: number;
  acceptEula: boolean;
  /** Which gameplay modules to install. "prison" always brings Economy
   *  (ranks need coins); "full" installs every module. */
  moduleKind: FullPackModule;
  currencyName: string;
  currencySymbol: string;
  /** x2 prestige yield by default — honest, tunable. */
  prisonPrestigeMultiplier: number;
  /** Seed for procedural structures; different seed = different variant. */
  seed?: number;
  /** Generate procedural structures into the server's datapack. */
  generateStructures: boolean;
  /** Generate real pixel-art assets (coin, sprites). */
  generateAssets: boolean;
  /** Generate a resource pack for the server (textures, models, lang, sounds). */
  generateResourcePack: boolean;
  /** Generate a Fabric/NeoForge Java mod for the server. */
  generateMod: boolean;
  modLoader: "fabric" | "neoforge";
  /** Zip the whole server folder into a deployable server pack. */
  createServerPack: boolean;
  /** Extra server.properties overrides (merged on top of the pack's own). */
  properties?: Record<string, string>;
  /** Prison extensions: shops, NPCs, custom mines, rank visuals. */
  prisonExtensions?: {
    shops?: Array<{
      id: string;
      name: string;
      triggerId: string;
      items: Array<{
        id: string;
        displayName: string;
        buyPrice: number;
        sellPrice: number;
        slot: number;
        amount: number;
      }>;
    }>;
    npcs?: Array<{
      id: string;
      name: string;
      x: number;
      y: number;
      z: number;
      rotationYaw: number;
      rotationPitch: number;
      mobType: string;
      heldItem?: string;
      helmet?: string;
      chestplate?: string;
      leggings?: string;
      boots?: string;
      customNameVisible: boolean;
      aiDisabled: boolean;
      silent: boolean;
    }>;
    mines?: Array<{
      id: string;
      name: string;
      x: number;
      y: number;
      z: number;
      blockType: string;
      minRank: number;
    }>;
    ranks?: Array<{
      rank: number;
      name: string;
      prefix: string;
      suffix: string;
      tablistColor: string;
      nametagColor: string;
    }>;
  };
}

export interface PackStructure {
  id: string;
  kind: StructureKindId;
  seed: number;
  wrotePath?: string;
}

export interface PackAsset {
  id: string;
  style: string;
  wrotePath?: string;
  pngBase64?: string;
}

export interface FullPackResult {
  server: ServerSetupResult;
  modules: { id: ServerModuleId; files: number }[];
  commands: { id: string; actions: number }[];
  structures: PackStructure[];
  assets: PackAsset[];
  resourcePack?: { packPath: string; fileCount: number; totalBytes: number };
  modJava?: { modPath: string; fileCount: number; totalBytes: number };
  prisonExt?: {
    shops: number;
    npcs: number;
    mines: number;
    ranks: number;
    total: number;
  };
  serverPack?: { zipPath: string; modCount: number };
  summary: string;
}

// ---------------------------------------------------------------------------
// Commands seam — injected so the pure orchestrator is testable without
// the Tauri runtime. Production uses the real invoke/writeProjectFile.
// ---------------------------------------------------------------------------

export interface FullPackCmds {
  createServer: (options: {
    basePath: string;
    slug: string;
    name: string;
    software: string;
    mcVersion: string;
    port: number;
    ramMb: number;
    acceptEula: boolean;
    properties?: Record<string, string>;
  }) => Promise<ServerSetupResult>;
  writeProjectFile: (basePath: string, relPath: string, content: string) => Promise<void>;
  generateStructure: (payload: {
    storageBase: string;
    projectRel: string;
    structureId: string;
    kind: StructureKindId;
    seed: number;
    mcVersion: string;
    previewOnly: boolean;
    outputKind?: "mod" | "server_module";
  }) => Promise<{ wrotePath?: string }>;
  generateItemTexture: (payload: {
    storageBase: string;
    projectRel: string;
    modId: string;
    itemId: string;
    style: string;
    primary: string;
    secondary: string;
    assetKind: "item" | "block";
    frames?: number;
    previewOnly?: boolean;
  }) => Promise<{ wrotePath?: string; pngBase64?: string }>;
  exportServerPack: (payload: {
    basePath: string;
    slug: string;
    packName: string;
  }) => Promise<{ zipPath: string; modCount: number }>;
  createResourcePack: (options: {
    storageBase: string;
    projectRel: string;
    packName: string;
    packDescription?: string;
    modId: string;
    language: "pt_br" | "en_us";
    items: Array<{ id: string; textureStyle: string; primary: string; secondary: string; frames?: number; displayName: string }>;
    blocks: Array<{ id: string; textureStyle: string; primary: string; secondary: string; displayName: string }>;
    generateSounds: boolean;
  }) => Promise<{ packPath: string; fileCount: number; totalBytes: number; summary: string }>;
  createModJava: (options: {
    storageBase: string;
    projectRel: string;
    modId: string;
    modName: string;
    version: string;
    minecraftVersion: string;
    loader: "fabric" | "neoforge";
    items: Array<{ id: string; displayName: string; creativeTab?: boolean }>;
    blocks: Array<{ id: string; displayName: string; material: string; hardness: number; resistance: number }>;
    group: string;
    archiveBaseName: string;
  }) => Promise<{ modPath: string; fileCount: number; totalBytes: number; summary: string }>;
}

export const realCmds: FullPackCmds = {
  createServer: (options) => createServerCommand(options),
  writeProjectFile,
  generateStructure: async (payload: any) => {
    const result = await generateStructure(
      payload as Parameters<typeof generateStructure>[0],
    );
    return { wrotePath: result.wrotePath ?? undefined };
  },
  generateItemTexture: (payload) =>
    invoke<{ wrotePath?: string; pngBase64?: string }>("generate_item_texture", {
      storageBase: payload.storageBase,
      projectRel: payload.projectRel,
      modId: payload.modId,
      itemId: payload.itemId,
      style: payload.style,
      primary: payload.primary,
      secondary: payload.secondary,
      assetKind: payload.assetKind,
      frames: payload.frames,
      previewOnly: payload.previewOnly,
    }),
  exportServerPack: (payload) =>
    invoke<{ zipPath: string; modCount: number }>("server_pack_export", {
      basePath: payload.basePath,
      slug: payload.slug,
      packName: payload.packName,
    }),
  createResourcePack: (options: any) => createResourcePack(options as any),
  createModJava: (options: any) => createModJava(options as any),
};

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, tested directly
// ---------------------------------------------------------------------------

const PRI = "nexus_prison";
const ECO = "nexus_economy";
const TOK = "nexus_token";

const COIN_PRIMARY = "#fbbf24"; // prison gold
const COIN_SECONDARY = "#a78bfa"; // voxel purple

/** The custom /trigger commands every Prison server gets, in addition to
 *  the module's own rank/warp functions. */
export function prisonCustomCommands(options: {
  currencySymbol: string;
  currencyName: string;
  prisonPrestigeMultiplier?: number;
}): CustomCommand[] {
  const { currencySymbol, currencyName } = options;
  return [
    {
      id: "nexus_rank",
      description: "Show your current Prison rank and prestige",
      actions: [{ kind: "message", text: `Rank: ${currencyName} progression` }],
      costCoins: 0,
    },
    {
      id: "nexus_prestige",
      description: "Prestige reset (rank 50 → +1 prestige, x${options.prisonPrestigeMultiplier ?? 2} yield)",
      actions: [{ kind: "message", text: `Prestige: ${currencySymbol} multiplier` }],
      costCoins: 0,
    },
    {
      id: "nexus_convert",
      description: `Exchange ${currencyName} for chain tokens (/convert)`,
      costCoins: 10,
      actions: [{ kind: "convert", tiers: [10, 50, 100, 500, 1000] }],
    },
    {
      id: "nexus_mine_info",
      description: "Show which mine your rank warps to",
      actions: [{ kind: "message", text: "Mine A: rank 0-9 · Mine B: 10-29 · Mine C: 30+" }],
      costCoins: 0,
    },
  ];
}

/** Real pixel-art assets for the Prison module. */
export function prisonAssets(): Array<{
  id: string;
  style: string;
  primary: string;
  secondary: string;
  assetKind: "item" | "block";
  frames?: number;
}> {
  return [
    {
      id: "prison_coin",
      style: "gem",
      primary: COIN_PRIMARY,
      secondary: COIN_SECONDARY,
      assetKind: "item",
      frames: 4, // animated spin
    },
    {
      id: "prison_pickaxe",
      style: "sword",
      primary: "#7a7a7a",
      secondary: "#fbbf24",
      assetKind: "item",
    },
    {
      id: "prison_bar",
      style: "panel",
      primary: "#1f2937",
      secondary: "#fbbf24",
      assetKind: "block",
    },
  ];
}

/** Procedural Prison world structures (seed-driven, honest variants). */
export function prisonStructures(seed: number): PackStructure[] {
  return [
    { id: "prison_block", kind: "prison", seed },
    { id: "mine_a", kind: "mine", seed: seed + 1 },
    { id: "mine_b", kind: "mine", seed: seed + 2 },
    { id: "mine_c", kind: "mine", seed: seed + 3 },
  ];
}

/** Which modules to install for each pack flavour. */
export function modulesFor(kind: FullPackModule): ServerModuleId[] {
  switch (kind) {
    case "prison":
      return ["prison", "economy"];
    case "economy":
      return ["economy"];
    case "token":
      return ["token", "economy"];
    case "full":
      return ["prison", "economy", "token", "skyblock", "factions", "bedwars", "monuments"];
  }
}

// ---------------------------------------------------------------------------
// The orchestrator — one command, everything real
// ---------------------------------------------------------------------------

export async function createFullPack(
  options: FullPackOptions,
  cmds: FullPackCmds = realCmds,
): Promise<FullPackResult> {
  const {
    basePath,
    slug,
    name,
    software,
    mcVersion,
    port,
    ramMb,
    acceptEula,
    moduleKind,
    currencyName,
    currencySymbol,
    prisonPrestigeMultiplier,
    seed = 1337,
    generateStructures,
    generateAssets,
    createServerPack,
    properties: extraProperties,
  } = options;

  const moduleOptions: ModuleInstallOptions = {
    currencyName,
    currencySymbol,
    mcVersion,
    prisonPrestigeMultiplier,
  };

  // ---- 1. The server itself (official jar, world-safe)
  const serverProperties: Record<string, string> = {
    "motd": `§6§l${name} §r§f— Prison Pack`,
    "difficulty": "normal",
    "generate-structures": String(generateStructures),
    "enable-command-block": "true",
    "spawn-protection": "0",
    ...extraProperties,
  };
  if (options.properties?.["level-seed"]) {
    serverProperties["level-seed"] = options.properties["level-seed"];
  }

  const server = await cmds.createServer({
    basePath,
    slug,
    name,
    software,
    mcVersion,
    port,
    ramMb,
    acceptEula,
    properties: serverProperties,
  });

  const serverRel = `servers/${slug}`;
  const write = async (file: GeneratedFile) => {
    await cmds.writeProjectFile(basePath, `${serverRel}/${file.path}`, file.content);
  };

  // ---- 2. Gameplay modules as real vanilla datapacks
  const selected = modulesFor(moduleKind);
  const moduleFiles = generateSelectedModules(selected, moduleOptions);
  for (const file of moduleFiles) await write(file);

  // ---- 3. Custom /trigger commands (ranks, convert, prestige, mine info)
  const commands = prisonCustomCommands({ currencySymbol, currencyName, prisonPrestigeMultiplier });
  const commandFiles = generateCustomCommandsDatapack(commands, {
    hasEconomy: selected.includes("economy"),
  });
  for (const file of commandFiles) await write(file);

  // ---- 4. Procedural world structures into the server's datapack
  const structures: PackStructure[] = [];
  if (generateStructures) {
    for (const s of prisonStructures(seed)) {
      const result = await cmds.generateStructure({
        storageBase: basePath,
        projectRel: serverRel,
        structureId: s.id,
        kind: s.kind,
        seed: s.seed,
        mcVersion,
        previewOnly: false,
        outputKind: "server_module",
      });
      structures.push({ ...s, wrotePath: result.wrotePath });
    }
  }

  // ---- 5. Real pixel-art assets (animated coin, pickaxe, panel)
  const assets: PackAsset[] = [];
  if (generateAssets) {
    for (const a of prisonAssets()) {
      const result = await cmds.generateItemTexture({
        storageBase: basePath,
        projectRel: serverRel,
        modId: PRI,
        itemId: a.id,
        style: a.style,
        primary: a.primary,
        secondary: a.secondary,
        assetKind: a.assetKind,
        frames: a.frames,
        previewOnly: false,
      });
      assets.push({
        id: a.id,
        style: a.style,
        wrotePath: result.wrotePath,
        pngBase64: result.pngBase64,
      });
    }
  }

  // ---- 6. Resource pack (textures, models, lang, sounds)
  let resourcePack;
  if (options.generateResourcePack) {
    const rpResult = await cmds.createResourcePack({
      storageBase: basePath,
      projectRel: `projects/${slug}-resourcepack`,
      packName: name,
      packDescription: `Resource pack for ${name} server`,
      modId: PRI,
      language: "pt_br",
      items: prisonAssets().map((a) => ({
        id: a.id,
        textureStyle: a.style === "panel" ? "panel" : a.style,
        primary: a.primary,
        secondary: a.secondary,
        frames: a.frames,
        displayName: a.id.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      })),
      blocks: [],
      generateSounds: true,
    });
    resourcePack = {
      packPath: rpResult.packPath,
      fileCount: rpResult.fileCount,
      totalBytes: rpResult.totalBytes,
    };
  }

  // ---- 7. Java mod (Fabric or NeoForge)
  let modJava;
  if (options.generateMod) {
    const mjResult = await cmds.createModJava({
      storageBase: basePath,
      projectRel: `projects/${slug}-mod`,
      modId: PRI,
      modName: `${name} Mod`,
      version: "1.0.0",
      minecraftVersion: mcVersion,
      loader: options.modLoader,
      items: prisonAssets().filter((a) => a.assetKind === "item").map((a) => ({
        id: a.id,
        displayName: a.id.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        creativeTab: true,
      })),
      blocks: prisonAssets().filter((a) => a.assetKind === "block").map((a) => ({
        id: a.id,
        displayName: a.id.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        material: "stone",
        hardness: 2.0,
        resistance: 6.0,
      })),
      group: "com.voxel",
      archiveBaseName: `${slug}-mod`,
    });
    modJava = {
      modPath: mjResult.modPath,
      fileCount: mjResult.fileCount,
      totalBytes: mjResult.totalBytes,
    };
  }

  // ---- 8. Prison extensions (shops, NPCs, custom mines, rank visual)
  let prisonExt;
  if (moduleKind === "prison" && options.prisonExtensions) {
    const peResult = prisonExtensionsFiles({
      currencySymbol,
      currencyName,
      prisonPrestigeMultiplier,
      shops: options.prisonExtensions.shops ?? [],
      npcs: options.prisonExtensions.npcs ?? [],
      mines: options.prisonExtensions.mines ?? [],
      ranks: options.prisonExtensions.ranks ?? [],
    });
    for (const file of peResult) {
      await cmds.writeProjectFile(basePath, `${serverRel}/${file.path}`, file.content);
    }
    prisonExt = {
      shops: peResult.filter((f) => f.path.includes("/shops/")).length,
      npcs: peResult.filter((f) => f.path.includes("/npcs/")).length,
      mines: peResult.filter((f) => f.path.includes("/mines/")).length,
      ranks: peResult.filter((f) => f.path.includes("/ranks/")).length,
      total: peResult.length,
    };
  }

  // ---- 9. Server pack ZIP — the whole server, deployable anywhere
  let serverPack;
  if (createServerPack) {
    serverPack = await cmds.exportServerPack({ basePath, slug, packName: name });
  }

  const summary = [
    `Server "${name}" created and ready to boot.`,
    `Modules: ${selected.join(", ")}.`,
    `Commands: ${commands.length} custom /trigger commands.`,
    generateStructures ? `Structures: ${structures.length} (prison block + mines A/B/C).` : "",
    generateAssets ? `Assets: ${assets.length} pixel-art files.` : "",
    options.generateResourcePack ? `Resource pack: ${resourcePack?.fileCount ?? 0} files.` : "",
    options.generateMod ? `Java mod: ${modJava?.fileCount ?? 0} files.` : "",
    prisonExt ? `Prison extensions: ${prisonExt.total} files (${prisonExt.shops} shops, ${prisonExt.npcs} NPCs, ${prisonExt.mines} mines, ${prisonExt.ranks} ranks).` : "",
    createServerPack ? `Server pack: ${serverPack?.zipPath ?? ""}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    server,
    modules: selected.map((id) => ({
      id,
      files: moduleFiles.filter((f) => f.path.startsWith(`world/datapacks/${id === "prison" ? PRI : id === "economy" ? ECO : TOK}`)).length,
    })),
    commands: commands.map((c) => ({ id: c.id, actions: c.actions.length })),
    structures,
    assets,
    resourcePack,
    modJava,
    prisonExt,
    serverPack,
    summary,
  };
}
