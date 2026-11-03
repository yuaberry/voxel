// Additional server management utilities for Economy Simulator

import { createHash } from 'crypto';

export interface ServerStats {
  playerCount: number;
  uptime: number;
  tps: number;
  memoryUsage: number;
  cpuUsage: number;
}

export interface ServerConfigSummary {
  configHash: string;
  settings: Record<string, any>;
  recommendedChanges: string[];
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Get comprehensive server statistics for management dashboard
 */
export function getServerStats(serverData: any): ServerStats {
  return {
    playerCount: serverData.playerCount || 0,
    uptime: serverData.uptime || 0,
    tps: Math.min(20, Math.max(0, 20 - (serverData.lagMs || 0) / 50)),
    memoryUsage: serverData.memoryUsage || 0,
    cpuUsage: serverData.cpuUsage || 0,
  };
}

/**
 * Generate server configuration summary for backup/restore
 */
export function generateServerConfigSummary(server: any): ServerConfigSummary {
  const settings = { ...server.settings || {} };
  const recommendedChanges: string[] = [];

  if (!server.properties?.online_mode) {
    recommendedChanges.push("Consider enabling online-mode for security");
  }
  if (server.properties?.max_players && parseInt(server.properties.max_players) > 50) {
    recommendedChanges.push("Consider reducing max players for better performance");
  }

  const configHash = createHash('sha256').update(JSON.stringify(settings)).digest('hex').substring(0, 12);
  return {
    configHash,
    settings,
    recommendedChanges,
  };
}

/**
 * Validate server configuration for common issues
 */
export function validateServerConfig(config: any): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.server?.properties) {
    errors.push("Missing server.properties configuration");
  }

  if (config.server.properties?.online_mode === false) {
    warnings.push("online-mode is disabled - server is vulnerable to cracked clients");
  }

  if (config.server.properties?.max_players && parseInt(config.server.properties.max_players) > 100) {
    warnings.push("High max players may cause performance issues");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
