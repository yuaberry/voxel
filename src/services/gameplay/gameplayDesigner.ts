/**
 * VOXEL Gameplay Designer (Super Prompt §4, Fase B) — the editor that works
 * on the REAL files: scans the mod's registered items (all three loader
 * styles we ship templates for), reports the implementation status of each
 * (lang/model/texture/recipe — the consistency check), and creates items
 * by writing every matching file coherently. Recipes are real datapack
 * JSON. Nothing is faked: what you see is what the game loads.
 */
import { listProjectFiles, readProjectFile, writeProjectFile } from "@/services/projects/projectsService";
import { generateItemTexture } from "@/services/assets/assetStudioService";
import type { ProjectRecord } from "@/types";

export type ModStyle = "fabric" | "deferred" | "modern";

export interface ItemDef {
  id: string;
  constName: string | null;
  registered: boolean;
  model: boolean;
  lang: boolean;
  texture: boolean;
  recipe: boolean;
  displayName: string | null;
}

export interface ScanResult {
  modId: string;
  style: ModStyle;
  items: ItemDef[];
  modItemsRel: string | null;
}

const ID_RE = /^[a-z][a-z0-9_]{1,63}$/;

function toConst(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join("_");
}

async function findModItemsRel(basePath: string, projectSlug: string): Promise<string | null> {
  const files = await listProjectFiles(basePath, `projects/${projectSlug}`).catch(() => []);
  const hit = files.find(
    (f) => f.path.endsWith("/ModItems.java") || f.path === "src/main/java/ModItems.java",
  );
  return hit ? `projects/${projectSlug}/${hit.path}` : null;
}

/** Reads en_us.json and returns its keys (lang merge safety needs the object). */
async function readLangObject(basePath: string, rel: string): Promise<Record<string, string>> {
  try {
    const raw = await readProjectFile(basePath, rel);
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function scanProject(
  basePath: string,
  project: ProjectRecord,
): Promise<ScanResult> {
  const modId = project.slug.replace(/-/g, "_");
  const modItemsRel = await findModItemsRel(basePath, project.slug);
  const assetsRel = `projects/${project.slug}/src/main/resources/assets/${modId}`;
  const dataRel = `projects/${project.slug}/src/main/resources/data/${modId}`;

  const assets = await listProjectFiles(basePath, assetsRel).catch(() => []);
  const data = await listProjectFiles(basePath, dataRel).catch(() => []);
  const lang = await readLangObject(basePath, `${assetsRel}/lang/en_us.json`);

  const items: ItemDef[] = [];
  const seen = new Set<string>();
  let style: ModStyle = "fabric";

  if (modItemsRel) {
    const java = await readProjectFile(basePath, modItemsRel).catch(() => "");
    style = java.includes("registerSimpleItem")
      ? "modern"
      : java.includes("RegistryObject") || java.includes("DeferredRegister")
        ? "deferred"
        : "fabric";

    // registration lines — the ids the mod REALLY registers (all styles)
    const re = /(?:register|registerSimpleItem)\(\s*"([a-z0-9_]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(java)) !== null) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      // the CONSTANT name on the line just above the call (both styles
      // declare `public static final ... CONST = ... register("id"...`)
      const before = java.slice(Math.max(0, match.index - 160), match.index);
      const constMatch = /([A-Z][A-Z0-9_]+)\s*=\s*$/.exec(before);
      const constName = constMatch ? constMatch[1] : null;

      items.push({
        id,
        constName,
        registered: true,
        model: assets.some((f) => f.path.endsWith(`/models/item/${id}.json`)),
        lang: Boolean(lang[`item.${modId}.${id}`]),
        texture: assets.some((f) => f.path.endsWith(`/textures/item/${id}.png`)),
        recipe: data.some((f) => f.path.endsWith(`/recipes/${id}.json`)),
        displayName: lang[`item.${modId}.${id}`] ?? null,
      });
    }
  }

  items.sort((a, b) => a.id.localeCompare(b.id));
  return { modId, style, items, modItemsRel };
}

export interface NewItemSpec {
  id: string;
  displayName: string;
  /** texture colors (real generation, same as the Asset Studio) */
  primary: string;
  secondary: string;
}

function itemJava(style: ModStyle, spec: NewItemSpec): string {
  const id = spec.id;
  const constName = toConst(id);
  const doc = `    /** ${spec.displayName} — created by the VOXEL Gameplay Designer. */`;
  switch (style) {
    case "fabric":
      return `${doc}\n    public static final Item ${constName} = register("${id}",\n            new Item(new Item.Settings()));\n\n`;
    case "deferred":
      return `${doc}\n    public static final RegistryObject<Item> ${constName} = ITEMS.register(\n            "${id}", () -> new Item(new Item.Properties()));\n\n`;
    case "modern":
      return `${doc}\n    public static final DeferredItem<Item> ${constName} =\n            ITEMS.registerSimpleItem("${id}", properties -> properties);\n\n`;
  }
}

/** Creates the item in EVERY real place: java, model, lang, texture. */
export async function createItem(
  basePath: string,
  project: ProjectRecord,
  spec: NewItemSpec,
): Promise<{ filesWritten: string[] }> {
  const id = spec.id.trim();
  if (!ID_RE.test(id)) {
    throw new Error('Item id must be lowercase letters/digits/_ (it becomes registry names)');
  }
  if (!spec.displayName.trim()) {
    throw new Error("Give the item a display name");
  }
  const scan = await scanProject(basePath, project);
  if (!scan.modItemsRel) {
    throw new Error("ModItems.java not found — this project's layout is not supported yet (the Agent can add items anywhere)");
  }
  if (scan.items.some((i) => i.id === id)) {
    throw new Error(`"${id}" already exists in this mod`);
  }

  const written: string[] = [];
  const projectRel = `projects/${project.slug}`;
  const assetsRel = `${projectRel}/src/main/resources/assets/${scan.modId}`;

  // 1. Java — append before the creative-tab block (or the class end)
  const javaRel = scan.modItemsRel;
  const java = await readProjectFile(basePath, javaRel);
  const anchorCandidates = [
    java.indexOf("    /** Creative tab"),
    java.indexOf("    // The mod's creative tab"),
    java.indexOf("    public static final ItemGroup"),
    java.lastIndexOf("}"),
  ].filter((i) => i >= 0);
  const insertAt = Math.max(0, Math.min(...anchorCandidates));
  const snippet = itemJava(scan.style, spec);
  const updated =
    java.slice(0, insertAt) +
    snippet +
    (insertAt === java.lastIndexOf("}") ? "" : "") +
    java.slice(insertAt);
  await writeProjectFile(basePath, javaRel, updated);
  written.push(javaRel);

  // fabric creative tab: also show the new item in the entries block
  if (scan.style === "fabric" && updated.includes("entries.add(") && spec) {
    const constName = toConst(id);
    const lastEntries = updated.lastIndexOf("entries.add(");
    if (lastEntries >= 0) {
      const lineEnd = updated.indexOf(";", lastEntries);
      const withEntry =
        updated.slice(0, lineEnd + 1) +
        `\n                entries.add(${constName});` +
        updated.slice(lineEnd + 1);
      await writeProjectFile(basePath, javaRel, withEntry);
    }
  }

  // 2. model
  const modelRel = `${assetsRel}/models/item/${id}.json`;
  await writeProjectFile(
    basePath,
    modelRel,
    JSON.stringify(
      { parent: "item/generated", textures: { layer0: `${scan.modId}:item/${id}` } },
      null,
      2,
    ),
  );
  written.push(modelRel);

  // 3. lang — MERGE (never overwrite unrelated entries)
  const langRel = `${assetsRel}/lang/en_us.json`;
  const langObj = await readLangObject(basePath, langRel);
  langObj[`item.${scan.modId}.${id}`] = spec.displayName.trim();
  await writeProjectFile(basePath, langRel, JSON.stringify(langObj, null, 2));
  written.push(langRel);

  // 4. texture — real generation (the same engine the Studio uses)
  await generateItemTexture({
    storageBase: basePath,
    projectRel: `projects/${project.slug}`,
    modId: scan.modId,
    itemId: id,
    style: "gem",
    primary: spec.primary,
    secondary: spec.secondary,
    assetKind: "item",
    frames: 1,
    previewOnly: false,
  });
  written.push(`${assetsRel}/textures/item/${id}.png`);

  return { filesWritten: written };
}

// ---------------------------------------------------------------------------
// Recipes — real datapack JSON (shaped/shapeless), the vanilla format
// ---------------------------------------------------------------------------

export interface ShapedPattern {
  /** three rows of up to 3 symbols (' ' or a letter) */
  rows: [string, string, string];
  /** symbol -> item id (e.g. D -> minecraft:diamond) */
  keys: Record<string, string>;
}

export function buildShapedRecipe(resultId: string, resultCount: number, pattern: ShapedPattern): string {
  const keys: Record<string, { item: string }> = {};
  for (const [symbol, item] of Object.entries(pattern.keys)) {
    if (!/^[A-Z]$/.test(symbol)) {
      throw new Error(`Recipe key "${symbol}" must be a single capital letter (or use space for empty)`);
    }
    if (!item.includes(":")) {
      throw new Error(`Recipe ingredient "${item}" needs a namespace (e.g. minecraft:diamond)`);
    }
    keys[symbol] = { item };
  }
  for (const row of pattern.rows) {
    if (row.length > 3) {
      throw new Error("Recipe rows have at most 3 symbols");
    }
    for (const ch of row) {
      if (ch !== " " && !keys[ch]) {
        throw new Error(`Recipe row uses "${ch}" but no ingredient is bound to it`);
      }
    }
  }
  const ns = resultId.includes(":") ? resultId : null;
  const item = ns ?? resultId;
  return JSON.stringify(
    {
      type: "minecraft:crafting_shaped",
      pattern: pattern.rows,
      key: keys,
      result: { item, count: Math.max(1, Math.min(64, resultCount)) },
    },
    null,
    2,
  );
}

export function buildShapelessRecipe(resultId: string, resultCount: number, ingredients: string[]): string {
  if (ingredients.length === 0 || ingredients.length > 9) {
    throw new Error("Shapeless recipes take 1 to 9 ingredients");
  }
  for (const ing of ingredients) {
    if (!ing.includes(":")) {
      throw new Error(`Ingredient "${ing}" needs a namespace (e.g. minecraft:diamond)`);
    }
  }
  return JSON.stringify(
    {
      type: "minecraft:crafting_shapeless",
      ingredients: ingredients.map((item) => ({ item })),
      result: { item: resultId, count: Math.max(1, Math.min(64, resultCount)) },
    },
    null,
    2,
  );
}

export async function writeRecipe(
  basePath: string,
  project: ProjectRecord,
  itemId: string,
  json: string,
): Promise<string> {
  const modId = project.slug.replace(/-/g, "_");
  const rel = `projects/${project.slug}/src/main/resources/data/${modId}/recipes/${itemId}.json`;
  await writeProjectFile(basePath, rel, json);
  return rel;
}
