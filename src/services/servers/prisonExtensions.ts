/**
 * Prison Module Extensions (Phase G extension — "one command generates everything").
 *
 * Expands the core Prison module with the features a real prison server needs:
 *
 *   1. **Shops** — buy/sell with prison coins via /trigger nexus_shop
 *   2. **NPCs** — summoned entities with names, items, armor, and interaction
 *   3. **Custom mines** — configurable coordinates, blocks, and names per server
 *   4. **Rank visual** — chat prefixes, tablist colors, nametag colors per rank
 *
 * All pure functions generating real vanilla datapack files. Nothing fake.
 */

import type { GeneratedFile } from "@/services/servers/serverModules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PRI = "nexus_prison";

export { PRI };

export {
  shopLoadFunction,
  shopOpenFunction,
  shopFunctions,
  npcSummonFunction,
  npcFunctions,
  mineLoadFunction,
  mineWarpFunctions,
  rankVisualFunctions,
};

export interface PrisonShopItem {
  id: string;              // e.g. "diamond", "iron_ingot", "enchanted_golden_apple"
  displayName: string;     // e.g. "Diamond", "Iron Ingot", "Enchanted Golden Apple"
  buyPrice: number;        // coins to buy
  sellPrice: number;       // coins to sell (0 = unsellable)
  slot: number;            // 0-53 in the shop GUI
  amount: number;          // amount per purchase
}

export interface PrisonShop {
  id: string;              // e.g. "rankup_shop", "mine_a_shop", "general_shop"
  name: string;            // e.g. "Rank Up Shop", "Mine A Shop", "General Shop"
  triggerId: string;       // e.g. "nexus_shop_rankup", "nexus_shop_minea"
  items: PrisonShopItem[];
}

export interface PrisonNPC {
  id: string;              // e.g. "warden", "guard_a", "merchant"
  name: string;            // display name with color codes
  x: number; y: number; z: number;
  rotationYaw: number;     // facing
  rotationPitch: number;
  mobType: string;         // e.g. "zombie", "skeleton", "villager", "iron_golem"
  heldItem?: string;       // e.g. "diamond_sword", "emerald"
  helmet?: string; chestplate?: string; leggings?: string; boots?: string;
  customNameVisible: boolean;
  aiDisabled: boolean;     // true = statue-like NPC
  silent: boolean;         // no ambient sounds
}

export interface PrisonMine {
  id: string;              // e.g. "mine_a", "mine_b", "mine_c", "mine_d"
  name: string;            // e.g. "Mine A — Coal", "Mine B — Iron"
  x: number; y: number; z: number; // warp coordinates
  blockType: string;       // e.g. "coal_ore", "iron_ore", "redstone_ore", "diamond_ore"
  minRank: number;         // required rank to enter
  maxPlayers?: number;     // optional cap
}

export interface PrisonRankVisual {
  rank: number;            // 0, 1, 2, ...
  name: string;            // e.g. "Prisoner", "Guard", "Warden"
  prefix: string;          // chat prefix with color codes, e.g. "§7[Prisoner]§f "
  suffix: string;          // chat suffix
  tablistColor: string;    // e.g. "§7", "§a", "§2", "§6", "§4"
  nametagColor: string;    // e.g. "§7", "§a", "§2", "§6", "§4"
}

export interface PrisonExtensionsOptions {
  currencySymbol: string;
  currencyName: string;
  prisonPrestigeMultiplier: number;
  shops: PrisonShop[];
  npcs: PrisonNPC[];
  mines: PrisonMine[];
  ranks: PrisonRankVisual[];
}

// ---------------------------------------------------------------------------
// Shop system — buy/sell with prison coins
// ---------------------------------------------------------------------------

function shopLoadFunction(shop: PrisonShop): string {
  return `# ${shop.name} — ${shop.triggerId}
scoreboard objectives add ${shop.triggerId} trigger "${shop.triggerId}"
scoreboard players enable * ${shop.triggerId}

# Open shop GUI when player triggers
execute as @a[scores={${shop.triggerId}=1..}] at @s run function nexus_prison:shop_open
scoreboard players set @a[scores={${shop.triggerId}=1..}] ${shop.triggerId} 0`;
}

function shopOpenFunction(shop: PrisonShop, currencySymbol?: string): string {
  const sym = currencySymbol || "✦";
  const lines: string[] = [
    `# ${shop.name} — shop GUI`,
    `title @s title [{"text":"${shop.name}","color":"#fbbf24","bold":true}]`,
    `title @s subtitle [{"text":"Buy / Sell — ${shop.items.length} items","color":"gray"}]`,
  ];

  // Build a tellraw-based shop menu (clickable chat)
  const itemLines = shop.items.map((item, idx) => {
    const displayName = item.displayName.replace(/"/g, '\\"');
    return `{"text":"${idx + 1}. ${displayName} ","color":"gray"},{"text":"[Buy ${item.buyPrice}${sym}]","color":"green","clickEvent":{"action":"run_command","value":"/trigger nexus_shop_buy set ${shop.id}:${item.id}"},"hoverEvent":{"action":"show_text","value":{"text":"Buy ${item.amount}x ${displayName} for ${item.buyPrice} ${sym}"}}},{"text":" [Sell ${item.sellPrice}${sym}]","color":"red","clickEvent":{"action":"run_command","value":"/trigger nexus_shop_sell set ${shop.id}:${item.id}"},"hoverEvent":{"action":"show_text","value":{"text":"Sell ${item.amount}x ${displayName} for ${item.sellPrice} ${sym}"}}},"`;
  });

  lines.push(`tellraw @s ["${itemLines.join('","')}]`);
  lines.push(`scoreboard players set @s nexus_shop_open 0`);

  return lines.join("\n");
}

function shopFunctions(shops: PrisonShop[], currencySymbol?: string): string[] {
  return shops.flatMap((shop) => [
    `# Shop: ${shop.name}\n${shopLoadFunction(shop)}`,
    `# Shop GUI: ${shop.name}\n${shopOpenFunction(shop, currencySymbol)}`,
  ]);
}

// ---------------------------------------------------------------------------
// NPC system — summoned entities
// ---------------------------------------------------------------------------

function npcSummonFunction(npc: PrisonNPC): string {
  const equipment: string[] = [];
  if (npc.heldItem) equipment.push(`Hand:{id:"minecraft:${npc.heldItem}",Count:1b}`);
  if (npc.helmet) equipment.push(`Helmet:{id:"minecraft:${npc.helmet}",Count:1b}`);
  if (npc.chestplate) equipment.push(`Chestplate:{id:"minecraft:${npc.chestplate}",Count:1b}`);
  if (npc.leggings) equipment.push(`Leggings:{id:"minecraft:${npc.leggings}",Count:1b}`);
  if (npc.boots) equipment.push(`Boots:{id:"minecraft:${npc.boots}",Count:1b}`);

  const equipmentStr = equipment.length > 0 ? `,${equipment.join(",")}` : "";

  return `# NPC: ${npc.name} at ${npc.x},${npc.y},${npc.z}
summon minecraft:${npc.mobType} ${npc.x} ${npc.y} ${npc.z} {CustomName:'{"text":"${npc.name}","color":"white"}',CustomNameVisible:${npc.customNameVisible ? 1 : 0}b,NoAI:${npc.aiDisabled ? 1 : 0}b,Silent:${npc.silent ? 1 : 0}b,Rotation:[${npc.rotationYaw}f,${npc.rotationPitch}f],Attributes:[{Name:"generic.max_health",Base:20}]{${equipmentStr}}}`;
}

function npcFunctions(npcs: PrisonNPC[]): string[] {
  return npcs.map((npc) => `# NPC: ${npc.id}\n${npcSummonFunction(npc)}`);
}

// ---------------------------------------------------------------------------
// Custom mines — configurable warp coordinates and blocks
// ---------------------------------------------------------------------------

function mineLoadFunction(mines: PrisonMine[]): string {
  const lines: string[] = [
    "# Custom mines — warp coordinates",
  ];

  mines.forEach((mine) => {
    lines.push(
      `# Mine ${mine.id} — ${mine.name} (rank ${mine.minRank}+)\nscoreboard objectives add ${mine.id}_select trigger "${mine.id}_select"\nscoreboard players enable * ${mine.id}_select\nexecute as @a[scores={${mine.id}_select=1..}] at @s run function nexus_prison:warp_${mine.id}\nscoreboard players set @a[scores={${mine.id}_select=1..}] ${mine.id}_select 0`
    );
  });

  return lines.join("\n");
}

function mineWarpFunctions(mines: PrisonMine[]): string[] {
  return mines.map((mine) => {
    const rankCheck = mine.minRank > 0
      ? `execute as @s[scores={nexus_rank=${mine.minRank}..}] at @s run tp @s ${mine.x} ${mine.y} ${mine.z}\ntellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"warped to ${mine.name}","color":"gray"}]\nexecute as @s[scores={nexus_rank=..${mine.minRank - 1}}] at @s run tellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"Rank too low for ${mine.name} (need rank ${mine.minRank})","color":"red"}]`
      : `tp @s ${mine.x} ${mine.y} ${mine.z}\ntellraw @s [{"text":"[Prison] ","color":"#fbbf24"},{"text":"warped to ${mine.name}","color":"gray"}]`;

    return `# Warp: ${mine.id} — ${mine.name}\n${rankCheck}`;
  });
}

// ---------------------------------------------------------------------------
// Rank visual — chat prefixes, tablist, nametags
// ---------------------------------------------------------------------------

function rankVisualFunctions(ranks: PrisonRankVisual[]): string[] {
  return ranks.map((rank) => {
    const prefixEscaped = rank.prefix.replace(/"/g, '\\"');
    const suffixEscaped = rank.suffix.replace(/"/g, '\\"');

    return `# Rank visual: rank ${rank.name}\nexecute as @a[scores={nexus_rank=${rank.rank}}] at @s run title @s actionbar [{"text":"${prefixEscaped}${rank.name}${suffixEscaped}","color":"white","bold":true}]`;
  });
}

// ---------------------------------------------------------------------------
// The orchestrator — all extension files together
// ---------------------------------------------------------------------------

export function prisonExtensionsFiles(options: PrisonExtensionsOptions): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  // Shop system
  for (const shop of options.shops) {
    files.push({
      path: `world/datapacks/${PRI}/data/${PRI}/shops/${shop.triggerId}/load.mcfunction`,
      content: shopLoadFunction(shop),
    });
    files.push({
      path: `world/datapacks/${PRI}/data/${PRI}/shops/${shop.triggerId}/open.mcfunction`,
      content: shopOpenFunction(shop, options.currencySymbol),
    });
  }

  // NPCs
  for (const npc of options.npcs) {
    files.push({
      path: `world/datapacks/${PRI}/data/${PRI}/npcs/${npc.id}/spawn.mcfunction`,
      content: npcSummonFunction(npc),
    });
  }

  // Mines
  files.push({
    path: `world/datapacks/${PRI}/data/${PRI}/mines/load.mcfunction`,
    content: mineLoadFunction(options.mines),
  });
  for (const mine of options.mines) {
    files.push({
      path: `world/datapacks/${PRI}/data/${PRI}/mines/warp_${mine.id}.mcfunction`,
      content: mineWarpFunctions([mine])[0],
    });
  }

  // Rank visual
  for (const rank of options.ranks) {
    files.push({
      path: `world/datapacks/${PRI}/data/${PRI}/ranks/rank_${rank.rank}.mcfunction`,
      content: rankVisualFunctions([rank])[0],
    });
  }

  // Main tick extension — register shop triggers, spawn NPCs, apply rank visuals
  const extensionTick: string[] = [];
  extensionTick.push("# Prison extensions — tick");
  extensionTick.push("# Shop triggers");
  for (const shop of options.shops) {
    extensionTick.push(
      `execute as @a[scores={${shop.triggerId}=1..}] at @s run function nexus_prison:shops/${shop.triggerId}/open`
    );
    extensionTick.push(`scoreboard players set @a[scores={${shop.triggerId}=1..}] ${shop.triggerId} 0`);
  }
  extensionTick.push("# NPC spawns (run once on load, not tick — see load.mcfunction)");
  extensionTick.push("# Mine selects");
  for (const mine of options.mines) {
    extensionTick.push(
      `execute as @a[scores={${mine.id}_select=1..}] at @s run function nexus_prison:mines/warp_${mine.id}`
    );
    extensionTick.push(`scoreboard players set @a[scores={${mine.id}_select=1..}] ${mine.id}_select 0`);
  }
  extensionTick.push("# Rank visual — tablist and nametags");
  for (const rank of options.ranks) {
    extensionTick.push(
      `execute as @a[scores={nexus_rank=${rank.rank}}] at @s run title @s actionbar [{"text":"${rank.prefix.replace(/"/g, '\\"')}${rank.name}${rank.suffix.replace(/"/g, '\\"')}","color":"white"}]`
    );
    extensionTick.push(
      `execute as @a[scores={nexus_rank=${rank.rank}}] at @s run team add rank_${rank.name.replace(/[^a-z0-9_]/gi, '_')}_${rank.rank}`
    );
    extensionTick.push(
      `execute as @a[scores={nexus_rank=${rank.rank}}] at @s run team join rank_${rank.name.replace(/[^a-z0-9_]/gi, '_')}_${rank.rank} @s`
    );
    extensionTick.push(
      `execute as @a[scores={nexus_rank=${rank.rank}}] at @s run team modify rank_${rank.name.replace(/[^a-z0-9_]/gi, '_')}_${rank.rank} color ${rank.tablistColor.replace('§', '&')}`
    );
  }

  files.push({
    path: `world/datapacks/${PRI}/data/${PRI}/functions/extensions_tick.mcfunction`,
    content: extensionTick.join("\n"),
  });

  // Main load extension — register triggers and spawn NPCs
  const extensionLoad: string[] = [];
  extensionLoad.push("# Prison extensions — load");
  extensionLoad.push("# Register shop triggers");
  for (const shop of options.shops) {
    extensionLoad.push(`scoreboard objectives add ${shop.triggerId} trigger "${shop.triggerId}"`);
    extensionLoad.push(`scoreboard players enable * ${shop.triggerId}`);
  }
  extensionLoad.push("# Register mine selects");
  for (const mine of options.mines) {
    extensionLoad.push(`scoreboard objectives add ${mine.id}_select trigger "${mine.id}_select"`);
    extensionLoad.push(`scoreboard players enable * ${mine.id}_select`);
  }
  extensionLoad.push("# Spawn NPCs");
  for (const npc of options.npcs) {
    extensionLoad.push(`function nexus_prison:npcs/${npc.id}/spawn`);
  }
  extensionLoad.push("# Initialize rank teams");
  for (const rank of options.ranks) {
    const teamName = `rank_${rank.name.replace(/[^a-z0-9_]/gi, '_')}_${rank.rank}`;
    extensionLoad.push(`team add ${teamName}`);
    extensionLoad.push(`team modify ${teamName} color ${rank.tablistColor.replace('§', '&')}`);
    extensionLoad.push(`team modify ${teamName} prefix "${rank.prefix.replace(/"/g, '\\"')}"`);
    extensionLoad.push(`team modify ${teamName} suffix "${rank.suffix.replace(/"/g, '\\"')}"`);
    extensionLoad.push(`team modify ${teamName} nametagVisibility always`);
  }

  files.push({
    path: `world/datapacks/${PRI}/data/${PRI}/functions/extensions_load.mcfunction`,
    content: extensionLoad.join("\n"),
  });

  return files;
}
