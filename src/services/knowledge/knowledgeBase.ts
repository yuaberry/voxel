/**
 * VOXEL Knowledge Center (Super Prompt §11, Fase C) — technical knowledge
 * that is VERIFIED: everything below is either a fact we proved in our own
 * E2E builds (six loader eras compiling real jars) or a fact of the vanilla
 * engine our production datapacks run on. Each article carries its official
 * source links; nothing invented, no deprecated APIs presented as current.
 */
export interface KnowledgeArticle {
  id: string;
  title: string;
  category: "eras" | "loaders" | "datapacks" | "build" | "servers" | "launcher" | "ai";
  tags: string[];
  verified: string; // HOW we verified it (E2E tests, production modules)
  sources: string[]; // official links
  body: string;
}

export const KNOWLEDGE_BASE: KnowledgeArticle[] = [
  {
    id: "minecraft-eras",
    title: "Minecraft eras: what changes between 1.20.1, 1.21.x and 26.x",
    category: "eras",
    tags: ["pack_format", "26.x", "1.20.1", "1.21", "structures", "int providers"],
    verified:
      "verified by our six template E2Es (fabric 1.20.1, forge 1.20.1, neoforge 1.20.1/1.20.2-era/MDG/26.x) — each compiles a real jar",
    sources: [
      "https://minecraft.wiki/w/Pack_format",
      "https://neoforged.net",
    ],
    body: `The eras that matter for content creators:

- **1.20.1** — datapack pack_format 15, resource pack 15; structures live under \`data/<ns>/structures/\`. The most stable modding target: every major loader supports it.
- **1.20.2-1.21.1** — pack_format 18→34 across the line; NeoForge switched from ForgeGradle 6 to NeoGradle 7 (registry names, \`neoforge.mods.toml\`).
- **1.21.2+** — int providers FLATTEN in worldgen JSON (constant int instead of {type:"minecraft:constant"...}) — dimension files written for 1.20.1 will not parse here unchanged.
- **1.21.4+** — item model definitions move to \`assets/<ns>/items/*.json\`; lang keys gain the \`itemGroup.\` prefix.
- **26.x (YY.M scheme)** — pack_format beyond 34; Java 25 era; NeoForge registration is \`registerSimpleItem("id", properties -> ...)\` returning \`DeferredItem\` — the old \`SwordItem\`/ToolMaterials constructors no longer exist (components + ToolMaterial). Our 26.x E2E caught exactly this when the template compiled.

Where it lives in VOXEL: the version catalog auto-updates these mappings (Settings → Minecraft), the Compatibility Lab shows each project's era, and the templates embed era-factual files.`,
  },
  {
    id: "loader-styles",
    title: "The three registration styles (fabric, DeferredRegister, 26.x)",
    category: "loaders",
    tags: ["fabric", "forge", "neoforge", "DeferredRegister", "registerSimpleItem", "ModItems"],
    verified:
      "the Gameplay Designer parses all three styles from the real ModItems.java of our templates",
    sources: [
      "https://docs.fabricmc.net/develop/items/first-item",
      "https://docs.neoforged.net/docs/items",
      "https://mcforge.readthedocs.io/en/1.20.x/items/",
    ],
    body: `Registering an item looks different per loader era — VOXEL's scanner and designer speak all three:

**Fabric (1.20.1):**
\`\`\`java
public static final Item GEM = register("gem",
        new Item(new Item.Settings()));
\`\`\`

**Forge / NeoForge (DeferredRegister):**
\`\`\`java
public static final RegistryObject<Item> GEM = ITEMS.register(
        "gem", () -> new Item(new Item.Properties()));
\`\`\`

**26.x (ModDevGradle):**
\`\`\`java
public static final DeferredItem<Item> GEM =
        ITEMS.registerSimpleItem("gem", properties -> properties);
\`\`\`

Regardless of style, the REST of the pipeline is identical: the model at \`assets/<modid>/models/item/<id>.json\`, the lang key \`item.<modid>.<id>\`, the texture at \`assets/<modid>/textures/item/<id>.png\` and (optionally) the recipe at \`data/<modid>/recipes/<id>.json\`. The Gameplay Designer writes all of them coherently and the Asset Lab checks they exist.`,
  },
  {
    id: "datapack-triggers",
    title: "Vanilla datapack patterns: triggers, statistics and predicates",
    category: "datapacks",
    tags: ["trigger", "scoreboard", "minecraft.mined", "predicate", "tick", "load"],
    verified:
      "these are the exact patterns our production modules run (Token Chain since Wave 1, Prison mines, Visual Logic — all tested)",
    sources: [
      "https://minecraft.wiki/w/Scoreboard#Criteria",
      "https://minecraft.wiki/w/Predicate",
    ],
    body: `Player-facing commands WITHOUT operator rights come from /trigger:

\`\`\`
# load: create the objective as a TRIGGER
scoreboard objectives add my_command trigger "My Command"
# tick: enable for everyone, then route whoever fired it
scoreboard players enable @a my_command
execute as @a[scores={my_command=1..}] run function my_ns:on_my_command
# on_my_command: consume the signal first
scoreboard players set @s my_command 0
\`\`\`

Detecting MINING with the real \`minecraft.mined:<block>\` criterion (the Prison pattern):
\`\`\`
scoreboard objectives add mined_diamond minecraft.mined:minecraft.diamond_ore
execute as @a[scores={mined_diamond=1..}] run function my_ns:on_mine
# inside: scoreboard players set @s mined_diamond 0
\`\`\`

CHANCE is a real predicate file (\`data/<ns>/predicates/x.json\`):
\`\`\`json
{"condition": "minecraft:random_chance", "chance": 0.25}
\`\`\`
called with \`execute if predicate <ns>:x\`.

Timers are 20 ticks per second: increment a dummy score in tick, fire at \`N*20\`, reset to 0. Conditions with children become their own function called by the parent's \`execute\` prefix — the nesting our Visual Logic compiler emits.`,
  },
  {
    id: "gradle-first-build",
    title: "What the FIRST Gradle build actually does (and why it's slow)",
    category: "build",
    tags: ["gradle", "first build", "cache", "toolchain", "environment"],
    verified: "our E2E clocked the toolchain download (718MB launcher; minutes on first run)",
    sources: [
      "https://gradle.org/downloads/",
      "https://adoptium.net",
    ],
    body: `The first \`gradlew build\` on a fresh machine downloads:
1. the Gradle distribution itself (the wrapper version — 8.8 in the 1.20.1 templates, 9.x in the 26.x era),
2. every dependency of the toolchain: Loom or ForgeGradle/ModDevGradle, mappings, the Minecraft jars,
3. any declared libraries (Fabric API etc.).

Later builds reuse the shared cache (VOXEL points GRADLE_USER_HOME at your workspace) and take seconds-to-minutes instead. If the first build dies mid-download: check the internet/firewall/antivirus and run it again — the Error Center tells you exactly that (category \`environment\`).

Java per era: 1.20.1 builds want 17+ (21 recommended), 26.x wants 25. Point Settings → Java at the right binary; the preflight check catches a wrong one BEFORE wasting a build.`,
  },
  {
    id: "build-errors",
    title: "Reading build errors: javac vs dependency vs environment",
    category: "build",
    tags: ["javac", "error", "dependency", "JAVA_HOME", "environment"],
    verified: "the Error Center parser is unit-tested per category (8 tests) and drives the Auto-Fix loop",
    sources: [
      "https://docs.oracle.com/javase/17/docs/specs/diagnostics.html",
    ],
    body: `Three families, three different fixes:

1. **javac errors** (\`src/.../File.java:12: error: ...\`) — real code errors. The Error Center extracts file/line/message and the agent can fix them (Fix Build workflow). Common trap: calling an API from the wrong era (e.g. \`SwordItem\` in 26.x — use the Compatibility Lab to see which era you're on).
2. **dependency errors** (\`Could not resolve ...\`) — a library isn't reachable: first build interrupted, a repository is down, or the version doesn't exist. Retrying a first build fixes most cases.
3. **environment errors** — Java missing/wrong (\`'java' is not recognized\`, \`JAVA_HOME\`), disk full, permission denied. The Error Center names the machine problem and the exact fix; nothing code-side will help until it's addressed.

\`Unsupported class file major version\` = your Java is too old OR too new for the Gradle version. The verdict distinguishes which.`,
  },
  {
    id: "vanilla-vs-paper",
    title: "Vanilla vs Paper: plugins, mods and where files go",
    category: "servers",
    tags: ["paper", "vanilla", "plugins", "mods", "online-mode"],
    verified: "our server pipeline downloads both with checksum verification (Fill API v3 for Paper, piston-meta for vanilla)",
    sources: [
      "https://docs.papermc.io",
      "https://www.minecraft.net/en-us/eula",
    ],
    body: `- **Vanilla server**: no plugins, no mods, but FULL datapack support — everything VOXEL generates (modules, custom commands, Visual Logic, imported structures) runs on it.
- **Paper**: a performance server that runs PLUGINS (\`.jar\` files in \`plugins/\`). VOXEL installs Paper plugins from Modrinth with SHA-1 verification. Plugins are NOT Minecraft mods — they use Paper's API, not a loader.
- **Modded servers**: mods go in \`mods/\` and need a matching server-side loader — VOXEL's Deploy puts your DATAPACK on any server, and your mod's data files work wherever the mod runs.
- \`online-mode=true\` stays ON: only genuine Minecraft accounts join, and VOXEL's presets can never turn it off.

Backups cover \`world/\`, \`plugins/\`, \`config/\` and the properties — and they're zip-slip guarded both ways.`,
  },
  {
    id: "launcher-assets",
    title: "What launching the game really downloads",
    category: "launcher",
    tags: ["launcher", "assets", "libraries", "natives", "SHA-1"],
    verified: "our launcher E2E verifies every one of the ~3.7k files by SHA-1 before first launch",
    sources: [
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    ],
    body: `A launchable instance is: the client jar + version.json libraries for your OS + the natives (unpacked from the platform library zips) + ~3.6k asset files (sounds/textures) + the asset index. VOXEL downloads them from Mojang's official endpoints with the published SHA-1 for EVERY file — a mismatch aborts the download. Instances are isolated per project under \`instances/<slug>/\`, so mods/shaders never leak between them.

The Fabric profile merges via meta.fabricmc.net when the project uses Fabric. MSA login is the official device flow — tokens live in the OS keyring, never in the database.`,
  },
  {
    id: "ai-models-setup",
    title: "Choosing and routing AI models in VOXEL",
    category: "ai",
    tags: ["openrouter", "anthropic", "ollama", "fallback", "metrics"],
    verified: "the Model Router's fallback fires exactly once before the first delta; metrics come from real task rows",
    sources: [
      "https://openrouter.ai/docs",
      "https://docs.anthropic.com",
      "https://ollama.com",
    ],
    body: `VOXEL speaks OpenAI-compatible (OpenRouter/OpenAI/NVIDIA NIM), Anthropic and Ollama. Keys live in the OS keyring.

- The **model field** is your primary — pick the best on the market for the work (strong reasoning for the Architect phase, fast for small fixes).
- **Phase models** let the task force run different models per role (Architect/Developer/Reviewer).
- The **fallback model** retries EXACTLY ONCE when the primary fails before any content arrives — a mid-stream fallback would duplicate text, so those stay real failures.
- The AI Command Center shows the honest numbers per task: success rate, latency, fallback usage. No cost numbers are invented — only what providers return.`,
  },
];

/** Textual search across titles, bodies and tags — honest substring/keyword scoring. */
export function searchKnowledge(query: string): KnowledgeArticle[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = KNOWLEDGE_BASE.map((article) => {
    const haystack = `${article.title}\n${article.tags.join(" ")}\n${article.body}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (article.title.toLowerCase().includes(term)) score += 3;
      if (article.tags.some((tag) => tag.toLowerCase().includes(term))) score += 2;
      if (haystack.includes(term)) score += 1;
    }
    return { article, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.article);
}

/** Error category → the article that explains it (the Error Center links here). */
const CATEGORY_TO_ARTICLE: Record<string, string> = {
  environment: "build-errors",
  configuration: "build-errors",
  dependency: "gradle-first-build",
  java: "build-errors",
};

export function articleForErrorCategory(category: string): KnowledgeArticle | null {
  const id = CATEGORY_TO_ARTICLE[category];
  if (!id) return null;
  return KNOWLEDGE_BASE.find((article) => article.id === id) ?? null;
}
