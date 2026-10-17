import type { ProjectRecord } from "@/types";
import type { ToolSchema } from "./toolCallFormat";
import { generateItemTexture, type TextureGenRequest } from "@/services/assets/assetStudioService";
import { generateStructure } from "@/services/assets/structureService";
import {
  createProjectDirectory,
  deleteProjectEntry,
  editProjectFile,
  listProjectFiles,
  projectGitDiff,
  projectGitStatus,
  readProjectFile,
  renameProjectEntry,
  searchProject,
  writeProjectFile,
  createSnapshot,
  listSnapshots,
} from "@/services/projects/projectsService";

/**
 * VOXEL Agent tools (Phase 3).
 *
 * Security model:
 *  - Every path goes through the Rust path guard (canonicalize + prefix check).
 *  - Destructive tools (delete) require UI confirmation (policy layer 3).
 *  - All executions are audited to ai_tool_calls.
 */

export interface ToolContext {
  basePath: string;
  project: ProjectRecord;
  projectRel: string;
}

export interface ToolExecutor {
  schema: ToolSchema;
  requiresConfirmation?: boolean;
  /** Human-readable summary for the audit trail and UI cards. */
  summarize: (args: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string argument "${key}"`);
  }
  return value;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const READ_TOOLS_MAX_CHARS = 6000;

export function buildTools(): ToolExecutor[] {
  const rel = (args: Record<string, unknown>) => str(args, "rel_path");

  return [
    {
      schema: {
        name: "read_file",
        description:
          "Read a UTF-8 text file from the project, relative to the project root (e.g. \"src/main/java/.../ModItems.java\").",
        parameters: {
          type: "object",
          properties: {
            rel_path: { type: "string", description: "Path relative to the project root" },
          },
          required: ["rel_path"],
        },
      },
      summarize: (args) => `read ${String(args.rel_path ?? "?")}`,
      async execute(args, ctx) {
        const content = await readProjectFile(ctx.basePath, `${ctx.projectRel}/${rel(args)}`);
        if (content.length > READ_TOOLS_MAX_CHARS) {
          return `${content.slice(0, READ_TOOLS_MAX_CHARS)}\n… (truncated, ${content.length} chars total)`;
        }
        return content || "(empty file)";
      },
    },

    {
      schema: {
        name: "write_file",
        description:
          "Create or overwrite a text file with the COMPLETE content. Use for new items, blocks, recipes, models, lang entries and code changes.",
        parameters: {
          type: "object",
          properties: {
            rel_path: { type: "string", description: "Path relative to the project root" },
            content: { type: "string", description: "Complete file content (UTF-8)" },
          },
          required: ["rel_path", "content"],
        },
      },
      summarize: (args) => `write ${String(args.rel_path ?? "?")}`,
      async execute(args, ctx) {
        const content = str(args, "content");
        await writeProjectFile(ctx.basePath, `${ctx.projectRel}/${rel(args)}`, content);
        return `Wrote ${content.length} chars to ${rel(args)}`;
      },
    },

    {
      schema: {
        name: "edit_file",
        description:
          "Surgical find & replace in an existing file. Prefer this over write_file for small changes. \"find\" must match the file content EXACTLY.",
        parameters: {
          type: "object",
          properties: {
            rel_path: { type: "string" },
            find: { type: "string", description: "Exact text to find" },
            replace: { type: "string", description: "Replacement text" },
            replace_all: { type: "boolean", description: "Replace every occurrence (default: first only)" },
          },
          required: ["rel_path", "find", "replace"],
        },
      },
      summarize: (args) => `edit ${String(args.rel_path ?? "?")}`,
      async execute(args, ctx) {
        const result = await editProjectFile(
          ctx.basePath,
          `${ctx.projectRel}/${rel(args)}`,
          str(args, "find"),
          str(args, "replace"),
          args.replace_all === true,
        );
        return `Replaced ${result.occurrences} occurrence(s) in ${rel(args)} (new size: ${result.new_length} chars)`;
      },
    },

    {
      schema: {
        name: "delete_file",
        description: "Delete a file or empty directory. DANGEROUS — requires user confirmation.",
        parameters: {
          type: "object",
          properties: { rel_path: { type: "string" } },
          required: ["rel_path"],
        },
      },
      requiresConfirmation: true,
      summarize: (args) => `delete ${String(args.rel_path ?? "?")}`,
      async execute(args, ctx) {
        await deleteProjectEntry(ctx.basePath, `${ctx.projectRel}/${rel(args)}`);
        return `Deleted ${rel(args)}`;
      },
    },

    {
      schema: {
        name: "rename_file",
        description: "Rename a file or directory (name only, no path moves).",
        parameters: {
          type: "object",
          properties: {
            rel_path: { type: "string" },
            new_name: { type: "string", description: "New final name (no path separators)" },
          },
          required: ["rel_path", "new_name"],
        },
      },
      summarize: (args) => `rename ${String(args.rel_path ?? "?")} → ${String(args.new_name ?? "?")}`,
      async execute(args, ctx) {
        await renameProjectEntry(ctx.basePath, `${ctx.projectRel}/${rel(args)}`, str(args, "new_name"));
        return `Renamed to ${str(args, "new_name")}`;
      },
    },

    {
      schema: {
        name: "create_directory",
        description: "Create a directory (with parents) relative to the project root.",
        parameters: {
          type: "object",
          properties: { rel_path: { type: "string" } },
          required: ["rel_path"],
        },
      },
      summarize: (args) => `mkdir ${String(args.rel_path ?? "?")}`,
      async execute(args, ctx) {
        await createProjectDirectory(ctx.basePath, `${ctx.projectRel}/${rel(args)}`);
        return `Created directory ${rel(args)}`;
      },
    },

    {
      schema: {
        name: "list_files",
        description:
          "List project files (recursive). Returns relative paths with (dir) markers. Skip patterns: .git, build, .gradle, run.",
        parameters: {
          type: "object",
          properties: { rel_path: { type: "string", description: "Optional subfolder to scope the listing" } },
        },
      },
      summarize: (args) => `list ${String(args.rel_path ?? "(root)")}`,
      async execute(args, ctx) {
        const scope = optStr(args, "rel_path");
        const entries = await listProjectFiles(
          ctx.basePath,
          scope ? `${ctx.projectRel}/${scope}` : ctx.projectRel,
        );
        if (entries.length === 0) return "(empty)";
        return entries
          .map((entry) => (entry.is_dir ? `${entry.path}/ (dir)` : entry.path))
          .slice(0, 120)
          .join("\n");
      },
    },

    {
      schema: {
        name: "search_project",
        description:
          "Case-insensitive text search across the project. Returns path:line matches with the matching line content.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            max_results: { type: "number", description: "Max matches (default 50)" },
          },
          required: ["query"],
        },
      },
      summarize: (args) => `search "${String(args.query ?? "?")}"`,
      async execute(args, ctx) {
        const max = typeof args.max_results === "number" ? args.max_results : 50;
        const matches = await searchProject(
          ctx.basePath,
          ctx.projectRel,
          str(args, "query"),
          false,
          Math.min(Math.max(Math.floor(max), 1), 200),
        );
        if (matches.length === 0) return "No matches.";
        return matches.map((m) => `${m.path}:${m.line_number}: ${m.line_text}`).join("\n");
      },
    },

    {
      schema: {
        name: "inspect_dependencies",
        description:
          "Inspect build dependencies: parses gradle.properties (minecraft/yarn/loader/fabric-api) and fabric.mod.json (depends map).",
        parameters: { type: "object", properties: {} },
      },
      summarize: () => "inspect dependencies",
      async execute(_args, ctx) {
        const [props, modJson] = await Promise.all([
          readProjectFile(ctx.basePath, `${ctx.projectRel}/gradle.properties`).catch(() => null),
          readProjectFile(ctx.basePath, `${ctx.projectRel}/src/main/resources/fabric.mod.json`).catch(() => null),
        ]);
        const sections: string[] = [];
        if (props) {
          sections.push(
            props
              .split("\n")
              .filter((line) => /^(minecraft_version|yarn_mappings|loader_version|fabric_version)/.test(line))
              .join("\n"),
          );
        } else {
          sections.push("gradle.properties not found");
        }
        if (modJson) {
          try {
            const parsed = JSON.parse(modJson) as { depends?: Record<string, string> };
            sections.push(
              "fabric.mod.json depends:\n" +
                Object.entries(parsed.depends ?? {})
                  .map(([k, v]) => `- ${k}: ${v}`)
                  .join("\n"),
            );
          } catch {
            sections.push("fabric.mod.json is not valid JSON");
          }
        } else {
          sections.push("fabric.mod.json not found");
        }
        return sections.join("\n\n");
      },
    },

    {
      schema: {
        name: "git_status",
        description: "Show the git working-tree status of the project (porcelain).",
        parameters: { type: "object", properties: {} },
      },
      summarize: () => "git status",
      async execute(_args, ctx) {
        const status = await projectGitStatus(ctx.basePath, ctx.projectRel);
        return status || "clean — no pending changes";
      },
    },

    {
      schema: {
        name: "git_diff",
        description: "Show the unified diff of the working tree against the last commit.",
        parameters: { type: "object", properties: {} },
      },
      summarize: () => "git diff",
      async execute(_args, ctx) {
        const diff = await projectGitDiff(ctx.basePath, ctx.projectRel);
        if (diff.length > READ_TOOLS_MAX_CHARS) {
          return `${diff.slice(0, READ_TOOLS_MAX_CHARS)}\n… (truncated)`;
        }
        return diff;
      },
    },

    {
      schema: {
        name: "create_snapshot",
        description:
          "Create a git snapshot commit of the current state (label is auto-generated). Use before risky sequences when the user asked for checkpoints.",
        parameters: {
          type: "object",
          properties: { reason: { type: "string", description: "Short reason stored in the commit message" } },
        },
      },
      summarize: (args) => `snapshot (${String(args.reason ?? "manual")})`,
      async execute(args, ctx) {
        const snapshot = await createSnapshot(
          ctx.basePath,
          ctx.projectRel,
          optStr(args, "reason") ?? "agent checkpoint",
        );
        return `Snapshot ${snapshot.label} created (${snapshot.shortSha})`;
      },
    },

    {
      schema: {
        name: "list_snapshots",
        description: "List existing snapshots (label, reason, date, sha).",
        parameters: { type: "object", properties: {} },
      },
      summarize: () => "list snapshots",
      async execute(_args, ctx) {
        const snapshots = await listSnapshots(ctx.basePath, ctx.projectRel);
        if (snapshots.length === 0) return "No snapshots yet (initial scaffold commit exists).";
        return snapshots
          .map((s) => `${s.label} | ${s.reason || s.shortSha} | ${s.date}`)
          .join("\n");
      },
    },
    {
      schema: {
        name: "generate_item_texture",
        description:
          "Generate a REAL 16x16 pixel-art texture and write it into the project. asset_kind 'item' (default) → src/main/resources/assets/<mod_id>/textures/item/<item_id>.png with styles sword, gem, ingot, orb, apple, book, wand; asset_kind 'block' → textures/block/<block_id>.png with styles bricks, planks, ore, panel. Colors are #rrggbb. Use this whenever a new item or block needs a texture instead of leaving it blank.",
        parameters: {
          type: "object",
          properties: {
            item_id: {
              type: "string",
              description: "snake_case item id, e.g. darksteel_ingot",
            },
            style: {
              type: "string",
              description: "One of: sword, gem, ingot, orb, apple, book, wand",
            },
            primary: {
              type: "string",
              description: "Primary color #rrggbb (the item's main body)",
            },
            secondary: {
              type: "string",
              description: "Secondary color #rrggbb (grip, glints, accents)",
            },
            mod_id: {
              type: "string",
              description:
                "The mod id of this project (only when unsure — the project's mod id is the default)",
            },
            asset_kind: {
              type: "string",
              description: "'item' (default) or 'block' — must match the style recipes",
            },
            frames: {
              type: "number",
              description:
                "1 = static sprite (default). 2-8 = ANIMATED: a vertical strip with a shine pulse plus the .png.mcmeta the game animates. Use for magic gems, energy weapons, glowing blocks.",
            },
          },
          required: ["item_id", "style", "primary", "secondary"],
        },
      },
      summarize: (args) =>
        `generate texture ${String(args.item_id)} (${String(args.style)}, ${String(args.primary)}/${String(args.secondary)})`,
      execute: async (args, ctx) => {
        const modId =
          typeof args.mod_id === "string" && args.mod_id.trim().length > 0
            ? args.mod_id.trim()
            : ctx.project.slug.replace(/-/g, "_");
        const result = await generateItemTexture({
          storageBase: ctx.basePath,
          projectRel: ctx.projectRel,
          modId,
          itemId: str(args, "item_id"),
          style: str(args, "style") as TextureGenRequest["style"],
          primary: str(args, "primary"),
          secondary: str(args, "secondary"),
          assetKind:
            typeof args.asset_kind === "string" && args.asset_kind.trim().length > 0
              ? (args.asset_kind.trim() as TextureGenRequest["assetKind"])
              : "item",
          frames:
            typeof args.frames === "number" ? Math.min(8, Math.max(1, Math.floor(args.frames))) : 1,
          previewOnly: false,
        });
        return `Texture written: ${result.wrotePath ?? "unknown"} (16x16 pixel art, ${String(args.asset_kind ?? "item")} style ${String(args.style)})`;
      },
    },
    {
      schema: {
        name: "generate_structure",
        description:
          "Generate a REAL Minecraft structure (.nbt, structure-block ready) and write it into the project's datapack at src/main/resources/data/<mod_id>/structures/<structure_id>.nbt (or structure/ on MC 1.21+). Procedural templates: watchtower (defensive tower), cottage (cozy house), obelisk (mystic monument), ruin (eroded remnant). Same seed always produces the same build.",
        parameters: {
          type: "object",
          properties: {
            structure_id: {
              type: "string",
              description: "snake_case id, e.g. dark_castle_gate",
            },
            kind: {
              type: "string",
              description: "One of: watchtower, cottage, obelisk, ruin",
            },
            seed: {
              type: "number",
              description:
                "Deterministic seed (integer). Optional — omit and the structure is generated with seed 0.",
            },
          },
          required: ["structure_id", "kind"],
        },
      },
      summarize: (args) =>
        `generate structure ${String(args.structure_id)} (${String(args.kind)}, seed ${String(args.seed ?? 0)})`,
      execute: async (args, ctx) => {
        const result = await generateStructure({
          storageBase: ctx.basePath,
          projectRel: ctx.projectRel,
          structureId: str(args, "structure_id"),
          kind: str(args, "kind") as Parameters<typeof generateStructure>[0]["kind"],
          seed: typeof args.seed === "number" ? Math.floor(args.seed) : 0,
          mcVersion: ctx.project.minecraft_version,
          previewOnly: false,
        });
        return `Structure written: ${result.wrotePath ?? "unknown"} (${result.blockCount} blocks, ${result.size.join("x")} — load it in-game with a structure block or reference it from a datapack)`;
      },
    },
  ];
}
