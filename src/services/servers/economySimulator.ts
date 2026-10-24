/**
 * VOXEL Economy Simulator (Super Prompt §16, Phase D) — deterministic
 * progression math over the REAL module facts. The Prison module pays
 * 1 rank point per 10 mined blocks, ranks up every 10 points (announced),
 * and PRESTIGE at 50 points resets the run with a bonus multiplier —
 * these are the exact rules our production datapack runs. Everything the
 * simulator prints is labeled SIMULATION: projections from parameters,
 * never real player data.
 */
import type { ServerRecord } from "@/types";

export interface SimulatorParams {
  /** blocks the player mines per minute (their grind) */
  blocksPerMinute: number;
  /** the prestige bonus of the installed Prison module (default ×2) */
  prestigeMultiplier: number;
  /** economy: coins per block mined (the module's Economy rate) */
  coinsPerBlock: number;
  /** the user's currency dilution factor (from the Currency designer) */
  dilution: number;
}

export interface RankProjection {
  rank: string;
  pointsAtRankUp: number;
  blocksNeeded: number;
  minutesNeeded: number;
}

export interface SimulationReport {
  /** per-rank climb: 0-9 Mine A, 10-29 Mine B, 30+ Mine C (module facts) */
  ranks: RankProjection[];
  /** minutes until PRESTIGE (50 points) with the multiplier compounding */
  minutesToPrestige: number;
  /** prestige runs modeled (capped at 5 — the compounding is the point) */
  prestigeRuns: Array<{ run: number; multiplier: number; minutes: number; coinsTotal: number }>;
  /** coins minted along the way (module rate) and their DILUTED value */
  coinsAtPrestige: number;
  exploitFindings: string[];
  bottleneck: string;
  disclaimer: string;
}

/** The Prison module's REAL rules — constants of the datapack we ship. */
export const PRISON_RULES = {
  blocksPerPoint: 10,
  pointsPerRankUp: 10,
  pointsPerRankB: 30, // 0-9 Mine A, 10-29 Mine B, 30+ Mine C
  prestigeAt: 50,
} as const;

export function mineForPoints(rank: number): string {
  if (rank < PRISON_RULES.pointsPerRankUp) return "Mine A";
  if (rank < PRISON_RULES.pointsPerRankB) return "Mine B";
  return "Mine C";
}

/**
 * Pure simulation — deterministic in the inputs, tested standalone.
 * Everything divides safely: hostile params produce findings, not crashes.
 */
export function simulateProgression(params: SimulatorParams): SimulationReport {
  const exploitFindings: string[] = [];

  const blocksPerMinute = Math.max(0, params.blocksPerMinute);
  const coinsPerBlock = Math.max(0, params.coinsPerBlock);
  const prestigeMultiplier = params.prestigeMultiplier;

  if (blocksPerMinute <= 0) {
    exploitFindings.push(
      "Blocks per minute is zero or less — nothing to simulate. Set the player's grind rate.",
    );
  }
  if (prestigeMultiplier < 1) {
    exploitFindings.push(
      `Prestige multiplier ${prestigeMultiplier} < 1 — prestiging SLOWS the grind. Players will ignore it; the endgame has no hook.`,
    );
  }
  if (prestigeMultiplier > 10) {
    exploitFindings.push(
      `Prestige multiplier ${prestigeMultiplier} is extreme — one prestige run snowballs the whole progression. Watch for coin inflation (the dilution curve exists for this).`,
    );
  }
  if (coinsPerBlock > 1000) {
    exploitFindings.push(
      "More than 1000 coins per block: the market tiers in the Token Chain module (1-5) will be bypassed in minutes — raise tier prices or lower the rate.",
    );
  }

  // per-rank climb table (the module's literal points → mines mapping)
  const ranks: RankProjection[] = [];
  const blocksPerMinuteSafe = blocksPerMinute || 1; // avoid /0 — findings carry the warning
  for (let rank = 0; rank <= 50; rank += 10) {
    const cumulativeBlocks = (rank + 10) * PRISON_RULES.blocksPerPoint;
    ranks.push({
      rank: `${rank}-${rank + 9} (${mineForPoints(rank)})`,
      pointsAtRankUp: rank + PRISON_RULES.pointsPerRankUp,
      blocksNeeded: cumulativeBlocks,
      minutesNeeded: Math.round(cumulativeBlocks / blocksPerMinuteSafe),
    });
  }

  // prestige runs with the compounding multiplier
  const prestigeRuns: SimulationReport["prestigeRuns"] = [];
  let totalCoins = 0;
  let multiplier = 1;
  for (let run = 1; run <= 5; run++) {
    multiplier *= prestigeMultiplier;
    const effectiveBlocksPerMinute = blocksPerMinuteSafe * multiplier;
    const blocksForRun = PRISON_RULES.prestigeAt * PRISON_RULES.blocksPerPoint;
    const minutes = Math.round(blocksForRun / effectiveBlocksPerMinute);
    totalCoins += blocksForRun * coinsPerBlock;
    prestigeRuns.push({ run, multiplier, minutes, coinsTotal: Math.round(totalCoins) });
  }

  const minutesToPrestige = prestigeRuns[0]?.minutes ?? 0;
  const coinsAtPrestige = PRISON_RULES.prestigeAt * PRISON_RULES.blocksPerPoint * coinsPerBlock;

  const bottleneck =
    prestigeMultiplier <= 1
      ? "The bottleneck IS the prestige: with no multiplier, every run costs the same 500 blocks and the endgame flattens."
      : blocksPerMinute < 20
        ? "The early grind is the bottleneck: under 20 blocks/minute, the first rank-ups feel slow. Consider a starter pickaxe tier."
        : prestigeMultiplier > 10
          ? "Prestige 2+ is the runaway stage: multipliers above ×10 break the pacing after two runs."
          : "Healthy curve: rank-ups every ~" + Math.round((10 * PRISON_RULES.blocksPerPoint) / blocksPerMinuteSafe) + " minutes, prestige compounding present.";

  return {
    ranks,
    minutesToPrestige,
    prestigeRuns,
    coinsAtPrestige,
    exploitFindings,
    bottleneck,
    disclaimer:
      "SIMULATION — projections from your parameters and the module's real rules. No real player data is used or collected.",
  };
}

/** Suggested defaults read from the server's own facts (currency config). */
export function suggestParams(currency: {
  dilution: number;
} | null): SimulatorParams {
  return {
    blocksPerMinute: 30, // an engaged player with an iron pickaxe
    prestigeMultiplier: 2, // the module's default bonus
    coinsPerBlock: 1,
    dilution: currency?.dilution ?? 100000,
  };
}

export function serverLabel(server: ServerRecord): string {
  return `${server.name} (${server.software} ${server.minecraft_version})`;
}
