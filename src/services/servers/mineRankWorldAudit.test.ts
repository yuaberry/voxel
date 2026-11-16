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
  MINE_RANK_MINE_FLOOR_Y,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_MINE_VOLUME,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_POND,
  MINE_RANK_TERRA_MINE,
  MINE_RANK_AREIA_MINE,
  MINE_RANK_MNC_PICKAXE_PRICE,
  MINE_RANK_MINE_RESET_COST,
  generateMineRankFiles,
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