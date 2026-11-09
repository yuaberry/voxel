import { describe, expect, it } from "vitest";
import {
  MINE_RANK_ARENA,
  MINE_RANK_BASE_Y,
  MINE_RANK_COMMANDS,
  MINE_RANK_CURRENCIES,
  MINE_RANK_DATAPACK_FILE_COUNT,
  MINE_RANK_DECK_Y,
  MINE_RANK_HUB,
  MINE_RANK_MINE_FLOOR_Y,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_POND,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_TIERS,
  generateMineRankFiles,
  mineRankCommandsMarkdown,
  mineRankPlotCenter,
} from "./mineRankServer";

const files = generateMineRankFiles();
const byPath = new Map(files.map((file) => [file.path, file.content]));

function fn(name: string): string {
  const content = byPath.get(
    `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions/${name}.mcfunction`,
  );
  expect(content, `missing function ${name}`).toBeDefined();
  return content as string;
}

describe("Mine Rank — the manifest is the single source of truth", () => {
  it("ships every command of the Rankup variation with a unique trigger", () => {
    expect(MINE_RANK_COMMANDS.length).toBeGreaterThanOrEqual(30);
    const triggers = MINE_RANK_COMMANDS.map((command) => command.trigger);
    expect(new Set(triggers).size).toBe(triggers.length);
    const functions = MINE_RANK_COMMANDS.map((command) => command.fn);
    expect(new Set(functions).size).toBe(functions.length);
    // the vanilla caps the scoreboard objective name at 16 characters
    for (const trigger of triggers) {
      expect(trigger.length).toBeLessThanOrEqual(16);
    }
  });

  it("covers every family the owner asked for", () => {
    const families = new Set(MINE_RANK_COMMANDS.map((command) => command.family));
    expect([...families].sort()).toEqual(
      ["economia", "geral", "mina", "progressao", "social", "sistemas", "terrenos"].sort(),
    );
  });

  it("keeps the four NerdZone coins and the eight tiers", () => {
    expect(MINE_RANK_CURRENCIES.map((currency) => currency.name)).toEqual([
      "Coins",
      "Tokens",
      "Rubies",
      "Cash",
    ]);
    expect(MINE_RANK_CURRENCIES.map((currency) => currency.symbol)).toEqual([
      "$",
      "☀",
      "✦",
      "✪",
    ]);
    expect(MINE_RANK_TIERS).toHaveLength(8);
    expect(MINE_RANK_TIERS[0].minLevel).toBe(0);
    expect(MINE_RANK_TIERS[7].minLevel).toBe(MINE_RANK_PRESTIGE_LEVEL);
  });
});

describe("Mine Rank — the datapack", () => {
  it("publishes the exact file count it really generates", () => {
    // the site and the docs quote this number — it must never drift
    expect(MINE_RANK_DATAPACK_FILE_COUNT).toBe(files.length);
    expect(new Set(files.map((file) => file.path)).size).toBe(files.length);
  });

  it("writes the pack manifest and the load/tick tags", () => {
    const mcmeta = JSON.parse(byPath.get(`world/datapacks/${MINE_RANK_NS}/pack.mcmeta`)!);
    expect(mcmeta.pack.pack_format).toBe(15);

    const loadTag = JSON.parse(
      byPath.get(`world/datapacks/${MINE_RANK_NS}/data/minecraft/tags/functions/load.json`)!,
    );
    expect(loadTag.values).toEqual([`${MINE_RANK_NS}:load`]);
    const tickTag = JSON.parse(
      byPath.get(`world/datapacks/${MINE_RANK_NS}/data/minecraft/tags/functions/tick.json`)!,
    );
    expect(tickTag.values).toEqual([`${MINE_RANK_NS}:tick`]);
  });

  it("registers every trigger and never uses an objective name over 16 chars", () => {
    const load = fn("load");
    for (const command of MINE_RANK_COMMANDS) {
      expect(load).toContain(`scoreboard objectives add ${command.trigger} trigger`);
    }
    const names = [...load.matchAll(/scoreboard objectives add (\S+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(MINE_RANK_COMMANDS.length);
    for (const name of names) {
      expect(name.length, `objective ${name} is too long for vanilla`).toBeLessThanOrEqual(16);
    }
  });

  it("enables and routes every command in the tick", () => {
    const tick = fn("tick");
    for (const command of MINE_RANK_COMMANDS) {
      expect(tick).toContain(`scoreboard players enable @a ${command.trigger}`);
      expect(tick).toContain(
        `execute as @a[scores={${command.trigger}=1..}] at @s run function ${MINE_RANK_NS}:${command.fn}`,
      );
      // every routed function really exists in the pack
      expect(byPath.has(
        `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions/${command.fn}.mcfunction`,
      )).toBe(true);
    }
  });

  it("reads the REAL vanilla statistics instead of faking the mining", () => {
    const load = fn("load");
    expect(load).toContain("minecraft.mined:minecraft.stone");
    expect(load).toContain("minecraft.mined:minecraft.diamond_ore");
    expect(load).toContain("minecraft.custom:minecraft.player_kills");
    expect(load).toContain("minecraft.custom:minecraft.play_time");

    // the delta keeps the player statistics intact (we never drain them)
    const collect = fn("collect_blocks");
    expect(collect).toContain("scoreboard players operation @s mr_tmp -= @s mr_last_stone");
    expect(collect).not.toContain("scoreboard players set @s mr_s_stone 0");
  });

  it("uses the vanilla 1.20.1 syntax the real E2E proved", () => {
    // `give` takes item(+NBT) → count: in 1.20.1 the NBT is attached to the
    // item id and the count comes AFTER it (the real E2E proved both orders)
    const pickaxe = fn("cmd_pickaxe");
    expect(pickaxe).toContain(
      'give @s minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:efficiency",lvl:3}',
    );
    expect(pickaxe).toContain('}]} 1');
    const fishing = fn("cmd_fishing");
    expect(fishing).toContain(
      'give @s minecraft:fishing_rod{Enchantments:[{id:"minecraft:lure",lvl:3}]} 1',
    );

    // `scoreboard players add` only accepts an integer — a score is added with
    // `scoreboard players operation ... += ...`
    const award = fn("award_blocks");
    expect(award).toContain("scoreboard players operation @s mr_level += @s mr_blocks");
    expect(award).toContain(
      "scoreboard players operation #mr_tot_blocks mr_tot_blocks += @s mr_blocks",
    );
    const kill = fn("award_kill");
    expect(kill).toContain("scoreboard players operation @s mr_cash += @s mr_kill_pending");

    for (const [name, content] of byPath) {
      if (!name.endsWith(".mcfunction")) continue;
      expect(content, `${name} adds a score to a score`).not.toMatch(
        /scoreboard players add \S+ \S+ \S+ \S+/,
      );
    }
  });

  it("builds the private mines: 8 plots with 8 ore layers each", () => {
    expect(MINE_RANK_PLOTS).toBe(8);
    expect(MINE_RANK_ORE_LAYERS).toHaveLength(8);
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      const { x: cx, z: cz } = mineRankPlotCenter(plot);
      const build = fn(`build_plot_${plot}`);
      // the deck stands on its own platform, above any terrain
      expect(build).toContain(
        `fill ${cx - 5} ${MINE_RANK_BASE_Y} ${cz - 5} ${cx + 5} ${MINE_RANK_BASE_Y} ${cz + 5} minecraft:stone`,
      );
      // the shaft: 8 ore layers from the top down to the floor
      expect(build).toContain(
        `fill ${cx - 1} ${MINE_RANK_MINE_TOP_Y} ${cz - 1} ${cx + 1} ${MINE_RANK_MINE_TOP_Y} ${cz + 1} minecraft:coal_ore`,
      );
      expect(build).toContain(
        `fill ${cx - 1} ${MINE_RANK_MINE_FLOOR_Y} ${cz - 1} ${cx + 1} ${MINE_RANK_MINE_FLOOR_Y} ${cz + 1} minecraft:emerald_ore`,
      );
      expect(build).toContain(
        `fill ${cx - 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz - 2} ${cx + 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz + 2} minecraft:bedrock`,
      );
      // the reset restores exactly the same layers
      const reset = fn(`reset_plot_${plot}`);
      expect(reset).toContain("minecraft:coal_ore");
      expect(reset).toContain("minecraft:emerald_ore");
    }
  });

  it("keeps the whole world within 5 chunks of the hub", () => {
    // a long teleport makes the vanilla load the whole chunk corridor and
    // freeze the server (measured: 48 chunks froze the tick for ~45s)
    const distance = (x: number, z: number) =>
      Math.max(Math.abs(x), Math.abs(z)) / 16;
    const structures = [
      MINE_RANK_POND,
      MINE_RANK_ARENA,
      ...Array.from({ length: MINE_RANK_PLOTS }, (_, index) =>
        mineRankPlotCenter(index + 1),
      ),
    ];
    for (const structure of structures) {
      expect(
        distance(structure.x, structure.z),
        `structure at ${structure.x}/${structure.z} is too far from the hub`,
      ).toBeLessThanOrEqual(5);
    }
  });

  it("lays the plots out on a 4x2 grid without overlapping decks", () => {
    const centers = Array.from({ length: MINE_RANK_PLOTS }, (_, index) =>
      mineRankPlotCenter(index + 1),
    );
    // the grid grows towards +X (4 columns) and +Z (2 rows)
    expect(centers[0]).toEqual({ x: 20, z: 20 });
    expect(centers[3]).toEqual({ x: 68, z: 20 });
    expect(centers[4]).toEqual({ x: 20, z: 36 });
    expect(centers[7]).toEqual({ x: 68, z: 36 });

    // every deck is 11x11 — the 16-block spacing keeps them apart
    for (const center of centers) {
      for (const other of centers) {
        if (center === other) continue;
        const apart =
          Math.abs(center.x - other.x) >= 16 || Math.abs(center.z - other.z) >= 16;
        expect(apart).toBe(true);
      }
    }
  });

  it("builds the hub, the fishing pond and the expedition arena", () => {
    const world = fn("build_world");
    expect(world).toContain(
      `fill -6 ${MINE_RANK_BASE_Y} -6 6 ${MINE_RANK_BASE_Y} 6 minecraft:stone`,
    );
    expect(world).toContain(
      `fill ${MINE_RANK_POND.x - 5} ${MINE_RANK_DECK_Y} ${MINE_RANK_POND.z - 5} ${MINE_RANK_POND.x + 5} ${MINE_RANK_DECK_Y} ${MINE_RANK_POND.z + 5} minecraft:water`,
    );
    expect(world).toContain("minecraft:iron_bars");
    // the spawn point is the hub — the player never spawns inside the terrain
    expect(world).toContain(
      `setworldspawn ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
    );
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      expect(world).toContain(`function ${MINE_RANK_NS}:build_plot_${plot}`);
    }
  });

  it("initializes a player who just joined (the vanilla has no join event)", () => {
    const init = fn("init_player");
    // every objective the commands check with `matches 0`
    for (const objective of [
      "mr_level",
      "mr_coins",
      "mr_plot",
      "mr_clan",
      "mr_mine_used",
      "mr_fish",
      "mr_tp_pending",
    ]) {
      expect(init).toContain(`scoreboard players set @s ${objective} 0`);
    }
    // the tier starts at 1 and the player is marked as ready
    expect(init).toContain("scoreboard players set @s mr_rank 1");
    expect(init).toContain("tag @s add mr_ready");

    // the tick initializes whoever is not ready yet — before routing
    const tick = fn("tick");
    expect(tick).toContain(
      `execute as @a[tag=!mr_ready] run function ${MINE_RANK_NS}:init_player`,
    );
    const initAt = tick.indexOf("init_player");
    const routeAt = tick.indexOf(":cmd_mine");
    expect(initAt).toBeGreaterThan(-1);
    expect(initAt).toBeLessThan(routeAt);
  });
});

describe("Mine Rank — the commands really do something", () => {
  it("the mine menu warps, restores and charges for the restore", () => {
    const menu = fn("menu_mine");
    expect(menu).toContain("/trigger mr_t_mine set 2");
    expect(menu).toContain("/trigger mr_t_mine set 3");

    const go = fn("do_mine_go");
    expect(go).toContain(
      `execute if score @s mr_plot matches 1 run tp @s ${mineRankPlotCenter(1).x} ${MINE_RANK_BASE_Y} ${mineRankPlotCenter(1).z}`,
    );
    expect(go).toContain(
      `execute if score @s mr_plot matches 8 run tp @s ${mineRankPlotCenter(8).x} ${MINE_RANK_BASE_Y} ${mineRankPlotCenter(8).z}`,
    );

    const reset = fn("do_mine_reset");
    expect(reset).toContain("if score @s mr_coins matches 25..");
    const pay = fn("pay_mine_reset");
    expect(pay).toContain("scoreboard players remove @s mr_coins 25");
    expect(pay).toContain(`${MINE_RANK_NS}:reset_plot_1`);
  });

  it("prestige resets the level and grants the permanent bonus", () => {
    const prestige = fn("prestige_now");
    expect(prestige).toContain("scoreboard players add @s mr_prestige 1");
    expect(prestige).toContain("scoreboard players set @s mr_level 0");
    expect(prestige).toContain("scoreboard players add @s mr_rubies 5");

    const bonus = fn("bonus_step");
    expect(bonus).toContain("scoreboard players operation @s mr_coins += @s mr_blocks");
    expect(bonus).toContain(`${MINE_RANK_NS}:bonus_step`);
  });

  it("the plot commands register the access by tag and target the nearest player", () => {
    // the vanilla refuses `team join` inside a datapack (the team name is
    // validated while the function is parsed), so the access lives on tags
    const grant = fn("grant_plot_1");
    expect(grant).toContain("tag @s add mr_trust_1");
    const revoke = fn("revoke_plot_1");
    expect(revoke).toContain("tag @s remove mr_trust_1");
    const deny = fn("deny_plot_1");
    expect(deny).toContain("tag @s add mr_deny_1");

    const add = fn("cmd_plot_add");
    expect(add).toContain("tag @s add mr_req");
    expect(add).toContain("@a[limit=1,sort=nearest,tag=!mr_req]");
    expect(add).toContain("tag @s remove mr_req");
  });

  it("never uses a team command — the vanilla validates it at parse time", () => {
    for (const [name, content] of byPath) {
      if (!name.endsWith(".mcfunction")) continue;
      expect(content, `${name} uses a team command`).not.toMatch(/\bteam\s+(add|join|leave|modify)\b/);
      expect(content, `${name} selects by team`).not.toContain("[team=");
    }
  });

  it("the economy has a market that only sells what was mined", () => {
    const sell = fn("sell_coal");
    expect(sell).toContain("if score @s mr_ore_coal matches 1..");
    const doSell = fn("do_sell_coal");
    expect(doSell).toContain("scoreboard players remove @s mr_ore_coal 1");
    expect(doSell).toContain("clear @s minecraft:coal_ore 1");
    expect(doSell).toContain("scoreboard players add @s mr_coins 5");

    const buy = fn("buy_pickaxe");
    expect(buy).toContain("if score @s mr_coins matches 500..");
    const doBuy = fn("do_buy_pickaxe");
    expect(doBuy).toContain("scoreboard players remove @s mr_coins 500");
    expect(doBuy).toContain("give @s minecraft:diamond_pickaxe 1");
  });

  it("the chat commands offer quick phrases instead of pretending to have free text", () => {
    const global = fn("cmd_chat_g");
    expect(global).toContain(`${MINE_RANK_NS}:menu_chat_g`);
    const phrase = fn("chat_g_1");
    expect(phrase).toContain("tellraw @a");
    expect(phrase).toContain('{"selector":"@s"');

    const tell = fn("tell_1");
    expect(tell).toContain("@a[limit=1,sort=nearest,tag=!mr_req]");
  });

  it("every command of the manifest has an mcfunction in the pack", () => {
    for (const command of MINE_RANK_COMMANDS) {
      const path = `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions/${command.fn}.mcfunction`;
      expect(byPath.has(path), `${command.id} has no function`).toBe(true);
    }
  });
});

describe("Mine Rank — the reference that ships with the pack", () => {
  it("documents every command and the honest vanilla limits", () => {
    const doc = mineRankCommandsMarkdown();
    for (const command of MINE_RANK_COMMANDS) {
      expect(doc).toContain(command.id);
      expect(doc).toContain(`/trigger ${command.trigger}`);
    }
    expect(doc).toContain("o vanilla não aceita digitar um nick");
    expect(doc).toContain("nerdzone.gg");
    expect(byPath.get(`world/datapacks/${MINE_RANK_NS}/COMMANDS.md`)).toBe(doc);
  });
});
