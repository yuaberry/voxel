/**
 * VOXEL Style Memory (Super Prompt §7, Fase B) — the project's bibles and
 * decisions, editable in one panel, with the AI contradiction check: the
 * memories are sent to the configured model and every reported conflict
 * must quote the passages — invented findings are dropped by the parser.
 */
import { readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import { streamChat } from "@/services/ai/streaming";
import { useSettingsStore } from "@/stores/settingsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";

export interface MemoryFile {
  id: string;
  title: string;
  rel: string;
  content: string | null;
}

export const MEMORY_FILES: Omit<MemoryFile, "content">[] = [
  { id: "style", title: "Style Bible", rel: ".voxel/style-bible.md" },
  { id: "lore", title: "Lore Bible", rel: ".voxel/lore-bible.md" },
  { id: "gameplay", title: "Gameplay Bible", rel: ".voxel/gameplay-bible.md" },
  { id: "decisions", title: "Architecture Decisions", rel: ".voxel/decisions.md" },
  { id: "architecture", title: "Architecture Map", rel: ".voxel/architecture.md" },
];

export async function listMemory(basePath: string, projectSlug: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  for (const meta of MEMORY_FILES) {
    let content: string | null = null;
    try {
      content = await readProjectFile(basePath, `projects/${projectSlug}/${meta.rel}`);
    } catch {
      content = null; // not written yet — an honest empty, never invented
    }
    out.push({ ...meta, content });
  }
  // legacy .nexus fallback (the era before the rebrand kept memories too)
  if (out.every((f) => f.content === null)) {
    for (const file of out) {
      try {
        file.content = await readProjectFile(
          basePath,
          `projects/${projectSlug}/${file.rel.replace(".voxel/", ".nexus/")}`,
        );
      } catch {
        // stays null
      }
    }
  }
  return out;
}

export async function saveMemory(
  basePath: string,
  projectSlug: string,
  rel: string,
  content: string,
): Promise<void> {
  await writeProjectFile(basePath, `projects/${projectSlug}/${rel}`, content);
}

export interface MemoryContradiction {
  between: string;
  quote: string;
  why: string;
}

/** Parses the model's answer — only quoted contradictions survive. */
export function parseContradictions(answer: string): MemoryContradiction[] {
  const re = /```json\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as { contradictions?: unknown };
      if (!Array.isArray(raw.contradictions)) continue;
      const valid: MemoryContradiction[] = [];
      for (const item of raw.contradictions) {
        if (!item || typeof item !== "object") continue;
        const between = String((item as Record<string, unknown>).between ?? "").trim();
        const quote = String((item as Record<string, unknown>).quote ?? "").trim();
        const why = String((item as Record<string, unknown>).why ?? "").trim();
        if (between && quote && why) {
          valid.push({ between, quote, why });
        }
      }
      return valid.slice(0, 10);
    } catch {
      continue;
    }
  }
  return [];
}

/** The AI reads the memories and reports conflicts — quoting the passages. */
export async function checkContradictions(
  memories: MemoryFile[],
): Promise<MemoryContradiction[]> {
  const settings = useSettingsStore.getState().settings.ai;
  const apiKey = await secretsGet(AI_API_KEY_ID).catch(() => null);
  const body = memories
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => `### ${m.title}\n${m.content!.slice(0, 4000)}`)
    .join("\n\n");
  if (!body.trim()) {
    return [];
  }
  let answer = "";
  for await (const event of streamChat(settings, apiKey, [
    {
      role: "user",
      content: `You audit a Minecraft mod project's memory files for CONTRADICTIONS. Read every bible below and report real conflicts between them (a rule in one place that fights a rule in another, tone clashes, gameplay promises that conflict).

Answer with ONE fenced json block:
\`\`\`json
{"contradictions":[{"between":"which files/rules conflict","quote":"the exact passage(s) that conflict","why":"why they cannot both be true"}]}
\`\`\`
Only report REAL conflicts — if there are none, answer {"contradictions":[]}.

${body}`,
    },
  ])) {
    if (event.type === "delta") answer += event.text;
    if (event.type === "error") throw new Error(event.message);
  }
  return parseContradictions(answer);
}
