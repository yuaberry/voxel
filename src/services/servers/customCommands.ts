/**
 * Custom Commands Studio — the owner's autonomy ask: users design their OWN
 * server commands (message/title/give/teleport/effect/sound/summon and the
 * /convert flow that exchanges mined coins for chain tokens) and the app
 * generates a REAL vanilla datapack, era-honest (1.20.1 format like every
 * server module): triggers route to functions, costs debit the economy
 * scoreboard, cooldowns tick down, summons carry real NBT.
 *
 * Players run them with plain chat — `/trigger` needs no operator rights.
 */

import type { GeneratedFile } from "./serverModules";

export const CUSTOM_NS = "nexus_custom";

export type CommandAction =
  | { kind: "message"; text: string; color?: string }
  | { kind: "title"; text: string; subtitle?: string }
  | { kind: "give"; item: string; count?: number }
  | { kind: "teleport"; x: number; y: number; z: number }
  | { kind: "effect"; effect: string; seconds: number; amplifier?: number }
  | { kind: "sound"; sound: string; volume?: number }
  | {
      kind: "summon";
      mob: string;
      name?: string;
      health?: number;
      heldItem?: string;
      helmet?: string;
      chestplate?: string;
      leggings?: string;
      boots?: string;
    }
  /**
   * The /convert flow the owner designed: exchange the mineable economy
   * coin for tokens of the user's own wallet chain. Tiers are fixed
   * amounts (vanilla datapacks cannot print variable scores into logs —
   * the same honest pattern the Token Chain market uses).
   */
  | { kind: "convert"; tiers: number[] };

export interface CustomCommand {
  /** trigger id — players run `/trigger <id> set <n>`; a-z0-9_ only */
  id: string;
  description: string;
  /** seconds the player must wait between uses (0 = none) */
  cooldownSeconds?: number;
  /** nexus_coin cost (requires the Economy module installed) */
  costCoins?: number;
  actions: CommandAction[];
}

export interface CustomCommandOptions {
  /** true when the Economy module is installed — enables costs + convert */
  hasEconomy: boolean;
}

const TRIG_RE = /^[a-z][a-z0-9_]{1,31}$/;

export function validateTriggerId(id: string): string | null {
  if (!TRIG_RE.test(id)) {
    return "Command id must start with a letter and use only lowercase letters, digits and _";
  }
  return null;
}

function tellraw(text: string, color = "gray"): string {
  const safe = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `tellraw @s [{"text":"${safe}","color":"${color}"}]`;
}

function nbtQuoted(text: string): string {
  // inside NBT single-quoted strings, double quotes live free — only the
  // single quote itself must never appear
  return text.replace(/'/g, "");
}

function summonNbt(action: Extract<CommandAction, { kind: "summon" }>): string {
  const parts: string[] = [];
  if (action.name) {
    parts.push(
      `CustomName:'[{"text":"${nbtQuoted(action.name)}","color":"gold","italic":false}]'`,
      "CustomNameVisible:1b",
    );
  }
  const armor = [
    action.helmet ? `{id:"minecraft:${action.helmet}",Count:1b}` : "{}",
    action.chestplate ? `{id:"minecraft:${action.chestplate}",Count:1b}` : "{}",
    action.leggings ? `{id:"minecraft:${action.leggings}",Count:1b}` : "{}",
    action.boots ? `{id:"minecraft:${action.boots}",Count:1b}` : "{}",
  ].join(",");
  const hand = action.heldItem
    ? `{id:"minecraft:${action.heldItem}",Count:1b}`
    : "{}";
  parts.push(`HandItems:[${hand},{}]`, `ArmorItems:[${armor}]`);
  if (action.health && action.health > 0) {
    // 1.20.1 writes attributes with the capital form
    parts.push(`Attributes:[{Name:"generic.max_health",Base:${action.health}}]`);
  }
  return `summon minecraft:${action.mob} ~ ~ ~ {${parts.join(",")}}`;
}

function actionLines(action: CommandAction, options: CustomCommandOptions): string[] {
  switch (action.kind) {
    case "message":
      return [tellraw(action.text, action.color ?? "gray")];
    case "title": {
      const lines = [`title @s title {"text":"${nbtQuoted(action.text)}","color":"gold"}`];
      if (action.subtitle) {
        lines.push(`title @s subtitle {"text":"${nbtQuoted(action.subtitle)}","color":"gray"}`);
      }
      return lines;
    }
    case "give":
      return [`give @s minecraft:${action.item.replace(/^minecraft:/, "")} ${action.count ?? 1}`];
    case "teleport":
      return [`tp @s ${action.x} ${action.y} ${action.z}`];
    case "effect":
      return [
        `effect give @s minecraft:${action.effect} ${action.seconds} ${action.amplifier ?? 0} true`,
      ];
    case "sound":
      return [
        `playsound minecraft:${action.sound} master @s ~ ~ ~ ${action.volume ?? 1}`,
      ];
    case "summon":
      return [summonNbt(action)];
    case "convert": {
      if (!options.hasEconomy) {
        // honest: convert IS the economy bridge — without the coin it does nothing
        return [tellraw("This server has no economy module — /convert is inactive", "red")];
      }
      const lines: string[] = [];
      for (let i = 0; i < action.tiers.length; i++) {
        const amount = action.tiers[i];
        lines.push(
          `execute if score @s nexus_custom_cvt matches ${i + 1} if score @s nexus_coin matches ${amount}.. run function ${CUSTOM_NS}:cvt_${i + 1}`,
          `execute if score @s nexus_custom_cvt matches ${i + 1} if score @s nexus_coin matches ..${Math.max(amount - 1, 0)} run ${tellraw(
            `Not enough coins — this tier costs ${amount}`,
            "red",
          )}`,
        );
      }
      return lines;
    }
  }
}

function tierFunctions(command: CustomCommand): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const action of command.actions) {
    if (action.kind !== "convert") continue;
    for (let i = 0; i < action.tiers.length; i++) {
      const amount = action.tiers[i];
      files.push({
        path: `world/datapacks/${CUSTOM_NS}/data/${CUSTOM_NS}/functions/cvt_${i + 1}.mcfunction`,
        content: `# convert tier ${i + 1}: ${amount} coins -> ${amount} chain tokens
scoreboard players remove @s nexus_coin ${amount}
scoreboard players set @s nexus_custom_cvt 0
say [VoxelCoin] CONVERT @s ${amount}
${tellraw(`${amount} coins converted — the panel mints your chain tokens`, "green")}
`,
      });
    }
  }
  return files;
}

/**
 * Generates the complete custom-commands datapack. The structure mirrors
 * the Token Chain module exactly (triggers enabled per tick, scores reset
 * on route, say-based intents the panel reads) — 100% vanilla, mixable,
 * namespaced so it never collides with the built-in modules.
 */
export function generateCustomCommandsDatapack(
  commands: CustomCommand[],
  options: CustomCommandOptions,
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  files.push({
    path: `world/datapacks/${CUSTOM_NS}/pack.mcmeta`,
    content: JSON.stringify(
      {
        pack: {
          pack_format: 15, // 1.20.1 — same era as every server module
          description: `Custom commands authored in VOXEL (${commands.length})`,
        },
      },
      null,
      2,
    ),
  });
  files.push({
    path: `world/datapacks/${CUSTOM_NS}/data/minecraft/tags/functions/load.json`,
    content: JSON.stringify({ values: [`${CUSTOM_NS}:load`] }, null, 2),
  });
  files.push({
    path: `world/datapacks/${CUSTOM_NS}/data/minecraft/tags/functions/tick.json`,
    content: JSON.stringify({ values: [`${CUSTOM_NS}:tick`] }, null, 2),
  });

  const loadLines: string[] = ["# custom commands — registered by VOXEL"];
  const tickLines: string[] = [];
  for (const command of commands) {
    const trig = command.id;
    loadLines.push(`scoreboard objectives add ${trig} trigger "${command.description.slice(0, 40)}"`);
    if (command.cooldownSeconds && command.cooldownSeconds > 0) {
      loadLines.push(`scoreboard objectives add ${trig}_cd dummy`);
    }
    tickLines.push(`scoreboard players enable @a ${trig}`);
    if (command.cooldownSeconds && command.cooldownSeconds > 0) {
      tickLines.push(
        `execute as @a[scores={${trig}_cd=1..}] run scoreboard players remove @s ${trig}_cd 1`,
      );
    }
    // convert commands route on the CONVERT trigger set (tier index)
    const hasConvert = command.actions.some((a) => a.kind === "convert");
    if (hasConvert) {
      loadLines.push(`scoreboard objectives add nexus_custom_cvt trigger "Convert"`);
      tickLines.push(`scoreboard players enable @a nexus_custom_cvt`);
      tickLines.push(
        `execute as @a[scores={nexus_custom_cvt=1..}] run function ${CUSTOM_NS}:cmd_${trig}`,
      );
    }
    tickLines.push(`execute as @a[scores={${trig}=1..}] run function ${CUSTOM_NS}:cmd_${trig}`);
  }
  loadLines.push(
    `tellraw @a [{"text":"[VOXEL] ","color":"#9155ff"},{"text":"${commands.length} custom ${commands.length === 1 ? "command" : "commands"} active","color":"gray"}]`,
  );

  files.push({
    path: `world/datapacks/${CUSTOM_NS}/data/${CUSTOM_NS}/functions/load.mcfunction`,
    content: `${loadLines.join("\n")}\n`,
  });
  files.push({
    path: `world/datapacks/${CUSTOM_NS}/data/${CUSTOM_NS}/functions/tick.mcfunction`,
    content: `# routes every trigger, every tick (vanilla pattern)
${tickLines.join("\n")}
`,
  });

  for (const command of commands) {
    files.push(...tierFunctions(command));
    const body: string[] = [`# /trigger ${command.id} — ${command.description}`];
    const hasConvert = command.actions.some((a) => a.kind === "convert");
    if (hasConvert) {
      body.push("scoreboard players set @s nexus_custom_cvt 0");
    }
    body.push(`scoreboard players set @s ${command.id} 0`);

    // cooldown gate: busy players get a notice instead of a silent nothing
    const hasCd = Boolean(command.cooldownSeconds && command.cooldownSeconds > 0);
    // cost gate: the coin is debited only when the balance covers it
    const hasCost = Boolean(
      options.hasEconomy && command.costCoins && command.costCoins > 0,
    );

    const runLines: string[] = [];
    if (hasCost && command.costCoins) {
      runLines.push(
        `scoreboard players remove @s nexus_coin ${command.costCoins}`,
      );
    }
    if (hasCd && command.cooldownSeconds) {
      runLines.push(`scoreboard players set @s ${command.id}_cd ${command.cooldownSeconds}`);
    }
    for (const action of command.actions) {
      if (action.kind === "convert") {
        // convert ROUTES by tier value — the routing (or the honest
        // inactive notice) belongs in the gate function itself
        body.push(...actionLines(action, options));
        continue;
      }
      runLines.push(...actionLines(action, options));
    }

    if (hasCd) {
      body.push(
        `execute if score @s ${command.id}_cd matches 1.. run ${tellraw(
          `Still on cooldown (${command.cooldownSeconds}s)`,
          "red",
        )}`,
      );
    }
    if (hasCost && command.costCoins) {
      body.push(
        `execute if score @s nexus_coin matches ${command.costCoins}.. run function ${CUSTOM_NS}:run_${command.id}`,
        `execute if score @s nexus_coin matches ..${Math.max(command.costCoins - 1, 0)} run ${tellraw(
          `This command costs ${command.costCoins} coins`,
          "red",
        )}`,
      );
    }
    if (hasCd) {
      // cooldown applies after the cost gate — paid players don't pay twice
      body.push(
        `execute if score @s ${command.id}_cd matches ..0 ${
          hasCost
            ? `run execute if score @s nexus_coin matches ${command.costCoins}.. run function ${CUSTOM_NS}:run_${command.id}`
            : `run function ${CUSTOM_NS}:run_${command.id}`
        }`,
      );
    } else if (!hasCost) {
      body.push(`function ${CUSTOM_NS}:run_${command.id}`);
    }

    files.push({
      path: `world/datapacks/${CUSTOM_NS}/data/${CUSTOM_NS}/functions/cmd_${command.id}.mcfunction`,
      content: `${body.join("\n")}\n`,
    });
    files.push({
      path: `world/datapacks/${CUSTOM_NS}/data/${CUSTOM_NS}/functions/run_${command.id}.mcfunction`,
      content: `${runLines.join("\n")}\n`,
    });
  }

  return files;
}

/** The README lines the server docs gain — faithful to the generated pack. */
export function customCommandsDocs(commands: CustomCommand[]): string[] {
  return commands.map((c) => {
    const cost = c.costCoins ? ` (cost: ${c.costCoins} coins)` : "";
    const cd = c.cooldownSeconds ? ` · cooldown ${c.cooldownSeconds}s` : "";
    return `- \`/trigger ${c.id}\` — ${c.description}${cost}${cd}`;
  });
}
