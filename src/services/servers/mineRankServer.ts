/**
 * Mine Rank — VOXEL's own Rankup-style server system.
 *
 * Inspired by the public guide of nerdzone.gg/guia (the Rankup style the
 * owner asked for), re-authored from scratch for VOXEL: every command,
 * every score and every block of the world is generated here — nothing is
 * copied from NerdZone or from any plugin.
 *
 * Vanilla truth (Minecraft 1.20.1, the era of every server module):
 *   - the only player command is `/trigger <objective> [set <int>]`, so the
 *     whole surface is `/trigger mr_t_*` + clickable `tellraw` menus;
 *   - free text does not exist → chat commands offer fixed phrases;
 *   - a player cannot be named → the target is always the nearest other
 *     player (documented in COMMANDS.md, never hidden);
 *   - scoreboard objective names are capped at 16 characters.
 *
 * The single source of truth is MINE_RANK_COMMANDS: the datapack, the
 * generated COMMANDS.md and the tests all read from it.
 */

import type { GeneratedFile } from "./serverModules";

/** Datapack namespace — never collides with the other VOXEL modules. */
export const MINE_RANK_NS = "nexus_rank";

// ---------------------------------------------------------------------------
// Configuration (the numbers the owner sees in the panel)
// ---------------------------------------------------------------------------

/** How many plots (private mines) the world ships with. */
export const MINE_RANK_PLOTS = 8;
/**
 * Distance between two plot centers.
 *
 * The world is deliberately COMPACT: a vanilla teleport longer than a few
 * chunks makes the server load the whole corridor (the "chunk holder
 * chain") — a 48-chunk jump froze the server for ~45s and killed the
 * watchdog. Every structure now lives within 5 chunks of the hub.
 */
export const MINE_RANK_PLOT_SPACING = 16;
/** The X/Z of the first plot center (the grid grows towards +X and +Z). */
export const MINE_RANK_PLOT_ORIGIN = 20;
/** How many plots fit in one row of the grid. */
export const MINE_RANK_PLOT_COLUMNS = 4;
/** Level needed to prestige. */
export const MINE_RANK_PRESTIGE_LEVEL = 1000;
/** Blocks mined before the private mine is restored. */
export const MINE_RANK_MINE_RESET_BLOCKS = 100;
/** Price (coins) of a manual mine restore. */
export const MINE_RANK_MINE_RESET_COST = 25;
/** Ticks of one fishing session (20 ticks = 1s). */
export const MINE_RANK_FISHING_TICKS = 1200;
/** Fish needed for each fishing level. */
export const MINE_RANK_FISH_PER_LEVEL = 5;
/** Clan slots (each one is a real vanilla team). */
export const MINE_RANK_CLAN_SLOTS = 8;
/**
 * The height of the walkable deck of every structure.
 *
 * The world is built on its own platform, high above the terrain, so the
 * server behaves the same in every biome. The block under the player's feet
 * is the BASE layer (one below).
 */
export const MINE_RANK_DECK_Y = 100;
/** The solid block under the deck. */
export const MINE_RANK_BASE_Y = MINE_RANK_DECK_Y - 1;
/** Hub (spawn) coordinates. */
export const MINE_RANK_HUB = { x: 0, y: MINE_RANK_DECK_Y, z: 0 };
/** Fishing pond coordinates (the player stands on the water). */
export const MINE_RANK_POND = { x: 0, y: MINE_RANK_DECK_Y + 1, z: 80 };
/** Raid arena coordinates (the player stands on the stone floor). */
export const MINE_RANK_ARENA = { x: -80, y: MINE_RANK_DECK_Y, z: 0 };
/** Mobs spawned by one expedition. */
export const MINE_RANK_RAID_MOBS = 8;
/** Blocks the hype train needs for each extra coin multiplier. */
export const MINE_RANK_HYPE_STEP = 1000;

/** The eight ore layers of every private mine (top → bottom). */
export const MINE_RANK_ORE_LAYERS = [
  "coal_ore",
  "iron_ore",
  "copper_ore",
  "gold_ore",
  "redstone_ore",
  "lapis_ore",
  "diamond_ore",
  "emerald_ore",
] as const;

/** The deepest ore layer of a private mine. */
export const MINE_RANK_MINE_FLOOR_Y = 91;
/** The top ore layer of a private mine (the player stands on it). */
export const MINE_RANK_MINE_TOP_Y =
  MINE_RANK_MINE_FLOOR_Y + MINE_RANK_ORE_LAYERS.length - 1;

/** Colored marker of each plot — the owner sees which one is which. */
const PLOT_MARKERS = [
  "white_wool",
  "orange_wool",
  "magenta_wool",
  "light_blue_wool",
  "yellow_wool",
  "lime_wool",
  "pink_wool",
  "light_gray_wool",
] as const;

/** The ore statistics the module reads (real vanilla mined statistics). */
const MINED_STATISTICS = [
  { key: "stone", item: "minecraft.stone" },
  { key: "coal", item: "minecraft.coal_ore" },
  { key: "iron", item: "minecraft.iron_ore" },
  { key: "copper", item: "minecraft.copper_ore" },
  { key: "gold", item: "minecraft.gold_ore" },
  { key: "red", item: "minecraft.redstone_ore" },
  { key: "lapis", item: "minecraft.lapis_ore" },
  { key: "diamond", item: "minecraft.diamond_ore" },
  { key: "emerald", item: "minecraft.emerald_ore" },
] as const;

/** Ores the player can sell at the market (and their price in coins). */
const MARKET_ORES = [
  { key: "coal", item: "minecraft:coal_ore", price: 5, label: "Carvão" },
  { key: "iron", item: "minecraft:iron_ore", price: 12, label: "Ferro" },
  { key: "gold", item: "minecraft:gold_ore", price: 30, label: "Ouro" },
  { key: "diamond", item: "minecraft:diamond_ore", price: 120, label: "Diamante" },
] as const;

/**
 * The center of a plot: a 4x2 grid that grows towards +X and +Z.
 *
 * The grid is COMPACT on purpose — the farthest plot (68, 36) is ~5 chunks
 * away from the hub, so no teleport in the server ever loads a long
 * corridor of chunks (the vanilla froze for ~45s when the pond was 48
 * chunks away).
 */
export function mineRankPlotCenter(plot: number): { x: number; z: number } {
  const index = Math.min(Math.max(plot, 1), MINE_RANK_PLOTS) - 1;
  const column = index % MINE_RANK_PLOT_COLUMNS;
  const row = Math.floor(index / MINE_RANK_PLOT_COLUMNS);
  return {
    x: MINE_RANK_PLOT_ORIGIN + column * MINE_RANK_PLOT_SPACING,
    z: MINE_RANK_PLOT_ORIGIN + row * MINE_RANK_PLOT_SPACING,
  };
}

// ---------------------------------------------------------------------------
// Tiers and currencies
// ---------------------------------------------------------------------------

export interface MineRankTier {
  index: number;
  name: string;
  minLevel: number;
  color: string;
  reward: string;
}

/** The eight rank tiers, from level 0 to the prestige gate. */
export const MINE_RANK_TIERS: MineRankTier[] = [
  { index: 1, name: "Novato", minLevel: 0, color: "#a78bfa", reward: "picareta e os primeiros coins" },
  { index: 2, name: "Escavador", minLevel: 100, color: "#22d3ee", reward: "+50 coins e +5 tokens" },
  { index: 3, name: "Minerador", minLevel: 250, color: "#38bdf8", reward: "peitoral de ferro" },
  { index: 4, name: "Perito", minLevel: 450, color: "#34d399", reward: "+50 coins e +5 tokens" },
  { index: 5, name: "Mestre", minLevel: 650, color: "#fbbf24", reward: "peitoral dourado" },
  { index: 6, name: "Lenda", minLevel: 800, color: "#fb923c", reward: "+50 coins e +5 tokens" },
  { index: 7, name: "Titã", minLevel: 950, color: "#f472b6", reward: "peitoral de diamante" },
  { index: 8, name: "Mítico", minLevel: 1000, color: "#f87171", reward: "prestígio liberado" },
];

export interface MineRankCurrency {
  /** the scoreboard objective that stores the balance */
  id: string;
  name: string;
  symbol: string;
  color: string;
  /** how the player earns it */
  earns: string;
}

/** The four currencies of the server. */
export const MINE_RANK_CURRENCIES: MineRankCurrency[] = [
  {
    id: "mr_coins",
    name: "Coins",
    symbol: "$",
    color: "#fbbf24",
    earns: "1 por bloco minerado (+1 por prestígio) e vendas no mercado",
  },
  {
    id: "mr_tokens",
    name: "Tokens",
    symbol: "☀",
    color: "#22d3ee",
    earns: "tiers, pesca e prestígio",
  },
  {
    id: "mr_rubies",
    name: "Rubies",
    symbol: "✦",
    color: "#f472b6",
    earns: "abates, restauração da mina e tempo online",
  },
  {
    id: "mr_cash",
    name: "Cash",
    symbol: "✪",
    color: "#facc15",
    earns: "prestígio e abates na expedição",
  },
];

// ---------------------------------------------------------------------------
// The command manifest — single source of truth
// ---------------------------------------------------------------------------

export type MineRankFamily =
  | "mina"
  | "progressao"
  | "terrenos"
  | "economia"
  | "sistemas"
  | "social"
  | "geral";

export type MineRankSurface = "menu" | "info" | "warp" | "action" | "economy" | "social";

export interface MineRankCommand {
  /** the command the player asks for (Rankup-style naming) */
  id: string;
  /** the arguments the original command takes */
  args: string[];
  /** the vanilla trigger the player really types */
  trigger: string;
  family: MineRankFamily;
  surface: MineRankSurface;
  description: string;
  /** the mcfunction that implements it */
  fn: string;
  /** honest note about what vanilla cannot do */
  note?: string;
}

const NEAREST_NOTE =
  "o vanilla não aceita digitar um nick — o alvo é sempre o jogador mais próximo de você";

/**
 * Every command the Mine Rank server answers. The datapack, the generated
 * COMMANDS.md and the tests all read from this list — a command that is not
 * here does not exist in the server.
 */
export const MINE_RANK_COMMANDS: MineRankCommand[] = [
  // ---- mine -------------------------------------------------------------
  {
    id: "mina",
    args: [],
    trigger: "mr_t_mine",
    family: "mina",
    surface: "menu",
    description: "Abre o menu da sua mina.",
    fn: "cmd_mine",
  },
  {
    id: "mina ir",
    args: [],
    trigger: "mr_t_mine_go",
    family: "mina",
    surface: "warp",
    description: "Vai direto para a sua mina.",
    fn: "cmd_mine_go",
  },
  {
    id: "mina resetar",
    args: [],
    trigger: "mr_t_mine_reset",
    family: "mina",
    surface: "action",
    description: `Restaura os blocos da sua mina (${MINE_RANK_MINE_RESET_COST} coins).`,
    fn: "cmd_mine_reset",
  },
  // ---- progression ------------------------------------------------------
  {
    id: "picareta",
    args: [],
    trigger: "mr_t_pickaxe",
    family: "progressao",
    surface: "action",
    description: "Pega uma picareta nova (eficiência e unbreaking III).",
    fn: "cmd_pickaxe",
  },
  {
    id: "prestigio",
    args: [],
    trigger: "mr_t_prestige",
    family: "progressao",
    surface: "menu",
    description: "Abre o menu de prestígio.",
    fn: "cmd_prestige",
  },
  {
    id: "resumo",
    args: [],
    trigger: "mr_t_summary",
    family: "progressao",
    surface: "info",
    description: "Resumo da sua progressão.",
    fn: "cmd_summary",
  },
  {
    id: "boosters",
    args: [],
    trigger: "mr_t_boosters",
    family: "progressao",
    surface: "info",
    description: "Mostra seus boosters (bônus de coins e hype train).",
    fn: "cmd_boosters",
  },
  {
    id: "armadura",
    args: [],
    trigger: "mr_t_armor",
    family: "progressao",
    surface: "info",
    description: "Mostra sua armadura de mineração.",
    fn: "cmd_armor",
  },
  // ---- plots ------------------------------------------------------------
  {
    id: "p claim",
    args: [],
    trigger: "mr_t_plot_claim",
    family: "terrenos",
    surface: "action",
    description: "Reserva o terreno em que você está.",
    fn: "cmd_plot_claim",
  },
  {
    id: "p h",
    args: [],
    trigger: "mr_t_plot_home",
    family: "terrenos",
    surface: "warp",
    description: "Vai para o seu terreno.",
    fn: "cmd_plot_home",
  },
  {
    id: "p auto",
    args: [],
    trigger: "mr_t_plot_auto",
    family: "terrenos",
    surface: "action",
    description: "Pega o próximo terreno livre.",
    fn: "cmd_plot_auto",
    note: "sem sorteio no vanilla — entregamos o primeiro terreno livre em ordem",
  },
  {
    id: "p add",
    args: ["<nick>"],
    trigger: "mr_t_plot_add",
    family: "terrenos",
    surface: "social",
    description: "Dá acesso de construção ao jogador mais próximo.",
    fn: "cmd_plot_add",
    note: NEAREST_NOTE,
  },
  {
    id: "p remove",
    args: ["<nick>"],
    trigger: "mr_t_plot_del",
    family: "terrenos",
    surface: "social",
    description: "Remove o acesso de construção do jogador mais próximo.",
    fn: "cmd_plot_del",
    note: NEAREST_NOTE,
  },
  {
    id: "p deny",
    args: ["<nick>"],
    trigger: "mr_t_plot_deny",
    family: "terrenos",
    surface: "social",
    description: "Bloqueia o jogador mais próximo no seu terreno.",
    fn: "cmd_plot_deny",
    note: NEAREST_NOTE,
  },
  // ---- economy ----------------------------------------------------------
  {
    id: "money",
    args: [],
    trigger: "mr_t_money",
    family: "economia",
    surface: "economy",
    description: "Mostra suas coins.",
    fn: "cmd_money",
  },
  {
    id: "tokens",
    args: [],
    trigger: "mr_t_tokens",
    family: "economia",
    surface: "economy",
    description: "Mostra seus tokens.",
    fn: "cmd_tokens",
  },
  {
    id: "rubi",
    args: [],
    trigger: "mr_t_rubies",
    family: "economia",
    surface: "economy",
    description: "Mostra seus rubies.",
    fn: "cmd_rubies",
  },
  {
    id: "cash",
    args: [],
    trigger: "mr_t_cash",
    family: "economia",
    surface: "economy",
    description: "Mostra seu cash.",
    fn: "cmd_cash",
  },
  {
    id: "money top",
    args: [],
    trigger: "mr_t_top",
    family: "economia",
    surface: "info",
    description: "Estatísticas do servidor (online, blocos minerados, hype).",
    fn: "cmd_top",
    note: "o vanilla não ordena jogadores — mostramos os totais reais do servidor",
  },
  {
    id: "mercado",
    args: [],
    trigger: "mr_t_market",
    family: "economia",
    surface: "menu",
    description: "Vende minérios por coins.",
    fn: "cmd_market",
  },
  {
    id: "loja",
    args: [],
    trigger: "mr_t_shop",
    family: "economia",
    surface: "menu",
    description: "Loja do servidor (itens por coins).",
    fn: "cmd_shop",
  },
  // ---- systems ----------------------------------------------------------
  {
    id: "saque",
    args: [],
    trigger: "mr_t_raid",
    family: "sistemas",
    surface: "menu",
    description: "Abre a expedição (arena de mobs).",
    fn: "cmd_raid",
  },
  {
    id: "pesca",
    args: [],
    trigger: "mr_t_fishing",
    family: "sistemas",
    surface: "warp",
    description: "Vai para o lago e começa uma sessão de pesca.",
    fn: "cmd_fishing",
  },
  {
    id: "peixes",
    args: [],
    trigger: "mr_t_fish",
    family: "sistemas",
    surface: "info",
    description: "Mostra seus peixes.",
    fn: "cmd_fish",
  },
  {
    id: "niveis",
    args: [],
    trigger: "mr_t_fish_lvl",
    family: "sistemas",
    surface: "info",
    description: "Mostra seu nível de pesca.",
    fn: "cmd_fish_lvl",
  },
  {
    id: "clan",
    args: [],
    trigger: "mr_t_clan",
    family: "sistemas",
    surface: "menu",
    description: "Menu do clan.",
    fn: "cmd_clan",
    note: "clans têm nome fixo (Clan 1..8) — o vanilla não cria nomes livres",
  },
  {
    id: "hypetrain",
    args: [],
    trigger: "mr_t_hype",
    family: "sistemas",
    surface: "info",
    description: "Mostra o Hype Train do servidor.",
    fn: "cmd_hype",
  },
  {
    id: "tempo",
    args: [],
    trigger: "mr_t_playtime",
    family: "sistemas",
    surface: "info",
    description: "Mostra seu tempo online.",
    fn: "cmd_playtime",
  },
  // ---- social -----------------------------------------------------------
  {
    id: "tpa",
    args: ["<nick>"],
    trigger: "mr_t_tpa",
    family: "social",
    surface: "social",
    description: "Pede teleporte para o jogador mais próximo.",
    fn: "cmd_tpa",
    note: NEAREST_NOTE,
  },
  {
    id: "tpaccept",
    args: [],
    trigger: "mr_t_tp_ok",
    family: "social",
    surface: "social",
    description: "Aceita o pedido de teleporte.",
    fn: "cmd_tp_ok",
  },
  {
    id: "tpadeny",
    args: [],
    trigger: "mr_t_tp_no",
    family: "social",
    surface: "social",
    description: "Recusa o pedido de teleporte.",
    fn: "cmd_tp_no",
  },
  {
    id: "tpacancel",
    args: [],
    trigger: "mr_t_tp_cancel",
    family: "social",
    surface: "social",
    description: "Cancela o pedido de teleporte que você enviou.",
    fn: "cmd_tp_cancel",
  },
  {
    id: "g",
    args: ["<mensagem>"],
    trigger: "mr_t_chat_g",
    family: "social",
    surface: "social",
    description: "Chat global (frases rápidas).",
    fn: "cmd_chat_g",
    note: "sem texto livre no vanilla — o menu oferece frases prontas",
  },
  {
    id: "tell",
    args: ["<nick>", "<mensagem>"],
    trigger: "mr_t_chat_tell",
    family: "social",
    surface: "social",
    description: "Mensagem privada (frases rápidas).",
    fn: "cmd_chat_tell",
    note: `${NEAREST_NOTE} — e o vanilla não mostra quem enviou a mensagem`,
  },
  {
    id: "r",
    args: ["<mensagem>"],
    trigger: "mr_t_chat_r",
    family: "social",
    surface: "social",
    description: "Resposta rápida para o jogador mais próximo.",
    fn: "cmd_chat_r",
    note: `${NEAREST_NOTE} — sem histórico de mensagens no vanilla`,
  },
  // ---- general ----------------------------------------------------------
  {
    id: "warps",
    args: [],
    trigger: "mr_t_warps",
    family: "geral",
    surface: "menu",
    description: "Menu de warps.",
    fn: "cmd_warps",
  },
  {
    id: "spawn",
    args: [],
    trigger: "mr_t_spawn",
    family: "geral",
    surface: "warp",
    description: "Volta para o hub do servidor.",
    fn: "cmd_spawn",
  },
  {
    id: "home",
    args: [],
    trigger: "mr_t_home",
    family: "geral",
    surface: "warp",
    description: "Vai para o seu terreno (ou para o hub).",
    fn: "cmd_home",
    note: "sethome livre exige plugin — no vanilla a 'casa' é o seu terreno",
  },
  {
    id: "duvidas",
    args: [],
    trigger: "mr_t_help",
    family: "geral",
    surface: "info",
    description: "Regras do servidor e como usar os comandos.",
    fn: "cmd_help",
  },
];

/** The family labels used by the docs and by the UI panel. */
export const MINE_RANK_FAMILY_LABELS: Record<MineRankFamily, string> = {
  mina: "Mina",
  progressao: "Progressão",
  terrenos: "Terrenos",
  economia: "Economia",
  sistemas: "Sistemas",
  social: "Social",
  geral: "Geral",
};

// ---------------------------------------------------------------------------
// Chat helpers (tellraw JSON)
// ---------------------------------------------------------------------------

interface ChatPart {
  text?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  score?: { objective: string; name: string };
  selector?: string;
  clickEvent?: { action: string; value: string };
  hoverEvent?: { action: string; value: { text: string } };
}

function chat(parts: ChatPart[]): string {
  return JSON.stringify(parts);
}

/** The module prefix every message carries. */
function tag(color = "#fbbf24"): ChatPart {
  return { text: "[Mine Rank] ", color };
}

/** A clickable menu entry. */
function option(
  label: string,
  trigger: string,
  value: number,
  color = "#22d3ee",
  hover?: string,
): ChatPart {
  const part: ChatPart = {
    text: label,
    color,
    clickEvent: { action: "run_command", value: `/trigger ${trigger} set ${value}` },
  };
  if (hover) {
    part.hoverEvent = { action: "show_text", value: { text: hover } };
  }
  return part;
}

/** A score shown in chat. */
function score(objective: string, name = "@s", color = "#a78bfa"): ChatPart {
  return { score: { objective, name }, color };
}

// ---------------------------------------------------------------------------
// Datapack helpers
// ---------------------------------------------------------------------------

function functionFile(name: string, lines: string[]): GeneratedFile {
  return {
    path: `world/datapacks/${MINE_RANK_NS}/data/${MINE_RANK_NS}/functions/${name}.mcfunction`,
    content: `${lines.join("\n")}\n`,
  };
}

function dataFile(path: string, content: string): GeneratedFile {
  return { path: `world/datapacks/${MINE_RANK_NS}/${path}`, content };
}

/**
 * The tags that carry the access registry.
 *
 * The vanilla refuses `team join` inside a datapack: the team name is
 * validated when the function is PARSED (before `load` runs), so the team
 * does not exist yet and the whole function fails to load. Tags have no such
 * validation — the access registry lives on the players themselves.
 */
function accessTag(plot: number): string {
  return `mr_trust_${plot}`;
}

function denyTag(plot: number): string {
  return `mr_deny_${plot}`;
}

function clanTag(slot: number): string {
  return `mr_clan_${slot}`;
}

// ---------------------------------------------------------------------------
// The world (hub, plots, pond, arena)
//
// Every structure stands on its own deck at y=100 — above any vanilla
// terrain — so the server works the same on a flat world, on a plains biome
// or on a mountains biome. The block the player walks on is the BASE layer
// (y=99); the DECK (y=100) holds the decoration and the holes.
// ---------------------------------------------------------------------------

function buildWorldLines(): string[] {
  const pond = MINE_RANK_POND;
  const arena = MINE_RANK_ARENA;
  const lines: string[] = [
    `# Mine Rank — the procedural world (deck at y=${MINE_RANK_DECK_Y})`,
    "# every structure is within 5 chunks of the hub — a long teleport makes",
    "# the vanilla load the whole corridor and freeze the server",
    "# hub (spawn)",
    `fill -6 ${MINE_RANK_BASE_Y} -6 6 ${MINE_RANK_BASE_Y} 6 minecraft:stone`,
    `fill -2 ${MINE_RANK_DECK_Y} -2 2 ${MINE_RANK_DECK_Y} 2 minecraft:sea_lantern`,
    `fill -1 ${MINE_RANK_DECK_Y} -1 1 ${MINE_RANK_DECK_Y} 1 minecraft:air`,
    `setblock -5 ${MINE_RANK_DECK_Y} 5 minecraft:sea_lantern`,
    `setblock 5 ${MINE_RANK_DECK_Y} -5 minecraft:sea_lantern`,
    `setworldspawn ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
    "# fishing pond",
    `fill ${pond.x - 6} ${MINE_RANK_BASE_Y} ${pond.z - 6} ${pond.x + 6} ${MINE_RANK_BASE_Y} ${pond.z + 6} minecraft:stone`,
    `fill ${pond.x - 5} ${MINE_RANK_DECK_Y} ${pond.z - 5} ${pond.x + 5} ${MINE_RANK_DECK_Y} ${pond.z + 5} minecraft:water`,
    `fill ${pond.x - 6} ${MINE_RANK_DECK_Y} ${pond.z - 6} ${pond.x + 6} ${MINE_RANK_DECK_Y} ${pond.z - 6} minecraft:cobblestone`,
    `fill ${pond.x - 6} ${MINE_RANK_DECK_Y} ${pond.z + 6} ${pond.x + 6} ${MINE_RANK_DECK_Y} ${pond.z + 6} minecraft:cobblestone`,
    `fill ${pond.x - 6} ${MINE_RANK_DECK_Y} ${pond.z - 6} ${pond.x - 6} ${MINE_RANK_DECK_Y} ${pond.z + 6} minecraft:cobblestone`,
    `fill ${pond.x + 6} ${MINE_RANK_DECK_Y} ${pond.z - 6} ${pond.x + 6} ${MINE_RANK_DECK_Y} ${pond.z + 6} minecraft:cobblestone`,
    "# raid arena",
    `fill ${arena.x - 7} ${MINE_RANK_BASE_Y} ${arena.z - 7} ${arena.x + 7} ${MINE_RANK_BASE_Y} ${arena.z + 7} minecraft:stone`,
    `fill ${arena.x - 8} ${MINE_RANK_DECK_Y} ${arena.z - 8} ${arena.x + 8} ${MINE_RANK_DECK_Y} ${arena.z - 8} minecraft:iron_bars`,
    `fill ${arena.x - 8} ${MINE_RANK_DECK_Y} ${arena.z + 8} ${arena.x + 8} ${MINE_RANK_DECK_Y} ${arena.z + 8} minecraft:iron_bars`,
    `fill ${arena.x - 8} ${MINE_RANK_DECK_Y} ${arena.z - 7} ${arena.x - 8} ${MINE_RANK_DECK_Y} ${arena.z + 7} minecraft:iron_bars`,
    `fill ${arena.x + 8} ${MINE_RANK_DECK_Y} ${arena.z - 7} ${arena.x + 8} ${MINE_RANK_DECK_Y} ${arena.z + 7} minecraft:iron_bars`,
    "# private mines",
  ];
  for (let p = 1; p <= MINE_RANK_PLOTS; p += 1) {
    lines.push(`function ${MINE_RANK_NS}:build_plot_${p}`);
  }
  return lines;
}

/**
 * One plot: a deck with a 3x3 hole in the middle and a private shaft below
 * it. The shaft holds the 8 ore layers — the player stands on the top layer
 * and digs down, one layer at a time.
 */
function buildPlotLines(plot: number): string[] {
  const { x: cx, z: cz } = mineRankPlotCenter(plot);
  const lines: string[] = [
    `# plot ${plot} — deck at y=${MINE_RANK_DECK_Y}, shaft down to y=${MINE_RANK_MINE_FLOOR_Y}`,
    // the deck, with the 3x3 hole of the shaft
    `fill ${cx - 5} ${MINE_RANK_BASE_Y} ${cz - 5} ${cx + 5} ${MINE_RANK_BASE_Y} ${cz + 5} minecraft:stone`,
    `fill ${cx - 1} ${MINE_RANK_BASE_Y} ${cz - 1} ${cx + 1} ${MINE_RANK_BASE_Y} ${cz + 1} minecraft:air`,
    // the colored marker: a ring around the hole
    `fill ${cx - 2} ${MINE_RANK_DECK_Y} ${cz - 2} ${cx + 2} ${MINE_RANK_DECK_Y} ${cz + 2} minecraft:${PLOT_MARKERS[plot - 1]}`,
    `fill ${cx - 1} ${MINE_RANK_DECK_Y} ${cz - 1} ${cx + 1} ${MINE_RANK_DECK_Y} ${cz + 1} minecraft:air`,
    `setblock ${cx - 4} ${MINE_RANK_DECK_Y} ${cz} minecraft:sea_lantern`,
    `setblock ${cx + 4} ${MINE_RANK_DECK_Y} ${cz} minecraft:sea_lantern`,
    // the shaft walls and its floor
    `fill ${cx - 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz - 2} ${cx + 2} ${MINE_RANK_MINE_FLOOR_Y} ${cz + 2} minecraft:bedrock`,
  ];
  for (let y = MINE_RANK_MINE_FLOOR_Y + 1; y <= MINE_RANK_MINE_TOP_Y; y += 1) {
    lines.push(`fill ${cx - 2} ${y} ${cz - 2} ${cx - 2} ${y} ${cz + 2} minecraft:stone`);
    lines.push(`fill ${cx + 2} ${y} ${cz - 2} ${cx + 2} ${y} ${cz + 2} minecraft:stone`);
    lines.push(`fill ${cx - 2} ${y} ${cz - 2} ${cx + 2} ${y} ${cz - 2} minecraft:stone`);
    lines.push(`fill ${cx - 2} ${y} ${cz + 2} ${cx + 2} ${y} ${cz + 2} minecraft:stone`);
  }
  // the ore layers — the player digs them from the top down
  MINE_RANK_ORE_LAYERS.forEach((ore, index) => {
    const y = MINE_RANK_MINE_TOP_Y - index;
    lines.push(`fill ${cx - 1} ${y} ${cz - 1} ${cx + 1} ${y} ${cz + 1} minecraft:${ore}`);
  });
  return lines;
}

/** Puts the 8 ore layers back (the mine is restored every 100 blocks). */
function resetPlotLines(plot: number): string[] {
  const { x: cx, z: cz } = mineRankPlotCenter(plot);
  const lines: string[] = [`# restore the ore layers of plot ${plot}`];
  MINE_RANK_ORE_LAYERS.forEach((ore, index) => {
    const y = MINE_RANK_MINE_TOP_Y - index;
    lines.push(`fill ${cx - 1} ${y} ${cz - 1} ${cx + 1} ${y} ${cz + 1} minecraft:${ore}`);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Command implementations — one mcfunction per manifest entry
// ---------------------------------------------------------------------------

/** The nearest OTHER player (the requester is tagged `mr_req` meanwhile). */
function nearestPlayer(): string {
  return "@a[limit=1,sort=nearest,tag=!mr_req]";
}

/** Tellraw to the player. */
function tell(parts: ChatPart[]): string {
  return `tellraw @s ${chat(parts)}`;
}

/** Tellraw to everybody. */
function broadcast(parts: ChatPart[]): string {
  return `tellraw @a ${chat(parts)}`;
}

/**
 * The eight plot cases of a teleport.
 *
 * `offset` is 2 for the surface (the player lands on the marker ring, next
 * to the hole of the shaft) and 0 for the shaft itself.
 */
function plotTeleports(y: number, offset = 0): string[] {
  const lines: string[] = [];
  for (let p = 1; p <= MINE_RANK_PLOTS; p += 1) {
    const { x, z } = mineRankPlotCenter(p);
    lines.push(
      `execute if score @s mr_plot matches ${p} run tp @s ${x} ${y} ${z + offset}`,
    );
  }
  return lines;
}

/** The eight plot cases of a function call (used by plot restore/reset). */
function plotCalls(fn: string): string[] {
  const lines: string[] = [];
  for (let p = 1; p <= MINE_RANK_PLOTS; p += 1) {
    lines.push(
      `execute if score @s mr_plot matches ${p} run function ${MINE_RANK_NS}:${fn}_${p}`,
    );
  }
  return lines;
}

/**
 * The eight plot cases of an access grant/revoke.
 *
 * The target is the nearest OTHER player: the vanilla cannot resolve a typed
 * nick, so the executor is tagged `mr_req` while the call runs.
 */
function plotAccessCalls(fn: string): string[] {
  const lines: string[] = [];
  for (let p = 1; p <= MINE_RANK_PLOTS; p += 1) {
    lines.push(
      `execute if score @s mr_plot matches ${p} run execute at @s as ${nearestPlayer()} run function ${MINE_RANK_NS}:${fn}_${p}`,
    );
  }
  return lines;
}

/** The quick-chat phrases (the vanilla has no free text). */
const GLOBAL_PHRASES = [
  "Bom dia, mina!",
  "Alguém para minerar junto?",
  "Vendendo minério no mercado!",
  "Minha mina foi restaurada!",
  "Quem vai para a expedição?",
  "Bora pescar?",
];

const PRIVATE_PHRASES = [
  "Vamos minerar juntos?",
  "Me empresta uma picareta?",
  "Aceito a proposta de clan!",
  "Boa mina!",
];

function commandFunctions(): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  // ---- mine -------------------------------------------------------------
  map.cmd_mine = [
    "# /trigger mr_t_mine — 1 = menu, 2 = go to the mine, 3 = restore the mine",
    `execute if score @s mr_t_mine matches 1 run function ${MINE_RANK_NS}:menu_mine`,
    `execute if score @s mr_t_mine matches 2 run function ${MINE_RANK_NS}:do_mine_go`,
    `execute if score @s mr_t_mine matches 3 run function ${MINE_RANK_NS}:do_mine_reset`,
    "scoreboard players set @s mr_t_mine 0",
  ];

  map.cmd_mine_go = [
    `execute if score @s mr_plot matches 1.. run function ${MINE_RANK_NS}:do_mine_go`,
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você ainda não tem terreno — use /trigger mr_t_plot_auto", color: "red" },
    ])}`,
    "scoreboard players set @s mr_t_mine_go 0",
  ];

  map.cmd_mine_reset = [
    `execute if score @s mr_plot matches 1.. run function ${MINE_RANK_NS}:do_mine_reset`,
    "scoreboard players set @s mr_t_mine_reset 0",
  ];

  map.menu_mine = [
    tell([tag(), { text: "Sua mina", color: "#22d3ee", bold: true }]),
    tell([
      option(
        " 1. Ir para a mina",
        "mr_t_mine",
        2,
        "#a78bfa",
        "Teleporta para o seu veio de mineração",
      ),
    ]),
    tell([
      option(
        ` 2. Restaurar os blocos (${MINE_RANK_MINE_RESET_COST} coins)`,
        "mr_t_mine",
        3,
        "#a78bfa",
        "Repõe os blocos da sua mina",
      ),
    ]),
  ];

  map.do_mine_go = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você ainda não tem terreno — use /trigger mr_t_plot_auto", color: "red" },
    ])}`,
    ...plotTeleports(MINE_RANK_BASE_Y),
    "playsound minecraft:block.amethyst_block.chime master @s ~ ~ ~ 0.6 0.9",
  ];

  map.do_mine_reset = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você não tem mina — reserve um terreno primeiro.", color: "red" },
    ])}`,
    `execute if score @s mr_plot matches 1.. if score @s mr_coins matches ${MINE_RANK_MINE_RESET_COST}.. run function ${MINE_RANK_NS}:pay_mine_reset`,
    `execute if score @s mr_plot matches 1.. if score @s mr_coins matches ..${MINE_RANK_MINE_RESET_COST - 1} run ${tell([
      tag(),
      { text: `Restaurar a mina custa ${MINE_RANK_MINE_RESET_COST} coins.`, color: "red" },
    ])}`,
  ];

  map.pay_mine_reset = [
    `scoreboard players remove @s mr_coins ${MINE_RANK_MINE_RESET_COST}`,
    "scoreboard players set @s mr_mine_used 0",
    ...plotCalls("reset_plot"),
    tell([
      tag(),
      { text: "Sua mina foi restaurada — os blocos voltaram.", color: "#22d3ee" },
    ]),
  ];

  // ---- progression ------------------------------------------------------
  map.cmd_pickaxe = [
    "give @s minecraft:diamond_pickaxe{Enchantments:[{id:\"minecraft:efficiency\",lvl:3},{id:\"minecraft:unbreaking\",lvl:3}]} 1",
    tell([
      tag(),
      { text: "Você recebeu uma picareta nova (eficiência III + unbreaking III).", color: "#22d3ee" },
    ]),
    "scoreboard players set @s mr_t_pickaxe 0",
  ];

  map.cmd_prestige = [
    "# /trigger mr_t_prestige — 1 = menu, 2 = confirm",
    `execute if score @s mr_t_prestige matches 1 run function ${MINE_RANK_NS}:menu_prestige`,
    `execute if score @s mr_t_prestige matches 2 run function ${MINE_RANK_NS}:do_prestige`,
    "scoreboard players set @s mr_t_prestige 0",
  ];

  map.menu_prestige = [
    tell([tag(), { text: "Prestígio", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Requisito: level ", color: "gray" },
      score("mr_prestige", "@s", "#fbbf24"),
      { text: " → cada prestígio dá +1 coin por bloco minerado.", color: "gray" },
    ]),
    tell([
      { text: " Seu level: ", color: "gray" },
      score("mr_level", "@s", "#a78bfa"),
      { text: ` · prestígio exige level ${MINE_RANK_PRESTIGE_LEVEL}.`, color: "gray" },
    ]),
    tell([
      option(
        " Confirmar prestígio (volta ao level 0)",
        "mr_t_prestige",
        2,
        "#fbbf24",
        "Irreversível: o level volta a 0 e o bônus permanente sobe",
      ),
    ]),
  ];

  map.do_prestige = [
    `execute if score @s mr_level matches ${MINE_RANK_PRESTIGE_LEVEL}.. run function ${MINE_RANK_NS}:prestige_now`,
    `execute if score @s mr_level matches ..${MINE_RANK_PRESTIGE_LEVEL - 1} run ${tell([
      tag(),
      { text: `Prestígio exige level ${MINE_RANK_PRESTIGE_LEVEL}. Seu level: `, color: "red" },
      score("mr_level", "@s", "#fbbf24"),
    ])}`,
  ];

  map.prestige_now = [
    "scoreboard players add @s mr_prestige 1",
    "scoreboard players set @s mr_level 0",
    "scoreboard players set @s mr_rank 1",
    "scoreboard players set @s mr_mine_used 0",
    "scoreboard players add @s mr_rubies 5",
    "scoreboard players add @s mr_cash 1",
    "scoreboard players add @s mr_tokens 10",
    broadcast([
      tag(),
      { selector: "@s", color: "#a78bfa" },
      { text: " fez prestígio! Bônus permanente: +1 coin por bloco.", color: "#22d3ee" },
    ]),
    'title @s title [{"text":"PRESTÍGIO!","color":"#fbbf24","bold":true}]',
    "playsound minecraft:ui.toast.challenge_complete master @a ~ ~ ~ 0.7 1.0",
  ];

  map.cmd_summary = [
    tell([tag(), { text: "Resumo", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Level ", color: "gray" },
      score("mr_level", "@s", "#a78bfa"),
      { text: " · tier ", color: "gray" },
      score("mr_rank", "@s", "#22d3ee"),
      { text: " · prestígio ", color: "gray" },
      score("mr_prestige", "@s", "#fbbf24"),
    ]),
    tell([
      { text: " Coins $ ", color: "gray" },
      score("mr_coins", "@s", "#fbbf24"),
      { text: " · tokens ☀ ", color: "gray" },
      score("mr_tokens", "@s", "#22d3ee"),
      { text: " · rubies ✦ ", color: "gray" },
      score("mr_rubies", "@s", "#f472b6"),
      { text: " · cash ✪ ", color: "gray" },
      score("mr_cash", "@s", "#facc15"),
    ]),
    tell([
      { text: " Terreno ", color: "gray" },
      score("mr_plot", "@s", "#a78bfa"),
      { text: " · blocos na mina ", color: "gray" },
      score("mr_mine_used", "@s", "#a78bfa"),
      { text: ` · restauração em ${MINE_RANK_MINE_RESET_BLOCKS} blocos.`, color: "gray" },
    ]),
    "scoreboard players set @s mr_t_summary 0",
  ];

  map.cmd_boosters = [
    "scoreboard players operation @s mr_tmp = #mr_hype",
    "scoreboard players operation @s mr_tmp /= #mr_k1000 mr_const",
    tell([tag(), { text: "Boosters", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Coins por bloco: +", color: "gray" },
      score("mr_prestige", "@s", "#fbbf24"),
      { text: " (base +1 por prestígio)", color: "gray" },
    ]),
    tell([
      { text: " Hype Train do servidor: +", color: "gray" },
      score("mr_tmp", "@s", "#fbbf24"),
      { text: " a cada ", color: "gray" },
      score("mr_hype", "#mr_hype", "#a78bfa"),
      { text: " blocos minerados", color: "gray" },
    ]),
    "scoreboard players set @s mr_t_boosters 0",
  ];

  map.cmd_armor = [
    "scoreboard players operation @s mr_tmp = @s mr_s_stone",
    ...MINED_STATISTICS.slice(1).map(
      (stat) => `scoreboard players operation @s mr_tmp += @s mr_s_${stat.key}`,
    ),
    tell([tag(), { text: "Armadura de mineração", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Blocos minerados: ", color: "gray" },
      score("mr_tmp", "@s", "#a78bfa"),
    ]),
    tell([
      { text: " Armadura atual: ", color: "gray" },
      { text: "couro", color: "#a78bfa" },
    ]),
    'execute if score @s mr_tmp matches 100.. run tellraw @s [{"text":"[Mine Rank] ","color":"#fbbf24"},{"text":"Armadura atual: ","color":"gray"},{"text":"corrente","color":"#22d3ee"}]',
    'execute if score @s mr_tmp matches 500.. run tellraw @s [{"text":"[Mine Rank] ","color":"#fbbf24"},{"text":"Armadura atual: ","color":"gray"},{"text":"ferro","color":"#fbbf24"}]',
    'execute if score @s mr_tmp matches 1500.. run tellraw @s [{"text":"[Mine Rank] ","color":"#fbbf24"},{"text":"Armadura atual: ","color":"gray"},{"text":"diamante","color":"#f472b6"}]',
    "scoreboard players set @s mr_t_armor 0",
  ];

  // ---- plots ------------------------------------------------------------
  map.cmd_plot_claim = [
    `execute if score @s mr_plot matches 1.. run ${tell([
      tag(),
      { text: "Você já tem um terreno — use /trigger mr_t_plot_home", color: "red" },
    ])}`,
    ...Array.from({ length: MINE_RANK_PLOTS }, (_, index) => {
      const p = index + 1;
      const { x, z } = mineRankPlotCenter(p);
      return `execute if score @s mr_plot matches 0 positioned ${x} ${MINE_RANK_DECK_Y} ${z + 2} if entity @s[distance=..6] run function ${MINE_RANK_NS}:claim_plot_${p}`;
    }),
    "scoreboard players set @s mr_t_plot_claim 0",
  ];

  for (let p = 1; p <= MINE_RANK_PLOTS; p += 1) {
    const center = mineRankPlotCenter(p);
    map[`claim_plot_${p}`] = [
      `execute if score #mr_p${p} mr_plot_used matches 1 run ${tell([
        tag(),
        { text: "Este terreno já foi reservado.", color: "red" },
      ])}`,
      `execute if score #mr_p${p} mr_plot_used matches 0 run function ${MINE_RANK_NS}:do_claim_${p}`,
    ];
    map[`do_claim_${p}`] = [
      `scoreboard players set #mr_p${p} mr_plot_used 1`,
      `scoreboard players set @s mr_plot ${p}`,
      `tp @s ${center.x} ${MINE_RANK_DECK_Y + 1} ${center.z + 2}`,
      broadcast([
        tag(),
        { selector: "@s", color: "#a78bfa" },
        { text: ` reservou o terreno #${p}.`, color: "gray" },
      ]),
    ];
    map[`grant_plot_${p}`] = [
      `execute if entity @s[tag=${denyTag(p)}] run tag @s remove ${denyTag(p)}`,
      `tag @s add ${accessTag(p)}`,
      "scoreboard players add #mr_notice mr_notice 1",
      tell([
        tag(),
        { text: "Você ganhou acesso de construção a um terreno.", color: "gray" },
      ]),
    ];
    map[`revoke_plot_${p}`] = [
      `execute if entity @s[tag=${accessTag(p)}] run tag @s remove ${accessTag(p)}`,
      "scoreboard players add #mr_notice mr_notice 1",
      tell([
        tag(),
        { text: "Seu acesso de construção foi removido.", color: "gray" },
      ]),
    ];
    map[`deny_plot_${p}`] = [
      `execute if entity @s[tag=${accessTag(p)}] run tag @s remove ${accessTag(p)}`,
      `tag @s add ${denyTag(p)}`,
      "scoreboard players add #mr_notice mr_notice 1",
      tell([
        tag(),
        { text: "Você foi bloqueado neste terreno.", color: "red" },
      ]),
    ];
  }

  map.cmd_plot_home = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você ainda não tem terreno — use /trigger mr_t_plot_auto", color: "red" },
    ])}`,
    ...plotTeleports(MINE_RANK_DECK_Y + 1, 2),
    "scoreboard players set @s mr_t_plot_home 0",
  ];

  map.cmd_plot_auto = [
    `execute if score @s mr_plot matches 1.. run ${tell([
      tag(),
      { text: "Você já tem um terreno — use /trigger mr_t_plot_home", color: "red" },
    ])}`,
    ...Array.from({ length: MINE_RANK_PLOTS }, (_, index) => {
      const p = index + 1;
      return `execute if score @s mr_plot matches 0 if score #mr_p${p} mr_plot_used matches 0 run function ${MINE_RANK_NS}:do_claim_${p}`;
    }),
    "scoreboard players set @s mr_t_plot_auto 0",
  ];

  map.cmd_plot_add = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você não tem terreno.", color: "red" },
    ])}`,
    "scoreboard players operation @s mr_tmp = #mr_notice",
    "tag @s add mr_req",
    ...plotAccessCalls("grant_plot"),
    "tag @s remove mr_req",
    "scoreboard players operation @s mr_tmp2 = #mr_notice",
    "scoreboard players operation @s mr_tmp2 -= @s mr_tmp",
    `execute if score @s mr_tmp2 matches 1.. run ${tell([
      tag(),
      { text: "Acesso concedido ao jogador mais próximo.", color: "gray" },
    ])}`,
    "scoreboard players set @s mr_t_plot_add 0",
  ];

  map.cmd_plot_del = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você não tem terreno.", color: "red" },
    ])}`,
    "scoreboard players operation @s mr_tmp = #mr_notice",
    "tag @s add mr_req",
    ...plotAccessCalls("revoke_plot"),
    "tag @s remove mr_req",
    "scoreboard players operation @s mr_tmp2 = #mr_notice",
    "scoreboard players operation @s mr_tmp2 -= @s mr_tmp",
    `execute if score @s mr_tmp2 matches 1.. run ${tell([
      tag(),
      { text: "Acesso removido do jogador mais próximo.", color: "gray" },
    ])}`,
    "scoreboard players set @s mr_t_plot_del 0",
  ];

  map.cmd_plot_deny = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você não tem terreno.", color: "red" },
    ])}`,
    "scoreboard players operation @s mr_tmp = #mr_notice",
    "tag @s add mr_req",
    ...plotAccessCalls("deny_plot"),
    "tag @s remove mr_req",
    "scoreboard players operation @s mr_tmp2 = #mr_notice",
    "scoreboard players operation @s mr_tmp2 -= @s mr_tmp",
    `execute if score @s mr_tmp2 matches 1.. run ${tell([
      tag(),
      { text: "Jogador bloqueado no seu terreno.", color: "gray" },
    ])}`,
    "scoreboard players set @s mr_t_plot_deny 0",
  ];

  // ---- economy ----------------------------------------------------------
  const balance = (objective: string, label: string, symbol: string, color: string, trigger: string): string[] => [
    tell([
      tag(),
      { text: `${label}: `, color: "gray" },
      score(objective, "@s", color),
      { text: ` ${symbol}`, color: "gray" },
    ]),
    `scoreboard players set @s ${trigger} 0`,
  ];

  map.cmd_money = balance("mr_coins", "Coins", "$", "#fbbf24", "mr_t_money");
  map.cmd_tokens = balance("mr_tokens", "Tokens", "☀", "#22d3ee", "mr_t_tokens");
  map.cmd_rubies = balance("mr_rubies", "Rubies", "✦", "#f472b6", "mr_t_rubies");
  map.cmd_cash = balance("mr_cash", "Cash", "✪", "#facc15", "mr_t_cash");

  map.cmd_top = [
    tell([tag(), { text: "Estatísticas do servidor", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Jogadores online: ", color: "gray" },
      score("mr_online", "#mr_online", "#a78bfa"),
    ]),
    tell([
      { text: " Blocos minerados no servidor: ", color: "gray" },
      score("mr_tot_blocks", "#mr_tot_blocks", "#a78bfa"),
    ]),
    tell([
      { text: " Hype Train: ", color: "gray" },
      score("mr_hype", "#mr_hype", "#fbbf24"),
    ]),
    tell([
      { text: " (o vanilla não ordena jogadores — estes são os totais reais)", color: "dark_gray" },
    ]),
    "scoreboard players set @s mr_t_top 0",
  ];

  map.cmd_market = [
    "# /trigger mr_t_market — 1 = menu, 2..5 = sell",
    `execute if score @s mr_t_market matches 1 run function ${MINE_RANK_NS}:menu_market`,
    `execute if score @s mr_t_market matches 2 run function ${MINE_RANK_NS}:sell_coal`,
    `execute if score @s mr_t_market matches 3 run function ${MINE_RANK_NS}:sell_iron`,
    `execute if score @s mr_t_market matches 4 run function ${MINE_RANK_NS}:sell_gold`,
    `execute if score @s mr_t_market matches 5 run function ${MINE_RANK_NS}:sell_diamond`,
    "scoreboard players set @s mr_t_market 0",
  ];

  map.menu_market = [
    tell([tag(), { text: "Mercado", color: "#22d3ee", bold: true }]),
    ...MARKET_ORES.map((ore, index) =>
      tell([
        { text: ` ${ore.label}: `, color: "gray" },
        score(`mr_ore_${ore.key}`, "@s", "#a78bfa"),
        { text: " ", color: "gray" },
        option(
          `— vender por ${ore.price} coins`,
          "mr_t_market",
          index + 2,
          "#fbbf24",
          `Vende 1 ${ore.label} minerado por ${ore.price} coins`,
        ),
      ]),
    ),
  ];

  MARKET_ORES.forEach((ore) => {
    map[`sell_${ore.key}`] = [
      `execute if score @s mr_ore_${ore.key} matches 1.. run function ${MINE_RANK_NS}:do_sell_${ore.key}`,
      `execute if score @s mr_ore_${ore.key} matches ..0 run ${tell([
        tag(),
        { text: `Você não tem ${ore.label.toLowerCase()} para vender.`, color: "red" },
      ])}`,
    ];
    map[`do_sell_${ore.key}`] = [
      `scoreboard players remove @s mr_ore_${ore.key} 1`,
      `clear @s ${ore.item} 1`,
      `scoreboard players add @s mr_coins ${ore.price}`,
      tell([
        tag(),
        { text: `1 ${ore.label.toLowerCase()} vendido por ${ore.price} coins.`, color: "#22d3ee" },
      ]),
    ];
  });

  map.cmd_shop = [
    "# /trigger mr_t_shop — 1 = menu, 2..5 = buy",
    `execute if score @s mr_t_shop matches 1 run function ${MINE_RANK_NS}:menu_shop`,
    `execute if score @s mr_t_shop matches 2 run function ${MINE_RANK_NS}:buy_pickaxe`,
    `execute if score @s mr_t_shop matches 3 run function ${MINE_RANK_NS}:buy_armor`,
    `execute if score @s mr_t_shop matches 4 run function ${MINE_RANK_NS}:buy_emerald`,
    `execute if score @s mr_t_shop matches 5 run function ${MINE_RANK_NS}:buy_gapple`,
    "scoreboard players set @s mr_t_shop 0",
  ];

  map.menu_shop = [
    tell([tag(), { text: "Loja do servidor", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Coins: ", color: "gray" },
      score("mr_coins", "@s", "#fbbf24"),
    ]),
    tell([option(" 1. Picareta de diamante — 500 coins", "mr_t_shop", 2, "#fbbf24")]),
    tell([option(" 2. Peitoral de ferro — 300 coins", "mr_t_shop", 3, "#fbbf24")]),
    tell([option(" 3. Bloco de esmeralda — 150 coins", "mr_t_shop", 4, "#fbbf24")]),
    tell([option(" 4. Maçã dourada — 50 coins", "mr_t_shop", 5, "#fbbf24")]),
  ];

  const buys: Array<{ fn: string; label: string; price: number; give: string }> = [
    { fn: "buy_pickaxe", label: "picareta de diamante", price: 500, give: "give @s minecraft:diamond_pickaxe 1" },
    { fn: "buy_armor", label: "peitoral de ferro", price: 300, give: "give @s minecraft:iron_chestplate 1" },
    { fn: "buy_emerald", label: "bloco de esmeralda", price: 150, give: "give @s minecraft:emerald_block 1" },
    { fn: "buy_gapple", label: "maçã dourada", price: 50, give: "give @s minecraft:golden_apple 1" },
  ];

  buys.forEach((buy) => {
    map[buy.fn] = [
      `execute if score @s mr_coins matches ${buy.price}.. run function ${MINE_RANK_NS}:do_${buy.fn}`,
      `execute if score @s mr_coins matches ..${buy.price - 1} run ${tell([
        tag(),
        { text: `${buy.label} custa ${buy.price} coins — seu saldo: `, color: "red" },
        score("mr_coins", "@s", "#fbbf24"),
      ])}`,
    ];
    map[`do_${buy.fn}`] = [
      `scoreboard players remove @s mr_coins ${buy.price}`,
      buy.give,
      tell([
        tag(),
        { text: `Você comprou ${buy.label} por ${buy.price} coins.`, color: "#22d3ee" },
      ]),
    ];
  });

  // ---- systems ----------------------------------------------------------
  map.cmd_raid = [
    "# /trigger mr_t_raid — 1 = menu, 2 = start the expedition",
    `execute if score @s mr_t_raid matches 1 run function ${MINE_RANK_NS}:menu_raid`,
    `execute if score @s mr_t_raid matches 2 run function ${MINE_RANK_NS}:start_raid`,
    "scoreboard players set @s mr_t_raid 0",
  ];

  map.menu_raid = [
    tell([tag(), { text: "Expedição (saque)", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Você é levado à arena e enfrenta ", color: "gray" },
      { text: `${MINE_RANK_RAID_MOBS} mobs`, color: "#fbbf24" },
      { text: ". Cada abate rende ", color: "gray" },
      { text: "1 rubi + 1 cash", color: "#f472b6" },
      { text: ".", color: "gray" },
    ]),
    tell([
      option(
        " Iniciar expedição",
        "mr_t_raid",
        2,
        "#fbbf24",
        "Teleporta para a arena e invoca os mobs",
      ),
    ]),
  ];

  map.start_raid = [
    `tp @s ${MINE_RANK_ARENA.x} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}`,
    `summon minecraft:zombie ${MINE_RANK_ARENA.x} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}`,
    `summon minecraft:zombie ${MINE_RANK_ARENA.x + 2} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z + 2}`,
    `summon minecraft:skeleton ${MINE_RANK_ARENA.x - 2} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z + 2}`,
    `summon minecraft:skeleton ${MINE_RANK_ARENA.x + 2} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z - 2}`,
    `summon minecraft:spider ${MINE_RANK_ARENA.x - 2} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z - 2}`,
    `summon minecraft:creeper ${MINE_RANK_ARENA.x + 4} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}`,
    `summon minecraft:creeper ${MINE_RANK_ARENA.x - 4} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}`,
    `summon minecraft:witch ${MINE_RANK_ARENA.x} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z + 4}`,
    tell([
      tag(),
      { text: "Expedição iniciada! Cada abate rende 1 rubi e 1 cash.", color: "#22d3ee" },
    ]),
  ];

  map.cmd_fishing = [
    `tp @s ${MINE_RANK_POND.x} ${MINE_RANK_POND.y} ${MINE_RANK_POND.z}`,
    "give @s minecraft:fishing_rod{Enchantments:[{id:\"minecraft:lure\",lvl:3}]} 1",
    `scoreboard players set @s mr_fishing ${MINE_RANK_FISHING_TICKS}`,
    tell([
      tag(),
      {
        text: `Sessão de pesca de ${MINE_RANK_FISHING_TICKS / 20}s iniciada.`,
        color: "#22d3ee",
      },
    ]),
    "scoreboard players set @s mr_t_fishing 0",
  ];

  map.cmd_fish = [
    tell([tag(), { text: "Peixes", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Peixes: ", color: "gray" },
      score("mr_fish", "@s", "#a78bfa"),
      { text: " · nível de pesca: ", color: "gray" },
      score("mr_fish_lvl", "@s", "#22d3ee"),
    ]),
    "scoreboard players set @s mr_t_fish 0",
  ];

  map.cmd_fish_lvl = [
    tell([tag(), { text: "Nível de pesca", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Nível: ", color: "gray" },
      score("mr_fish_lvl", "@s", "#22d3ee"),
      { text: ` · cada ${MINE_RANK_FISH_PER_LEVEL} peixes sobem o nível.`, color: "gray" },
    ]),
    tell([
      { text: " Bônus por sessão: +", color: "gray" },
      score("mr_fish_lvl", "@s", "#fbbf24"),
      { text: " coins e +2 tokens.", color: "gray" },
    ]),
    "scoreboard players set @s mr_t_fish_lvl 0",
  ];

  map.cmd_clan = [
    "# /trigger mr_t_clan — 1 = menu, 2 = create, 3..10 = join a slot, 11 = leave",
    `execute if score @s mr_t_clan matches 1 run function ${MINE_RANK_NS}:menu_clan`,
    `execute if score @s mr_t_clan matches 2 run function ${MINE_RANK_NS}:create_clan`,
    ...Array.from({ length: MINE_RANK_CLAN_SLOTS }, (_, index) => {
      const slot = index + 1;
      return `execute if score @s mr_t_clan matches ${index + 3} run function ${MINE_RANK_NS}:join_clan_${slot}`;
    }),
    `execute if score @s mr_t_clan matches ${MINE_RANK_CLAN_SLOTS + 3} run function ${MINE_RANK_NS}:leave_clan`,
    "scoreboard players set @s mr_t_clan 0",
  ];

  map.menu_clan = [
    tell([tag(), { text: "Clan", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Seu clan: ", color: "gray" },
      score("mr_clan", "@s", "#a78bfa"),
      { text: " (0 = sem clan)", color: "gray" },
    ]),
    tell([option(" Criar clan (primeiro slot livre)", "mr_t_clan", 2, "#fbbf24")]),
    ...Array.from({ length: MINE_RANK_CLAN_SLOTS }, (_, index) => {
      const slot = index + 1;
      return tell([
        { text: " Entrar no Clan ", color: "gray" },
        { text: String(slot), color: "#a78bfa" },
        option(
          " —",
          "mr_t_clan",
          index + 3,
          "#22d3ee",
          `Entra no Clan ${slot}`,
        ),
      ]);
    }),
    tell([option(" Sair do clan", "mr_t_clan", MINE_RANK_CLAN_SLOTS + 3, "#f87171")]),
  ];

  map.create_clan = [
    `execute if score @s mr_clan matches 1.. run ${tell([
      tag(),
      { text: "Você já está em um clan.", color: "red" },
    ])}`,
    ...Array.from({ length: MINE_RANK_CLAN_SLOTS }, (_, index) => {
      const slot = index + 1;
      return `execute if score @s mr_clan matches 0 if score #mr_c${slot} mr_clan_used matches 0 run function ${MINE_RANK_NS}:do_create_clan_${slot}`;
    }),
  ];

  for (let slot = 1; slot <= MINE_RANK_CLAN_SLOTS; slot += 1) {
    map[`do_create_clan_${slot}`] = [
      `scoreboard players set #mr_c${slot} mr_clan_used 1`,
      `scoreboard players set @s mr_clan ${slot}`,
      `tag @s add ${clanTag(slot)}`,
      tell([
        tag(),
        { text: `Você fundou o Clan ${slot}.`, color: "#22d3ee" },
      ]),
    ];
    map[`join_clan_${slot}`] = [
      `execute if score @s mr_clan matches 1.. run ${tell([
        tag(),
        { text: "Você já está em um clan.", color: "red" },
      ])}`,
      `execute if score @s mr_clan matches 0 if score #mr_c${slot} mr_clan_used matches 1 run function ${MINE_RANK_NS}:do_join_clan_${slot}`,
    ];
    map[`do_join_clan_${slot}`] = [
      `scoreboard players set @s mr_clan ${slot}`,
      `tag @s add ${clanTag(slot)}`,
      tell([
        tag(),
        { text: `Você entrou no Clan ${slot}.`, color: "#22d3ee" },
      ]),
    ];
    map[`do_leave_clan_${slot}`] = [
      `execute if entity @s[tag=${clanTag(slot)}] run tag @s remove ${clanTag(slot)}`,
      "scoreboard players set @s mr_clan 0",
      // the slot frees itself when nobody is left with the clan tag
      `execute unless entity @a[tag=${clanTag(slot)}] run scoreboard players set #mr_c${slot} mr_clan_used 0`,
      tell([tag(), { text: "Você saiu do clan.", color: "gray" }]),
    ];
  }

  map.leave_clan = [
    `execute if score @s mr_clan matches 0 run ${tell([
      tag(),
      { text: "Você não está em um clan.", color: "red" },
    ])}`,
    ...Array.from({ length: MINE_RANK_CLAN_SLOTS }, (_, index) => {
      const slot = index + 1;
      return `execute if score @s mr_clan matches ${slot} run function ${MINE_RANK_NS}:do_leave_clan_${slot}`;
    }),
  ];

  map.cmd_hype = [
    "scoreboard players operation @s mr_tmp = #mr_hype",
    "scoreboard players operation @s mr_tmp /= #mr_k1000 mr_const",
    tell([tag(), { text: "Hype Train", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Blocos minerados pelo servidor: ", color: "gray" },
      score("mr_hype", "#mr_hype", "#a78bfa"),
    ]),
    tell([
      { text: " Multiplicador global: +", color: "gray" },
      score("mr_tmp", "@s", "#fbbf24"),
      { text: ` a cada ${MINE_RANK_HYPE_STEP} blocos.`, color: "gray" },
    ]),
    "scoreboard players set @s mr_t_hype 0",
  ];

  map.cmd_playtime = [
    tell([tag(), { text: "Tempo online", color: "#22d3ee", bold: true }]),
    tell([
      { text: " Minutos jogados: ", color: "gray" },
      score("mr_minutes", "@s", "#a78bfa"),
    ]),
    tell([
      { text: " A cada 60 minutos: +25 coins e +1 rubi.", color: "gray" },
    ]),
    "scoreboard players set @s mr_t_playtime 0",
  ];

  // ---- social -----------------------------------------------------------
  map.cmd_tpa = [
    "tag @s add mr_req",
    `execute at @s as ${nearestPlayer()} run scoreboard players set @s mr_tp_pending 1`,
    "tag @s remove mr_req",
    "scoreboard players set @s mr_tp_sent 1",
    tell([
      tag(),
      { text: "Pedido de teleporte enviado ao jogador mais próximo.", color: "gray" },
    ]),
    "scoreboard players set @s mr_t_tpa 0",
  ];

  map.cmd_tp_ok = [
    `execute if score @s mr_tp_pending matches 1 run function ${MINE_RANK_NS}:tp_accept`,
    `execute if score @s mr_tp_pending matches 0 run ${tell([
      tag(),
      { text: "Você não tem nenhum pedido de teleporte.", color: "red" },
    ])}`,
    "scoreboard players set @s mr_tp_ok 0",
  ];

  map.tp_accept = [
    "scoreboard players set @s mr_tp_pending 0",
    `execute at ${nearestPlayer()} run tp @s ~ ~ ~`,
    tell([tag(), { text: "Teleporte aceito.", color: "gray" }]),
  ];

  map.cmd_tp_no = [
    "scoreboard players set @s mr_tp_pending 0",
    tell([tag(), { text: "Pedido recusado.", color: "gray" }]),
    "scoreboard players set @s mr_t_tp_no 0",
  ];

  map.cmd_tp_cancel = [
    "scoreboard players set @s mr_tp_sent 0",
    tell([tag(), { text: "Pedido cancelado.", color: "gray" }]),
    "scoreboard players set @s mr_t_tp_cancel 0",
  ];

  map.cmd_chat_g = [
    "# /trigger mr_t_chat_g — 1 = menu, 2..7 = quick phrases",
    `execute if score @s mr_t_chat_g matches 1 run function ${MINE_RANK_NS}:menu_chat_g`,
    ...GLOBAL_PHRASES.map(
      (_, index) =>
        `execute if score @s mr_t_chat_g matches ${index + 2} run function ${MINE_RANK_NS}:chat_g_${index + 1}`,
    ),
    "scoreboard players set @s mr_t_chat_g 0",
  ];

  map.menu_chat_g = [
    tell([tag(), { text: "Chat global (frases rápidas)", color: "#22d3ee", bold: true }]),
    ...GLOBAL_PHRASES.map((phrase, index) =>
      tell([
        option(` ${index + 1}. ${phrase}`, "mr_t_chat_g", index + 2, "#a78bfa", "Envia no chat global"),
      ]),
    ),
  ];

  GLOBAL_PHRASES.forEach((phrase, index) => {
    map[`chat_g_${index + 1}`] = [
      broadcast([
        { selector: "@s", color: "#a78bfa" },
        { text: ": ", color: "gray" },
        { text: phrase, color: "white" },
      ]),
    ];
  });

  map.cmd_chat_tell = [
    "# /trigger mr_t_chat_tell — 1 = menu, 2..5 = quick phrases",
    `execute if score @s mr_t_chat_tell matches 1 run function ${MINE_RANK_NS}:menu_chat_tell`,
    ...PRIVATE_PHRASES.map(
      (_, index) =>
        `execute if score @s mr_t_chat_tell matches ${index + 2} run function ${MINE_RANK_NS}:tell_${index + 1}`,
    ),
    "scoreboard players set @s mr_t_chat_tell 0",
  ];

  map.menu_chat_tell = [
    tell([tag(), { text: "Mensagem privada (frases rápidas)", color: "#22d3ee", bold: true }]),
    ...PRIVATE_PHRASES.map((phrase, index) =>
      tell([
        option(` ${index + 1}. ${phrase}`, "mr_t_chat_tell", index + 2, "#a78bfa", "Envia ao jogador mais próximo"),
      ]),
    ),
  ];

  PRIVATE_PHRASES.forEach((phrase, index) => {
    map[`tell_${index + 1}`] = [
      "tag @s add mr_req",
      `execute at @s as ${nearestPlayer()} run ${tell([
        tag(),
        { text: phrase, color: "white" },
      ])}`,
      "tag @s remove mr_req",
    ];
    map[`reply_${index + 1}`] = [
      "tag @s add mr_req",
      `execute at @s as ${nearestPlayer()} run ${tell([
        tag(),
        { text: `resposta: ${phrase}`, color: "white" },
      ])}`,
      "tag @s remove mr_req",
    ];
  });

  map.cmd_chat_r = [
    "# /trigger mr_t_chat_r — 1 = menu, 2..5 = quick replies",
    `execute if score @s mr_t_chat_r matches 1 run function ${MINE_RANK_NS}:menu_chat_r`,
    ...PRIVATE_PHRASES.map(
      (_, index) =>
        `execute if score @s mr_t_chat_r matches ${index + 2} run function ${MINE_RANK_NS}:reply_${index + 1}`,
    ),
    "scoreboard players set @s mr_t_chat_r 0",
  ];

  map.menu_chat_r = [
    tell([tag(), { text: "Resposta rápida", color: "#22d3ee", bold: true }]),
    ...PRIVATE_PHRASES.map((phrase, index) =>
      tell([
        option(` ${index + 1}. ${phrase}`, "mr_t_chat_r", index + 2, "#a78bfa", "Responde ao jogador mais próximo"),
      ]),
    ),
  ];

  // ---- general ----------------------------------------------------------
  map.cmd_warps = [
    "# /trigger mr_t_warps — 1 = menu, 2..7 = destinations",
    `execute if score @s mr_t_warps matches 1 run function ${MINE_RANK_NS}:menu_warps`,
    `execute if score @s mr_t_warps matches 2 run function ${MINE_RANK_NS}:warp_hub`,
    `execute if score @s mr_t_warps matches 3 run function ${MINE_RANK_NS}:warp_mine`,
    `execute if score @s mr_t_warps matches 4 run function ${MINE_RANK_NS}:warp_pond`,
    `execute if score @s mr_t_warps matches 5 run function ${MINE_RANK_NS}:warp_arena`,
    `execute if score @s mr_t_warps matches 6 run function ${MINE_RANK_NS}:warp_plot`,
    `execute if score @s mr_t_warps matches 7 run function ${MINE_RANK_NS}:warp_home`,
    "scoreboard players set @s mr_t_warps 0",
  ];

  map.menu_warps = [
    tell([tag(), { text: "Warps", color: "#22d3ee", bold: true }]),
    tell([option(" 1. Hub", "mr_t_warps", 2, "#a78bfa")]),
    tell([option(" 2. Minha mina", "mr_t_warps", 3, "#a78bfa")]),
    tell([option(" 3. Lago de pesca", "mr_t_warps", 4, "#a78bfa")]),
    tell([option(" 4. Arena da expedição", "mr_t_warps", 5, "#a78bfa")]),
    tell([option(" 5. Meu terreno", "mr_t_warps", 6, "#a78bfa")]),
    tell([option(" 6. Casa (terreno ou hub)", "mr_t_warps", 7, "#a78bfa")]),
  ];

  map.warp_hub = [
    `tp @s ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
  ];

  map.warp_mine = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você ainda não tem terreno.", color: "red" },
    ])}`,
    ...plotTeleports(MINE_RANK_BASE_Y),
  ];

  map.warp_pond = [
    `tp @s ${MINE_RANK_POND.x} ${MINE_RANK_POND.y} ${MINE_RANK_POND.z}`,
  ];

  map.warp_arena = [
    `tp @s ${MINE_RANK_ARENA.x} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}`,
  ];

  map.warp_plot = [
    `execute if score @s mr_plot matches 0 run ${tell([
      tag(),
      { text: "Você ainda não tem terreno.", color: "red" },
    ])}`,
    ...plotTeleports(MINE_RANK_DECK_Y + 1, 2),
  ];

  map.warp_home = [
    `execute if score @s mr_plot matches 0 run tp @s ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
    ...plotTeleports(MINE_RANK_DECK_Y + 1, 2),
  ];

  map.cmd_spawn = [
    `tp @s ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
    "scoreboard players set @s mr_t_spawn 0",
  ];

  map.cmd_home = [
    `execute if score @s mr_plot matches 0 run tp @s ${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}`,
    ...plotTeleports(MINE_RANK_DECK_Y + 1, 2),
    "scoreboard players set @s mr_t_home 0",
  ];

  map.cmd_help = [
    tell([tag(), { text: "Regras do Mine Rank", color: "#22d3ee", bold: true }]),
    tell([
      { text: " 1. Reserve um terreno: ", color: "gray" },
      { text: "/trigger mr_t_plot_auto", color: "#a78bfa" },
    ]),
    tell([
      { text: " 2. Minere na sua mina: ", color: "gray" },
      { text: "/trigger mr_t_mine_go", color: "#a78bfa" },
    ]),
    tell([
      { text: " 3. Cada bloco dá 1 coin e 1 level; a cada ", color: "gray" },
      { text: `${MINE_RANK_MINE_RESET_BLOCKS} blocos`, color: "#fbbf24" },
      { text: " a mina se restaura.", color: "gray" },
    ]),
    tell([
      { text: " 4. Prestígio no level ", color: "gray" },
      { text: String(MINE_RANK_PRESTIGE_LEVEL), color: "#fbbf24" },
      { text: ": +1 coin por bloco, para sempre.", color: "gray" },
    ]),
    tell([
      { text: " A lista completa de comandos está no COMMANDS.md do datapack.", color: "dark_gray" },
    ]),
    "scoreboard players set @s mr_t_help 0",
  ];

  return map;
}

// ---------------------------------------------------------------------------
// System functions (mining, kills, playtime, fishing)
// ---------------------------------------------------------------------------

/** The ores the player can sell at the market. */
const SELLABLE_ORE_KEYS = new Set(["coal", "iron", "gold", "diamond"]);

/**
 * The player objectives that start at zero.
 *
 * A player who just joined has NO score at all — and `execute if score @s
 * mr_plot matches 0` is FALSE for a score that does not exist. Without this
 * initialization every "you have no plot / no clan" branch would be dead
 * code. The datapack has no join event, so the tick initializes whoever is
 * missing the `mr_ready` tag.
 */
const PLAYER_ZERO_OBJECTIVES = [
  "mr_level",
  "mr_prestige",
  "mr_coins",
  "mr_tokens",
  "mr_rubies",
  "mr_cash",
  "mr_blocks",
  "mr_bonus",
  "mr_mine_used",
  "mr_plot",
  "mr_clan",
  "mr_fish",
  "mr_fish_lvl",
  "mr_fish_next",
  "mr_fishing",
  "mr_minutes",
  "mr_pt_pending",
  "mr_last_pt",
  "mr_kill_pending",
  "mr_tp_pending",
  "mr_tp_sent",
  "mr_ore_coal",
  "mr_ore_iron",
  "mr_ore_gold",
  "mr_ore_diamond",
  ...MINED_STATISTICS.map((stat) => `mr_last_${stat.key}`),
  "mr_last_kills",
] as const;

function systemFunctions(): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  map.init_player = [
    "# a player who just joined has no scores — every `matches 0` needs them",
    ...PLAYER_ZERO_OBJECTIVES.map(
      (objective) => `scoreboard players set @s ${objective} 0`,
    ),
    "scoreboard players set @s mr_rank 1",
    "tag @s add mr_ready",
  ];

  map.collect_blocks = [
    "# @s = player — read the REAL vanilla mined statistics through a delta",
    "# (the player statistics stay intact: we never drain them)",
    ...MINED_STATISTICS.flatMap((stat) => {
      const lines = [
        `execute unless score @s mr_last_${stat.key} matches 0.. run scoreboard players set @s mr_last_${stat.key} 0`,
        `scoreboard players operation @s mr_tmp = @s mr_s_${stat.key}`,
        `scoreboard players operation @s mr_tmp -= @s mr_last_${stat.key}`,
        `scoreboard players operation @s mr_last_${stat.key} = @s mr_s_${stat.key}`,
        `scoreboard players operation @s mr_blocks += @s mr_tmp`,
      ];
      if (SELLABLE_ORE_KEYS.has(stat.key)) {
        lines.push(`scoreboard players operation @s mr_ore_${stat.key} += @s mr_tmp`);
      }
      return lines;
    }),
  ];

  map.award_blocks = [
    "# @s = player — the blocks mined since the last tick",
    "scoreboard players operation @s mr_coins += @s mr_blocks",
    "scoreboard players operation @s mr_level += @s mr_blocks",
    "# prestige bonus: one extra coin per block for each prestige point",
    "scoreboard players operation @s mr_bonus = @s mr_prestige",
    `execute if score @s mr_bonus matches 1.. run function ${MINE_RANK_NS}:bonus_step`,
    "# server counters",
    "scoreboard players operation #mr_tot_blocks mr_tot_blocks += @s mr_blocks",
    "scoreboard players operation #mr_hype mr_hype += @s mr_blocks",
    "# the private mine",
    "scoreboard players operation @s mr_mine_used += @s mr_blocks",
    "scoreboard players set @s mr_blocks 0",
    `execute if score @s mr_level matches 100.. run function ${MINE_RANK_NS}:check_tier`,
    `execute if score @s mr_mine_used matches ${MINE_RANK_MINE_RESET_BLOCKS}.. run function ${MINE_RANK_NS}:restore_my_mine`,
  ];

  map.bonus_step = [
    "scoreboard players operation @s mr_coins += @s mr_blocks",
    "scoreboard players remove @s mr_bonus 1",
    `execute if score @s mr_bonus matches 1.. run function ${MINE_RANK_NS}:bonus_step`,
  ];

  map.check_tier = [
    "# recompute the tier from the level",
    `execute if score @s mr_level matches ${MINE_RANK_PRESTIGE_LEVEL}.. run scoreboard players set @s mr_tmp 8`,
    "execute if score @s mr_level matches 950..999 run scoreboard players set @s mr_tmp 7",
    "execute if score @s mr_level matches 800..949 run scoreboard players set @s mr_tmp 6",
    "execute if score @s mr_level matches 650..799 run scoreboard players set @s mr_tmp 5",
    "execute if score @s mr_level matches 450..649 run scoreboard players set @s mr_tmp 4",
    "execute if score @s mr_level matches 250..449 run scoreboard players set @s mr_tmp 3",
    "execute if score @s mr_level matches 100..249 run scoreboard players set @s mr_tmp 2",
    "execute if score @s mr_level matches 0..99 run scoreboard players set @s mr_tmp 1",
    "# diff = new tier - old tier",
    "scoreboard players operation @s mr_tmp2 = @s mr_tmp",
    "scoreboard players operation @s mr_tmp2 -= @s mr_rank",
    `execute if score @s mr_tmp2 matches 1.. run function ${MINE_RANK_NS}:tier_up`,
  ];

  map.tier_up = [
    "scoreboard players operation @s mr_rank = @s mr_tmp",
    "scoreboard players add @s mr_coins 50",
    "scoreboard players add @s mr_tokens 5",
    "execute if score @s mr_rank matches 3 run give @s minecraft:iron_chestplate 1",
    "execute if score @s mr_rank matches 5 run give @s minecraft:golden_chestplate 1",
    "execute if score @s mr_rank matches 7 run give @s minecraft:diamond_chestplate 1",
    broadcast([
      tag(),
      { selector: "@s", color: "#a78bfa" },
      { text: " subiu de tier! Bônus: +50 coins e +5 tokens.", color: "#22d3ee" },
    ]),
    'title @s title [{"text":"TIER NOVO!","color":"#fbbf24","bold":true}]',
    "playsound minecraft:entity.player.levelup master @s ~ ~ ~ 0.6 1.1",
  ];

  map.collect_kills = [
    "# @s = player — kills come from the REAL vanilla statistic",
    "execute unless score @s mr_last_kills matches 0.. run scoreboard players set @s mr_last_kills 0",
    "scoreboard players operation @s mr_tmp = @s mr_s_kills",
    "scoreboard players operation @s mr_tmp -= @s mr_last_kills",
    "scoreboard players operation @s mr_last_kills = @s mr_s_kills",
    "scoreboard players operation @s mr_kill_pending += @s mr_tmp",
  ];

  map.award_kill = [
    "scoreboard players operation @s mr_rubies += @s mr_kill_pending",
    "scoreboard players operation @s mr_cash += @s mr_kill_pending",
    "scoreboard players set @s mr_kill_pending 0",
  ];

  map.collect_playtime = [
    "# @s = player — play time comes from the REAL vanilla statistic (ticks)",
    "execute unless score @s mr_last_pt matches 0.. run scoreboard players set @s mr_last_pt 0",
    "scoreboard players operation @s mr_tmp = @s mr_playtime",
    "scoreboard players operation @s mr_tmp -= @s mr_last_pt",
    "scoreboard players operation @s mr_last_pt = @s mr_playtime",
    "scoreboard players operation @s mr_pt_pending += @s mr_tmp",
    `execute if score @s mr_pt_pending matches ${MINE_RANK_FISHING_TICKS}.. run function ${MINE_RANK_NS}:playtime_minute`,
  ];

  map.playtime_minute = [
    `scoreboard players remove @s mr_pt_pending ${MINE_RANK_FISHING_TICKS}`,
    "scoreboard players add @s mr_minutes 1",
  ];

  map.playtime_reward = [
    "scoreboard players remove @s mr_minutes 60",
    "scoreboard players add @s mr_coins 25",
    "scoreboard players add @s mr_rubies 1",
    tell([
      tag(),
      { text: "1 hora online! +25 coins e +1 rubi.", color: "#22d3ee" },
    ]),
  ];

  map.restore_my_mine = [
    "scoreboard players set @s mr_mine_used 0",
    ...plotCalls("reset_plot"),
    "scoreboard players add @s mr_rubies 1",
    tell([
      tag(),
      { text: "Sua mina foi restaurada! +1 rubi.", color: "#22d3ee" },
    ]),
  ];

  map.fishing_done = [
    "scoreboard players set @s mr_fishing 0",
    "scoreboard players add @s mr_fish 1",
    "scoreboard players add @s mr_coins 10",
    "scoreboard players add @s mr_tokens 2",
    "scoreboard players operation @s mr_tmp = @s mr_fish",
    "scoreboard players operation @s mr_tmp -= @s mr_fish_next",
    `execute if score @s mr_tmp matches 0.. run function ${MINE_RANK_NS}:fish_level_up`,
    tell([
      tag(),
      { text: "Sessão de pesca encerrada: +1 peixe, +10 coins e +2 tokens.", color: "#22d3ee" },
    ]),
  ];

  map.fish_level_up = [
    "scoreboard players add @s mr_fish_lvl 1",
    `scoreboard players add @s mr_fish_next ${MINE_RANK_FISH_PER_LEVEL}`,
    "scoreboard players add @s mr_rubies 1",
    tell([
      tag(),
      { text: "Nível de pesca subiu! +1 rubi.", color: "#fbbf24" },
    ]),
  ];

  return map;
}

// ---------------------------------------------------------------------------
// load / tick
// ---------------------------------------------------------------------------

function loadLines(): string[] {
  const lines: string[] = [
    "# Mine Rank — setup (generated by VOXEL · vanilla 1.20.1)",
    "scoreboard objectives add mr_level dummy \"Mine Rank — level\"",
    "scoreboard objectives add mr_rank dummy \"Mine Rank — tier\"",
    "scoreboard objectives add mr_prestige dummy \"Mine Rank — prestige\"",
    "scoreboard objectives add mr_coins dummy \"Mine Rank — coins\"",
    "scoreboard objectives add mr_tokens dummy \"Mine Rank — tokens\"",
    "scoreboard objectives add mr_rubies dummy \"Mine Rank — rubies\"",
    "scoreboard objectives add mr_cash dummy \"Mine Rank — cash\"",
    "scoreboard objectives add mr_blocks dummy \"Mine Rank — blocks pending\"",
    "scoreboard objectives add mr_bonus dummy \"Mine Rank — prestige bonus\"",
    "scoreboard objectives add mr_mine_used dummy \"Mine Rank — blocks in mine\"",
    "scoreboard objectives add mr_plot dummy \"Mine Rank — plot\"",
    "scoreboard objectives add mr_plot_used dummy \"Mine Rank — plot reserved\"",
    "scoreboard objectives add mr_clan dummy \"Mine Rank — clan\"",
    "scoreboard objectives add mr_clan_used dummy \"Mine Rank — clan slot\"",
    "scoreboard objectives add mr_fish dummy \"Mine Rank — fish\"",
    "scoreboard objectives add mr_fish_lvl dummy \"Mine Rank — fishing level\"",
    "scoreboard objectives add mr_fish_next dummy \"Mine Rank — fishing goal\"",
    "scoreboard objectives add mr_fishing dummy \"Mine Rank — fishing session\"",
    "scoreboard objectives add mr_minutes dummy \"Mine Rank — minutes online\"",
    "scoreboard objectives add mr_pt_pending dummy \"Mine Rank — playtime pending\"",
    "scoreboard objectives add mr_pt_last dummy \"Mine Rank — playtime checkpoint\"",
    "scoreboard objectives add mr_kill_pending dummy \"Mine Rank — kills pending\"",
    "scoreboard objectives add mr_tp_pending dummy \"Mine Rank — teleport request\"",
    "scoreboard objectives add mr_tp_sent dummy \"Mine Rank — teleport sent\"",
    "scoreboard objectives add mr_notice dummy \"Mine Rank — notice counter\"",
    "scoreboard objectives add mr_online dummy \"Mine Rank — players online\"",
    "scoreboard objectives add mr_tot_blocks dummy \"Mine Rank — server blocks\"",
    "scoreboard objectives add mr_hype dummy \"Mine Rank — hype train\"",
    "scoreboard objectives add mr_const dummy \"Mine Rank — constants\"",
    "scoreboard objectives add mr_tmp dummy \"Mine Rank — temporary\"",
    "scoreboard objectives add mr_tmp2 dummy \"Mine Rank — temporary 2\"",
    "scoreboard objectives add mr_ore_coal dummy \"Mine Rank — coal to sell\"",
    "scoreboard objectives add mr_ore_iron dummy \"Mine Rank — iron to sell\"",
    "scoreboard objectives add mr_ore_gold dummy \"Mine Rank — gold to sell\"",
    "scoreboard objectives add mr_ore_diamond dummy \"Mine Rank — diamond to sell\"",
    "# the real vanilla statistics (read through a delta, never drained)",
    ...MINED_STATISTICS.map(
      (stat) =>
        `scoreboard objectives add mr_s_${stat.key} minecraft.mined:${stat.item} "Mined ${stat.key}"`,
    ),
    "scoreboard objectives add mr_s_kills minecraft.custom:minecraft.player_kills \"Player kills\"",
    "scoreboard objectives add mr_playtime minecraft.custom:minecraft.play_time \"Play time\"",
    "# checkpoints of the statistics",
    ...MINED_STATISTICS.map(
      (stat) => `scoreboard objectives add mr_last_${stat.key} dummy`,
    ),
    "scoreboard objectives add mr_last_kills dummy",
    "scoreboard objectives add mr_last_pt dummy",
    "# the player commands (the only surface vanilla gives us)",
    ...MINE_RANK_COMMANDS.map(
      (command) =>
        `scoreboard objectives add ${command.trigger} trigger "${command.description.slice(0, 32)}"`,
    ),
    "# server-side counters",
    "scoreboard players set #mr_const mr_const 1200",
    "scoreboard players set #mr_k1000 mr_const 1000",
    "scoreboard players set #mr_hype mr_hype 0",
    "scoreboard players set #mr_tot_blocks mr_tot_blocks 0",
    "scoreboard players set #mr_notice mr_notice 0",
    "scoreboard players set #mr_online mr_online 0",
    "# the world",
    `function ${MINE_RANK_NS}:build_world`,
    broadcast([
      tag(),
      { text: `Mine Rank ativo — ${MINE_RANK_COMMANDS.length} comandos, ${MINE_RANK_PLOTS} terrenos. Use /trigger mr_t_help.`, color: "gray" },
    ]),
  ];
  return lines;
}

function tickLines(): string[] {
  const lines: string[] = [
    "# Mine Rank — every tick",
    "scoreboard players set #mr_online mr_online 0",
    "execute as @a run scoreboard players add #mr_online mr_online 1",
    "# enable the player commands",
    ...MINE_RANK_COMMANDS.map((command) => `scoreboard players enable @a ${command.trigger}`),
    "# a player who just joined starts with zeroes (the datapack has no join event)",
    `execute as @a[tag=!mr_ready] run function ${MINE_RANK_NS}:init_player`,
    "# mining",
    `execute as @a at @s run function ${MINE_RANK_NS}:collect_blocks`,
    `execute as @a[scores={mr_blocks=1..}] at @s run function ${MINE_RANK_NS}:award_blocks`,
    "# kills",
    `execute as @a at @s run function ${MINE_RANK_NS}:collect_kills`,
    `execute as @a[scores={mr_kill_pending=1..}] at @s run function ${MINE_RANK_NS}:award_kill`,
    "# play time",
    `execute as @a at @s run function ${MINE_RANK_NS}:collect_playtime`,
    `execute as @a[scores={mr_minutes=60..}] at @s run function ${MINE_RANK_NS}:playtime_reward`,
    "# fishing session",
    `execute as @a[scores={mr_fishing=1}] at @s run function ${MINE_RANK_NS}:fishing_done`,
    "execute as @a[scores={mr_fishing=1..}] run scoreboard players remove @s mr_fishing 1",
    "# route the commands",
    ...MINE_RANK_COMMANDS.map(
      (command) =>
        `execute as @a[scores={${command.trigger}=1..}] at @s run function ${MINE_RANK_NS}:${command.fn}`,
    ),
  ];
  return lines;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Generates the complete Mine Rank datapack: the pack manifest, the load/tick
 * tags, every mcfunction, the procedural world and the command reference.
 */
export function generateMineRankFiles(): GeneratedFile[] {
  const commands = commandFunctions();
  const system = systemFunctions();

  const missing = MINE_RANK_COMMANDS.filter((command) => !commands[command.fn]);
  if (missing.length > 0) {
    throw new Error(
      `Mine Rank: comandos sem implementação: ${missing.map((command) => command.fn).join(", ")}`,
    );
  }

  const files: GeneratedFile[] = [
    dataFile(
      "pack.mcmeta",
      JSON.stringify(
        {
          pack: {
            pack_format: 15,
            description: `VOXEL module: mine rank (${MINE_RANK_COMMANDS.length} commands)`,
          },
        },
        null,
        2,
      ),
    ),
    dataFile(
      "data/minecraft/tags/functions/load.json",
      JSON.stringify({ values: [`${MINE_RANK_NS}:load`] }, null, 2),
    ),
    dataFile(
      "data/minecraft/tags/functions/tick.json",
      JSON.stringify({ values: [`${MINE_RANK_NS}:tick`] }, null, 2),
    ),
    functionFile("load", loadLines()),
    functionFile("tick", tickLines()),
    functionFile("build_world", buildWorldLines()),
  ];

  for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
    files.push(functionFile(`build_plot_${plot}`, buildPlotLines(plot)));
    files.push(functionFile(`reset_plot_${plot}`, resetPlotLines(plot)));
  }

  for (const [name, lines] of Object.entries(commands)) {
    files.push(functionFile(name, lines));
  }
  for (const [name, lines] of Object.entries(system)) {
    files.push(functionFile(name, lines));
  }

  files.push(dataFile("COMMANDS.md", mineRankCommandsMarkdown()));
  files.push(dataFile("README.md", mineRankReadme()));

  return files;
}

// ---------------------------------------------------------------------------
// The reference shipped with the datapack
// ---------------------------------------------------------------------------

/** How each NerdZone command maps to the Mine Rank (own variation). */
const NERDZONE_COMPARISON: Array<{ nz: string; mineRank: string; note: string }> = [
  {
    nz: "/mina · /mina ir · /mina resetar",
    mineRank: "mr_t_mine · mr_t_mine_go · mr_t_mine_reset",
    note: "menu, teleporte e restauração da mina privada",
  },
  { nz: "/picareta", mineRank: "mr_t_pickaxe", note: "picareta com eficiência e unbreaking III" },
  {
    nz: "/prestigio",
    mineRank: "mr_t_prestige",
    note: `prestígio no level ${MINE_RANK_PRESTIGE_LEVEL} (+1 coin por bloco)`,
  },
  {
    nz: "/resumo · /boosters · /armadura",
    mineRank: "mr_t_summary · mr_t_boosters · mr_t_armor",
    note: "mesma função, dados reais do servidor",
  },
  {
    nz: "/p auto · /p claim · /p h · /p add · /p remove · /p deny",
    mineRank: "mr_t_plot_auto · mr_t_plot_claim · mr_t_plot_home · mr_t_plot_add · mr_t_plot_del · mr_t_plot_deny",
    note: "o acesso fica registrado por tag (o vanilla recusa `team join` dentro de um datapack); o alvo é o jogador mais próximo",
  },
  {
    nz: "/money · /tokens · /rubi · /cash",
    mineRank: "mr_t_money · mr_t_tokens · mr_t_rubies · mr_t_cash",
    note: "as mesmas quatro moedas",
  },
  {
    nz: "/money top",
    mineRank: "mr_t_top",
    note: "totais reais do servidor (o vanilla não ordena jogadores)",
  },
  { nz: "/leilao", mineRank: "mr_t_market", note: "venda de minérios por coins" },
  { nz: "/loja", mineRank: "mr_t_shop", note: "loja com itens por coins" },
  {
    nz: "/pesca · /peixes · /niveis",
    mineRank: "mr_t_fishing · mr_t_fish · mr_t_fish_lvl",
    note: "sessão de pesca com recompensa por tempo",
  },
  {
    nz: "/saque",
    mineRank: "mr_t_raid",
    note: "arena de mobs — cada abate rende 1 rubi e 1 cash",
  },
  {
    nz: "/clan",
    mineRank: "mr_t_clan",
    note: "8 slots de clan (Clan 1..8) com registro de membros por tag",
  },
  {
    nz: "/hypetrain",
    mineRank: "mr_t_hype",
    note: "multiplicador global por blocos minerados no servidor",
  },
  {
    nz: "/tempo",
    mineRank: "mr_t_playtime",
    note: "tempo online medido pelo statistic vanilla",
  },
  {
    nz: "/g · /tell · /r",
    mineRank: "mr_t_chat_g · mr_t_chat_tell · mr_t_chat_r",
    note: "frases prontas — o vanilla não tem texto livre",
  },
  {
    nz: "/tpa · /tpaccept · /tpadeny · /tpacancel",
    mineRank: "mr_t_tpa · mr_t_tp_ok · mr_t_tp_no · mr_t_tp_cancel",
    note: "o alvo é o jogador mais próximo",
  },
  {
    nz: "/warps · /spawn · /sethome · /home",
    mineRank: "mr_t_warps · mr_t_spawn · mr_t_home",
    note: "sethome livre exige plugin — no vanilla a casa é o seu terreno",
  },
  { nz: "/duvidas", mineRank: "mr_t_help", note: "as regras dentro do jogo" },
  {
    nz: "/figurinhas · /colmeia · /brainrot · /spawners · /autoclick · /redstone · /explorar · /bosses · /kits · /habilidades · /lixeira · /armazem · /vips · /ativarkey · /proteger",
    mineRank: "—",
    note: "sistemas de plugin: fora do alcance de um datapack vanilla (registrados no roadmap)",
  },
];

/** The command reference that ships inside the datapack (COMMANDS.md). */
export function mineRankCommandsMarkdown(): string {
  const lines: string[] = [];

  lines.push("# Mine Rank — referência de comandos");
  lines.push("");
  lines.push(
    "> Datapack `nexus_rank`, gerado pelo VOXEL. Este arquivo lista **todos** os comandos que o servidor responde.",
  );
  lines.push("");
  lines.push("## Como usar");
  lines.push("");
  lines.push(
    "No Minecraft 1.20.1 puro o único comando de jogador é `/trigger`. Por isso cada comando do Mine Rank é um `/trigger` com um número:",
  );
  lines.push("");
  lines.push("```");
  lines.push("/trigger mr_t_mine set 1");
  lines.push("```");
  lines.push("");
  lines.push(
    "Os menus do chat são clicáveis — cada botão já executa o `/trigger` certo. Digitar `/trigger <objetivo>` sem valor conta como **1** (abrir o menu).",
  );
  lines.push("");
  lines.push("## Regras");
  lines.push("");
  lines.push("- 1 bloco minerado = **1 level** + **1 coin** (+1 coin por prestígio).");
  lines.push(
    `- ${MINE_RANK_MINE_RESET_BLOCKS} blocos na sua mina → a mina é restaurada (+1 rubi). Restaurar na mão custa ${MINE_RANK_MINE_RESET_COST} coins.`,
  );
  lines.push(
    `- Prestígio no level ${MINE_RANK_PRESTIGE_LEVEL}: volta ao level 0, +5 rubies, +1 cash, +10 tokens e **+1 coin por bloco para sempre**.`,
  );
  lines.push(
    `- ${MINE_RANK_PLOTS} terrenos (cada um com 8 camadas de minério) e ${MINE_RANK_CLAN_SLOTS} slots de clan.`,
  );
  lines.push(
    "- O alvo dos comandos sociais é **sempre o jogador mais próximo**: o vanilla não aceita digitar um nick.",
  );
  lines.push(
    "- O acesso de construção (`p add` / `p remove` / `p deny`) e a filiação de cada clan ficam **registrados por tag** (`mr_trust_N`, `mr_deny_N`, `mr_clan_N`): o vanilla recusa `team join` dentro de um datapack, porque o nome do time é validado quando a função é lida — antes de o `load` criar o time.",
  );
  lines.push("");
  lines.push("## Limites do vanilla (o que este datapack NÃO faz)");
  lines.push("");
  lines.push(
    "- **Não impede a construção**: o vanilla puro não tem proteção de terreno — o registro de acesso serve para o dono do terreno saber quem tem acesso, e a trava real exige plugin.",
  );
  lines.push(
    "- **Não tem texto livre**: chat, pedidos e nomes de clan viraram menus e frases prontas.",
  );
  lines.push(
    "- **Não tem ranking de jogadores**: `money top` mostra os totais reais do servidor (blocos minerados, hype, online).",
  );
  lines.push(
    "- **Não tem nome livre de clan**: existem 8 slots fixos (Clan 1..8).",
  );
  lines.push("");
  lines.push("## Tiers");
  lines.push("");
  lines.push("| # | Tier | Level mínimo | Recompensa |");
  lines.push("| --- | --- | --- | --- |");
  for (const tier of MINE_RANK_TIERS) {
    lines.push(`| ${tier.index} | ${tier.name} | ${tier.minLevel} | ${tier.reward} |`);
  }
  lines.push("");
  lines.push("## Moedas");
  lines.push("");
  lines.push("| Moeda | Símbolo | Como se ganha |");
  lines.push("| --- | --- | --- |");
  for (const currency of MINE_RANK_CURRENCIES) {
    lines.push(`| ${currency.name} | ${currency.symbol} | ${currency.earns} |`);
  }
  lines.push("");

  const families = Object.keys(MINE_RANK_FAMILY_LABELS) as MineRankFamily[];
  for (const family of families) {
    const commands = MINE_RANK_COMMANDS.filter((command) => command.family === family);
    if (commands.length === 0) continue;
    lines.push(`## ${MINE_RANK_FAMILY_LABELS[family]}`);
    lines.push("");
    lines.push("| Comando | Vanilla | O que faz | Observação |");
    lines.push("| --- | --- | --- | --- |");
    for (const command of commands) {
      const id = command.args.length > 0 ? `${command.id} ${command.args.join(" ")}` : command.id;
      lines.push(
        `| \`${id}\` | \`/trigger ${command.trigger}\` | ${command.description} | ${command.note ?? "—"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Comparação com o Rankup de referência (nerdzone.gg)");
  lines.push("");
  lines.push(
    "O Mine Rank é uma variação própria: a referência pública (`nerdzone.gg/guia`) mostrou o conjunto de comandos do Rankup e o que significam. Aqui está o que cada comando virou — e o que o vanilla não permite.",
  );
  lines.push("");
  lines.push("| Rankup (referência) | Mine Rank | Como ficou |");
  lines.push("| --- | --- | --- |");
  for (const row of NERDZONE_COMPARISON) {
    lines.push(`| \`${row.nz}\` | \`${row.mineRank}\` | ${row.note} |`);
  }
  lines.push("");
  lines.push("## O mundo");
  lines.push("");
  lines.push(`- **Hub** (spawn): \`${MINE_RANK_HUB.x} ${MINE_RANK_HUB.y} ${MINE_RANK_HUB.z}\``);
  for (let plot = 1; plot <= MINE_RANK_PLOTS; plot += 1) {
    const { x, z } = mineRankPlotCenter(plot);
    lines.push(
      `- **Terreno ${plot}**: deck em \`${x} ${MINE_RANK_DECK_Y} ${z + 2}\` · shaft de \`${x} ${MINE_RANK_BASE_Y} ${z}\` até \`${x} ${MINE_RANK_MINE_FLOOR_Y} ${z}\``,
    );
  }
  lines.push(`- **Lago de pesca**: \`${MINE_RANK_POND.x} ${MINE_RANK_POND.y} ${MINE_RANK_POND.z}\``);
  lines.push(`- **Arena da expedição**: \`${MINE_RANK_ARENA.x} ${MINE_RANK_ARENA.y} ${MINE_RANK_ARENA.z}\``);
  lines.push("");
  lines.push(
    `Tudo fica a no máximo **5 chunks** do hub: um teleporte longo faz o vanilla carregar o corredor inteiro de chunks e travar o servidor (foi medido: 48 chunks = ~45s de tick travado).`,
  );
  lines.push("");
  lines.push(
    "As camadas da mina, de cima para baixo: " +
      MINE_RANK_ORE_LAYERS.map((ore) => ore.replace("_ore", "")).join(" → ") +
      ".",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/** The short README that ships with the datapack. */
export function mineRankReadme(): string {
  const lines: string[] = [];
  lines.push("# Mine Rank (nexus_rank)");
  lines.push("");
  lines.push(
    "Sistema de progressão estilo Rankup escrito pelo VOXEL para Minecraft 1.20.1 puro — sem plugin, sem macro, sem texto livre.",
  );
  lines.push("");
  lines.push(`- **${MINE_RANK_COMMANDS.length} comandos** de jogador (todos em \`/trigger\`, com menus clicáveis).`);
  lines.push(`- **${MINE_RANK_TIERS.length} tiers** de level, prestígio no level ${MINE_RANK_PRESTIGE_LEVEL}.`);
  lines.push(`- **${MINE_RANK_CURRENCIES.length} moedas**: Coins, Tokens, Rubies e Cash.`);
  lines.push(`- **${MINE_RANK_PLOTS} terrenos** com 8 camadas de minério cada, restaurados sozinhos.`);
  lines.push(`- **${MINE_RANK_CLAN_SLOTS} slots de clan** (registro de membros por tag).`);
  lines.push("");
  lines.push("A lista completa dos comandos está no [COMMANDS.md](./COMMANDS.md).");
  lines.push("");
  lines.push(
    "Licença: conteúdo original do VOXEL. Inspirado no estilo Rankup público do NerdZone — nenhum código, comando ou arquivo foi copiado.",
  );
  lines.push("");
  return lines.join("\n");
}
