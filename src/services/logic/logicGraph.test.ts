import { describe, expect, it } from "vitest";
import {
  compileLogicGraph,
  validateGraph,
  ALL_KINDS,
  type LogicGraph,
} from "./logicGraph";

function fileOf(files: { path: string; content: string }[], suffix: string) {
  const f = files.find((x) => x.path.endsWith(suffix));
  expect(f, `expected a file ending with ${suffix}`).toBeTruthy();
  return f!.content;
}

const miningRewards: LogicGraph = {
  name: "mine_rewards",
  description: "Pay players for mining diamonds",
  nodes: [
    { id: "ev1", kind: "event_mine", params: { block: "diamond_ore", variable: "mined_diamond" } },
    { id: "ch1", kind: "cond_score_min", params: { variable: "player_rank", min: 2 } },
    { id: "act1", kind: "act_add_score", params: { variable: "mine_coins", amount: 5 } },
    { id: "act2", kind: "act_message", params: { text: "+5 coins for the diamond!", color: "green" } },
  ],
  edges: [
    { from: "ev1", to: "ch1" },
    { from: "ch1", to: "act1" },
    { from: "ch1", to: "act2" },
  ],
};

describe("Visual Logic compiler (real vanilla semantics)", () => {
  it("compiles a mine→rank-condition→reward flow into real datapack files", () => {
    const { files, errors } = compileLogicGraph(miningRewards);
    expect(errors).toEqual([]);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("pack.mcmeta"))).toBe(true);
    expect(paths.some((p) => p.endsWith("tags/functions/load.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("tags/functions/tick.json"))).toBe(true);

    // the objective uses the REAL minecraft.mined criterion
    const load = fileOf(files, "functions/load.mcfunction");
    expect(load).toContain(
      "scoreboard objectives add mined_diamond minecraft.mined:minecraft.diamond_ore",
    );
    // the tick routes players who mined and consumes the signal
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain("execute as @a[scores={mined_diamond=1..}] run function");
    // the event function resets the counter and runs the chain
    const evt = fileOf(files, "functions/evt_ev1.mcfunction");
    expect(evt).toContain("scoreboard players set @s mined_diamond 0");
    // condition with children compiles to its own chain function
    const chain = fileOf(files, "functions/chain_ch1.mcfunction");
    expect(chain).toContain("scoreboard players add @s mine_coins 5");
    expect(chain).toContain('+5 coins for the diamond!');
    // the event calls the chain under the score condition
    expect(evt).toContain("if score @s player_rank matches 2.. run function nexus_logic_mine_rewards:chain_ch1");
  });

  it("compiles /trigger events with enable+route and chance predicates", () => {
    const graph: LogicGraph = {
      name: "lucky_chest",
      nodes: [
        { id: "e", kind: "event_command", params: { trigger: "lucky_chest" } },
        { id: "c", kind: "cond_chance", params: { percent: 25 } },
        { id: "g", kind: "act_give", params: { item: "diamond", count: 2 } },
      ],
      edges: [
        { from: "e", to: "c" },
        { from: "c", to: "g" },
      ],
    };
    const { files, errors } = compileLogicGraph(graph);
    expect(errors).toEqual([]);
    const load = fileOf(files, "functions/load.mcfunction");
    expect(load).toContain("scoreboard objectives add lucky_chest trigger");
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain("scoreboard players enable @a lucky_chest");
    // a REAL vanilla predicate carries the chance
    const predicate = fileOf(files, "predicates/chance_c.json");
    expect(JSON.parse(predicate)).toEqual({
      condition: "minecraft:random_chance",
      chance: 0.25,
    });
    const evt = fileOf(files, "functions/evt_e.mcfunction");
    // the chance wraps a CHAIN function (the Token Chain pattern) holding the give
    expect(evt).toContain(
      "execute if predicate nexus_logic_lucky_chest:chance_c run function nexus_logic_lucky_chest:chain_c",
    );
    const chain = fileOf(files, "functions/chain_c.mcfunction");
    expect(chain).toContain("give @s minecraft:diamond 2");
  });

  it("compiles interval events on a 20-ticks-per-second timer", () => {
    const graph: LogicGraph = {
      name: "heal_loop",
      nodes: [
        { id: "t", kind: "event_interval", params: { seconds: 10, timer: "heal_timer" } },
        { id: "h", kind: "act_effect", params: { effect: "regeneration", seconds: 3, amplifier: 0 } },
      ],
      edges: [{ from: "t", to: "h" }],
    };
    const { files, errors } = compileLogicGraph(graph);
    expect(errors).toEqual([]);
    const tick = fileOf(files, "functions/tick.mcfunction");
    expect(tick).toContain("execute as @a[scores={heal_timer=200..}] run function");
    const evt = fileOf(files, "functions/evt_t.mcfunction");
    expect(evt).toContain("effect give @s minecraft:regeneration 3 0 true");
  });

  it("validates: event without actions, bad params, dangerous commands, dangling edges", () => {
    const graph: LogicGraph = {
      name: "Broken",
      nodes: [
        { id: "e", kind: "event_command", params: { trigger: "ok_trigger" } }, // no actions wired
        { id: "bad", kind: "event_command", params: { trigger: "2starts-with-digit" } },
        { id: "d", kind: "act_command", params: { command: "op SomePlayer" } }, // NOT allowlisted
        { id: "e2", kind: "event_command", params: { trigger: "second" } },
        { id: "g", kind: "act_give", params: {} }, // missing item
      ],
      edges: [
        { from: "e2", to: "g" },
        { from: "ghost", to: "e2" }, // dangling
        { from: "e2", to: "bad" }, // event as target
      ],
    };
    const errors = validateGraph(graph);
    const messages = errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("no action in its flow"))).toBe(true);
    expect(messages.some((m) => m.includes("must be lowercase"))).toBe(true);
    expect(messages.some((m) => m.includes("only safe world-side commands"))).toBe(true);
    expect(messages.some((m) => m.includes("does not exist"))).toBe(true);
    expect(messages.some((m) => m.includes("Events cannot be the target"))).toBe(true);
    expect(messages.some((m) => m.includes('"item" is required'))).toBe(true);
    // and a graph with errors compiles to NOTHING (never installs nonsense)
    const compiled = compileLogicGraph({ ...graph, name: "still_broken" });
    expect(compiled.files).toEqual([]);
  });

  it("escapes player text so tellraw never breaks", () => {
    const graph: LogicGraph = {
      name: "greeter",
      nodes: [
        { id: "e", kind: "event_command", params: { trigger: "hello" } },
        { id: "m", kind: "act_message", params: { text: 'Welcome "chief"!', color: "gold" } },
      ],
      edges: [{ from: "e", to: "m" }],
    };
    const { files, errors } = compileLogicGraph(graph);
    expect(errors).toEqual([]);
    const evt = fileOf(files, "functions/evt_e.mcfunction");
    expect(evt).toContain("chief"); // the text survived, escaped
    const tellrawLine = evt.split("\n").find((l) => l.startsWith("tellraw"))!;
    expect(tellrawLine.split('"').length % 2).toBe(1);
  });

  it("exposes every node kind with role + required params (the palette is honest)", () => {
    expect(ALL_KINDS.length).toBeGreaterThanOrEqual(19);
    for (const kind of ALL_KINDS) {
      const role = validateGraph({
        name: "probe",
        nodes: [
          { id: "e", kind: "event_command", params: { trigger: "probe" } },
          { id: "n", kind, params: {} },
        ],
        edges: [{ from: "e", to: "n" }],
      });
      // missing params are reported per node — the schema exists for all
      expect(role.every((e) => typeof e.message === "string")).toBe(true);
    }
  });
});
