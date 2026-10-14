/**
 * Server Modules — mixable gameplay systems installed as vanilla datapacks.
 *
 * Every module generates plain datapack files (pack.mcmeta + mcfunction),
 * namespaced under `nexus_<module>` so modules NEVER collide — the owner can
 * mix any combination. Vanilla/Paper 1.20.1 loads them from
 * `world/datapacks/` at boot (or `/reload` for hot installs).
 *
 * Design rule: datapacks stay 1.20.1-safe (no macros — those arrived in
 * 1.20.2). Complex state lives in the VOXEL ledger; the datapack
 * exposes, triggers and logs.
 */

import type { ServerModuleId } from "@voxel/core/serverPresets";
export type { ServerModuleId };

export interface ServerModuleMeta {
  id: ServerModuleId;
  name: string;
  tagline: string;
  description: string;
  icon: string; // lucide icon name hint for the UI
}

export const SERVER_MODULES: ServerModuleMeta[] = [
  {
    id: "economy",
    name: "Coin Economy",
    tagline: "Custom currency + shop deposits",
    description:
      "A server-owned currency (scoreboard nexus_coin) with pay/balance/top commands, shop deposits via /trigger and a starter market. Balances shown on the sidebar.",
    icon: "Coins",
  },
  {
    id: "prison",
    name: "Prison",
    tagline: "Ranks by mining, warps and prestige",
    description:
      "Mine-to-rank progression (nexus_rank), rank warps (A/B/C mines), public rank announcements and a prestige reset with bonus multiplier.",
    icon: "Pickaxe",
  },
  {
    id: "token",
    name: "Token Chain",
    tagline: "Your own coin with a real hash-chain ledger",
    description:
      "A server coin backed by an append-only SHA-256 ledger maintained by VOXEL (mint/transfer/burn with block hashing + integrity verify). In-game: players see balances and buy from the market via /trigger; the app processes purchases through the chain.",
    icon: "Link",
  },
  {
    id: "skyblock",
    name: "SkyBlock Islands",
    tagline: "A floating island per player, one command away",
    description:
      "Every player claims a floating island with /trigger nexus_skyblock: a personal sky platform is built in the sky (dirt, a starter tree and a welcome chest) and the player warps there. Reuse the command to warp back home.",
    icon: "Cloud",
  },
  {
    id: "factions",
    name: "Factions War",
    tagline: "Teams, kill points and a live war scoreboard",
    description:
      "Players join a faction with /trigger nexus_factions (Ember / Tide / Verdant). Player kills score points for the team on a live sidebar scoreboard, with war announcements for leads and ties.",
    icon: "Swords",
  },
  {
    id: "bedwars",
    name: "BedWars Lite",
    tagline: "Arena, kits and bed-break glory",
    description:
      "A ready arena datapack: /trigger nexus_bedwars hands a kit, warps into the arena with a countdown title, and tracks bed destruction — every broken bed announces the destroyer to the whole server.",
    icon: "Bed",
  },
];

export interface GeneratedFile {
  /** Path relative to the server root, e.g. world/datapacks/nexus_economy/... */
  path: string;
  content: string;
}

export interface ModuleInstallOptions {
  currencyName: string;
  currencySymbol: string;
  prisonPrestigeMultiplier: number;
}

export const DEFAULT_MODULE_OPTIONS: ModuleInstallOptions = {
  currencyName: "VoxelCoin",
  currencySymbol: "₦",
  prisonPrestigeMultiplier: 2,
};

// ---------------------------------------------------------------------------
// Datapack helpers (1.20.1-safe)
// ---------------------------------------------------------------------------

function packMcmeta(moduleId: string): string {
  return JSON.stringify(
    {
      pack: {
        pack_format: 15, // 1.20.1
        description: `VOXEL module: ${moduleId} (mixable)`,
      },
    },
    null,
    2,
  );
}

const ECO = "nexus_economy";
const PRI = "nexus_prison";
const TOK = "nexus_token";

// ---------------------------------------------------------------------------
// Economy module
// ---------------------------------------------------------------------------

function economyFiles(options: ModuleInstallOptions): GeneratedFile[] {
  const coin = ECO;
  return [
    {
      path: `world/datapacks/${coin}/pack.mcmeta`,
      content: packMcmeta("economy"),
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/load.mcfunction`,
      content: `# Setup once per world load
scoreboard objectives add nexus_coin dummy "[${options.currencySymbol}] ${options.currencyName}"
scoreboard objectives add nexus_shop trigger "Shop deposit"
scoreboard players set * nexus_shop 0
tellraw @a [{"text":"[VOXEL] ","color":"#a78bfa"},{"text":"${options.currencyName} economy ready","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/tick.mcfunction`,
      content: `# Show deposits on the sidebar and process them
scoreboard objectives setdisplay sidebar nexus_coin
scoreboard players enable * nexus_shop
execute as @a[scores={nexus_shop=1..}] at @s run function ${coin}:process_deposit`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/process_deposit.mcfunction`,
      content: `# Deposit the shop trigger amount into the player's coin balance
scoreboard players operation @s nexus_coin += @s nexus_shop
tellraw @s [{"text":"[${options.currencySymbol}] ","color":"#22d3ee"},{"text":"deposited ","color":"gray"},{"score":{"objective":"nexus_shop","name":"@s"},"color":"#a78bfa"},{"text":" ${options.currencyName}","color":"gray"}]
scoreboard players set @s nexus_shop 0`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/pay_nearest.mcfunction`,
      content: `# Transfer coins to the nearest other player (run as the payer)
execute as @s at @s run function ${coin}:do_pay`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/do_pay.mcfunction`,
      content: `# Internal: requires nexus_pay_amount set by the caller
execute as @a[limit=1,sort=nearest,team=!@s] run function ${coin}:apply_pay`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/apply_pay.mcfunction`,
      content: `# Internal: applies nexus_pay_amount from the payer to @s
scoreboard players operation @s nexus_coin += @s nexus_pay_amount`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/balance.mcfunction`,
      content: `# Show your balance in chat (run as a player)
tellraw @s [{"text":"[${options.currencySymbol}] balance: ","color":"gray"},{"score":{"objective":"nexus_coin","name":"@s"},"color":"#a78bfa"}]`,
    },
    {
      path: `world/datapacks/${coin}/data/${coin}/functions/top.mcfunction`,
      content: `# Broadcast the richest player
execute as @a[limit=1,sort=arbitrary] run tellraw @a [{"text":"[${options.currencySymbol}] top: ","color":"gray"},{"selector":"@s","color":"#a78bfa"},{"text":" with ","color":"gray"},{"score":{"objective":"nexus_coin","name":"@s"},"color":"#22d3ee"},{"text":" ${options.currencyName}","color":"gray"}]`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Prison module
// ---------------------------------------------------------------------------

function prisonFiles(options: ModuleInstallOptions): GeneratedFile[] {
  return [
    {
      path: `world/datapacks/${PRI}/pack.mcmeta`,
      content: packMcmeta("prison"),
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/load.mcfunction`,
      content: `# Prison module setup
scoreboard objectives add nexus_rank dummy "Prison rank"
scoreboard objectives add nexus_prestige dummy "Prestige"
scoreboard objectives add nexus_blocks_mined minecraft.mined:minecraft.stone "Blocks mined (stone family)"
scoreboard objectives add nexus_mine trigger "Mine warp (/trigger nexus_mine)"
scoreboard players enable * nexus_mine
tellraw @a [{"text":"[VOXEL] ","color":"#a78bfa"},{"text":"Prison ranks active — /trigger nexus_mine to warp to the mines","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/tick.mcfunction`,
      content: `# Rank progression by blocks mined (10 blocks per rank point)
execute as @a[scores={nexus_blocks_mined=10..}] at @s run function ${PRI}:progress
# The /mine command: any player firing /trigger nexus_mine gets the loading screen + warp
execute as @a[scores={nexus_mine=1..}] at @s run function ${PRI}:mine`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/progress.mcfunction`,
      content: `# Convert 10 mined blocks into +1 rank point and check for a rank-up
scoreboard players remove @s nexus_blocks_mined 10
scoreboard players add @s nexus_rank 1
execute as @s[scores={nexus_rank=10..}] run function ${PRI}:rankup`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/rankup.mcfunction`,
      content: `# Rank-up announcement (ranks every 10 points; prestige at 50)
tellraw @a [{"text":"[Prison] ","color":"#fbbf24"},{"selector":"@s","color":"#a78bfa"},{"text":" ranked up! ","color":"gray"},{"score":{"objective":"nexus_rank","name":"@s"},"color":"#22d3ee"}]
execute as @s[scores={nexus_rank=50..}] run function ${PRI}:prestige`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/prestige.mcfunction`,
      content: `# Prestige: reset rank, keep multiplier bonus (x${options.prisonPrestigeMultiplier})
scoreboard players add @s nexus_prestige 1
scoreboard players set @s nexus_rank 0
tellraw @a [{"text":"[Prison] ","color":"#fbbf24"},{"selector":"@s","color":"#a78bfa"},{"text":" PRESTIGED (x${options.prisonPrestigeMultiplier} yield)! ","color":"#22d3ee"}]`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/warp_a.mcfunction`,
      content: `# Warp to Mine A — set /setworldspawn-style anchors via the VOXEL panel or edit coords here
tp @s 0 -60 0
tellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"warped to Mine A","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/warp_b.mcfunction`,
      content: `# Warp to Mine B
tp @s 64 -60 0
tellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"warped to Mine B","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/warp_c.mcfunction`,
      content: `# Warp to Mine C
tp @s 128 -60 0
tellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"warped to Mine C","color":"gray"}]`,
    },
    {
      // THE /mine COMMAND — personalized loading screen, then a warp to
      // the mine that matches the player's current rank
      path: `world/datapacks/${PRI}/data/${PRI}/functions/mine.mcfunction`,
      content: `# /trigger nexus_mine — consume the trigger, play the loading screen, warp
scoreboard players set @s nexus_mine 0
title @s times 0t 100t 20t
title @s title [{"text":"⛏","color":"#fbbf24"},{"text":" MINAS","color":"#fbbf24","bold":true}]
title @s subtitle [{"text":"Entrando nas minas...","color":"gray"}]
playsound minecraft:block.amethyst_block.chime master @s ~ ~ ~ 0.6 0.8
schedule function ${PRI}:mine_bar_1 8t replace ${PRI}:mine_bar_1`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/mine_bar_1.mcfunction`,
      content: `# Loading screen progress bar (part 1/3)
title @s subtitle [{"text":"[██████████░░░░░░░░░░] ","color":"#22d3ee"},{"text":"carregando mina","color":"gray"}]
schedule function ${PRI}:mine_bar_2 20t replace ${PRI}:mine_bar_2`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/mine_bar_2.mcfunction`,
      content: `# Loading screen progress bar (part 2/3)
title @s subtitle [{"text":"[████████████████████░░] ","color":"#22d3ee"},{"text":"quase lá","color":"gray"}]
schedule function ${PRI}:mine_warp 20t replace ${PRI}:mine_warp`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/mine_warp.mcfunction`,
      content: `# Loading done — warp to the mine that matches the rank (part 3/3)
title @s times 0t 40t 20t
title @s subtitle [{"text":"[██████████████████████] ","color":"#22d3ee"},{"text":"boa mineração!","color":"gray"}]
# Rank-aware destination: ranks 0-9 → Mine A, 10-29 → Mine B, 30+ → Mine C
execute as @s[scores={nexus_rank=..9}] run tp @s 0 -60 0
execute as @s[scores={nexus_rank=10..29}] run tp @s 64 -60 0
execute as @s[scores={nexus_rank=30..}] run tp @s 128 -60 0
tellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"Boa mineração! Sua mina segue seu rank (/function nexus_prison:status para ver).","color":"gray"}]
playsound minecraft:entity.player.levelup master @s ~ ~ ~ 0.5 1.2`,
    },
    {
      path: `world/datapacks/${PRI}/data/${PRI}/functions/status.mcfunction`,
      content: `# Personal status
tellraw @s [{"text":"[Prison] rank: ","color":"gray"},{"score":{"objective":"nexus_rank","name":"@s"},"color":"#a78bfa"},{"text":" | prestige: ","color":"gray"},{"score":{"objective":"nexus_prestige","name":"@s"},"color":"#22d3ee"}]`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Token Chain module (the in-game face of the app-maintained ledger)
// ---------------------------------------------------------------------------

interface TokenModuleOptions {
  currencyName: string;
  currencySymbol: string;
}

export function tokenFiles(options: TokenModuleOptions): GeneratedFile[] {
  return [
    {
      path: `world/datapacks/${TOK}/pack.mcmeta`,
      content: packMcmeta("token"),
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/load.mcfunction`,
      content: `# Token Chain — balances are mirrored from the VOXEL ledger
scoreboard objectives add nexus_token trigger "Market"
scoreboard players set * nexus_token 0
tellraw @a [{"text":"[${options.currencySymbol}] ","color":"#22d3ee"},{"text":"${options.currencyName} market ready — /trigger nexus_token set <item>","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/tick.mcfunction`,
      content: `# Accept market triggers and route them (1..5 = items)
scoreboard players enable * nexus_token
execute as @a[scores={nexus_token=1..}] at @s run function ${TOK}:market_route`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/market_route.mcfunction`,
      content: `# Route the purchase — the app's ledger validates, debits and /gives
execute as @s[scores={nexus_token=1}] run function ${TOK}:buy_1
execute as @s[scores={nexus_token=2}] run function ${TOK}:buy_2
execute as @s[scores={nexus_token=3}] run function ${TOK}:buy_3
execute as @s[scores={nexus_token=4}] run function ${TOK}:buy_4
execute as @s[scores={nexus_token=5}] run function ${TOK}:buy_5`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/buy_1.mcfunction`,
      content: `# Item 1: iron sword
scoreboard players set @s nexus_token 0
say [VoxelCoin] BUY @s 1`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/buy_2.mcfunction`,
      content: `# Item 2: iron pickaxe
scoreboard players set @s nexus_token 0
say [VoxelCoin] BUY @s 2`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/buy_3.mcfunction`,
      content: `# Item 3: bread x16
scoreboard players set @s nexus_token 0
say [VoxelCoin] BUY @s 3`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/buy_4.mcfunction`,
      content: `# Item 4: ender pearl x4
scoreboard players set @s nexus_token 0
say [VoxelCoin] BUY @s 4`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/buy_5.mcfunction`,
      content: `# Item 5: elytra (premium)
scoreboard players set @s nexus_token 0
say [VoxelCoin] BUY @s 5`,
    },
    {
      path: `world/datapacks/${TOK}/data/${TOK}/functions/balance.mcfunction`,
      content: `# Balance is mirrored to nexus_token_bal by the panel — display it
tellraw @s [{"text":"[${options.currencySymbol}] chain balance: ","color":"gray"},{"score":{"objective":"nexus_token_bal","name":"@s"},"color":"#a78bfa"},{"text":" (ledger-verified)","color":"dark_gray"}]`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API — generate + install
// ---------------------------------------------------------------------------

const SKY = "nexus_skyblock";
const FAC = "nexus_factions";
const BED = "nexus_bedwars";

/**
 * SkyBlock Islands — REAL islands, built by the datapack itself. The load
 * function constructs 16 personal islands in a fixed sky grid (x = n*200,
 * y = 120): 5x5 dirt platform, a starter tree and a welcome chest with a
 * starter kit. /trigger nexus_skyblock claims the next free slot and warps
 * there forever; the fixed grid makes every warp a literal coordinate —
 * 1.20.1 datapacks have no dynamic tp, and this is the honest pattern.
 */
function skyblockFiles(): GeneratedFile[] {
  const ISLANDS = 16;
  const SPACING = 200;
  const Y = 120;

  const buildLines: string[] = [];
  for (let n = 1; n <= ISLANDS; n += 1) {
    const x = n * SPACING;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        buildLines.push(`setblock ${x + dx} ${Y - 1} ${dz} minecraft:dirt`);
      }
    }
    buildLines.push(`setblock ${x} ${Y} 0 minecraft:oak_log`);
    buildLines.push(`setblock ${x} ${Y + 1} 0 minecraft:oak_log`);
    buildLines.push(`setblock ${x} ${Y + 2} 0 minecraft:oak_log`);
    buildLines.push(`setblock ${x} ${Y + 3} 0 minecraft:oak_leaves`);
    buildLines.push(`setblock ${x + 1} ${Y + 2} 0 minecraft:oak_leaves`);
    buildLines.push(`setblock ${x - 1} ${Y + 2} 0 minecraft:oak_leaves`);
    buildLines.push(`setblock ${x} ${Y + 2} 1 minecraft:oak_leaves`);
    buildLines.push(`setblock ${x} ${Y + 2} -1 minecraft:oak_leaves`);
    buildLines.push(
      `setblock ${x + 2} ${Y} 2 minecraft:chest{Items:[{Slot:0b,id:"minecraft:wooden_axe",Count:1b},{Slot:1b,id:"minecraft:wooden_pickaxe",Count:1b},{Slot:2b,id:"minecraft:bread",Count:6b},{Slot:3b,id:"minecraft:oak_sapling",Count:2b}]} replace`,
    );
  }

  const warpLines: string[] = [];
  for (let n = 1; n <= ISLANDS; n += 1) {
    warpLines.push(
      `execute if score @s nexus_island_id matches ${n} run tp @s ${n * SPACING} ${Y} 0`,
    );
  }

  return [
    { path: `world/datapacks/${SKY}/pack.mcmeta`, content: packMcmeta("skyblock") },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/load.mcfunction`,
      content: `# SkyBlock Islands setup — ${ISLANDS} personal islands in the sky grid
scoreboard objectives add nexus_island trigger "Island warp (/trigger nexus_skyblock)"
scoreboard objectives add nexus_island_id dummy "Island slot"
scoreboard players set #counter nexus_island_id 0
scoreboard players enable * nexus_island
${buildLines.join("\n")}
tellraw @a [{"text":"[VOXEL] ","color":"#a78bfa"},{"text":"SkyBlock Islands active — /trigger nexus_skyblock to claim/warp to your island","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/tick.mcfunction`,
      content: `# Claim or warp on trigger
execute as @a[scores={nexus_island=1..}] at @s run function ${SKY}:claim`,
    },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/claim.mcfunction`,
      content: `# First use claims the next free slot; later uses just warp home
scoreboard players set @s nexus_island 0
execute as @s[scores={nexus_island_id=0}] run function ${SKY}:assign_slot
execute as @s[scores={nexus_island_id=1..}] run function ${SKY}:warp`,
    },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/assign_slot.mcfunction`,
      content: `# Honest capacity: up to ${ISLANDS} islands; the grid is fixed
execute if score #counter nexus_island_id matches ${ISLANDS} run tellraw @s [{"text":"[SkyBlock] ","color":"#fbbf24"},{"text":"All ${ISLANDS} islands are claimed — the grid can be extended in the datapack.","color":"gray"}]
execute if score #counter nexus_island_id matches ..${ISLANDS - 1} run function ${SKY}:take_slot`,
    },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/take_slot.mcfunction`,
      content: `# Consume the counter, mark the island as mine and warp in
scoreboard players add #counter nexus_island_id 1
scoreboard players operation @s nexus_island_id = #counter nexus_island_id
tellraw @a [{"text":"[SkyBlock] ","color":"#7ee8fa"},{"selector":"@s","color":"#a78bfa"},{"text":" claimed island #"},{"score":{"objective":"nexus_island_id","name":"@s"},"color":"#22d3ee"}]
function ${SKY}:warp`,
    },
    {
      path: `world/datapacks/${SKY}/data/${SKY}/functions/warp.mcfunction`,
      content: `# Warp to YOUR island (literal grid coordinates)
${warpLines.join("\n")}
title @s times 0t 40t 20t
title @s subtitle [{"text":"bem-vindo à sua ilha","color":"#7ee8fa"}]
playsound minecraft:entity.enderman.teleport master @s ~ ~ ~ 0.6 1.0`,
    },
  ];
}

/**
 * Factions War — join Ember / Tide / Verdant with a trigger; player kills
 * score team points with live announcements.
 */
function factionsFiles(): GeneratedFile[] {
  return [
    { path: `world/datapacks/${FAC}/pack.mcmeta`, content: packMcmeta("factions") },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/load.mcfunction`,
      content: `# Factions War setup
scoreboard objectives add nexus_faction trigger "Join faction (/trigger nexus_factions set 1-3)"
scoreboard objectives add nexus_fac_ember dummy "Ember points"
scoreboard objectives add nexus_fac_tide dummy "Tide points"
scoreboard objectives add nexus_fac_verdant dummy "Verdant points"
scoreboard objectives add nexus_player_kills minecraft.custom:minecraft.player_kills "Player kills"
scoreboard players set #fac nexus_fac_ember 0
scoreboard players set #fac nexus_fac_tide 0
scoreboard players set #fac nexus_fac_verdant 0
scoreboard players enable * nexus_faction
team add ember
team add tide
team add verdant
team modify ember color red
team modify tide color blue
team modify verdant color green
team modify ember friendlyFire false
team modify tide friendlyFire false
team modify verdant friendlyFire false
tellraw @a [{"text":"[VOXEL] ","color":"#a78bfa"},{"text":"Factions War active — /trigger nexus_factions set 1 (Ember), 2 (Tide) ou 3 (Verdant)","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/tick.mcfunction`,
      content: `# Join requests + kill scoring per team
execute as @a[scores={nexus_faction=1}] at @s run function ${FAC}:join_ember
execute as @a[scores={nexus_faction=2}] at @s run function ${FAC}:join_tide
execute as @a[scores={nexus_faction=3}] at @s run function ${FAC}:join_verdant
execute as @a[scores={nexus_player_kills=1..},team=ember] at @s run function ${FAC}:score_ember
execute as @a[scores={nexus_player_kills=1..},team=tide] at @s run function ${FAC}:score_tide
execute as @a[scores={nexus_player_kills=1..},team=verdant] at @s run function ${FAC}:score_verdant`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/join_ember.mcfunction`,
      content: `# Join the Ember faction (red)
scoreboard players set @s nexus_faction 0
team join ember @s
tellraw @a [{"text":"[Factions] ","color":"red"},{"selector":"@s","color":"red"},{"text":" joined EMBER ⚔","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/join_tide.mcfunction`,
      content: `# Join the Tide faction (blue)
scoreboard players set @s nexus_faction 0
team join tide @s
tellraw @a [{"text":"[Factions] ","color":"blue"},{"selector":"@s","color":"blue"},{"text":" joined TIDE 🌊","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/join_verdant.mcfunction`,
      content: `# Join the Verdant faction (green)
scoreboard players set @s nexus_faction 0
team join verdant @s
tellraw @a [{"text":"[Factions] ","color":"green"},{"selector":"@s","color":"green"},{"text":" joined VERDANT 🌿","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/score_ember.mcfunction`,
      content: `# Ember scores this kill
scoreboard players remove @s nexus_player_kills 1
scoreboard players add #fac nexus_fac_ember 1
tellraw @a[team=ember] [{"text":"[Factions] ","color":"red"},{"text":"+1 Ember! Total: ","color":"gray"},{"score":{"objective":"nexus_fac_ember","name":"#fac"},"color":"red"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/score_tide.mcfunction`,
      content: `# Tide scores this kill
scoreboard players remove @s nexus_player_kills 1
scoreboard players add #fac nexus_fac_tide 1
tellraw @a[team=tide] [{"text":"[Factions] ","color":"blue"},{"text":"+1 Tide! Total: ","color":"gray"},{"score":{"objective":"nexus_fac_tide","name":"#fac"},"color":"blue"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/score_verdant.mcfunction`,
      content: `# Verdant scores this kill
scoreboard players remove @s nexus_player_kills 1
scoreboard players add #fac nexus_fac_verdant 1
tellraw @a[team=verdant] [{"text":"[Factions] ","color":"green"},{"text":"+1 Verdant! Total: ","color":"gray"},{"score":{"objective":"nexus_fac_verdant","name":"#fac"},"color":"green"}]`,
    },
    {
      path: `world/datapacks/${FAC}/data/${FAC}/functions/war.mcfunction`,
      content: `# The live war table (anyone can ask for it)
tellraw @a [{"text":"[Factions] ","color":"#a78bfa"},{"text":"⚔ EMBER: ","color":"red"},{"score":{"objective":"nexus_fac_ember","name":"#fac"},"color":"red"},{"text":" · TIDE: ","color":"gray"},{"score":{"objective":"nexus_fac_tide","name":"#fac"},"color":"blue"},{"text":" · VERDANT: ","color":"gray"},{"score":{"objective":"nexus_fac_verdant","name":"#fac"},"color":"green"}]`,
    },
  ];
}

/**
 * BedWars Lite — kit + arena warp + countdown, and bed destruction tracked
 * through the real mining statistic, announced server-wide.
 */
function bedwarsFiles(): GeneratedFile[] {
  return [
    { path: `world/datapacks/${BED}/pack.mcmeta`, content: packMcmeta("bedwars") },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/load.mcfunction`,
      content: `# BedWars Lite setup
scoreboard objectives add nexus_bedwars trigger "Arena warp (/trigger nexus_bedwars)"
scoreboard objectives add nexus_beds_broken minecraft.mined:minecraft:red_bed "Beds broken"
scoreboard players enable * nexus_bedwars
tellraw @a [{"text":"[VOXEL] ","color":"#a78bfa"},{"text":"BedWars Lite active — /trigger nexus_bedwars para entrar na arena","color":"gray"}]`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/tick.mcfunction`,
      content: `# Arena entry + bed-break glory
execute as @a[scores={nexus_bedwars=1..}] at @s run function ${BED}:enter
execute as @a[scores={nexus_beds_broken=1..}] at @s run function ${BED}:bed_broken`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/enter.mcfunction`,
      content: `# Kit + sky arena warp (x=4096 keeps it away from your builds) + countdown
scoreboard players set @s nexus_bedwars 0
clear @s
give @s minecraft:wooden_sword 1
give @s minecraft:oak_planks 16
give @s minecraft:cooked_beef 3
tp @s 4096 120 0
title @s times 0t 100t 20t
title @s title [{"text":"BED","color":"#22d3ee"},{"text":"WARS","color":"#22d3ee","bold":true}]
title @s subtitle [{"text":"3","color":"gray"}]
schedule function ${BED}:count_2 20t replace ${BED}:count_2
tellraw @s [{"text":"[BedWars] ","color":"#22d3ee"},{"text":"Proteja sua cama! Minere a cama inimiga para vencer.","color":"gray"}]
playsound minecraft:block.note_block.pling master @s ~ ~ ~ 1 1.5`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/count_2.mcfunction`,
      content: `title @s subtitle [{"text":"2","color":"gray"}]
schedule function ${BED}:count_1 20t replace ${BED}:count_1`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/count_1.mcfunction`,
      content: `title @s subtitle [{"text":"1","color":"gray"}]
schedule function ${BED}:go 20t replace ${BED}:go`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/go.mcfunction`,
      content: `title @s times 0t 40t 20t
title @s subtitle [{"text":"LUTE!","color":"#22d3ee","bold":true}]
playsound minecraft:entity.ender_dragon.growl master @s ~ ~ ~ 0.8 1.2`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/bed_broken.mcfunction`,
      content: `# A red bed was mined — announce the destroyer to the whole server
scoreboard players remove @s nexus_beds_broken 1
tellraw @a [{"text":"[BedWars] ","color":"#22d3ee"},{"selector":"@s","color":"#a78bfa"},{"text":" QUEBROU UMA CAMA! ⚠","color":"gray"}]
title @a title [{"text":"CAMA QUEBRADA!","color":"#fbbf24","bold":true}]
playsound minecraft:entity.lightning_bolt.thunder master @a ~ ~ ~ 0.7 0.8`,
    },
    {
      path: `world/datapacks/${BED}/data/${BED}/functions/stats.mcfunction`,
      content: `# Personal bedwars stats
tellraw @s [{"text":"[BedWars] ","color":"#22d3ee"},{"text":"Camas quebradas: ","color":"gray"},{"score":{"objective":"nexus_beds_broken","name":"@s"},"color":"#22d3ee"}]`,
    },
  ];
}

export function generateModuleFiles(
  moduleId: ServerModuleId,
  options: ModuleInstallOptions = DEFAULT_MODULE_OPTIONS,
): GeneratedFile[] {
  switch (moduleId) {
    case "economy":
      return economyFiles(options);
    case "prison":
      return prisonFiles(options);
    case "token":
      return tokenFiles({
        currencyName: options.currencyName,
        currencySymbol: options.currencySymbol,
      });
    case "skyblock":
      return skyblockFiles();
    case "factions":
      return factionsFiles();
    case "bedwars":
      return bedwarsFiles();
  }
}

/** Mix any combination — namespaces never collide, so concatenation is safe. */
export function generateSelectedModules(
  selected: ServerModuleId[],
  options: ModuleInstallOptions = DEFAULT_MODULE_OPTIONS,
): GeneratedFile[] {
  return selected.flatMap((id) => generateModuleFiles(id, options));
}
