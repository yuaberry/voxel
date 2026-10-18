/**
 * AI Server Studio — the owner's ask: the user only says WHAT they want and
 * the AI designs the rest: structures (with real procedural generation),
 * custom commands, world rules — with a PREVIEW of everything before a
 * single block is placed.
 *
 * The pipeline is honest by design: the AI produces a PLAN (parameters),
 * the app's own generators turn it into REAL artifacts (.nbt structures
 * via the Rust generator, commands via the datapack generator, properties
 * via the file writer). The model used is whatever the user configured in
 * Settings → AI — pick the best on the market there.
 */
import { streamChat } from "@/services/ai/streaming";
import { useSettingsStore } from "@/stores/settingsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { generateStructure, type StructureGenResult } from "@/services/assets/structureService";
import { generateCustomCommandsDatapack, type CustomCommand } from "./customCommands";
import { readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import type { ServerRecord } from "@/types";

export const STRUCTURE_KINDS = ["watchtower", "cottage", "obelisk", "ruin", "mine", "prison"] as const;
export type PlanStructureKind = (typeof STRUCTURE_KINDS)[number];

export interface PlanStructure {
  id: string;
  kind: PlanStructureKind;
  seed?: number;
  purpose?: string;
}

export interface ServerPlan {
  summary: string;
  structures: PlanStructure[];
  commands: CustomCommand[];
  properties: Record<string, string>;
}

const KIND_HINTS: Record<PlanStructureKind, string> = {
  watchtower: "7x7 stone-brick watchtower, 9-11 tall, arrow slits and battlements",
  cottage: "cozy timber cottage with porch and lantern",
  obelisk: "tall stone obelisk with a glowing top",
  ruin: "weathered broken structure with rubble",
  mine: "PRISON MINE — 25x9 mining gallery with timber supports, rails, torches and a real ORE VEIN (ore type rotates with the seed: coal/iron/redstone/lapis/gold/diamond/emerald)",
  prison: "PRISON BLOCK — 21x21 walled yard, iron-bar gates, 4 corner towers with battlements, 4 cells with bunks, central watch platform",
};

function buildSystemPrompt(server: ServerRecord): string {
  const kindList = STRUCTURE_KINDS.map(
    (k) => `- "${k}": ${KIND_HINTS[k]}`,
  ).join("\n");
  return `You are the VOXEL Server Designer. The user describes what they want on their Minecraft ${server.minecraft_version} ${server.software} server ("${server.name}") and you answer with a COMPLETE BUILD PLAN as a single fenced json block — nothing else in your answer.

Available REAL structure generators (procedural, deterministic in the seed — different seeds = different variants):
${kindList}

Custom commands use vanilla /trigger datapacks (no operator rights needed). Each command:
- id: lowercase letters/digits/_ , starts with a letter (this is what players type: /trigger <id>)
- description: short purpose
- actions: an array, each exactly one of:
  {"kind":"message","text":"...","color":"gold|red|green|gray|aqua|yellow"}
  {"kind":"title","text":"...","subtitle":"..."}
  {"kind":"give","item":"minecraft item id without prefix (e.g. diamond)","count":1}
  {"kind":"teleport","x":0,"y":64,"z":0}
  {"kind":"effect","effect":"speed|jump_boost|regeneration|strength|night_vision","seconds":30,"amplitude":1}
  {"kind":"sound","sound":"entity.player.levelup"}
  {"kind":"summon","mob":"zombie|skeleton|spider|...","name":"Custom Name","health":40,"heldItem":"iron_sword","helmet":"diamond_helmet"}

World rules (server.properties) you may set: motd (short), level-seed (numbers/letters), difficulty (easy|normal|hard), generate-structures (true|false), pvp (true|false).

Respond with EXACTLY one fenced json block:
\`\`\`json
{
  "summary": "one or two sentences of what you designed and why",
  "structures": [{"id":"snake_case_name","kind":"mine","seed":1234,"purpose":"the diamond mine for rank C"}],
  "commands": [{"id":"warp_mine","description":"...","actions":[{"kind":"message","text":"..."}]}],
  "properties": {"motd":"..."}
}
\`\`\`
Rules: 1-6 structures (choose kinds that fit the ask — a prison wants mines and the prison block; use DIFFERENT seeds for variety); 0-4 commands; only the properties that make sense. ids are lowercase snake_case. The plan is INSTALLED for real — never promise anything outside this schema.`;
}

export function extractPlan(answer: string): ServerPlan | null {
  const re = /```json\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Partial<ServerPlan>;
      const structures = Array.isArray(raw.structures) ? raw.structures : [];
      const commands = Array.isArray(raw.commands) ? raw.commands : [];
      const validStructures = structures.filter(
        (s): s is PlanStructure =>
          Boolean(s) &&
          typeof s.id === "string" &&
          /^[a-z][a-z0-9_]{1,40}$/.test(s.id) &&
          STRUCTURE_KINDS.includes(s.kind as PlanStructureKind),
      );
      const validCommands = commands.filter(
        (c): c is CustomCommand =>
          Boolean(c) &&
          typeof c.id === "string" &&
          /^[a-z][a-z0-9_]{1,31}$/.test(c.id) &&
          Array.isArray(c.actions) &&
          c.actions.length > 0,
      );
      const properties: Record<string, string> = {};
      if (raw.properties && typeof raw.properties === "object") {
        for (const [k, v] of Object.entries(raw.properties)) {
          // keys land in server.properties too — validate BOTH sides
          const keyOk =
            k.length > 0 &&
            k.length <= 64 &&
            /^[a-z0-9-]+$/.test(k) &&
            k !== "online-mode";
          if (keyOk && typeof v === "string" && v.length <= 256 && !v.includes("\n")) {
            properties[k] = v;
          }
        }
      }
      return {
        summary: typeof raw.summary === "string" ? raw.summary : "",
        structures: validStructures.slice(0, 6),
        commands: validCommands.slice(0, 4),
        properties,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** The user gives the command; the AI designs the whole plan. */
export async function designServerPlan(
  prompt: string,
  server: ServerRecord,
): Promise<{ plan: ServerPlan; raw: string }> {
  const settings = useSettingsStore.getState().settings.ai;
  const apiKey = await secretsGet(AI_API_KEY_ID).catch(() => null);
  let answer = "";
  for await (const event of streamChat(settings, apiKey, [
    { role: "user", content: `${buildSystemPrompt(server)}\n\nTHE ASK:\n${prompt}` },
  ])) {
    if (event.type === "delta") {
      answer += event.text;
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }
  const plan = extractPlan(answer);
  if (!plan) {
    throw new Error(
      "The model did not answer with a valid plan. Try again — or pick a stronger model in Settings → AI (the plan must be a single ```json block).",
    );
  }
  return { plan, raw: answer };
}

/** PREVIEW a planned structure — real generation, nothing written. */
export async function previewPlanStructure(
  structure: PlanStructure,
  basePath: string,
  serverSlug: string,
  mcVersion: string,
): Promise<StructureGenResult> {
  return generateStructure({
    storageBase: basePath,
    projectRel: `servers/${serverSlug}`,
    structureId: structure.id,
    kind: structure.kind,
    seed: structure.seed ?? 1337,
    mcVersion,
    previewOnly: true,
    outputKind: "server_module",
  });
}

/** Apply the approved plan — every artifact lands for real. */
export async function applyServerPlan(
  plan: ServerPlan,
  basePath: string,
  server: ServerRecord,
): Promise<{ placed: string[]; commandsInstalled: number }> {
  const serverRel = `servers/${server.slug}`;
  const placed: string[] = [];

  // 1. structures -> the server's datapack (era-honest, /place-able)
  for (const structure of plan.structures) {
    const result = await generateStructure({
      storageBase: basePath,
      projectRel: serverRel,
      structureId: structure.id,
      kind: structure.kind,
      seed: structure.seed ?? 1337,
      mcVersion: server.minecraft_version,
      previewOnly: false,
      outputKind: "server_module",
    });
    placed.push(
      result.wrotePath
        ? `/place template imports:${structure.id}` // the generator writes into the server module datapack
        : `/place template ${structure.id}`,
    );
  }

  // 2. commands -> the custom commands datapack (mixed with existing ones)
  if (plan.commands.length > 0) {
    const hasEconomy = await readProjectFile(
      basePath,
      `${serverRel}/world/datapacks/nexus_economy/pack.mcmeta`,
    )
      .then(() => true)
      .catch(() => false);
    const files = generateCustomCommandsDatapack(plan.commands, { hasEconomy });
    for (const file of files) {
      await writeProjectFile(basePath, `${serverRel}/${file.path}`, file.content);
    }
  }

  // 3. world rules -> server.properties (only the keys the plan carries)
  const propertyKeys = Object.keys(plan.properties);
  if (propertyKeys.length > 0) {
    const content = await readProjectFile(basePath, `${serverRel}/server.properties`);
    const edited = new Map(Object.entries(plan.properties));
    const lines = content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((line) => {
        const key = line.split("=")[0];
        return edited.has(key) ? `${key}=${edited.get(key)}` : line;
      });
    for (const [key, value] of edited) {
      if (!lines.some((l) => l.startsWith(`${key}=`))) {
        lines.push(`${key}=${value}`);
      }
    }
    await writeProjectFile(basePath, `${serverRel}/server.properties`, `${lines.join("\n")}\n`);
  }

  return { placed, commandsInstalled: plan.commands.length };
}
