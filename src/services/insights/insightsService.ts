/**
 * Analytics local (Super Prompt — Phase G): the honest dashboard over the
 * machine's OWN data. Every number here is measured from the local SQLite
 * and the local disk — builds, agent runs, moderation, automation, disk
 * usage. No telemetry, no uploads, no invented metrics: an empty workspace
 * shows zeros and "no data yet", never fabricated bars.
 */

import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/services/db/client";

// ---------------------------------------------------------------------------
// The DB seam — injectable so the tests run pure aggregations on fixtures
// ---------------------------------------------------------------------------

export interface InsightsDb {
  /** T is the FULL result type (the plugin-sql contract): select<Row[]> */
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildLogRow {
  level: string;
  source: string;
  message: string;
  created_at: string;
}

export interface BuildInsights {
  total: number;
  success: number;
  failed: number;
  /** 0..1 — 0 when there are no builds at all */
  successRate: number;
  /** builds per day, oldest first (14 days incl. empty days) */
  byDay: { day: string; total: number; failed: number }[];
  topProjects: { slug: string; total: number; failed: number }[];
  /** median of parseable elapsed seconds; null when no build reported it */
  medianSeconds: number | null;
}

export interface AiMetricRow {
  provider: string;
  model: string;
  ok: number;
  latency_ms: number;
  attempts: number;
  created_at: string;
}

export interface AiInsights {
  runs: number;
  okRate: number;
  avgLatencyMs: number;
  fallbackRuns: number;
  byModel: { model: string; runs: number; okRate: number }[];
}

export interface CountRow {
  n: number;
}

export interface WorkspaceDiskFacts {
  projectsBytes: number;
  serversBytes: number;
  backupsBytes: number;
  instancesBytes: number;
}

export interface InsightsOverview {
  builds: BuildInsights;
  ai: AiInsights;
  punishments: { total: number; bans: number; pardons: number; kicks: number };
  automations: { total: number; applied: number; failed: number; skipped: number };
  counts: {
    projects: number;
    servers: number;
    instances: number;
    snapshots: number;
    backups: number;
  };
  disk: WorkspaceDiskFacts | null;
}

// ---------------------------------------------------------------------------
// Pure aggregations — the tests drive these directly
// ---------------------------------------------------------------------------

/** "…— 275 lines in 213s" → 213 (seconds the build really took). */
export function parseBuildSeconds(message: string): number | null {
  const m = / in (\d+)s/.exec(message);
  return m ? Number(m[1]) : null;
}

export function buildInsights(rows: BuildLogRow[], nowMs: number): BuildInsights {
  const success = rows.filter((r) => r.level !== "error").length;
  const failed = rows.length - success;

  // 14 daily buckets, oldest first, zero-filled — no invented data, the
  // empty days are honestly empty
  const byDay: { day: string; total: number; failed: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(nowMs - i * 86_400_000);
    const day = date.toISOString().slice(0, 10);
    const dayRows = rows.filter((r) => (r.created_at ?? "").startsWith(day));
    byDay.push({
      day,
      total: dayRows.length,
      failed: dayRows.filter((r) => r.level === "error").length,
    });
  }

  const perProject = new Map<string, { total: number; failed: number }>();
  for (const row of rows) {
    const slug = row.source.replace(/^build:/, "");
    const bucket = perProject.get(slug) ?? { total: 0, failed: 0 };
    bucket.total += 1;
    if (row.level === "error") bucket.failed += 1;
    perProject.set(slug, bucket);
  }

  const seconds = rows
    .map((r) => parseBuildSeconds(r.message))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const medianSeconds =
    seconds.length > 0
      ? seconds.length % 2 === 1
        ? seconds[(seconds.length - 1) / 2]
        : (seconds[seconds.length / 2 - 1] + seconds[seconds.length / 2]) / 2
      : null;

  return {
    total: rows.length,
    success,
    failed,
    successRate: rows.length > 0 ? success / rows.length : 0,
    byDay,
    topProjects: [...perProject.entries()]
      .map(([slug, bucket]) => ({ slug, ...bucket }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    medianSeconds,
  };
}

export function aiInsights(rows: AiMetricRow[]): AiInsights {
  const ok = rows.filter((r) => r.ok === 1).length;
  const byModelMap = new Map<string, { runs: number; ok: number }>();
  for (const row of rows) {
    const bucket = byModelMap.get(row.model) ?? { runs: 0, ok: 0 };
    bucket.runs += 1;
    if (row.ok === 1) bucket.ok += 1;
    byModelMap.set(row.model, bucket);
  }
  return {
    runs: rows.length,
    okRate: rows.length > 0 ? ok / rows.length : 0,
    avgLatencyMs:
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + r.latency_ms, 0) / rows.length)
        : 0,
    fallbackRuns: rows.filter((r) => r.attempts > 1).length,
    byModel: [...byModelMap.entries()]
      .map(([model, b]) => ({ model, runs: b.runs, okRate: b.runs > 0 ? b.ok / b.runs : 0 }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 5),
  };
}

function count(rows: CountRow[]): number {
  return rows.length > 0 ? Number(rows[0].n) : 0;
}

// ---------------------------------------------------------------------------
// The overview — every number measured, nothing invented
// ---------------------------------------------------------------------------

export async function getInsightsOverview(
  dbOverride?: InsightsDb,
): Promise<InsightsOverview> {
  const db: InsightsDb = dbOverride ?? (await getDb());

  const [buildRows, aiRows, automationRows, projects, servers, instances, snapshots, backups] =
    await Promise.all([
      db.select<BuildLogRow[]>(
        "SELECT level, source, message, created_at FROM logs WHERE source LIKE 'build:%' ORDER BY created_at DESC LIMIT 500",
      ).catch(() => [] as BuildLogRow[]),
      db.select<AiMetricRow[]>(
        "SELECT provider, model, ok, latency_ms, attempts, created_at FROM ai_metrics ORDER BY created_at DESC LIMIT 500",
      ).catch(() => [] as AiMetricRow[]),
      db
        .select<{ action: string; detail: string }[]>(
          "SELECT action, detail FROM automation_runs ORDER BY id DESC LIMIT 500",
        )
        .catch(() => [] as { action: string; detail: string }[]),
      db.select<CountRow[]>("SELECT COUNT(*) AS n FROM projects").catch(() => [] as CountRow[]),
      db.select<CountRow[]>("SELECT COUNT(*) AS n FROM servers").catch(() => [] as CountRow[]),
      db.select<CountRow[]>("SELECT COUNT(*) AS n FROM instances").catch(() => [] as CountRow[]),
      db.select<CountRow[]>("SELECT COUNT(*) AS n FROM project_snapshots").catch(() => [] as CountRow[]),
      db.select<CountRow[]>("SELECT COUNT(*) AS n FROM backups").catch(() => [] as CountRow[]),
    ]);

  const punishmentTotals = await db
    .select<{ action: string; n: number }[]>(
      "SELECT action, COUNT(*) AS n FROM server_punishments GROUP BY action",
    )
    .catch(() => [] as { action: string; n: number }[]);
  const byAction = new Map(punishmentTotals.map((r) => [String(r.action), Number(r.n)]));

  let disk: WorkspaceDiskFacts | null = null;
  try {
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const basePath = useSettingsStore.getState().settings.storage.basePath;
    if (basePath) {
      disk = await invoke<WorkspaceDiskFacts>("workspace_disk_facts", { basePath });
    }
  } catch {
    disk = null; // the workspace facts stay honestly absent, not faked
  }

  return {
    builds: buildInsights(buildRows, Date.now()),
    ai: aiInsights(aiRows),
    punishments: {
      total: (byAction.get("ban") ?? 0) + (byAction.get("pardon") ?? 0) + (byAction.get("kick") ?? 0),
      bans: byAction.get("ban") ?? 0,
      pardons: byAction.get("pardon") ?? 0,
      kicks: byAction.get("kick") ?? 0,
    },
    automations: {
      total: automationRows.length,
      applied: automationRows.filter((r) => (r.detail ?? "").startsWith("applied")).length,
      failed: automationRows.filter((r) => (r.detail ?? "").startsWith("failed")).length,
      skipped: automationRows.filter((r) => (r.detail ?? "").startsWith("skipped")).length,
    },
    counts: {
      projects: count(projects),
      servers: count(servers),
      instances: count(instances),
      snapshots: count(snapshots),
      backups: count(backups),
    },
    disk,
  };
}
