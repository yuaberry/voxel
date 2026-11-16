/**
 * Completeness audit of the Mine Rank world and datapack.
 *
 * A vanilla datapack has NO compiler: a function that calls a function that
 * does not exist, a scoreboard objective that was never declared, a manifest
 * trigger with no function behind it, or a mine with a hole between its
 * layers — every one of those is a real bug that the game only shows as
 * "nothing happens", and the owner has no way to tell them apart.
 *
 * So the generated pack is audited like a build: every reference resolves,
 * every objective is declared, the world is geometrically coherent, and the
 * manifest surface is fully wired. Each check names what it found.
 */

import { describe, expect, it } from "vitest";
import {
  MINE_RANK_ARENA,
  MINE_RANK_BASE_Y,
  MINE_RANK_COMMANDS,
  MINE_RANK_CHAIN_MAX_PRICE,
  MINE_RANK_CHAIN_MIN_PRICE,
  MINE_RANK_CHAIN_INITIAL_PRICE,
  MINE_RANK_MINE_FLOOR_Y,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_MINE_VOLUME,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_POND,
  MINE_RANK_TERRA_MINE,
  MINE_RANK_AREIA_MINE,
  MINE_RANK_MINE_RESET_BLOCKS,
  MINE_RANK_MNC_PICKAXE_PRICE,
  MINE_RANK_MINE_RESET_COST,
  generateMineRankFiles,
  manualBook,
  mineRankPlotCenter,
} from "./mineRankServer";

const files = generateMineRankFiles();
const FUNCTIONS_DIR = `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions`;

const functionNames = new Set(
  files
    .filter((file) => file.path.startsWith(`${FUNCTIONS_DIR}/`) && file.path.endsWith(".mcfunction"))
    .map((file) => file.path.slice(`${FUNCTIONS_DIR}/`.length, -".mcfunction".length)),
);

const functionSource = new Map(
  files
    .filter((file) => file.path.startsWith(`${FUNCTIONS_DIR}/`) && file.path.endsWith(".mcfunction"))
    .map((file) => [
      file.path.slice(`${FUNCTIONS_DIR}/`.length, -".mcfunction".length),
      file.content,
    ]),
);

const everything = [...functionSource.values()].join("\n");

/** Every `function nexus_rank:xxx` reference, in every generated file. */
function callsIn(source: string): string[] {
  return [...source.matchAll(/function nexus_rank:([a-z0-9_]+)/g)].map((match) => match[1]);
}

describe("the generated datapack resolves — every reference points somewhere", () => {
  it("calls only functions that really exist", () => {
    const missing = new Map<string, string>();
    for (const [name, source] of functionSource) {
      for (const called of callsIn(source)) {
        // the load/tick tag references are written in pack.mcmeta, not here
        if (!functionNames.has(called) && !missing.has(called)) {
          missing.set(called, name);
        }
      }
    }
    expect(
      [...missing].map(([called, from]) => `${called} (called from ${from})`),
      "a vanilla function that calls a missing function fails at runtime with",
    ).toEqual([]);
  });

  it("declares every objective the functions use", () => {
    // any type: `dummy`, `trigger` (the player commands) or the vanilla
    // `minecraft.*` criteria the statistics read
    const declared = new Set(
      [
        ...everything.matchAll(
          /scoreboard objectives add ([a-z0-9_]+) (?:dummy|trigger|minecraft\.[a-z:.]+)/g,
        ),
      ].map((m) => m[1]),
    );
    expect(declared.size).toBeGreaterThan(40);

    // every objective the pack touches: set / add / get / reset / operation /
    // remove — the two forms of `operation` (`a op b`) are read differently
    const used = new Set<string>();
    for (const match of everything.matchAll(
      /scoreboard players (?:set|add|get|reset|remove) [#@]?[A-Za-z0-9_]+ ([a-z0-9_]+)/g,
    )) {
      used.add(match[1]);
    }
    for (const match of everything.matchAll(
      /scoreboard players operation [#@]?[A-Za-z0-9_]+ ([a-z0-9_]+) [-+*/=] [#@]?[A-Za-z0-9_]+ ([a-z0-9_]+)/g,
    )) {
      used.add(match[1]);
      used.add(match[2]);
    }
    const undeclared = [...used].filter((objective) => !declared.has(objective));
    expect(
      undeclared,
      "an undeclared objective makes every branch that reads it silently false",
    ).toEqual([]);
  });

  it("wires every manifest command to a real function", () => {
    for (const command of MINE_RANK_COMMANDS) {
      expect(
        functionNames.has(command.fn),
        `command ${command.id} (${command.trigger}) points at ${command.fn}, which does not exist`,
      ).toBe(true);
      // and the trigger objective the player clicks exists too
      expect(everything).toContain(command.trigger);
      // and the trigger it resets is the manifest one, not a typo: a reset
      // written to a non-existent objective leaves the real trigger at 1 and
      // the command re-runs every single tick (that bug existed: tpaccept
      // reset mr_tp_ok and the accepted teleport repeated forever)
      const resetLine = `scoreboard players set @s ${command.trigger} 0`;
      expect(
        functionSource.get(command.fn) ?? "",
        `${command.fn} must reset ${command.trigger}`,
      ).toContain(resetLine);
    }

  });
});

describe("the Mine Rank world is complete and coherent", () => {
  it("builds every area of the world from the setup function", () => {
    const load = functionSource.get("load") ?? "";
    // the hub, the pond, the arena and the two pre-rank mines are their own
    // functions, and the plots are one call each
    // one function builds the hub, the pond and the arena; the pre-rank mines
    // and the plots are one call each
    expect(load, "the setup never builds the world").toContain(
      `function ${MINE_RANK_NS}:build_world`,
    );
    // the pre-rank mines are called from the world builder itself
    const world = functionSource.get("build_world") ?? "";
    expect(world, "the world builder never builds the pre-rank mines").toContain(
      `function ${MINE_RANK_NS}:build_terra_mine`,
    );
    expect(world).toContain(`function ${MINE_RANK_NS}:build_areia_mine`);
    // os terrenos: uma chamada cada, todas dentro do construtor do mundo
    const calls = callsIn(world).filter((called) => called.startsWith("build_plot_"));
    expect(calls).toHaveLength(MINE_RANK_PLOTS);
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      expect(calls, `the world builder never builds plot ${plot}`).toContain(
        `build_plot_${plot}`,
      );
    }
  });

  it("hangs a contiguous shaft from every deck, walls all the way down", () => {
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      const { x: cx, z: cz } = mineRankPlotCenter(plot);
      const build = functionSource.get(`build_plot_${plot}`) ?? "";

      // the footing under the deck, then the deck itself, then the hole
      expect(build).toContain(
        `fill ${cx - 5} ${MINE_RANK_BASE_Y} ${cz - 5} ${cx + 5} ${MINE_RANK_BASE_Y} ${cz + 5} minecraft:stone`,
      );

      // a WALL at ±2 for EVERY ore layer, and no wall outside the shaft: a
      // gap in the wall lets the mine bleed into the stone around it
      for (let y = MINE_RANK_MINE_FLOOR_Y + 1; y <= MINE_RANK_MINE_TOP_Y; y += 1) {
        for (const [x0, x1, z0, z1] of [
          [cx - 2, cx - 2, cz - 2, cz + 2],
          [cx + 2, cx + 2, cz - 2, cz + 2],
          [cx - 2, cx + 2, cz - 2, cz - 2],
          [cx - 2, cx + 2, cz + 2, cz + 2],
        ]) {
          expect(build, `plot ${plot}: no wall at y=${y}`).toContain(
            `fill ${x0} ${y} ${z0} ${x1} ${y} ${z1} minecraft:stone`,
          );
        }
      }
      // no ore anywhere else: the ore layers are EXACTLY the shaft
      const oreLines = build
        .split("\n")
        .filter((line) => /minecraft:(coal|iron|gold|diamond|emerald)_ore/.test(line));
      expect(oreLines).toHaveLength(MINE_RANK_ORE_LAYERS.length);
      MINE_RANK_ORE_LAYERS.forEach((ore, index) => {
        const y = MINE_RANK_MINE_TOP_Y - index;
        expect(build, `plot ${plot}: ${ore} must sit at y=${y}`).toContain(
          `fill ${cx - 1} ${y} ${cz - 1} ${cx + 1} ${y} ${cz + 1} minecraft:${ore}`,
        );
      });
      // the floor of the shaft is bedrock, and it is one below the deepest ore
      expect(build).toContain(
        `fill ${cx - 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz - 2} ${cx + 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz + 2} minecraft:bedrock`,
      );
    }
    // and the walls wrap a 3x3 interior — the ore (3x3) must fit inside them
    expect(MINE_RANK_MINE_VOLUME).toBe(MINE_RANK_ORE_LAYERS.length * 9);
  });

  it("keeps every area apart from every other area", () => {
    const centers = Array.from({ length: MINE_RANK_PLOTS }, (_, index) =>
      mineRankPlotCenter(index + 1),
    );
    // the decks are 11x11 (radius 5): two centers must never be closer than
    // that, or the platforms merge and the mines share a wall
    for (let a = 0; a < centers.length; a += 1) {
      for (let b = a + 1; b < centers.length; b += 1) {
        const distance = Math.max(
          Math.abs(centers[a].x - centers[b].x),
          Math.abs(centers[a].z - centers[b].z),
        );
        expect(
          distance,
          `plots ${a + 1} and ${b + 1} are only ${distance} blocks apart`,
        ).toBeGreaterThanOrEqual(11);
      }
    }
    // the pre-rank mines have their own coordinates — they must not sit under
    // a plot (a shared mine would pay the wrong economy)
    for (const mine of [MINE_RANK_TERRA_MINE, MINE_RANK_AREIA_MINE]) {
      for (const [index, center] of centers.entries()) {
        const distance = Math.max(
          Math.abs(mine.x - center.x),
          Math.abs(mine.z - center.z),
        );
        expect(
          distance,
          `the pre-rank mine at ${mine.x},${mine.z} overlaps plot ${index + 1}`,
        ).toBeGreaterThan(16);
      }
    }
  });

  it("keeps the whole world inside the compact envelope", () => {
    // a long teleport makes the vanilla load the whole chunk corridor and
    // freeze the tick (measured: 48 chunks froze the server for ~45s)
    const distance = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) / 16;
    const areas: Array<[string, number, number]> = [
      ["pond", MINE_RANK_POND.x, MINE_RANK_POND.z],
      ["arena", MINE_RANK_ARENA.x, MINE_RANK_ARENA.z],
      ["terra mine", MINE_RANK_TERRA_MINE.x, MINE_RANK_TERRA_MINE.z],
      ["areia mine", MINE_RANK_AREIA_MINE.x, MINE_RANK_AREIA_MINE.z],
      ...Array.from({ length: MINE_RANK_PLOTS }, (_, index): [string, number, number] => {
        const center = mineRankPlotCenter(index + 1);
        return [`plot ${index + 1}`, center.x, center.z];
      }),
    ];
    for (const [name, x, z] of areas) {
      expect(distance(x, z), `${name} is ${distance(x, z)} chunks from the hub`).toBeLessThanOrEqual(
        5,
      );
    }
  });

  it("restores a mine the same way it built it", () => {
    for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
      const { x: cx, z: cz } = mineRankPlotCenter(plot);
      const reset = functionSource.get(`reset_plot_${plot}`) ?? "";
      MINE_RANK_ORE_LAYERS.forEach((ore, index) => {
        const y = MINE_RANK_MINE_TOP_Y - index;
        expect(reset, `reset of plot ${plot} must put ${ore} back at y=${y}`).toContain(
          `fill ${cx - 1} ${y} ${cz - 1} ${cx + 1} ${y} ${cz + 1} minecraft:${ore}`,
        );
      });
      // and the session counter is closed where the restore is PAID, or the
      // threshold would be reached again immediately and the mine would
      // restore on every tick
      const paid = functionSource.get("pay_mine_reset") ?? "";
      expect(paid).toContain("scoreboard players set @s mr_mine_used 0");
    }
  });

  it("runs the economy chain in the order that pays the player", () => {
    const tick = functionSource.get("tick") ?? "";
    // the statistics are read BEFORE they are awarded, or a block mined in
    // the same tick as the award is paid twice
    const read = tick.indexOf(`function ${MINE_RANK_NS}:collect_blocks`);
    const award = tick.indexOf(`function ${MINE_RANK_NS}:award_blocks`);
    expect(read).toBeGreaterThan(-1);
    expect(award).toBeGreaterThan(read);
    // and the mine restore is the LAST step of the award
    const awardSource = functionSource.get("award_blocks") ?? "";
    const restore = awardSource.indexOf(`function ${MINE_RANK_NS}:restore_my_mine`);
    expect(restore).toBeGreaterThan(-1);
  });
});

describe("the MineCoin economy closes", () => {
  it("prices the pickaxe and the whole enchantment ladder inside the cap", () => {
    // the cap is what keeps the coin from flooding; the ladder must never
    // cost more than the cap allows a player to hold
    const ladder = MINE_RANK_COMMANDS.filter((command) => command.id.startsWith("encantar_"));
    expect(ladder.length).toBeGreaterThan(0);
    expect(MINE_RANK_MNC_PICKAXE_PRICE).toBeGreaterThan(0);
    expect(MINE_RANK_MINE_RESET_COST).toBeGreaterThan(0);
  });

  it("converts coins into MineCoin and back, with the loss the docs promise", () => {
    // 1000 coins buy 1 MNC and 1 MNC sells for 500: the spread is the sink
    // that keeps the coin scarce, and it must be public
    expect(everything).toContain(
      `scoreboard players remove @s mr_coins ${1000}`,
    );
  });
});
describe("the manual book and the menus are clickable and honest", () => {
  it("gives a written book whose pages are valid JSON", () => {
    const pickaxe = functionSource.get("cmd_pickaxe") ?? "";
    // the book is one item in the give command
    const match = pickaxe.match(/give @s (minecraft:written_book\{.*?\}) 1/);
    expect(match, "cmd_pickaxe must hand over the manual book").toBeTruthy();
    const payload = match![1];
    // every page is a JSON string — a broken page would render as a blank book
    const pages = [...payload.matchAll(/'(\{.*?\})'/g)].map((entry) => entry[1]);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) {
      const parsed = JSON.parse(page) as { extra?: unknown[] };
      expect(parsed.extra, "a page must carry at least one line").toBeTruthy();
    }
  });

  it("escapes the backslashes the command parser would eat", () => {
    // A page lives inside a quoted string in the command, and the parser
    // treats a backslash as an escape: the JSON's own `\n` would arrive as
    // an INVALID escape sequence and the whole function would fail to load
    // (measured live — the pickaxe stopped arriving too).
    const book = manualBook();
    const pages = [...book.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) {
      // uma barra simples só pode aparecer como parte de `\\` (escape duplo)
      const singles = page.match(/(?<!\\)\\(?!\\)/g);
      expect(singles, `a lone backslash would break the parser: ${page.slice(0, 60)}`).toBeNull();
      // e o JSON da página continua válido depois de desfazer o escape duplo
      expect(() => JSON.parse(page.replace(/\\\\/g, "\\"))).not.toThrow();
    }
    // and no raw newline may reach the command file either
    expect(book).not.toContain("\n".replace("\n", String.fromCharCode(10)));
  });

  it("clicks only triggers that really exist", () => {
    const pickaxe = functionSource.get("cmd_pickaxe") ?? "";
    const triggers = [...pickaxe.matchAll(/\/trigger (mr_t_\w+) set (\d+)/g)].map((m) => m[1]);
    expect(triggers.length).toBeGreaterThanOrEqual(10);
    const declared = new Set(MINE_RANK_COMMANDS.map((command) => command.trigger));
    for (const trigger of triggers) {
      expect(
        declared.has(trigger),
        `the manual book runs ${trigger}, which is not in the manifest`,
      ).toBe(true);
    }
  });

  it("opens every area of the world from the mine menu", () => {
    const menu = functionSource.get("menu_mine") ?? "";
    for (const [label, trigger] of [
      ["a private mine", "mr_t_mine"],
      ["the restore", "mr_t_mine"],
      ["the Terra mine", "mr_t_terra_mine"],
      ["the Areia mine", "mr_t_areia_mine"],
      ["the hub", "mr_t_spawn"],
    ] as const) {
      expect(menu, `the mine menu must open ${label}`).toContain(trigger);
    }
  });

  it("shows the player's own numbers in the book (score components)", () => {
    const pickaxe = functionSource.get("cmd_pickaxe") ?? "";
    const book = manualBook();
    // the book reads the player's real state — a static book would lie the
    // moment the player mines one block
    expect(pickaxe).toContain('"objective":"mr_enc_eff"');
    expect(pickaxe).toContain('"objective":"mr_mnc"');
    expect(pickaxe).toContain('"objective":"mr_level"');
    // and the page text carries the REAL mine numbers, derived
    expect(pickaxe).toContain(`${MINE_RANK_ORE_LAYERS.length} camadas`);
    expect(book, "the book names the REAL reset threshold").toContain(
      `${MINE_RANK_MINE_RESET_BLOCKS} blocos`,
    );
    // and the book itself is the same payload the command gives
    expect(pickaxe).toContain(manualBook().slice(0, 60));
  });
});

describe("the Chain — the market the admin controls", () => {
  it("declares the Chain objectives and starts the price where the owner agreed", () => {
    const load = functionSource.get("load") ?? "";
    for (const objective of ["mr_chain", "mr_supply", "mr_issue", "mr_total"]) {
      expect(load, `${objective} must be declared`).toContain(
        `scoreboard objectives add ${objective} dummy`,
      );
    }
    // the price starts at R$1000, in centavos, and never at zero
    expect(load).toContain(
      `scoreboard players set #chain mr_chain ${MINE_RANK_CHAIN_INITIAL_PRICE}`,
    );
    // and the board is a real boss bar, created at setup
    expect(load).toContain("bossbar add nexus_rank:chain");
    // the supply and the price SURVIVE a reload: only a fresh machine starts
    // them. A reload that wiped the supply would erase the emission history
    // the boss bar shows, and the owner would lose his market on a restart.
    expect(load).toContain(
      "execute unless score #chain mr_supply matches 0.. run scoreboard players set #chain mr_supply 0",
    );
    expect(load).toContain("bossbar set nexus_rank:chain players @a");
  });

  it("clamps the price between the floor and the ceiling the owner agreed", () => {
    // R$1000–2700: the admin can move the market, not print his way past it
    expect(MINE_RANK_CHAIN_MIN_PRICE).toBeLessThanOrEqual(MINE_RANK_CHAIN_INITIAL_PRICE);
    expect(MINE_RANK_CHAIN_MAX_PRICE).toBeGreaterThan(MINE_RANK_CHAIN_INITIAL_PRICE);
    expect(MINE_RANK_CHAIN_MAX_PRICE).toBe(
      MINE_RANK_CHAIN_MIN_PRICE + 170_000,
    );
    const up = functionSource.get("cmd_chain_up") ?? "";
    expect(up).toContain(
      `if score #chain mr_chain matches ${MINE_RANK_CHAIN_MAX_PRICE + 1}.. run scoreboard players set #chain mr_chain ${MINE_RANK_CHAIN_MAX_PRICE}`,
    );
    const down = functionSource.get("cmd_chain_down") ?? "";
    expect(down).toContain(
      `if score #chain mr_chain matches ..${MINE_RANK_CHAIN_MIN_PRICE - 1} run scoreboard players set #chain mr_chain ${MINE_RANK_CHAIN_MIN_PRICE}`,
    );
  });

  it("closes the market to everyone but a tagged admin", () => {
    // every command that moves the price or emits coins refuses a non-admin
    // WITH A MESSAGE — a silent refusal is how a player concludes the server
    // is broken
    for (const command of ["cmd_chain_up", "cmd_chain_down", "cmd_chain_issue", "chain_team_menu"]) {
      const source = functionSource.get(command) ?? "";
      expect(
        source,
        `${command} must answer a non-admin`,
      ).toContain("execute unless entity @s[tag=mr_admin] run");
    }
  });

  it("issues in DIRECT PROPORTION to what each player mined", () => {
    const issue = functionSource.get("cmd_chain_issue") ?? "";
    // the total mined since the last restore
    expect(issue).toContain(
      "scoreboard players set #chain mr_total 0",
    );
    expect(issue).toContain(
      "execute as @a run scoreboard players operation #chain mr_total += @s mr_mine_used",
    );
    // and each player takes issue × mine_used / total — never evenly
    expect(issue).toContain(
      "execute if entity @s[tag=mr_admin] if score #chain mr_total matches 1.. as @a run scoreboard players operation @s mr_tmp = #chain mr_issue",
    );
    expect(issue).toContain(
      "execute if entity @s[tag=mr_admin] if score #chain mr_total matches 1.. as @a run scoreboard players operation @s mr_tmp *= @s mr_mine_used",
    );
    expect(issue).toContain(
      "execute if entity @s[tag=mr_admin] if score #chain mr_total matches 1.. as @a run scoreboard players operation @s mr_tmp /= #chain mr_total",
    );
    // nobody mined → the emission does not happen (an even split with an
    // empty board would hand coins to a player who never dug)
    expect(issue).toContain(
      "if score #chain mr_total matches 0 run",
    );
  });

  it("promotes and demotes the NEAREST player, never a hand-typed name", () => {
    // vanilla cannot target a player by name inside a datapack, so the tag
    // is applied to the nearest OTHER player while the requester is mr_req
    for (const command of ["chain_admin_add", "chain_admin_del", "chain_tester_add", "chain_tester_del"]) {
      const source = functionSource.get(command) ?? "";
      expect(source, `${command} must tag the requester`).toContain(
        "tag @s add mr_req",
      );
      expect(source, `${command} must act on the nearest player`).toContain(
        "tag @a[limit=1,sort=nearest,tag=!mr_req]",
      );
      expect(source, `${command} must release the requester`).toContain(
        "tag @s remove mr_req",
      );
    }
  });

  it("keeps the board in front of the player at spawn", () => {
    const tick = functionSource.get("tick") ?? "";
    const board = functionSource.get("chain_board") ?? "";
    // the boss bar carries the price, the supply and the online count,
    // re-drawn once a SECOND (a component parse per tick per player is a
    // tick the owner can feel)
    expect(board).toContain("bossbar set nexus_rank:chain name");
    expect(tick).toContain(
      "execute if score #chain mr_tick matches 1 run function nexus_rank:chain_board",
    );
    expect(tick).toContain("scoreboard players add #chain mr_tick 1");
    // o nome do placar é um componente de chat: um JSON inválido faria a
    // função INTEIRA falhar ao carregar e o placar ficaria mudo (foi assim
    // que um typo de aspa passou no teste de conteúdo e foi pego só no
    // servidor real)
    const nameLine = board
      .split("\n")
      .find((line) => line.startsWith("bossbar set nexus_rank:chain name"));
    expect(nameLine, "the board must set its name").toBeTruthy();
    const json = nameLine!.replace("bossbar set nexus_rank:chain name ", "");
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as { extra?: Array<Record<string, unknown>> };
    // e cada parte tem cor — um componente sem cor cai no branco padrão
    for (const part of parsed.extra ?? []) {
      expect(part.color, `a board part without a colour: ${JSON.stringify(part)}`).toBeTruthy();
    }
    expect(board).toContain('"objective":"mr_chain","name":"#chain"');
    expect(board).toContain('"objective":"mr_supply","name":"#chain"');
    // and the action bar repeats it near the hub
    expect(board).toContain("execute as @a[x=0,y=100,z=0,distance=..40] run title @s actionbar");
    // the admin tag is re-applied every tick, so a late join is an admin
    expect(tick).toContain("tag @a[name=Verifier] add mr_admin");
  });
});
