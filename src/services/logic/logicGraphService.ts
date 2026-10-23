/**
 * Visual Logic service — persistence and installation. Graphs live as
 * JSON in the workspace (`logic/<name>.json`); installing writes the
 * compiled datapack into a real server folder (the same writeProjectFile
 * path every module uses).
 */
import { invoke } from "@tauri-apps/api/core";
import {
  compileLogicGraph,
  validateGraph,
  type LogicGraph,
} from "./logicGraph";
import { writeProjectFile, readProjectFile } from "@/services/projects/projectsService";
import { streamChat } from "@/services/ai/streaming";
import { useSettingsStore } from "@/stores/settingsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { ALL_KINDS, requiredParams } from "./logicGraph";

export async function saveLogicGraph(basePath: string, graph: LogicGraph): Promise<void> {
  await writeProjectFile(basePath, `logic/${graph.name}.json`, JSON.stringify(graph, null, 2));
}

export async function listLogicGraphs(basePath: string): Promise<string[]> {
  try {
    const entries = await invoke<{ path: string; isDir: boolean }[]>(
      "list_project_files",
      { basePath, projectRel: "logic" },
    );
    return entries
      .filter((e) => !e.isDir && e.path.endsWith(".json"))
      .map((e) => e.path.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export async function loadLogicGraph(basePath: string, name: string): Promise<LogicGraph | null> {
  try {
    const raw = await readProjectFile(basePath, `logic/${name}.json`);
    return JSON.parse(raw) as LogicGraph;
  } catch {
    return null;
  }
}

export interface InstallResult {
  filesWritten: number;
}

/** Compiles, validates and installs the graph into a real server. */
export async function installLogicGraph(
  basePath: string,
  graph: LogicGraph,
  serverSlug: string,
): Promise<InstallResult> {
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }
  const { files } = compileLogicGraph(graph);
  for (const file of files) {
    await writeProjectFile(basePath, `servers/${serverSlug}/${file.path}`, file.content);
  }
  return { filesWritten: files.length };
}

// ---------------------------------------------------------------------------
// The AI designer — the owner's ask: describe it, the AI builds the graph
// ---------------------------------------------------------------------------

function designerPrompt(): string {
  const kindDocs = ALL_KINDS.map((k) => {
    const params = requiredParams(k).join(", ");
    return `- "${k}" (params: ${params})`;
  }).join("\n");
  return `You are the VOXEL Visual Logic designer. The user describes gameplay and you answer with a node graph as ONE fenced json block — nothing else.

Node kinds (the ONLY ones that exist — the app validates strictly):
${kindDocs}

Node semantics (real vanilla datapack):
- "event_command": players run /trigger <trigger> (no operator rights)
- "event_mine": fires when a player mines the given block (real minecraft.mined statistic)
- "event_interval": fires every N seconds
- conditions gate the flow; actions run when their branch's conditions pass

Rules:
- ids: simple lowercase words (event ids like "ev1", node ids unique)
- connect with edges {from, to}; events have no incoming edges; every event reaches at least one action
- act_message color: gold|red|green|gray|aqua|yellow
- cond_chance percent: 1-99
- 2-8 nodes total; keep it focused

Answer format:
\`\`\`json
{"name":"snake_case_name","description":"one line","nodes":[{"id":"ev1","kind":"event_command","params":{"trigger":"the_trigger"}}],"edges":[{"from":"ev1","to":"a1"}]}
\`\`\``;
}

export async function designLogicGraphWithAi(prompt: string): Promise<LogicGraph> {
  const settings = useSettingsStore.getState().settings.ai;
  const apiKey = await secretsGet(AI_API_KEY_ID).catch(() => null);
  let answer = "";
  for await (const event of streamChat(settings, apiKey, [
    { role: "user", content: `${designerPrompt()}\n\nTHE ASK:\n${prompt}` },
  ])) {
    if (event.type === "delta") answer += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  const re = /```json\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Partial<LogicGraph>;
      if (!raw.name || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
        continue;
      }
      const kinds = new Set(ALL_KINDS as readonly string[]);
      const graph: LogicGraph = {
        name: String(raw.name),
        description: typeof raw.description === "string" ? raw.description : undefined,
        nodes: raw.nodes.filter(
          (n): n is LogicGraph["nodes"][number] =>
            Boolean(n) && typeof n.id === "string" && kinds.has(String(n.kind)) &&
            n.params && typeof n.params === "object",
        ),
        edges: raw.edges.filter(
          (e): e is LogicGraph["edges"][number] =>
            Boolean(e) && typeof e.from === "string" && typeof e.to === "string",
        ),
      };
      if (graph.nodes.length === 0) continue;
      // layout: simple auto-column layout by role (events left, actions right)
      const byRole: Record<string, number> = { event: 0, condition: 0, action: 0 };
      for (const node of graph.nodes) {
        const role =
          node.kind.startsWith("event") ? "event" : node.kind.startsWith("cond") ? "condition" : "action";
        node.x = 80 + (role === "event" ? 0 : role === "condition" ? 260 : 520);
        node.y = 80 + byRole[role] * 120;
        byRole[role] += 1;
      }
      return graph;
    } catch {
      continue;
    }
  }
  throw new Error(
    "The model did not answer with a valid graph — try again or describe it in simpler steps.",
  );
}
