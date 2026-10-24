/**
 * Backup Pro (Super Prompt §21) — retention, integrity and scheduling,
 * with one honesty rule carried everywhere: a scheduled backup only runs
 * when the app is open AND the server is stopped (world safety), and a
 * failed scheduled backup alerts the owner instead of failing silently.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import { notifyDesktop } from "@/services/notifications/notificationService";

// ---------------------------------------------------------------------------
// Types (camelCase mirrors of the Rust perimeter)
// ---------------------------------------------------------------------------

export interface BackupsConfig {
  maxKeep: number;
  maxAgeDays: number;
  scheduleHours: number | null;
}

export const DEFAULT_BACKUPS_CONFIG: BackupsConfig = {
  maxKeep: 0,
  maxAgeDays: 0,
  scheduleHours: null,
};

export interface BackupVerifyReport {
  fileName: string;
  entryCount: number;
  totalBytes: number;
  hasLevelDat: boolean;
  ok: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Stamp parsing (shared with the Security Center's backup age math)
// ---------------------------------------------------------------------------

/** compact_timestamp YYYYMMDD-SSSSS → epoch ms (UTC); null when unparsable. */
export function parseBackupStamp(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{5})$/.exec(stamp.trim());
  if (!m) return null;
  const epoch = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Number(m[4]) * 1000;
  return Number.isFinite(epoch) ? epoch : null;
}

export interface BackupDue {
  due: boolean;
  hoursSince: number | null;
  lastAt: number | null;
}

/**
 * Pure scheduling decision: is a scheduled backup due for this server?
 * - no schedule configured → never due
 * - no backup yet → due (a fresh server with a schedule gets a first safety net)
 * - hours since the newest backup ≥ scheduleHours → due
 */
export function nextBackupDue(
  backups: { createdAt: string }[],
  config: BackupsConfig,
  nowMs: number,
): BackupDue {
  if (config.scheduleHours == null || config.scheduleHours <= 0) {
    return { due: false, hoursSince: null, lastAt: null };
  }
  const newest = backups[0];
  if (!newest) return { due: true, hoursSince: null, lastAt: null };
  const lastAt = parseBackupStamp(newest.createdAt);
  if (lastAt == null) return { due: true, hoursSince: null, lastAt: null };
  const hoursSince = (nowMs - lastAt) / 3_600_000;
  return { due: hoursSince >= config.scheduleHours, hoursSince, lastAt };
}

// ---------------------------------------------------------------------------
// Command wrappers (the Rust perimeter does the real work)
// ---------------------------------------------------------------------------

export async function getBackupsConfig(basePath: string, slug: string): Promise<BackupsConfig> {
  return invoke<BackupsConfig>("server_backups_config_get", { basePath, slug });
}

export async function setBackupsConfig(
  basePath: string,
  slug: string,
  config: BackupsConfig,
): Promise<BackupsConfig> {
  return invoke<BackupsConfig>("server_backups_config_set", { basePath, slug, config });
}

export async function verifyBackup(
  basePath: string,
  slug: string,
  backupPath: string,
): Promise<BackupVerifyReport> {
  return invoke<BackupVerifyReport>("server_backup_verify", { basePath, slug, backupPath });
}

export async function deleteBackup(basePath: string, slug: string, backupPath: string) {
  return invoke<void>("server_backup_delete", { basePath, slug, backupPath });
}

export async function pruneBackups(
  basePath: string,
  slug: string,
  config: BackupsConfig,
): Promise<string[]> {
  return invoke<string[]>("server_backup_prune", { basePath, slug, config });
}

// ---------------------------------------------------------------------------
// The scheduler — a desktop citizen, with its limits on the label
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  listServers: () => Promise<{ slug: string }[]>;
  isRunning: (slug: string) => Promise<boolean>;
  loadConfig: (slug: string) => Promise<BackupsConfig>;
  listBackups: (slug: string) => Promise<{ createdAt: string }[]>;
  backupNow: (slug: string) => Promise<void>;
  notify: (title: string, body: string) => void;
  now: () => number;
}

function defaultDeps(basePath: () => string): SchedulerDeps {
  return {
    listServers: () => listServersReconciled(basePath()),
    isRunning: (slug) => invoke<boolean>("server_status", { slug }).catch(() => false),
    loadConfig: (slug) => getBackupsConfig(basePath(), slug),
    listBackups: (slug) =>
      invoke<{ createdAt: string }[]>("server_list_backups", {
        basePath: basePath(),
        slug,
      }).catch(() => [] as { createdAt: string }[]),
    backupNow: (slug) =>
      invoke("server_backup", { basePath: basePath(), slug }).then(() => undefined),
    notify: (title, body) => void notifyDesktop(title, body),
    now: () => Date.now(),
  };
}

/** One pass over every server — exported so the tests can drive it
 * without waiting for real timers. */
export async function tick(deps: SchedulerDeps): Promise<void> {
  const servers = await deps.listServers().catch(() => []);
  for (const server of servers) {
    const config = await deps.loadConfig(server.slug).catch(() => DEFAULT_BACKUPS_CONFIG);
    if (config.scheduleHours == null) continue;
    // a running server is never backed up — world safety comes first,
    // and that is a skip, not an alert
    if (await deps.isRunning(server.slug)) continue;
    const backups = await deps.listBackups(server.slug);
    if (!nextBackupDue(backups, config, deps.now()).due) continue;
    try {
      await deps.backupNow(server.slug);
    } catch (e) {
      deps.notify(
        "Scheduled backup failed",
        `Server ${server.slug}: ${String(e)}`,
      );
    }
  }
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Boots the scheduled-backup loop (5-minute tick). Runs while the app is
 * open — that is the honest limit, stated on the settings UI. Returns a
 * stop function (tests use it; the app never stops it).
 */
export function startBackupScheduler(
  depsOverride?: Partial<SchedulerDeps> & { basePath?: () => string },
): () => void {
  const deps = {
    ...defaultDeps(depsOverride?.basePath ?? (() => useSettingsStore.getState().settings.storage.basePath)),
    ...depsOverride,
  };
  if (schedulerHandle) return () => undefined; // already running — singleton
  schedulerHandle = setInterval(() => void tick(deps), 5 * 60 * 1000);
  return () => {
    if (schedulerHandle) clearInterval(schedulerHandle);
    schedulerHandle = null;
  };
}
