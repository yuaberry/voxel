import type { ProjectRecord } from "@/types";
import { listProjectFiles, readProjectFile } from "@/services/projects/projectsService";
import { useSettingsStore } from "@/stores/settingsStore";

async function getStorageBase(): Promise<string> {
  const base = useSettingsStore.getState().settings.storage.basePath;
  if (!base) throw new Error("Storage location not configured (Settings → Storage)");
  return base;
}

/**
 * Context Assembly — everything the AI needs to know about the project
 * before a single token is generated (project-spec as source of truth,
 * bibles from the consistency memory, and the file tree shape).
 *
 * Project memory lives in `.voxel/` (8 files). Projects from the
 * previous brand era carry `.nexus/` — every read falls back to it so
 * nothing is lost.
 */

export interface ProjectContext {
  project: ProjectRecord;
  projectSpec: string | null;
  projectSpecParsed: Record<string, unknown> | null;
  styleBible: string | null;
  aiMemory: string | null;
  loreBible: string | null;
  gameplayBible: string | null;
  decisions: string | null;
  fileTreePreview: string;
  referenceCount: number;
  /** user-imported briefing documents (.txt/.md/.pdf/.docx -> .brief.md) */
  briefing: string | null;
}

/** Where the spec file lives for this project (.voxel preferred, .nexus legacy). */
export async function resolveSpecPath(
  basePath: string,
  projectSlug: string,
): Promise<string> {
  const rel = `projects/${projectSlug}`;
  const voxel = `${rel}/.voxel/project-spec.json`;
  const nexus = `${rel}/.nexus/project-spec.json`;
  const [hasVoxel, hasNexus] = await Promise.all([
    readProjectFile(basePath, voxel)
      .then(() => true)
      .catch(() => false),
    readProjectFile(basePath, nexus)
      .then(() => true)
      .catch(() => false),
  ]);
  if (hasVoxel || !hasNexus) return voxel;
  return nexus;
}

async function readFirst(
  basePath: string,
  rel: string,
  file: string,
): Promise<string | null> {
  const voxel = await readProjectFile(basePath, `${rel}/.voxel/${file}`).catch(() => null);
  if (voxel !== null) return voxel;
  return readProjectFile(basePath, `${rel}/.nexus/${file}`).catch(() => null);
}

export async function loadProjectContext(
  project: ProjectRecord,
): Promise<ProjectContext> {
  const basePath = await getStorageBase();
  const rel = `projects/${project.slug}`;

  const [spec, styleBible, aiMemory, loreBible, gameplayBible, decisions, files, briefings] =
    await Promise.all([
      readFirst(basePath, rel, "project-spec.json"),
      readFirst(basePath, rel, "style-bible.md"),
      readFirst(basePath, rel, "ai-memory.md"),
      readFirst(basePath, rel, "lore-bible.md"),
      readFirst(basePath, rel, "gameplay-bible.md"),
      readFirst(basePath, rel, "decisions.md"),
      listProjectFiles(basePath, rel).catch(() => []),
      // the user's OWN documents (txt/md/pdf/docx) live in .voxel/briefing/
      listProjectFiles(basePath, `${rel}/.voxel/briefing`).catch(() => []),
    ]);
  const briefing =
    (await Promise.all(
      briefings
        .filter((f) => !f.is_dir && f.path.endsWith(".brief.md"))
        .slice(0, 8)
        .map((f) =>
          readProjectFile(basePath, `${rel}/.voxel/briefing/${f.path}`).catch(() => null),
        ),
    ))
      .filter((x): x is string => x !== null)
      .join("\n\n---\n\n") || null;

  let projectSpecParsed: Record<string, unknown> | null = null;
  if (spec) {
    try {
      projectSpecParsed = JSON.parse(spec) as Record<string, unknown>;
    } catch {
      projectSpecParsed = null;
    }
  }

  // Compact tree preview (files only, capped)
  const treePreview = files
    .filter((f) => !f.is_dir)
    .slice(0, 60)
    .map((f) => f.path)
    .join("\n");

  const referenceCount = files.filter(
    (f) =>
      !f.is_dir &&
      (f.path.startsWith(".voxel/references/") || f.path.startsWith(".nexus/references/")),
  ).length;

  return {
    project,
    projectSpec: spec,
    projectSpecParsed,
    styleBible,
    aiMemory,
    loreBible,
    gameplayBible,
    decisions,
    briefing,
    fileTreePreview: treePreview,
    referenceCount,
  };
}

export function buildSystemPrompt(context: ProjectContext): string {
  const { project } = context;
  return `You are the VOXEL AI — a senior Minecraft Fabric mod engineer and game designer. You operate on a REAL project on the user's machine (not a mockup).

PROJECT: ${project.name} (slug: ${project.slug})
- Minecraft: ${project.minecraft_version} · Loader: ${project.loader} · License: ${project.license}
- Java package: derive from the project files.

SOURCE OF TRUTH — .voxel/project-spec.json:
${context.projectSpec ?? "(not found — generate one with the user's first request)"}

STYLE BIBLE (aesthetic rules every asset must follow):
${context.styleBible ?? "(not found)"}

LORE BIBLE (naming, world truth, tone):
${context.loreBible ?? "(not found)"}

GAMEPLAY BIBLE (progression and balance rules):
${context.gameplayBible ?? "(not found)"}

AI MEMORY (decisions and constraints so far):
${context.aiMemory ?? "(empty)"}

USER BRIEFING DOCUMENTS (the user's OWN imported files — .txt/.md/.pdf/.docx;
honor them as design intent, they outrank generic conventions):
${context.briefing ?? "(none imported)"}

DECISIONS (ADR log — read before structural changes):
${context.decisions ?? "(empty)"}

PROJECT FILES:
${context.fileTreePreview || "(empty)"}

Additional memory available under .voxel/ (read them when relevant):
architecture.md (codebase map), asset-index.json (asset registry).

RULES:
1. The project-spec.json above is the single source of truth. Keep every suggestion consistent with it. When the user asks for new features, first describe the impact on the spec.
2. When proposing changes to the specification, ALWAYS output the COMPLETE updated spec as a fenced \`\`\`json block starting with { — never partial fragments.
3. Be concrete and implementation-aware: registries (Registries.ITEM / Registries.BLOCK), models, lang keys, recipes and loot tables must match Minecraft ${project.minecraft_version} Fabric idioms.
4. When files need to be created or edited, show the exact file path and complete file content in fenced blocks. The VOXEL Agent applies them through its sandboxed tools after user confirmation.
5. Keep answers focused. Ask at most one clarifying question, and only when truly necessary.
6. Never break the Style, Lore or Gameplay Bibles. If a request conflicts with them, say so and propose the smallest honest adaptation.`;
}
