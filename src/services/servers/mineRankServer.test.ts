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
  MINE_RANK_MINE_RESET_BLOCKS,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_MINE_VOLUME,
  MINE_RANK_PRERANK_MINE_RESET_BLOCKS,
  MINE_RANK_PRERANK_MINE_VOLUME,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PICKAXE_BASE_LEVEL,
  MINE_RANK_PICKAXE_ENCHANTS,
  MINE_RANK_PICKAXE_ITEM,
  MINE_RANK_PLOTS,
  MINE_RANK_POND,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_TIERS,
  MINE_RANK_ENCHANT_MIN_LEVEL,
  MINE_RANK_ENCHANT_BENCH_POS,
  MINE_RANK_MNC_CAP,
  MINE_RANK_MNC_PICKAXE_PRICE,
  SHOVEL_MULTIPLIER_MILLE,
  SHOVEL_UPGRADE_PRICE_COINS,
  generateMineRankFiles,
  mineRankCommandsMarkdown,
  mineRankEnchantPrice,
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

/**
 * Every command line of every generated function.
 *
 * The vanilla 1.20.1 parser is the judge of the datapack — a single
 * invalid command makes the WHOLE function fail to load, and the server
 * logs the error on every boot.
 */
function everyCommandLine(): Array<{ file: string; line: string }> {
  const out: Array<{ file: string; line: string }> = [];
  for (const file of files) {
    if (!file.path.endsWith(".mcfunction")) continue;
    for (const line of file.content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      out.push({ file: file.path, line: trimmed });
    }
  }
  return out;
}

/**
 * The vanilla 1.20.1 rules this guard protects:
 *
 * - `matches` takes ONE range token built from integer constants
 *   (`5`, `0..`, `..100`, `1..10`) — a score holder is a parse error.
 * - `scoreboard players set/remove` take an INTEGER LITERAL as the value —
 *   `remove`/`set` with a score holder does not load.
 */
const VALID_RANGE = /^-?\d*(\.\.-?\d*)?$/;
const INTEGER_LITERAL = /^-?\d+$/;

function vanillaSyntaxProblem(line: string): string | null {
  const matchAt = line.indexOf(" matches ");
  if (matchAt >= 0) {
    const range = line.slice(matchAt + " matches ".length).split(" ")[0];
    if (!VALID_RANGE.test(range)) {
      return `matches with a non-literal range (${range})`;
    }
  }
  const players = line.match(
    /^scoreboard players (set|remove)\s+(\S+)\s+(\S+)\s+(\S+)/,
  );
  if (players && !INTEGER_LITERAL.test(players[4])) {
    return `players ${players[1]} with a non-literal value (${players[4]})`;
  }
  return null;
}

describe("Mine Rank — the vanilla 1.20.1 parser is the judge", () => {
  it("never ships an uninterpolated template placeholder", () => {
    // A double-quoted string keeps `${…}` as literal text — the vanilla then
    // reads "function ${MINE_RANK_NS}:x" as one argument and refuses the
    // whole function. This is the bug the E2E caught in the first run.
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.path.endsWith(".mcfunction")) continue;
      for (const line of file.content.split("\n")) {
        if (line.includes("${")) {
          offenders.push(`${file.path}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never uses a score holder where the vanilla demands a literal", () => {
    const offenders: string[] = [];
    for (const { file, line } of everyCommandLine()) {
      const problem = vanillaSyntaxProblem(line);
      if (problem) offenders.push(`${file}: ${line} (${problem})`);
    }
    expect(offenders).toEqual([]);
  });

  it("never uses a `team join` (the vanilla refuses it inside a datapack)", () => {
    for (const { file, line } of everyCommandLine()) {
      expect(line.startsWith("team join"), `${file}: ${line}`).toBe(false);
    }
  });

  it("puts the NBT of a `give` before the count (the 1.20.1 order)", () => {
    for (const { file, line } of everyCommandLine()) {
      if (!line.startsWith("give ")) continue;
      // `give <target> <item{NBT}> <count>` — the count is always the last
      // one (the item may carry spaces inside a quoted NBT string).
      expect(line, `${file}: ${line}`).toMatch(/^give\s+\S+\s+.*\s+-?\d+$/);
    }
  });

  it("keeps every objective name inside the 16-character vanilla limit", () => {
    const names = new Set<string>();
    for (const { line } of everyCommandLine()) {
      const match = line.match(
        /^scoreboard objectives add ([a-zA-Z0-9_]+) /,
      );
      if (match) names.add(match[1]);
      const players = line.match(
        /^scoreboard players (?:set|add|remove) \S+ ([a-zA-Z0-9_]+) /,
      );
      if (players) names.add(players[1]);
      const operation = line.match(
        /^scoreboard players operation \S+ ([a-zA-Z0-9_]+) /,
      );
      if (operation) names.add(operation[1]);
    }
    for (const name of names) {
      expect(name.length, `objective too long: ${name}`).toBeLessThanOrEqual(16);
    }
  });

  it("gives every `scoreboard players operation` a score holder as its source", () => {
    // Proven against the vanilla 1.20.1 server:
    //
    //   scoreboard players operation <target> <targetObj> <op> <source> [<sourceObj>]
    //
    // · with SIX tokens after `operation` the command does not parse at
    //   all and the whole function FAILS TO LOAD;
    // · with FOUR tokens (the source objective omitted) the command
    //   parses but is a SILENT NO-OP — the server answers
    //   "Can't get value of <obj> for <target>; none is set" and the
    //   target is never written;
    // · with a LITERAL source (`= 10`, `-= 40`, …) the command also
    //   parses and is a SILENT NO-OP — the literal is read as a score
    //   holder with no score, so the target keeps its old value. The
    //   vanilla commands for that are `scoreboard players set/add/remove`;
    // · with FIVE tokens and a real score holder the operation behaves
    //   exactly as written and composes with the previous line.
    const offenders: string[] = [];
    for (const { file, line } of everyCommandLine()) {
      if (!line.startsWith("scoreboard players operation ")) continue;
      const parts = line.trim().split(/\s+/);
      // parts[0..2] = scoreboard · players · operation
      const operands = parts.slice(3);
      if (operands.length === 4 && /^-?\d+$/.test(operands[3])) {
        offenders.push(
          `${file}: ${line} (a literal source is a silent no-op — use scoreboard players set/add/remove)`,
        );
        continue;
      }
      if (operands.length === 5) continue;
      offenders.push(
        `${file}: ${line} (${operands.length} operands after "operation" — the source objective is ${
          operands.length < 5 ? "missing (silent no-op)" : "duplicated (does not parse)"
        })`,
      );
    }
    expect(offenders).toEqual([]);
  });
});

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
      [
        "economia",
        "geral",
        "mina",
        "progressao",
        "social",
        "sistemas",
        "terrenos",
        "prerank",
        "pickaxe",
        "mine_terra",
        "mine_areia",
      ].sort(),
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
    // the new pickaxe is the SAME item the shop and the Bronze rank hand
    // over (one definition), and it lands in the MAIN HAND when that hand is
    // free or already holds the pickaxe — `item replace` never destroys an
    // unrelated item the way a blind `give` into a full hotbar can strand one
    expect(pickaxe).toContain(MINE_RANK_PICKAXE_ITEM);
    expect(pickaxe).toContain(
      "execute if data entity @s {SelectedItem:{}} run item replace entity @s weapon.mainhand with",
    );
    expect(pickaxe).toContain(
      'execute if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} run item replace entity @s weapon.mainhand with',
    );
    // a busy hand gets a plain give (the NBT is attached to the item id and
    // the count comes AFTER it — the real E2E proved both orders)
    expect(pickaxe).toContain(
      "execute unless data entity @s {SelectedItem:{}} unless data entity @s {SelectedItem:{id:\"minecraft:diamond_pickaxe\"}} run give @s",
    );
    // the levels the player BUILT go back onto the new pickaxe
    expect(pickaxe).toContain(`function ${MINE_RANK_NS}:apply_enchants`);
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

  it("builds the private mines: 8 plots with 5 ore layers each", () => {
    expect(MINE_RANK_PLOTS).toBe(8);
    expect(MINE_RANK_ORE_LAYERS).toHaveLength(5);
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      const { x: cx, z: cz } = mineRankPlotCenter(plot);
      const build = fn(`build_plot_${plot}`);
      // the deck stands on its own platform, above any terrain
      expect(build).toContain(
        `fill ${cx - 5} ${MINE_RANK_BASE_Y} ${cz - 5} ${cx + 5} ${MINE_RANK_BASE_Y} ${cz + 5} minecraft:stone`,
      );
      // the shaft hangs from the deck: coal right under the hole, emerald
      // one above the bedrock floor
      expect(build).toContain(
        `fill ${cx - 1} ${MINE_RANK_MINE_TOP_Y} ${cz - 1} ${cx + 1} ${MINE_RANK_MINE_TOP_Y} ${cz + 1} minecraft:coal_ore`,
      );
      const deepestOre = MINE_RANK_MINE_FLOOR_Y + 1;
      expect(build).toContain(
        `fill ${cx - 1} ${deepestOre} ${cz - 1} ${cx + 1} ${deepestOre} ${cz + 1} minecraft:emerald_ore`,
      );
      expect(build).toContain(
        `fill ${cx - 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz - 2} ${cx + 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz + 2} minecraft:bedrock`,
      );
      // the reset restores exactly the same layers
      const reset = fn(`reset_plot_${plot}`);
      expect(reset).toContain("minecraft:coal_ore");
      expect(reset).toContain("minecraft:emerald_ore");
      // and every ore layer the mine holds, in the same order
      for (const ore of MINE_RANK_ORE_LAYERS) {
        expect(reset).toContain(`minecraft:${ore}`);
      }
    }
  });

  /**
   * The coupling that broke silently.
   *
   * The automatic restore used to fire at a hand-written 100 blocks while
   * the whole mine held 72 (8 layers of 3x3). The restore could therefore
   * only happen after the player had mined MORE blocks than the mine
   * contains — in practice after digging the shaft walls. A smaller mine
   * makes that worse, never better: the mine empties and stays empty.
   *
   * The threshold is now derived from the volume, and these tests hold the
   * two together for every mine the module builds.
   */
  it("restores every mine while it still has ore in it", () => {
    // the private mine: 5 layers of 3x3
    expect(MINE_RANK_MINE_VOLUME).toBe(MINE_RANK_ORE_LAYERS.length * 9);
    expect(MINE_RANK_MINE_RESET_BLOCKS).toBeLessThan(MINE_RANK_MINE_VOLUME);

    // the pre-rank mines: a 7x7 platform, 3 layers of dirt/sand
    expect(MINE_RANK_PRERANK_MINE_VOLUME).toBe(49 * 3);
    expect(MINE_RANK_PRERANK_MINE_RESET_BLOCKS).toBeLessThan(
      MINE_RANK_PRERANK_MINE_VOLUME,
    );

    // and the threshold has to leave a margin, not fire on the last block
    expect(MINE_RANK_MINE_RESET_BLOCKS).toBeLessThanOrEqual(
      Math.floor(MINE_RANK_MINE_VOLUME * 0.75),
    );
    expect(MINE_RANK_PRERANK_MINE_RESET_BLOCKS).toBeLessThanOrEqual(
      Math.floor(MINE_RANK_PRERANK_MINE_VOLUME * 0.75),
    );
  });

  it("hangs the mine from the deck, with no gap to fall through", () => {
    // the first ore layer is the block under the deck's hole
    expect(MINE_RANK_MINE_TOP_Y).toBe(MINE_RANK_BASE_Y - 1);
    // and the walls wrap every ore layer, no more and no less
    expect(MINE_RANK_MINE_FLOOR_Y + 1).toBe(
      MINE_RANK_MINE_TOP_Y - (MINE_RANK_ORE_LAYERS.length - 1),
    );
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

  it("pre-ranks Terra and Areia exist with valid triggers", () => {
    const prerank = MINE_RANK_COMMANDS.find((c) => c.id === "pre-rank");
    expect(prerank).toBeDefined();
    expect(prerank!.trigger).toBe("mr_t_prerank");
    expect(prerank!.trigger.length).toBeLessThanOrEqual(16);

    const terra = MINE_RANK_COMMANDS.find((c) => c.id === "terra");
    expect(terra).toBeDefined();
    expect(terra!.trigger).toBe("mr_t_terra");
    expect(terra!.trigger.length).toBeLessThanOrEqual(16);

    const areia = MINE_RANK_COMMANDS.find((c) => c.id === "areia");
    expect(areia).toBeDefined();
    expect(areia!.trigger).toBe("mr_t_areia");
    expect(areia!.trigger.length).toBeLessThanOrEqual(16);

    const terraMine = MINE_RANK_COMMANDS.find((c) => c.id === "mina terra");
    expect(terraMine).toBeDefined();
    expect(terraMine!.trigger).toBe("mr_t_terra_mine");
    expect(terraMine!.trigger.length).toBeLessThanOrEqual(16);

    const areiaMine = MINE_RANK_COMMANDS.find((c) => c.id === "mina areia");
    expect(areiaMine).toBeDefined();
    expect(areiaMine!.trigger).toBe("mr_t_areia_mine");
    expect(areiaMine!.trigger.length).toBeLessThanOrEqual(16);
  });

  it("shovel merchant and upgrade commands exist", () => {
    const mercador = MINE_RANK_COMMANDS.find((c) => c.id === "mercador");
    expect(mercador).toBeDefined();
    expect(mercador!.trigger).toBe("mr_t_mercador");

    const pickUp = MINE_RANK_COMMANDS.find((c) => c.id === "pá upgrade");
    expect(pickUp).toBeDefined();
    expect(pickUp!.trigger).toBe("mr_t_pick_up");
    expect(pickUp!.trigger.length).toBeLessThanOrEqual(16);

    const fn = (name: string) =>
      byPath.get(
        `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions/${name}.mcfunction`,
      );
    expect(fn("cmd_mercador")).toBeDefined();
    expect(fn("cmd_pickaxe_upgrade")).toBeDefined();
    expect(fn("pickaxe_check")).toBeDefined();
    expect(fn("do_pickaxe_upgrade")).toBeDefined();
    expect(fn("cmd_mnc")).toBeDefined();
    expect(fn("mnc_route")).toBeDefined();
  });

  it("pre-rank and shovel scoreboard objectives exist in load", () => {
    const load = fn("load");
    for (const objective of [
      "mr_prerank",
      "mr_pickaxe_level",
      "mr_pick_mat",
      "mr_pickaxe_mult",
      "mr_pickaxe_price",
      "mr_block_value",
      "mr_pick_reward",
      "mr_pick_accum",
      "mr_mnc",
      "mr_blocks_terra",
      "mr_blocks_areia",
      "mr_terra_pending",
      "mr_areia_pending",
      "mr_in_terra",
      "mr_in_areia",
    ]) {
      expect(load).toContain(`scoreboard objectives add ${objective} dummy`);
    }
    // the real vanilla statistics the pre-rank mines read
    expect(load).toContain(
      "scoreboard objectives add mr_s_dirt minecraft.mined:minecraft.dirt",
    );
    expect(load).toContain(
      "scoreboard objectives add mr_s_sand minecraft.mined:minecraft.sand",
    );
    // the exact-money constant (1 coin = 100000 milli-cents)
    expect(load).toContain("scoreboard players set #mr_k100000 mr_const 100000");
  });

  it("shovel multiplier constants are configured", () => {
    expect(SHOVEL_MULTIPLIER_MILLE.wood).toBe(200);
    expect(SHOVEL_MULTIPLIER_MILLE.diamond).toBe(1500);
    expect(SHOVEL_MULTIPLIER_MILLE.netherite).toBe(2000);
    expect(SHOVEL_UPGRADE_PRICE_COINS.stone).toBe(50);
    expect(SHOVEL_UPGRADE_PRICE_COINS.diamond).toBe(600);
  });

  it("MineCoin is only unlocked at Bronze", () => {
    const mnc = MINE_RANK_COMMANDS.find((c) => c.id === "mnc");
    expect(mnc).toBeDefined();
    expect(mnc!.family).toBe("economia");
    const load = fn("load");
    expect(load).toContain("scoreboard objectives add mr_mnc dummy");
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

/**
 * The pickaxe enchantments — bought with MINE COIN, never with tokens.
 *
 * The owner's rule: "adicione encantamentos somente com a criptomoeda".
 * These tests are the guard on three things that would each break the
 * server in a different way:
 *
 *  1. the currency — an enchant charged in the wrong coin drains the wrong
 *     balance and the player is never told why it stopped working;
 *  2. the price — every level branch must match the single price formula,
 *     or the menu lies about what a click costs;
 *  3. the item — the level lives in a scoreboard and only reaches the item
 *     through `data modify` on the MAIN HAND pickaxe. Touching another item
 *     would silently corrupt whatever the player was holding.
 */
describe("Mine Rank — the pickaxe enchantments", () => {
  it("exposes one menu command and one buy command per enchantment", () => {
    const enchants = MINE_RANK_COMMANDS.filter((command) =>
      command.id.startsWith("encantar_"),
    );
    expect(enchants).toHaveLength(MINE_RANK_PICKAXE_ENCHANTS.length);
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const command = enchants.find((entry) => entry.id === `encantar_${enchant.objective.replace("mr_enc_", "")}`);
      expect(command, `no command buys ${enchant.label}`).toBeDefined();
      expect(command!.trigger).toBe(enchant.trigger);
      // the description carries the price of the NEXT level — the one a
      // player at the pickaxe's own base actually pays
      const base = MINE_RANK_PICKAXE_BASE_LEVEL[enchant.objective] ?? 0;
      expect(command!.description).toContain(
        `${mineRankEnchantPrice(enchant, base + 1)} MNC`,
      );
      expect(command!.description).not.toContain("token");
    }
    const menu = MINE_RANK_COMMANDS.find((command) => command.id === "encantos");
    expect(menu).toBeDefined();
  });

  it("charges the price the formula says, on every level", () => {
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const key = enchant.objective.replace("mr_enc_", "");
      const buy = fn(`cmd_enc_${key}`);
      for (let level = 0; level < enchant.maxLevel; level += 1) {
        const expected = mineRankEnchantPrice(enchant, level + 1);
        expect(
          buy,
          `${enchant.label}: level ${level} must charge ${expected} MNC`,
        ).toContain(
          `execute if score @s ${enchant.objective} matches ${level} run scoreboard players set @s mr_enc_price ${expected}`,
        );
      }
      // the price is charged in MINE COIN — and the coin balance is the one
      // that moves
      expect(buy).toContain(
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} if score @s ${enchant.objective} matches ..${enchant.maxLevel - 1} if score @s mr_mnc >= @s mr_enc_price run function ${MINE_RANK_NS}:enc_take_${key}`,
      );
      // and never in tokens
      expect(buy).not.toContain("mr_tokens");
    }
  });

  it("closes the ladder at the ceiling and asks for the pickaxe in hand", () => {
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const key = enchant.objective.replace("mr_enc_", "");
      const buy = fn(`cmd_enc_${key}`);
      // the ladder only OPENS at the rank gate — and the gate is part of
      // every branch, so holding the pickaxe or owning the coin cannot
      // bypass it
      expect(buy).toContain(
        `execute if score @s mr_level matches ..${MINE_RANK_ENCHANT_MIN_LEVEL - 1} run function ${MINE_RANK_NS}:enc_rank`,
      );
      for (const line of [
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. unless score @s mr_p_market matches 1`,
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 unless data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}}`,
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} if score @s ${enchant.objective} matches ..${enchant.maxLevel - 1} if score @s mr_mnc >= @s mr_enc_price`,
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} if score @s ${enchant.objective} matches ${enchant.maxLevel}..`,
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} if score @s ${enchant.objective} matches ..${enchant.maxLevel - 1} unless score @s mr_mnc >= @s mr_enc_price`,
      ]) {
        expect(buy, `${enchant.label}: every branch carries the rank gate`).toContain(line);
      }
      // holding the pickaxe is a hard requirement
      expect(buy).toContain(
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 unless data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} run function ${MINE_RANK_NS}:enc_hold`,
      );
      // the ceiling stops the ladder
      expect(buy).toContain(
        `execute if score @s mr_level matches ${MINE_RANK_ENCHANT_MIN_LEVEL}.. if score @s mr_p_market matches 1 if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} if score @s ${enchant.objective} matches ${enchant.maxLevel}.. run function ${MINE_RANK_NS}:enc_max_${key}`,
      );
    }
    // and the failure messages say which coin is missing
    const poor = fn("enc_poor");
    expect(poor).toContain("MineCoin insuficiente");
    expect(poor).toContain("mr_mnc");
    expect(fn("enc_hold")).toContain("Picareta de Mineração na mão");
  });

  it("writes the bought level into the pickaxe the player is holding", () => {
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const key = enchant.objective.replace("mr_enc_", "");
      const take = fn(`enc_take_${key}`);
      // the coin is really deducted, and only then the level rises
      expect(take).toContain("scoreboard players operation @s mr_mnc -= @s mr_enc_price");
      expect(take).toContain(`scoreboard players add @s ${enchant.objective} 1`);
      // VANILLA TRUTH (measured on a live server): a command CANNOT write a
      // player's NBT — every `data modify entity <player>` answers
      // "Unable to modify player data", while the same command on another
      // entity works. So the item travels through the work barrel: block
      // entities ARE writable, and `item replace ... from` copies (the
      // player never loses the item if a step fails)
      const at = MINE_RANK_ENCHANT_BENCH_POS;
      expect(take).toContain(
        `item replace block ${at} container.0 from entity @s weapon.mainhand`,
      );
      // the level travels from the SCOREBOARD into the item NBT: vanilla has
      // no command that adds an enchantment to a held item
      expect(take).toContain(
        `data merge storage ${MINE_RANK_NS}:ench {value:{id:"${enchant.id}"}}`,
      );
      expect(take).toContain(
        `execute store result storage ${MINE_RANK_NS}:ench value.lvl byte 1 run scoreboard players get @s ${enchant.objective}`,
      );
      // the stale entry for that enchantment is removed first, so the item
      // never carries two levels of the same enchantment
      expect(take).toContain(
        `data remove block ${at} Items[{Slot:0b}].tag.Enchantments[{id:"${enchant.id}"}]`,
      );
      expect(take).toContain(
        `data modify block ${at} Items[{Slot:0b}].tag.Enchantments append from storage ${MINE_RANK_NS}:ench value`,
      );
      // and the enchanted item comes BACK to the hand
      expect(take).toContain(
        `item replace entity @s weapon.mainhand from block ${at} container.0`,
      );
      // and NEVER touches the player's own NBT
      expect(take).not.toContain("data modify entity @s");
    }
  });

  it("re-applies the built levels onto a brand-new pickaxe", () => {
    const apply = fn("apply_enchants_ok");
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      expect(apply).toContain(
        `execute if score @s ${enchant.objective} matches 1.. run function ${MINE_RANK_NS}:apply_${enchant.objective.replace("mr_enc_", "")}`,
      );
    }
    // only the item in HAND is ever touched, and only when it is the pickaxe
    expect(fn("apply_enchants")).toContain(
      `execute if data entity @s {SelectedItem:{id:"minecraft:diamond_pickaxe"}} run function ${MINE_RANK_NS}:apply_enchants_ok`,
    );
  });

  it("keeps the whole ladder affordable inside the MineCoin cap", () => {
    // the cap is what stops the MineCoin from flooding the economy
    const total = MINE_RANK_PICKAXE_ENCHANTS.reduce(
      (sum, enchant) => sum + mineRankEnchantPrice(enchant, enchant.maxLevel),
      0,
    );
    expect(total).toBeLessThan(MINE_RANK_MNC_CAP);
    // and the pickaxe itself still costs less than the whole ladder
    expect(MINE_RANK_MNC_PICKAXE_PRICE).toBeLessThan(total);
  });

  /**
   * The base level of the pickaxe — the bug the LIVE E2E caught.
   *
   * The enchantment ladder does not start at zero: the pickaxe is handed
   * over with Efficiency III and Unbreaking III, and buying a level
   * REPLACES the item's entry with the scoreboard level (vanilla has no
   * command that adds one point to an enchantment). With the objectives
   * starting at 0, the first purchase wrote `lvl:1b` over the pickaxe's own
   * `lvl:3b` and the player paid to make the pickaxe WORSE — measured on
   * the live server: "Eficiência subiu para o nível 1 (-2 MNC)".
   */
  it("starts the ladder at the level the pickaxe already has", () => {
    const init = fn("init_player");
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const base = MINE_RANK_PICKAXE_BASE_LEVEL[enchant.objective] ?? 0;
      expect(
        init,
        `${enchant.label} must start at ${base} (the pickaxe's own level)`,
      ).toContain(`scoreboard players set @s ${enchant.objective} ${base}`);
    }
    // and the objectives are NOT in the zero list — zeroing them would lower
    // the pickaxe the player is holding
    expect(init).not.toContain("scoreboard players set @s mr_enc_eff 0");
  });

  it("charges the NEXT level from the base, not from zero", () => {
    for (const enchant of MINE_RANK_PICKAXE_ENCHANTS) {
      const key = enchant.objective.replace("mr_enc_", "");
      const buy = fn(`cmd_enc_${key}`);
      const base = MINE_RANK_PICKAXE_BASE_LEVEL[enchant.objective] ?? 0;
      const expected = mineRankEnchantPrice(enchant, base + 1);
      expect(
        buy,
        `${enchant.label}: the first purchase (level ${base}) costs ${expected} MNC`,
      ).toContain(
        `execute if score @s ${enchant.objective} matches ${base} run scoreboard players set @s mr_enc_price ${expected}`,
      );
    }
  });
});
