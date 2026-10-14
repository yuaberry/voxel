/**
 * Server style presets — curated, ready-made server configurations.
 *
 * "official" = canonical configurations of the server software itself
 * (vanilla survival, creative workshop, performance-tuned Paper).
 * "community" = beloved community game styles (SkyBlock, Prison, PvP…)
 * expressed through OUR curated properties + the app's own datapack
 * modules — nothing from third-party plugins/packs is redistributed.
 *
 * Properties are validated by the Rust merge (servers.rs) — format-only
 * keys, `online-mode` is never overridable.
 */

export type ServerModuleId = "economy" | "prison" | "token" | "skyblock" | "factions" | "bedwars" | "monuments";

export type ServerPresetCategory = "official" | "community";

export interface ServerStylePreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ServerPresetCategory;
  software: "vanilla" | "paper";
  ramMb: number;
  /** server.properties overrides handed to the Rust create command */
  properties: Record<string, string>;
  /** App datapack modules installed before the first boot */
  modules: ServerModuleId[];
}

export const SERVER_STYLE_PRESETS: readonly ServerStylePreset[] = [
  {
    id: "vanilla-survival",
    name: "Vanilla Survival",
    tagline: "The pure classic",
    description:
      "The unmodified survival experience — normal difficulty, protected spawn, command blocks on. Exactly what a fresh vanilla install should feel like.",
    category: "official",
    software: "vanilla",
    ramMb: 2048,
    properties: {
      motd: "A VOXEL vanilla survival server",
      difficulty: "normal",
      gamemode: "survival",
      "spawn-protection": "16",
      pvp: "true",
    },
    modules: [],
  },
  {
    id: "paper-survival",
    name: "Paper Survival",
    tagline: "Performance-tuned survival",
    description:
      "The recommended survival setup on Paper — tighter view/simulation distance for smooth play with friends, same beloved gameplay.",
    category: "official",
    software: "paper",
    ramMb: 4096,
    properties: {
      motd: "A VOXEL Paper survival server",
      difficulty: "normal",
      "view-distance": "8",
      "simulation-distance": "6",
      "spawn-protection": "0",
    },
    modules: [],
  },
  {
    id: "creative-workshop",
    name: "Creative Workshop",
    tagline: "Building, no friction",
    description:
      "Creative mode, peaceful world, PvP off and an open spawn — a calm canvas for building with friends.",
    category: "official",
    software: "paper",
    ramMb: 2048,
    properties: {
      motd: "A VOXEL creative workshop",
      gamemode: "creative",
      difficulty: "peaceful",
      pvp: "false",
      "spawn-protection": "0",
    },
    modules: [],
  },
  {
    id: "hardcore-realm",
    name: "Hardcore Realm",
    tagline: "One life, no mercy",
    description:
      "Hard difficulty with hardcore mode on — the true one-life challenge for a tight group of players.",
    category: "community",
    software: "vanilla",
    ramMb: 2048,
    properties: {
      motd: "A VOXEL hardcore realm — one life only",
      difficulty: "hard",
      hardcore: "true",
      pvp: "true",
    },
    modules: [],
  },
  {
    id: "skyblock-isles",
    name: "SkyBlock Isles",
    tagline: "A floating island per player, one command away",
    description:
      "Real sky islands: the datapack builds 16 floating islands (platform, starter tree, welcome chest) and /trigger nexus_skyblock claims yours. Coins and the token market complete the economy loop.",
    category: "community",
    software: "paper",
    ramMb: 4096,
    properties: {
      motd: "A VOXEL skyblock — claim your island with /trigger nexus_skyblock",
      difficulty: "normal",
      "spawn-protection": "0",
      pvp: "false",
    },
    modules: ["skyblock", "economy", "token"],
  },
  {
    id: "prison-break",
    name: "Prison Break",
    tagline: "Mine, rank up, prestige",
    description:
      "The prison progression style — mining ranks, warp commands and a working economy with the app's own prison module.",
    category: "community",
    software: "paper",
    ramMb: 4096,
    properties: {
      motd: "A VOXEL prison — mine your way to freedom",
      difficulty: "normal",
      "spawn-protection": "0",
      pvp: "true",
    },
    modules: ["prison", "economy", "token"],
  },
  {
    id: "economy-town",
    name: "Economy Town",
    tagline: "Trade, earn, build",
    description:
      "A town-style server centered on trading and earning — coin economy with deposits and a token-item market.",
    category: "community",
    software: "paper",
    ramMb: 4096,
    properties: {
      motd: "A VOXEL economy town — trade & thrive",
      difficulty: "easy",
      pvp: "false",
      "spawn-protection": "8",
    },
    modules: ["economy", "token"],
  },
  {
    id: "pvp-arena",
    name: "PvP Arena",
    tagline: "Factions, beds and fair fights",
    description:
      "Competitive play with the war systems: colored factions with kill scoring, and the BedWars Lite arena — kit, countdown and bed-break glory. Tuned for responsiveness with a low view distance.",
    category: "community",
    software: "paper",
    ramMb: 4096,
    properties: {
      motd: "A VOXEL PvP arena — /trigger nexus_factions ou /trigger nexus_bedwars",
      difficulty: "hard",
      "view-distance": "6",
      "simulation-distance": "4",
      pvp: "true",
      "spawn-protection": "0",
    },
    modules: ["factions", "bedwars"],
  },
  {
    id: "family-craft",
    name: "Family Craft",
    tagline: "Safe & friendly",
    description:
      "Whitelist-on, easy difficulty, PvP off and a generous protected spawn — a calm server for younger players and friends.",
    category: "community",
    software: "paper",
    ramMb: 2048,
    properties: {
      motd: "A VOXEL family-friendly server",
      difficulty: "easy",
      pvp: "false",
      "white-list": "true",
      "spawn-protection": "32",
    },
    modules: [],
  },
  {
    id: "token-tycoon",
    name: "Token Tycoon",
    tagline: "All-in economy",
    description:
      "Every economy system on at once — coins, the VoxelCoin token chain (SHA-256 ledger) and the prison progression for grind.",
    category: "community",
    software: "paper",
    ramMb: 8192,
    properties: {
      motd: "A VOXEL token tycoon server",
      difficulty: "normal",
      "spawn-protection": "0",
    },
    modules: ["economy", "token", "prison"],
  },
];

export function getServerPreset(id: string): ServerStylePreset | undefined {
  return SERVER_STYLE_PRESETS.find((preset) => preset.id === id);
}
