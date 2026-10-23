/**
 * VOXEL Visual Logic Studio (Super Prompt §3, Fase B) — the node graph with
 * REAL semantics: every node kind maps to proven vanilla-datapack patterns
 * (the same ones our modules ship): /trigger scoreboards, minecraft.mined
 * statistics, predicates for chance, scoreboard math. The compiler turns a
 * graph into actual mcfunction files; the validator refuses nonsense
 * BEFORE anything is written. No mock semantics, ever.
 */

export const LOGIC_NS = "nexus_logic";

// ---------------------------------------------------------------------------
// Domain — node kinds and their parameter schemas
// ---------------------------------------------------------------------------

export type LogicNodeKind =
  // events (roots)
  | "event_command" // /trigger <id> — any player, no operator rights
  | "event_mine" // a block-mine statistic (real criterion)
  | "event_interval" // every N seconds
  // conditions
  | "cond_score_min" // @s objective >= min
  | "cond_has_tag"
  | "cond_chance" // vanilla predicate random_chance
  | "cond_not_tag"
  // actions
  | "act_message" // tellraw to the player
  | "act_title"
  | "act_give"
  | "act_add_score" // scoreboard players add
  | "act_set_score"
  | "act_add_tag"
  | "act_remove_tag"
  | "act_teleport"
  | "act_effect"
  | "act_sound"
  | "act_summon"
  | "act_command"; // a vanilla command (validated allowlist)

export interface LogicNode {
  id: string;
  kind: LogicNodeKind;
  label?: string;
  params: Record<string, string | number>;
  x?: number;
  y?: number;
}

export interface LogicEdge {
  from: string; // source node id
  to: string; // target node id
}

export interface LogicGraph {
  name: string; // lowercase slug — the pack name
  description?: string;
  nodes: LogicNode[];
  edges: LogicEdge[];
}

export interface CompiledFile {
  path: string; // world/datapacks/<...>/<rest>
  content: string;
}

export interface LogicError {
  nodeId: string;
  message: string;
}

const KIND_INFO: Record<
  LogicNodeKind,
  { role: "event" | "condition" | "action"; label: string; required: string[] }
> = {
  event_command: { role: "event", label: "On /trigger", required: ["trigger"] },
  event_mine: { role: "event", label: "On block mined", required: ["block", "variable"] },
  event_interval: { role: "event", label: "Every N seconds", required: ["seconds", "timer"] },
  cond_score_min: { role: "condition", label: "Score at least", required: ["variable", "min"] },
  cond_has_tag: { role: "condition", label: "Has tag", required: ["tag"] },
  cond_not_tag: { role: "condition", label: "Does NOT have tag", required: ["tag"] },
  cond_chance: { role: "condition", label: "Chance %", required: ["percent"] },
  act_message: { role: "action", label: "Send message", required: ["text", "color"] },
  act_title: { role: "action", label: "Show title", required: ["text"] },
  act_give: { role: "action", label: "Give item", required: ["item"] },
  act_add_score: { role: "action", label: "Add to score", required: ["variable", "amount"] },
  act_set_score: { role: "action", label: "Set score", required: ["variable", "value"] },
  act_add_tag: { role: "action", label: "Add tag", required: ["tag"] },
  act_remove_tag: { role: "action", label: "Remove tag", required: ["tag"] },
  act_teleport: { role: "action", label: "Teleport", required: ["x", "y", "z"] },
  act_effect: { role: "action", label: "Apply effect", required: ["effect", "seconds"] },
  act_sound: { role: "action", label: "Play sound", required: ["sound"] },
  act_summon: { role: "action", label: "Summon entity", required: ["entity"] },
  act_command: { role: "action", label: "Run command", required: ["command"] },
};

export function kindRole(kind: LogicNodeKind): "event" | "condition" | "action" {
  return KIND_INFO[kind].role;
}

export function kindLabel(kind: LogicNodeKind): string {
  return KIND_INFO[kind].label;
}

export function requiredParams(kind: LogicNodeKind): string[] {
  return KIND_INFO[kind].required;
}

export const ALL_KINDS = Object.keys(KIND_INFO) as LogicNodeKind[];

// identifiers the datapack accepts (vanilla-safe, ours enforced)
const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const VAR_RE = /^[a-z][a-z0-9_]{1,40}$/;

/** Vanilla commands we allow in act_command — the safe, world-side set. */
const COMMAND_ALLOWLIST =
  /^(?:give|tp|effect|playsound|title|tellraw|summon|particle|fill|setblock|time|weather|say|stop|kill|xp|experience|clear|advancement|spreadplayers|worldborder|gamemode|defaultgamemode|difficulty|clone|structure|place|damage|spawnpoint|setworldspawn)\b/;

// ---------------------------------------------------------------------------
// Validation — refuse nonsense before anything is generated
// ---------------------------------------------------------------------------

export function validateGraph(graph: LogicGraph): LogicError[] {
  const errors: LogicError[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  if (!ID_RE.test(graph.name)) {
    errors.push({ nodeId: "", message: `Graph name "${graph.name}" is not a valid id (lowercase letters/digits/_)` });
  }

  const events = graph.nodes.filter((n) => kindRole(n.kind) === "event");
  if (events.length === 0) {
    errors.push({ nodeId: "", message: "The graph needs at least one event node (On /trigger, On block mined, Every N seconds)" });
  }

  for (const node of graph.nodes) {
    const info = KIND_INFO[node.kind];
    for (const key of info.required) {
      const value = node.params[key];
      if (value === undefined || value === null || String(value).trim() === "") {
        errors.push({ nodeId: node.id, message: `${info.label}: "${key}" is required` });
      }
    }
    if (node.kind === "event_command" && !ID_RE.test(String(node.params.trigger ?? ""))) {
      errors.push({ nodeId: node.id, message: "On /trigger: the trigger id must be lowercase letters/digits/_" });
    }
    if (node.kind === "event_mine" && !VAR_RE.test(String(node.params.variable ?? ""))) {
      errors.push({ nodeId: node.id, message: "On block mined: the score variable must be a valid scoreboard id" });
    }
    if (node.kind === "event_interval") {
      const seconds = Number(node.params.seconds);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
        errors.push({ nodeId: node.id, message: "Every N seconds: 1 to 600 seconds" });
      }
    }
    if (node.kind === "cond_score_min" && !VAR_RE.test(String(node.params.variable ?? ""))) {
      errors.push({ nodeId: node.id, message: "Score at least: unknown score variable" });
    }
    if (node.kind === "cond_chance") {
      const percent = Number(node.params.percent);
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        errors.push({ nodeId: node.id, message: "Chance %: must be between 1 and 99" });
      }
    }
    if (node.kind === "act_add_score" || node.kind === "act_set_score") {
      if (!VAR_RE.test(String(node.params.variable ?? ""))) {
        errors.push({ nodeId: node.id, message: `${info.label}: unknown score variable` });
      }
    }
    if (node.kind === "act_give" && !/^[a-z0-9_]+$/.test(String(node.params.item ?? ""))) {
      errors.push({ nodeId: node.id, message: "Give item: use the plain item id (e.g. diamond)" });
    }
    if (node.kind === "act_command" && !COMMAND_ALLOWLIST.test(String(node.params.command ?? "").trim())) {
      errors.push({ nodeId: node.id, message: "Run command: only safe world-side commands are allowed (give, tp, effect, title, summon…)" });
    }
    if (node.kind === "act_teleport") {
      for (const axis of ["x", "y", "z"]) {
        if (!/^[-\d.]+$/.test(String(node.params[axis] ?? ""))) {
          errors.push({ nodeId: node.id, message: "Teleport: coordinates must be numbers" });
        }
      }
    }
  }

  // edges: must reference real nodes; events cannot be targets
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      errors.push({ nodeId: edge.from, message: `Edge references a node that does not exist (${edge.from} → ${edge.to})` });
      continue;
    }
    if (kindRole(to.kind) === "event") {
      errors.push({ nodeId: to.id, message: "Events cannot be the target of a connection — they only start flows" });
    }
  }

  // every event must reach at least one action (an event wired to nothing is a lie)
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  for (const event of events) {
    const reachable = walk(children, event.id);
    const hitsAction = [...reachable].some((id) => byId.get(id) && kindRole(byId.get(id)!.kind) === "action");
    if (!hitsAction) {
      errors.push({ nodeId: event.id, message: "This event has no action in its flow — connect it to at least one action" });
    }
  }

  return errors;
}

function walk(children: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(children.get(start) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Compilation — the graph becomes REAL mcfunction files
// ---------------------------------------------------------------------------

function jsonTellraw(text: string, color: string): string {
  const safe = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `tellraw @s [{"text":"${safe}","color":"${color}"}]`;
}

function nbtName(text: string): string {
  return text.replace(/"/g, "").replace(/'/g, "");
}

function conditionPrefix(node: LogicNode, graphName: string): string {
  switch (node.kind) {
    case "cond_score_min":
      return `execute if score @s ${node.params.variable} matches ${Number(node.params.min)}..`;
    case "cond_has_tag":
      return `execute if entity @s[tag=${node.params.tag}]`;
    case "cond_not_tag":
      return `execute unless entity @s[tag=${node.params.tag}]`;
    case "cond_chance":
      // the chance VALUE lives in the predicate file the compiler emits
      return `execute if predicate ${LOGIC_NS}_${graphName}:chance_${node.id}`;
    default:
      return "execute";
  }
}

function actionLine(node: LogicNode): string {
  switch (node.kind) {
    case "act_message":
      return jsonTellraw(String(node.params.text), String(node.params.color || "gray"));
    case "act_title":
      return `title @s title {"text":"${nbtName(String(node.params.text))}","color":"gold"}`;
    case "act_give":
      return `give @s minecraft:${String(node.params.item).replace(/^minecraft:/, "")} ${Number(node.params.count ?? 1) || 1}`;
    case "act_add_score":
      return `scoreboard players add @s ${node.params.variable} ${Number(node.params.amount) || 0}`;
    case "act_set_score":
      return `scoreboard players set @s ${node.params.variable} ${Number(node.params.value) || 0}`;
    case "act_add_tag":
      return `tag @s add ${node.params.tag}`;
    case "act_remove_tag":
      return `tag @s remove ${node.params.tag}`;
    case "act_teleport":
      return `tp @s ${node.params.x} ${node.params.y} ${node.params.z}`;
    case "act_effect":
      return `effect give @s minecraft:${node.params.effect} ${Number(node.params.seconds)} ${Number(node.params.amplifier ?? 0)} true`;
    case "act_sound":
      return `playsound minecraft:${node.params.sound} master @s ~ ~ ~ ${Number(node.params.volume ?? 1)}`;
    case "act_summon":
      return `summon minecraft:${node.params.entity} ~ ~ ~ {CustomName:'[{"text":"${nbtName(String(node.params.name ?? ""))}"}]',CustomNameVisible:1b}`;
    case "act_command":
      return String(node.params.command).trim();
    default:
      return "";
  }
}

/**
 * Compiles the graph into a REAL vanilla datapack (1.20.1 era, like every
 * module): load registers objectives/triggers, tick routes events, each
 * event compiles its flow with nested `execute` chains — a condition with
 * children becomes its own function called by the parent prefix (the
 * proven Token Chain nesting pattern).
 */
export function compileLogicGraph(graph: LogicGraph): {
  files: CompiledFile[];
  errors: LogicError[];
} {
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    return { files: [], errors };
  }

  const ns = `${LOGIC_NS}_${graph.name}`;
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const predicates: { id: string; chance: number }[] = [];
  const flows: { fn: string; body: string }[] = [];
  const emitted = new Set<string>();

  const registerChance = (node: LogicNode) => {
    predicates.push({
      id: `chance_${node.id}`,
      chance: Math.min(0.99, Math.max(0.01, Number(node.params.percent) / 100)),
    });
  };

  /** A condition with children compiles to its own function. */
  const emitChain = (node: LogicNode): string => {
    const fn = `chain_${node.id}`;
    if (emitted.has(fn)) return fn;
    emitted.add(fn);
    const lines: string[] = [
      `# ${kindLabel(node.kind)} — ${String(node.params.variable ?? node.params.tag ?? "")}`,
    ];
    for (const childId of children.get(node.id) ?? []) {
      const child = byId.get(childId)!;
      if (kindRole(child.kind) === "condition") {
        if (child.kind === "cond_chance") registerChance(child);
        const prefix = conditionPrefix(child, graph.name);
        const grand = (children.get(child.id)?.length ?? 0) > 0;
        if (grand) {
          lines.push(`${prefix} run function ${ns}:${emitChain(child)}`);
        } else {
          lines.push(`${prefix} run ${actionLine(child)}`);
        }
      } else {
        lines.push(actionLine(child));
      }
    }
    flows.push({ fn, body: `${lines.join("\n")}\n` });
    return fn;
  };

  const files: CompiledFile[] = [];
  files.push({
    path: `world/datapacks/${ns}/pack.mcmeta`,
    content: JSON.stringify(
      { pack: { pack_format: 15, description: `Visual Logic: ${graph.description ?? graph.name}` } },
      null,
      2,
    ),
  });
  files.push({
    path: `world/datapacks/${ns}/data/minecraft/tags/functions/load.json`,
    content: JSON.stringify({ values: [`${ns}:load`] }, null, 2),
  });
  files.push({
    path: `world/datapacks/${ns}/data/minecraft/tags/functions/tick.json`,
    content: JSON.stringify({ values: [`${ns}:tick`] }, null, 2),
  });

  const loadLines: string[] = [`# Visual Logic graph: ${graph.name}`];
  const tickLines: string[] = [`# routes for ${graph.name}`];

  for (const event of graph.nodes.filter((n) => kindRole(n.kind) === "event")) {
    const evtFn = `evt_${event.id}`;
    const lines: string[] = [`# event: ${kindLabel(event.kind)}`];

    if (event.kind === "event_command") {
      const trigger = String(event.params.trigger);
      loadLines.push(
        `scoreboard objectives add ${trigger} trigger "${(graph.description ?? trigger).slice(0, 30)}"`,
      );
      tickLines.push(`scoreboard players enable @a ${trigger}`);
      tickLines.push(`execute as @a[scores={${trigger}=1..}] run function ${ns}:${evtFn}`);
      lines.push(`scoreboard players set @s ${trigger} 0`);
    }
    if (event.kind === "event_mine") {
      const variable = String(event.params.variable);
      const block = String(event.params.block);
      loadLines.push(
        `scoreboard objectives add ${variable} minecraft.mined:minecraft.${block} "Mined ${block}"`,
      );
      tickLines.push(`execute as @a[scores={${variable}=1..}] run function ${ns}:${evtFn}`);
      lines.push(`scoreboard players set @s ${variable} 0`);
    }
    if (event.kind === "event_interval") {
      const timer = String(event.params.timer);
      const seconds = Math.max(1, Math.round(Number(event.params.seconds)));
      loadLines.push(`scoreboard objectives add ${timer} dummy "Timer"`);
      tickLines.push(`scoreboard players add @a ${timer} 1`);
      tickLines.push(
        `execute as @a[scores={${timer}=${seconds * 20}..}] run function ${ns}:${evtFn}`,
      );
      lines.push(`scoreboard players set @s ${timer} 0`);
    }

    for (const childId of children.get(event.id) ?? []) {
      const child = byId.get(childId)!;
      if (kindRole(child.kind) === "condition") {
        if (child.kind === "cond_chance") registerChance(child);
        const prefix = conditionPrefix(child, graph.name);
        const grand = (children.get(child.id)?.length ?? 0) > 0;
        if (grand) {
          lines.push(`${prefix} run function ${ns}:${emitChain(child)}`);
        } else {
          lines.push(`${prefix} run ${actionLine(child)}`);
        }
      } else {
        lines.push(actionLine(child));
      }
    }
    flows.push({ fn: evtFn, body: `${lines.join("\n")}\n` });
  }

  for (const predicate of predicates) {
    files.push({
      path: `world/datapacks/${ns}/data/${ns}/predicates/${predicate.id}.json`,
      content: JSON.stringify(
        { condition: "minecraft:random_chance", chance: predicate.chance },
        null,
        2,
      ),
    });
  }

  files.push({
    path: `world/datapacks/${ns}/data/${ns}/functions/load.mcfunction`,
    content: `${loadLines.join("\n")}\n`,
  });
  files.push({
    path: `world/datapacks/${ns}/data/${ns}/functions/tick.mcfunction`,
    content: `${tickLines.join("\n")}\n`,
  });
  for (const flow of flows) {
    files.push({
      path: `world/datapacks/${ns}/data/${ns}/functions/${flow.fn}.mcfunction`,
      content: flow.body,
    });
  }

  return { files, errors };
}
