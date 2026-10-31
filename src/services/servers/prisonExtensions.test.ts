/**
 * Prison Extensions — pure function tests.
 *
 * Tests shop generation, NPC spawn functions, mine warps, rank visual,
 * and the full extensions_files orchestrator — all without the Tauri
 * runtime. Assertions verify the exact mcfunction output the server
 * will read at boot.
 */
import { describe, expect, it } from "vitest";
import {
  prisonExtensionsFiles,
  shopLoadFunction,
  shopOpenFunction,
  npcSummonFunction,
  mineLoadFunction,
  mineWarpFunctions,
  rankVisualFunctions,
  type PrisonShop,
  type PrisonNPC,
  type PrisonMine,
  type PrisonRankVisual,
} from "./prisonExtensions";

const baseShop: PrisonShop = {
  id: "general",
  name: "General Shop",
  triggerId: "nexus_shop_general",
  items: [
    { id: "diamond", displayName: "Diamond", buyPrice: 100, sellPrice: 50, slot: 0, amount: 1 },
    { id: "iron_ingot", displayName: "Iron Ingot", buyPrice: 10, sellPrice: 5, slot: 1, amount: 64 },
  ],
};

const baseNPC: PrisonNPC = {
  id: "warden",
  name: "§4Warden",
  x: 100, y: 64, z: -200,
  rotationYaw: 90,
  rotationPitch: 0,
  mobType: "zombie",
  heldItem: "diamond_sword",
  helmet: "diamond_helmet",
  chestplate: "diamond_chestplate",
  leggings: "diamond_leggings",
  boots: "diamond_boots",
  customNameVisible: true,
  aiDisabled: true,
  silent: true,
};

const baseMine: PrisonMine = {
  id: "mine_a",
  name: "Mine A — Coal",
  x: 0, y: -60, z: 0,
  blockType: "coal_ore",
  minRank: 0,
};

const baseRank: PrisonRankVisual = {
  rank: 0,
  name: "Prisoner",
  prefix: "§7[§fPrisoner§7]§f ",
  suffix: "",
  tablistColor: "§7",
  nametagColor: "§7",
};

describe("Prison Extensions — shop system", () => {
  it("shopLoadFunction creates trigger and enables players", () => {
    const load = shopLoadFunction(baseShop);
    expect(load).toContain(`scoreboard objectives add ${baseShop.triggerId} trigger "${baseShop.triggerId}"`);
    expect(load).toContain(`scoreboard players enable * ${baseShop.triggerId}`);
    expect(load).toContain(`function nexus_prison:shop_open`);
  });

  it("shopOpenFunction creates title and buy/sell menu", () => {
    const open = shopOpenFunction(baseShop);
    expect(open).toContain(`title @s title [{"text":"${baseShop.name}","color":"#fbbf24","bold":true}]`);
    expect(open).toContain("Diamond");
    expect(open).toContain("Iron Ingot");
    expect(open).toContain(`run_command","value":"/trigger nexus_shop_buy set general:diamond"`);
    expect(open).toContain(`run_command","value":"/trigger nexus_shop_sell set general:iron_ingot"`);
  });

  it("shopOpenFunction encodes special characters in display names", () => {
    const shop: PrisonShop = {
      ...baseShop,
      items: [{ ...baseShop.items[0], displayName: 'Diamond "Sword"' }],
    };
    const open = shopOpenFunction(shop);
    // quotes inside display names should be escaped
    expect(open).not.toContain('"Diamond "Sword""');
  });
});

describe("Prison Extensions — NPC system", () => {
  it("npcSummonFunction spawns with equipment and custom name", () => {
    const summon = npcSummonFunction(baseNPC);
    expect(summon).toContain(`summon minecraft:zombie ${baseNPC.x} ${baseNPC.y} ${baseNPC.z}`);
    expect(summon).toContain('CustomName');
    expect(summon).toContain('"§4Warden"');
    expect(summon).toContain(`id:"minecraft:diamond_sword"`);
    expect(summon).toContain(`id:"minecraft:diamond_helmet"`);
    expect(summon).toContain("NoAI:1b");
    expect(summon).toContain("Silent:1b");
    expect(summon).toContain("CustomNameVisible:1b");
    expect(summon).toContain(`Rotation:[90f,0f]`);
  });

  it("npcSummonFunction omits empty equipment", () => {
    const npc: PrisonNPC = { ...baseNPC, heldItem: undefined, helmet: undefined };
    const summon = npcSummonFunction(npc);
    expect(summon).not.toContain("Hand:");
    expect(summon).not.toContain("Helmet:");
  });
});

describe("Prison Extensions — mine system", () => {
  it("mineLoadFunction registers triggers for all mines", () => {
    const load = mineLoadFunction([baseMine]);
    expect(load).toContain(`scoreboard objectives add ${baseMine.id}_select trigger "${baseMine.id}_select"`);
    expect(load).toContain(`function nexus_prison:warp_${baseMine.id}`);
  });

  it("mineWarpFunctions teleports and checks rank", () => {
    const warps = mineWarpFunctions([baseMine]);
    expect(warps[0]).toContain(`tp @s ${baseMine.x} ${baseMine.y} ${baseMine.z}`);
    expect(warps[0]).toContain(`warped to ${baseMine.name}`);
  });

  it("mineWarpFunctions enforces rank requirement", () => {
    const mine: PrisonMine = { ...baseMine, minRank: 10 };
    const warps = mineWarpFunctions([mine]);
    expect(warps[0]).toContain(`nexus_rank=..${mine.minRank - 1}`);
    expect(warps[0]).toContain("Rank too low");
    expect(warps[0]).toContain(`nexus_rank=${mine.minRank}..`);
  });
});

describe("Prison Extensions — rank visual", () => {
  it("rankVisualFunctions creates actionbar and team", () => {
    const visuals = rankVisualFunctions([baseRank]);
    expect(visuals[0]).toContain(`nexus_rank=${baseRank.rank}`);
    expect(visuals[0]).toContain("actionbar");
    expect(visuals[0]).toContain(baseRank.prefix);
    expect(visuals[0]).toContain(baseRank.name);
  });
});

describe("Prison Extensions — full orchestrator", () => {
  it("prisonExtensionsFiles generates all extension files", () => {
    const options: any = {
      currencySymbol: "✦",
      currencyName: "Prison Coin",
      prisonPrestigeMultiplier: 2,
      shops: [baseShop],
      npcs: [baseNPC],
      mines: [baseMine],
      ranks: [baseRank],
    };

    const files = prisonExtensionsFiles(options);

    // shop files
    expect(files.some((f) => f.path.includes(`shops/${baseShop.triggerId}/load.mcfunction`))).toBe(true);
    expect(files.some((f) => f.path.includes(`shops/${baseShop.triggerId}/open.mcfunction`))).toBe(true);

    // npc files
    expect(files.some((f) => f.path.includes(`npcs/${baseNPC.id}/spawn.mcfunction`))).toBe(true);

    // mine files
    expect(files.some((f) => f.path.includes(`mines/load.mcfunction`))).toBe(true);
    expect(files.some((f) => f.path.includes(`mines/warp_${baseMine.id}.mcfunction`))).toBe(true);

    // rank files
    expect(files.some((f) => f.path.includes(`ranks/rank_${baseRank.rank}.mcfunction`))).toBe(true);

    // extension tick + load
    expect(files.some((f) => f.path.includes(`functions/extensions_tick.mcfunction`))).toBe(true);
    expect(files.some((f) => f.path.includes(`functions/extensions_load.mcfunction`))).toBe(true);
  });

  it("extension_load registers triggers, teams, and NPC spawns", () => {
    const options: any = {
      currencySymbol: "✦",
      currencyName: "Prison Coin",
      prisonPrestigeMultiplier: 2,
      shops: [baseShop],
      npcs: [baseNPC],
      mines: [baseMine],
      ranks: [baseRank],
    };

    const files = prisonExtensionsFiles(options);
    const loadFile = files.find((f) => f.path.endsWith("functions/extensions_load.mcfunction"));
    expect(loadFile).toBeDefined();
    const content = loadFile!.content;
    expect(content).toContain(`scoreboard objectives add ${baseShop.triggerId} trigger`);
    expect(content).toContain(`function nexus_prison:npcs/${baseNPC.id}/spawn`);
    expect(content).toContain(`team add rank_Prisoner_0`);
    expect(content).toContain(`team modify rank_Prisoner_0 prefix`);
  });
});
