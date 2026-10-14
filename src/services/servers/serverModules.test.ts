import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODULE_OPTIONS,
  generateSelectedModules,
  generateModuleFiles,
} from "./serverModules";

describe("serverModules", () => {
  it("generates economy datapack with pack.mcmeta and functions", () => {
    const files = generateModuleFiles("economy");
    const paths = files.map((f) => f.path);
    expect(paths).toContain("world/datapacks/nexus_economy/pack.mcmeta");
    expect(paths.some((p) => p.includes("tick.mcfunction"))).toBe(true);
    expect(paths.some((p) => p.includes("balance.mcfunction"))).toBe(true);
  });

  it("generates prison datapack with rank progression", () => {
    const files = generateModuleFiles("prison");
    const load = files.find((f) => f.path.includes("load.mcfunction"));
    expect(load).toBeDefined();
    expect(load!.content).toContain("nexus_rank");
    const progress = files.find((f) => f.path.includes("progress.mcfunction"));
    expect(progress!.content).toContain("nexus_rank");
  });

  it("generates token datapack with market routing", () => {
    const files = generateModuleFiles("token");
    const route = files.find((f) => f.path.includes("market_route"));
    expect(route).toBeDefined();
    expect(route!.content).toContain("buy_5");
  });

  it("mixes modules without namespace collisions", () => {
    const files = generateSelectedModules(["economy", "prison", "token"]);
    // every datapack has its own root
    const roots = new Set(files.map((f) => f.path.split("/")[2]));
    expect(roots).toEqual(new Set(["nexus_economy", "nexus_prison", "nexus_token"]));
    // no duplicate full paths
    const all = files.map((f) => f.path);
    expect(new Set(all).size).toBe(all.length);
  });

  it("pack format is 15 (MC 1.20.1)", () => {
    const files = generateModuleFiles("economy");
    const mcmeta = JSON.parse(
      files.find((f) => f.path.endsWith("pack.mcmeta"))!.content,
    );
    expect(mcmeta.pack.pack_format).toBe(15);
  });
});

describe("prison /mine command (the owner's ask)", () => {
  it("registers the trigger, plays the loading screen and warps by rank", () => {
    const files = generateSelectedModules(["prison"], DEFAULT_MODULE_OPTIONS);
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    const load = byPath.get(
      "world/datapacks/nexus_prison/data/nexus_prison/functions/load.mcfunction",
    )!;
    expect(load).toContain("scoreboard objectives add nexus_mine trigger");
    expect(load).toContain("scoreboard players enable * nexus_mine");

    const tick = byPath.get(
      "world/datapacks/nexus_prison/data/nexus_prison/functions/tick.mcfunction",
    )!;
    expect(tick).toContain("scores={nexus_mine=1..}");
    expect(tick).toContain("nexus_prison:mine");

    const mine = byPath.get(
      "world/datapacks/nexus_prison/data/nexus_prison/functions/mine.mcfunction",
    )!;
    // consume the trigger so it can fire again
    expect(mine).toContain("scoreboard players set @s nexus_mine 0");
    // the loading screen: title + subtitle + sound + scheduled progress bars
    expect(mine).toContain("title @s title");
    expect(mine).toContain("Entrando nas minas...");
    expect(mine).toContain("schedule function nexus_prison:mine_bar_1 8t");

    const bar1 = byPath.get(
      "world/datapacks/nexus_prison/data/nexus_prison/functions/mine_bar_1.mcfunction",
    )!;
    expect(bar1).toContain("█");
    expect(bar1).toContain("schedule function nexus_prison:mine_bar_2 20t");

    const warp = byPath.get(
      "world/datapacks/nexus_prison/data/nexus_prison/functions/mine_warp.mcfunction",
    )!;
    // rank-aware destination: 0-9 → A, 10-29 → B, 30+ → C
    expect(warp).toContain("scores={nexus_rank=..9}");
    expect(warp).toContain("scores={nexus_rank=10..29}");
    expect(warp).toContain("scores={nexus_rank=30..}");
    expect(warp).toContain("tp @s 0 -60 0");
    expect(warp).toContain("tp @s 64 -60 0");
    expect(warp).toContain("tp @s 128 -60 0");
  });
});

describe("skyblock islands (the honest grid)", () => {
  it("builds real islands in the load function and warps by literal slot", () => {
    const files = generateSelectedModules(["skyblock"], DEFAULT_MODULE_OPTIONS);
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    const load = byPath.get(
      "world/datapacks/nexus_skyblock/data/nexus_skyblock/functions/load.mcfunction",
    )!;
    // 16 islands of 5x5 dirt = 400 setblock lines of dirt + trees + chests
    const setblocks = load.split("\n").filter((l) => l.startsWith("setblock"));
    expect(setblocks.length).toBeGreaterThanOrEqual(16 * 33);
    expect(load).toContain("scoreboard players enable * nexus_island");
    // island 16 at x = 3200
    expect(load).toContain("setblock 3200 119 -2 minecraft:dirt");
    // welcome chest carries starter kit NBT
    expect(load).toContain('minecraft:chest{Items:[{Slot:0b,id:"minecraft:wooden_axe"');

    const warp = byPath.get(
      "world/datapacks/nexus_skyblock/data/nexus_skyblock/functions/warp.mcfunction",
    )!;
    expect(warp).toContain("execute if score @s nexus_island_id matches 1 run tp @s 200 120 0");
    expect(warp).toContain("execute if score @s nexus_island_id matches 16 run tp @s 3200 120 0");

    const assign = byPath.get(
      "world/datapacks/nexus_skyblock/data/nexus_skyblock/functions/assign_slot.mcfunction",
    )!;
    // honest capacity: the cap message when all 16 are claimed
    expect(assign).toContain("All 16 islands are claimed");
  });
});

describe("factions war", () => {
  it("registers teams, join triggers and per-team kill scoring", () => {
    const files = generateSelectedModules(["factions"], DEFAULT_MODULE_OPTIONS);
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    const load = byPath.get(
      "world/datapacks/nexus_factions/data/nexus_factions/functions/load.mcfunction",
    )!;
    expect(load).toContain("team add ember");
    expect(load).toContain("team modify tide color blue");
    expect(load).toContain("scoreboard players enable * nexus_faction");
    // kills come from the REAL vanilla statistic
    expect(load).toContain(
      "minecraft.custom:minecraft.player_kills",
    );

    const tick = byPath.get(
      "world/datapacks/nexus_factions/data/nexus_factions/functions/tick.mcfunction",
    )!;
    expect(tick).toContain("scores={nexus_faction=1}");
    expect(tick).toContain("scores={nexus_player_kills=1..},team=ember");
    expect(tick).toContain("nexus_factions:score_verdant");

    const join = byPath.get(
      "world/datapacks/nexus_factions/data/nexus_factions/functions/join_ember.mcfunction",
    )!;
    expect(join).toContain("team join ember @s");
    expect(join).toContain("scoreboard players set @s nexus_faction 0");
  });
});

describe("bedwars lite", () => {
  it("hands a kit, warps to the arena with a countdown and tracks broken beds", () => {
    const files = generateSelectedModules(["bedwars"], DEFAULT_MODULE_OPTIONS);
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    const load = byPath.get(
      "world/datapacks/nexus_bedwars/data/nexus_bedwars/functions/load.mcfunction",
    )!;
    // bed breaks are tracked through the real mining statistic
    expect(load).toContain("minecraft.mined:minecraft:red_bed");

    const enter = byPath.get(
      "world/datapacks/nexus_bedwars/data/nexus_bedwars/functions/enter.mcfunction",
    )!;
    expect(enter).toContain("give @s minecraft:wooden_sword 1");
    expect(enter).toContain("give @s minecraft:oak_planks 16");
    expect(enter).toContain("tp @s 4096 120 0");
    expect(enter).toContain("schedule function nexus_bedwars:count_2 20t");

    const bed = byPath.get(
      "world/datapacks/nexus_bedwars/data/nexus_bedwars/functions/bed_broken.mcfunction",
    )!;
    expect(bed).toContain("QUEBROU UMA CAMA!");
    expect(bed).toContain("title @a title");
  });
});
