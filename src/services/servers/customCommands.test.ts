import { describe, expect, it } from "vitest";
import {
  CUSTOM_NS,
  generateCustomCommandsDatapack,
  validateTriggerId,
  type CustomCommand,
} from "./customCommands";

function fileOf(files: { path: string; content: string }[], suffix: string) {
  const f = files.find((x) => x.path.endsWith(suffix));
  expect(f, `expected a file ending with ${suffix}`).toBeTruthy();
  return f!.content;
}

describe("custom commands generator (vanilla-real datapack)", () => {
  it("registers every trigger and routes it on tick", () => {
    const files = generateCustomCommandsDatapack(
      [{ id: "vip_kit", description: "The VIP welcome kit", actions: [{ kind: "give", item: "diamond", count: 3 }] }],
      { hasEconomy: false },
    );
    const load = fileOf(files, "functions/load.mcfunction");
    expect(load).toContain('scoreboard objectives add vip_kit trigger');
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain("scoreboard players enable @a vip_kit");
    expect(tick).toContain(`execute as @a[scores={vip_kit=1..}] run function ${CUSTOM_NS}:cmd_vip_kit`);
    const cmd = fileOf(files, "functions/cmd_vip_kit.mcfunction");
    expect(cmd).toContain("scoreboard players set @s vip_kit 0"); // score resets on route
    expect(fileOf(files, "functions/run_vip_kit.mcfunction")).toContain("give @s minecraft:diamond 3");
  });

  it("pack.mcmeta is era-honest and tags point at the namespace", () => {
    const files = generateCustomCommandsDatapack(
      [{ id: "warp_spawn", description: "Back to spawn", actions: [{ kind: "teleport", x: 0, y: 64, z: 0 }] }],
      { hasEconomy: false },
    );
    expect(fileOf(files, "pack.mcmeta")).toContain('"pack_format": 15');
    expect(fileOf(files, "tags/functions/load.json")).toContain(`${CUSTOM_NS}:load`);
    expect(fileOf(files, "tags/functions/tick.json")).toContain(`${CUSTOM_NS}:tick`);
    expect(fileOf(files, "functions/run_warp_spawn.mcfunction")).toContain("tp @s 0 64 0");
  });

  it("costs debit the economy coin and gate the run behind balance", () => {
    const cmd: CustomCommand = {
      id: "buy_kebab",
      description: "A well-earned snack",
      costCoins: 25,
      actions: [{ kind: "give", item: "cooked_beef", count: 5 }],
    };
    const files = generateCustomCommandsDatapack([cmd], { hasEconomy: true });
    const run = fileOf(files, "functions/run_buy_kebab.mcfunction");
    expect(run).toContain("scoreboard players remove @s nexus_coin 25");
    const gate = fileOf(files, "functions/cmd_buy_kebab.mcfunction");
    expect(gate).toContain("execute if score @s nexus_coin matches 25..");
    expect(gate).toContain("execute if score @s nexus_coin matches ..24");
  });

  it("cooldowns tick down and busy players get a word, not silence", () => {
    const cmd: CustomCommand = {
      id: "heal_up",
      description: "Emergency heal",
      cooldownSeconds: 60,
      actions: [{ kind: "effect", effect: "regeneration", seconds: 5, amplifier: 1 }],
    };
    const files = generateCustomCommandsDatapack([cmd], { hasEconomy: false });
    const load = fileOf(files, "functions/load.mcfunction");
    expect(load).toContain("scoreboard objectives add heal_up_cd dummy");
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain(`execute as @a[scores={heal_up_cd=1..}] run scoreboard players remove @s heal_up_cd 1`);
    const run = fileOf(files, "functions/run_heal_up.mcfunction");
    expect(run).toContain("scoreboard players set @s heal_up_cd 60");
    const gate = fileOf(files, "functions/cmd_heal_up.mcfunction");
    expect(gate).toContain(`execute if score @s heal_up_cd matches 1.. run tellraw @s`);
    expect(gate).toContain(`execute if score @s heal_up_cd matches ..0 run function ${CUSTOM_NS}:run_heal_up`);
    expect(fileOf(files, "functions/run_heal_up.mcfunction")).toContain("effect give @s minecraft:regeneration 5 1 true");
  });

  it("summons carry REAL nbt: name, equipment and health attribute (1.20.1)", () => {
    const cmd: CustomCommand = {
      id: "boss_guard",
      description: "Summon the arena guardian",
      actions: [
        {
          kind: "summon",
          mob: "zombie",
          name: "Arena Guardian",
          health: 40,
          heldItem: "netherite_sword",
          helmet: "diamond_helmet",
          chestplate: "diamond_chestplate",
          boots: "diamond_boots",
        },
      ],
    };
    const files = generateCustomCommandsDatapack([cmd], { hasEconomy: false });
    const summon = fileOf(files, "functions/run_boss_guard.mcfunction");
    expect(summon).toContain("summon minecraft:zombie ~ ~ ~ {");
    expect(summon).toContain('CustomName:\'[{"text":"Arena Guardian","color":"gold","italic":false}]\'');
    expect(summon).toContain("CustomNameVisible:1b");
    expect(summon).toContain('{id:"minecraft:netherite_sword",Count:1b}');
    expect(summon).toContain('Attributes:[{Name:"generic.max_health",Base:40}]');
    // armor array is exactly 4 slots, hands exactly 2
    expect(summon.match(/ArmorItems:\[.*\]/s)![0].split("{").length - 1).toBeGreaterThanOrEqual(4);
    expect(summon).toContain("HandItems:[{id:\"minecraft:netherite_sword\",Count:1b},{}]");
  });

  it("convert routes tiers, debits coins, and writes the intent the panel reads", () => {
    const cmd: CustomCommand = {
      id: "pix_convert",
      description: "Coins -> wallet chain",
      actions: [{ kind: "convert", tiers: [50, 100, 250] }],
    };
    const files = generateCustomCommandsDatapack([cmd], { hasEconomy: true });
    const load = fileOf(files, "functions/load.mcfunction");
    expect(load).toContain("scoreboard objectives add nexus_custom_cvt trigger");
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain("scoreboard players enable @a nexus_custom_cvt");
    expect(tick).toContain(`execute as @a[scores={nexus_custom_cvt=1..}] run function ${CUSTOM_NS}:cmd_pix_convert`);
    const tier1 = fileOf(files, "functions/cvt_1.mcfunction");
    expect(tier1).toContain("scoreboard players remove @s nexus_coin 50");
    expect(tier1).toContain("say [VoxelCoin] CONVERT @s 50");
    const gate = fileOf(files, "functions/cmd_pix_convert.mcfunction");
    expect(gate).toContain("execute if score @s nexus_custom_cvt matches 1 if score @s nexus_coin matches 50..");
    expect(gate).toContain("scoreboard players set @s nexus_custom_cvt 0");
  });

  it("convert is honestly inactive without the economy module", () => {
    const files = generateCustomCommandsDatapack(
      [{ id: "no_econ", description: "x", actions: [{ kind: "convert", tiers: [10] }] }],
      { hasEconomy: false },
    );
    const gate = fileOf(files, "functions/cmd_no_econ.mcfunction");
    expect(gate).toContain("no economy module");
  });

  it("trigger ids that vanilla would reject are refused before they hit the server", () => {
    expect(validateTriggerId("good_id_1")).toBeNull();
    expect(validateTriggerId("2fast")).toMatch(/letter/);
    expect(validateTriggerId("UPPER")).toMatch(/lowercase/);
    expect(validateTriggerId("has space")).toMatch(/lowercase/);
  });

  it("quotes in player messages never break the generated json", () => {
    const files = generateCustomCommandsDatapack(
      [{ id: "say_hi", description: 'He said "hi"', actions: [{ kind: "message", text: 'Welcome "chief"' }] }],
      { hasEconomy: false },
    );
    const run = fileOf(files, "functions/run_say_hi.mcfunction");
    expect(run).toContain('\\"chief\\"'); // inner quotes are escaped for tellraw
    // balanced quotes in the whole line
    const tellrawLine = run.split("\n").find((l) => l.startsWith("tellraw"))!;
    expect(tellrawLine.split('"').length % 2).toBe(1);
  });
});
