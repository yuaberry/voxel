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
  }
}

/** Mix any combination — namespaces never collide, so concatenation is safe. */
export function generateSelectedModules(
  selected: ServerModuleId[],
  options: ModuleInstallOptions = DEFAULT_MODULE_OPTIONS,
): GeneratedFile[] {
  return selected.flatMap((id) => generateModuleFiles(id, options));
}
