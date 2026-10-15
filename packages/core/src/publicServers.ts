/**
 * Public server references — famous servers and platforms, each one
 * pointing at the address its own authors publish, so users can explore
 * real live servers and pull their data with the SLP ping. Every entry
 * can be pinged live — an offline entry shows offline, never a lie.
 */

import type { ServerPresetCategory } from "./serverPresets";

export interface PublicServerRef {
  id: string;
  name: string;
  /** The connection address these servers publicly advertise */
  address: string;
  website: string;
  style: string;
  kind: "server" | "platform";
  note: string;
  category: ServerPresetCategory;
}

export const PUBLIC_SERVER_REFS: readonly PublicServerRef[] = [
  {
    id: "hypixel",
    name: "Hypixel",
    address: "mc.hypixel.net",
    website: "https://hypixel.net",
    style: "Minigames mega-server",
    kind: "server",
    note: "The most famous minigames network — BedWars, SkyBlock, Duels.",
    category: "community",
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    address: "play.cubecraft.net",
    website: "https://www.cubecraft.net",
    style: "Minigames + SkyBlock",
    kind: "server",
    note: "Long-running minigames network with a signature arcade feel.",
    category: "community",
  },
  {
    id: "nerdzone",
    name: "NerdZone",
    address: "nerdzone.gg",
    website: "https://nerdzone.gg",
    style: "Prison + crypto chain style",
    kind: "server",
    note: "The YouTuber's prison-style server — the reference for coin + chain progression (import it below to build yours).",
    category: "community",
  },
  {
    id: "minemen",
    name: "Minemen Club",
    address: "minemen.club",
    website: "https://minemen.club",
    style: "Competitive PvP practice",
    kind: "server",
    note: "Practice PvP server — the reference for kit duels and ranks.",
    category: "community",
  },
  {
    id: "minehut",
    name: "Minehut",
    address: "minehut.com",
    website: "https://minehut.com",
    style: "Free server hosting platform",
    kind: "platform",
    note: "Free/cheap public hosting — their lobby answers SLP pings.",
    category: "official",
  },
  {
    id: "aternos",
    name: "Aternos",
    address: "aternos.org",
    website: "https://aternos.org",
    style: "Free hosting platform",
    kind: "platform",
    note: "Free Minecraft hosting — a reference for managed vanilla/Paper setups.",
    category: "official",
  },
  {
    id: "exaroton",
    name: "exaroton",
    address: "exaroton.com",
    website: "https://exaroton.com",
    style: "Pay-as-you-go hosting",
    kind: "platform",
    note: "Flexible paid hosting — good reference for on-demand servers.",
    category: "official",
  },
];
