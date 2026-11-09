/**
 * The site renders the VERY SAME manifest that generates the datapack
 * inside the VOXEL desktop app — one source of truth, no duplicated data.
 */
import {
  MINE_RANK_ARENA,
  MINE_RANK_CLAN_SLOTS,
  MINE_RANK_COMMANDS,
  MINE_RANK_CURRENCIES,
  MINE_RANK_DATAPACK_FILE_COUNT,
  MINE_RANK_DECK_Y,
  MINE_RANK_FAMILY_LABELS,
  MINE_RANK_HUB,
  MINE_RANK_MINE_FLOOR_Y,
  MINE_RANK_MINE_RESET_BLOCKS,
  MINE_RANK_MINE_RESET_COST,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_PLOT_COLUMNS,
  MINE_RANK_PLOT_MARKERS,
  MINE_RANK_PLOT_ORIGIN,
  MINE_RANK_PLOT_SPACING,
  MINE_RANK_POND,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_RAID_MOBS,
  MINE_RANK_TIERS,
  NERDZONE_COMPARISON,
  mineRankPlotCenter,
  type MineRankCommand,
  type MineRankFamily,
} from "@mine-rank";

export {
  MINE_RANK_ARENA,
  MINE_RANK_CLAN_SLOTS,
  MINE_RANK_COMMANDS,
  MINE_RANK_CURRENCIES,
  MINE_RANK_DATAPACK_FILE_COUNT,
  MINE_RANK_DECK_Y,
  MINE_RANK_FAMILY_LABELS,
  MINE_RANK_HUB,
  MINE_RANK_MINE_FLOOR_Y,
  MINE_RANK_MINE_RESET_BLOCKS,
  MINE_RANK_MINE_RESET_COST,
  MINE_RANK_MINE_TOP_Y,
  MINE_RANK_NS,
  MINE_RANK_ORE_LAYERS,
  MINE_RANK_PLOTS,
  MINE_RANK_PLOT_COLUMNS,
  MINE_RANK_PLOT_MARKERS,
  MINE_RANK_PLOT_ORIGIN,
  MINE_RANK_PLOT_SPACING,
  MINE_RANK_POND,
  MINE_RANK_PRESTIGE_LEVEL,
  MINE_RANK_RAID_MOBS,
  MINE_RANK_TIERS,
  NERDZONE_COMPARISON,
  mineRankPlotCenter,
};

export type { MineRankCommand, MineRankFamily };

/**
 * The families in the order the menu shows them.
 *
 * DERIVED from the manifest labels — a hand-written list would silently drift
 * (and break the filters) the day a family is renamed or added.
 */
export const FAMILY_ORDER: MineRankFamily[] = Object.keys(
  MINE_RANK_FAMILY_LABELS,
) as MineRankFamily[];

/**
 * The real vanilla color of each wool block the world uses to mark a plot.
 *
 * Keyed by the block id, so the map can never drift from the world: the site
 * reads the marker list straight from the manifest.
 */
const WOOL_COLORS: Record<string, string> = {
  white_wool: "#e2e8f0",
  orange_wool: "#fb923c",
  magenta_wool: "#e879f9",
  light_blue_wool: "#38bdf8",
  yellow_wool: "#fbbf24",
  lime_wool: "#a3e635",
  pink_wool: "#f472b6",
  light_gray_wool: "#94a3b8",
};

/**
 * The colored marker of each plot — the very same wool blocks the world
 * generator writes (derived, never hand-written).
 */
export const PLOT_COLORS = MINE_RANK_PLOT_MARKERS.map(
  (marker) => WOOL_COLORS[marker] ?? "#94a3b8",
);

/** The proofs measured by the real E2E (vanilla 1.20.1 server). */
export const PROOFS = [
  {
    label: "Comandos do manifesto",
    value: String(MINE_RANK_COMMANDS.length),
    hint: "disparados no servidor real",
  },
  {
    label: "Triggers exercitados",
    value: String(MINE_RANK_COMMANDS.length * 3),
    hint: `${MINE_RANK_COMMANDS.length} comandos × 3 valores`,
  },
  {
    label: "Tiers de progressão",
    value: String(MINE_RANK_TIERS.length),
    hint: `do ${MINE_RANK_TIERS[0].name} ao ${MINE_RANK_TIERS[MINE_RANK_TIERS.length - 1].name}`,
  },
  {
    label: "Moedas",
    value: String(MINE_RANK_CURRENCIES.length),
    hint: MINE_RANK_CURRENCIES.map((currency) => currency.name.toLowerCase()).join(", "),
  },
  {
    label: "Terrenos com mina",
    value: String(MINE_RANK_PLOTS),
    hint: `${MINE_RANK_ORE_LAYERS.length} camadas de minério cada`,
  },
  {
    label: "Clans",
    value: String(MINE_RANK_CLAN_SLOTS),
    hint: `slots fixos (Clan 1..${MINE_RANK_CLAN_SLOTS})`,
  },
];

/** The vanilla behaviours the real E2E proved — the bugs we had to fix. */
export const VANILLA_LESSONS = [
  {
    title: "O NBT do give vai antes do count",
    detail:
      "No 1.20.1 o comando é `give @s item{NBT} 1` — na outra ordem a função nem carrega.",
  },
  {
    title: "team join é impossível num datapack",
    detail:
      "O vanilla valida o nome do time no parse da função, antes do load criar o time. O acesso virou tag.",
  },
  {
    title: "players add só aceita inteiro",
    detail:
      "Somar um score a outro é `scoreboard players operation X obj += Y obj`.",
  },
  {
    title: "Jogador novo não tem score",
    detail:
      "Todo `matches 0` era branch morto. O datapack inicializa o jogador no primeiro tick.",
  },
  {
    title: "Teleporte longo trava o servidor",
    detail:
      "48 chunks de distância = 45s de tick parado. O mundo do Mine Rank é compacto: tudo a 5 chunks.",
  },
  {
    title: "/trigger exige um jogador",
    detail:
      "Do console a resposta é “A player is required”. O E2E usa um cliente de verdade.",
  },
];

/** The honest limits — what a vanilla datapack cannot do. */
export const VANILLA_LIMITS = [
  "Não existe texto livre: chat, pedidos e clans viraram menus e frases prontas.",
  "Não dá para digitar um nick: o alvo dos comandos sociais é o jogador mais próximo.",
  "Não impede construção — o registro de acesso serve para o dono saber quem tem acesso; a trava real exige plugin.",
  "Não existe ranking de jogadores: o painel mostra os totais reais do servidor.",
  "Os nomes de clan são fixos (Clan 1..8) — o vanilla não cria nomes livres.",
];
