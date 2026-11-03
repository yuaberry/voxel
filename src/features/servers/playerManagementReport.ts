/**
 * Player Management Report (Super Prompt §19).
 *
 * Generates honest reports about player management status:
 * - Player counts by status (whitelisted, banned, opped, never joined)
 * - Security assessment
 * - Recommendations for server owners
 */

import { ManagedPlayer } from "./playerManagementService";

export interface PlayerReport {
  totalPlayers: number;
  byStatus: {
    whitelisted: number;
    banned: number;
    opped: number;
    neverJoined: number;
    total: number;
  };
  security: {
    onlineMode: boolean;
    whitelistEnabled: boolean;
    rconEnabled: boolean;
    backupCount: number;
    newestBackupAgeHours: number | null;
    pluginCount: number;
    riskLevel: "low" | "medium" | "high";
  };
  recommendations: string[];
}

export function generatePlayerReport(
  players: ManagedPlayer[],
  security: {
    onlineMode: boolean;
    whitelistEnabled: boolean;
    rconEnabled: boolean;
    backupCount: number;
    newestBackupAgeHours: number | null;
    pluginCount: number;
  },
): PlayerReport {
  const byStatus = {
    whitelisted: players.filter(p => p.whitelisted).length,
    banned: players.filter(p => p.banned).length,
    opped: players.filter(p => p.opped).length,
    neverJoined: players.filter(p => p.neverJoined).length,
    total: players.length,
  };

  const recommendations: string[] = [];

  if (!security.onlineMode) {
    recommendations.push("Consider enabling online-mode to prevent cracked client access");
  }
  if (!security.whitelistEnabled) {
    recommendations.push("Consider enabling whitelist for private servers");
  }
  if (security.backupCount === 0) {
    recommendations.push("No backups configured - server data is at risk");
  } else if (security.newestBackupAgeHours && security.newestBackupAgeHours > 168) {
    recommendations.push("Backups are older than 7 days - consider more frequent backups");
  }
  if (security.pluginCount === 0) {
    recommendations.push("No plugins installed - consider adding essential plugins like EssentialsX");
  }

  let riskLevel: "low" | "medium" | "high" = "low";
  if (!security.onlineMode || security.backupCount === 0) {
    riskLevel = "high";
  } else if (!security.whitelistEnabled || (security.newestBackupAgeHours && security.newestBackupAgeHours > 72)) {
    riskLevel = "medium";
  }

  return {
    totalPlayers: players.length,
    byStatus,
    security: {
      onlineMode: security.onlineMode,
      whitelistEnabled: security.whitelistEnabled,
      rconEnabled: security.rconEnabled,
      backupCount: security.backupCount,
      newestBackupAgeHours: security.newestBackupAgeHours,
      pluginCount: security.pluginCount,
      riskLevel,
    },
    recommendations,
  };
}

export function generatePlayerCsv(players: ManagedPlayer[]): string {
  const lines = ["Name,UUID,Whitelisted,Banned,Opped,NeverJoined,BanReason"];
  for (const player of players) {
    lines.push(`${player.name},${player.uuid},${player.whitelisted},${player.banned},${player.opped},${player.neverJoined},${player.banReason ?? ""}`);
  }
  return lines.join("\n");
}

export function exportPlayerReport(playerReport: PlayerReport): string {
  const lines: string[] = [];
  lines.push("# Player Management Report");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`Total Players: ${playerReport.totalPlayers}`);
  lines.push(`Whitelisted: ${playerReport.byStatus.whitelisted}`);
  lines.push(`Banned: ${playerReport.byStatus.banned}`);
  lines.push(`Operators: ${playerReport.byStatus.opped}`);
  lines.push(`Never Joined: ${playerReport.byStatus.neverJoined}`);
  lines.push("");
  lines.push("## Security");
  lines.push(`Online Mode: ${playerReport.security.onlineMode ? "Enabled" : "Disabled"}`);
  lines.push(`Whitelist: ${playerReport.security.whitelistEnabled ? "Enabled" : "Disabled"}`);
  lines.push(`RCON: ${playerReport.security.rconEnabled ? "Enabled" : "Disabled"}`);
  lines.push(`Backups: ${playerReport.security.backupCount}`);
  if (playerReport.security.newestBackupAgeHours) {
    lines.push(`Newest Backup: ${Math.round(playerReport.security.newestBackupAgeHours)} hours ago`);
  }
  lines.push(`Plugins: ${playerReport.security.pluginCount}`);
  lines.push(`Risk Level: ${playerReport.security.riskLevel}`);
  lines.push("");
  lines.push("## Recommendations");
  for (const rec of playerReport.recommendations) {
    lines.push(`- ${rec}`);
  }
  return lines.join("\n");
}
