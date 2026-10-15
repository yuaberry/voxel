/**
 * Style inference — turns live SLP data into a suggested preset, locally
 * and deterministically (keyword heuristics over MOTD/version), plus an
 * optional AI pass that asks the configured provider to design a custom
 * style from the server's real data.
 */

import type { ServerPingData } from "./serverPing";
import {
  getServerPreset,
  SERVER_STYLE_PRESETS,
  type ServerStylePreset,
} from "./serverPresets";

interface Heuristic {
  presetId: string;
  keywords: string[];
}

const HEURISTICS: Heuristic[] = [
  { presetId: "prison-break", keywords: ["prison", "prision", "cell", "rank up", "prestige", "mine your way", "minerar", "penitenciaria"] },
  { presetId: "skyblock-isles", keywords: ["skyblock", "sky block", "island", "oneblock"] },
  { presetId: "economy-town", keywords: ["economy", "economia", "towny", "shop", "loja", "trade", "market", "coin", "moeda", "crypto", "cripto", "chain", "blockchain"] },
  { presetId: "pvp-arena", keywords: ["pvp", "practice", "duel", "arena", "uhc", "kit"] },
  { presetId: "family-craft", keywords: ["family friendly", "family-friendly", "kids", "whitelist"] },
  { presetId: "hardcore-realm", keywords: ["hardcore", "one life"] },
  { presetId: "creative-workshop", keywords: ["creative", "build", "plot", "freebuild"] },
  { presetId: "vanilla-survival", keywords: ["survival", "smp", "semi-vanilla", "vanilla"] },
];

/** Deterministic keyword match over the MOTD text. */
export function inferPresetFromPing(ping: ServerPingData): ServerStylePreset {
  const haystack = `${ping.motd} ${ping.version}`.toLowerCase();
  for (const heuristic of HEURISTICS) {
    if (heuristic.keywords.some((word) => haystack.includes(word))) {
      const preset = getServerPreset(heuristic.presetId);
      if (preset) return preset;
    }
  }
  if (/paper|pufferfish|purpur/i.test(ping.version)) {
    return getServerPreset("paper-survival")!;
  }
  return getServerPreset("vanilla-survival")!;
}

/** A preview-style summary the AI prompt and the UI can share. */
export function describePing(ping: ServerPingData): string {
  const lines = [
    `Address: ${ping.host}:${ping.port}`,
    `Version: ${ping.version} (protocol ${ping.protocol})`,
    `Players: ${ping.playersOnline}/${ping.playersMax}`,
    `MOTD: ${ping.motd}`,
  ];
  if (ping.modsJson) lines.push(`Mods: ${ping.modsJson.slice(0, 400)}`);
  return lines.join("\n");
}

export interface AiStyleSuggestion {
  styleName: string;
  description: string;
  software: "vanilla" | "paper";
  properties: Record<string, string>;
  modules: string[];
  rationale: string;
}

/**
 * Asks the configured AI provider to design a custom server style from
 * the live ping data. Returns a validated suggestion; throws with a
 * clear message when AI is not configured or the answer is unusable.
 */
export async function designStyleWithAi(
  ping: ServerPingData,
  options: {
    sendPrompt: (system: string, user: string) => Promise<string>;
  },
): Promise<AiStyleSuggestion> {
  const system = [
    "You design Minecraft Java server configurations for VOXEL.",
    "You will receive REAL live data from a public server (SLP ping).",
    "Design a local server style inspired by it. Answer ONLY with JSON:",
    `{"styleName":string,"description":string,"software":"vanilla"|"paper",`,
    `"properties":{key:value strings for server.properties},`,
    `"modules":Array<"economy"|"prison"|"token"|"skyblock"|"factions"|"bedwars"|"monuments"|"realm">,"rationale":string}`,
    "Rules: never set online-mode. Keep properties valid for vanilla/Paper.",
    "Prefer 2-8 properties. modules only from the allowed list.",
  ].join(" ");

  const user = describePing(ping);
  const raw = await options.sendPrompt(system, user);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("The AI answer had no JSON object — try again");
  }
  let parsed: AiStyleSuggestion;
  try {
    parsed = JSON.parse(jsonMatch[0]) as AiStyleSuggestion;
  } catch {
    throw new Error("The AI answer was not valid JSON — try again");
  }

  const validModules = new Set(["economy", "prison", "token"]);
  if (!parsed.styleName || typeof parsed.styleName !== "string") {
    throw new Error("The AI answer is missing a style name");
  }
  if (parsed.software !== "vanilla" && parsed.software !== "paper") {
    parsed.software = "paper";
  }
  if (!parsed.properties || typeof parsed.properties !== "object") {
    parsed.properties = {};
  }
  delete parsed.properties["online-mode"];
  parsed.modules = Array.isArray(parsed.modules)
    ? parsed.modules.filter((m) => validModules.has(m))
    : [];
  return parsed;
}

/** All presets, for pickers/tests. */
export const ALL_PRESETS = SERVER_STYLE_PRESETS;
