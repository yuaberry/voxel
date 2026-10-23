/**
 * AI metrics (Model Router v2, §10) — only REAL numbers: every autonomous
 * task records its outcome (model, ok, latency, attempts) into ai_metrics
 * through the SQLite perimeter; the Command Center summarizes success
 * rate, average latency and fallback usage straight from the rows.
 */
import { getDb } from "@/services/db/client";

export interface MetricRow {
  provider: string;
  model: string;
  phase: string | null;
  ok: number;
  latencyMs: number;
  attempts: number;
  taskId: string | null;
  createdAt: string;
}

export async function recordTaskMetric(entry: {
  provider: string;
  model: string;
  phase: string;
  ok: boolean;
  latencyMs: number;
  attempts: number;
  taskId: string;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO ai_metrics (provider, model, phase, ok, latency_ms, attempts, task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entry.provider,
        entry.model,
        entry.phase,
        entry.ok ? 1 : 0,
        Math.round(entry.latencyMs),
        entry.attempts,
        entry.taskId,
      ],
    );
  } catch {
    // metrics are observability — never break a task over them
  }
}

export interface MetricsSummary {
  total: number;
  successRate: number;
  avgLatencyMs: number;
  fallbackUsage: number; // calls that needed more than one attempt
  perModel: Array<{ model: string; calls: number; successRate: number; avgLatencyMs: number }>;
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  try {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM ai_metrics ORDER BY created_at DESC LIMIT 200",
    );
    if (rows.length === 0) {
      return { total: 0, successRate: 0, avgLatencyMs: 0, fallbackUsage: 0, perModel: [] };
    }
    const typed = rows.map((r) => ({
      model: String(r.model),
      ok: Number(r.ok) === 1,
      latencyMs: Number(r.latency_ms ?? 0),
      attempts: Number(r.attempts ?? 1),
    }));
    const okCount = typed.filter((r) => r.ok).length;
    const byModel = new Map<string, { calls: number; ok: number; latency: number }>();
    for (const row of typed) {
      const agg = byModel.get(row.model) ?? { calls: 0, ok: 0, latency: 0 };
      agg.calls += 1;
      agg.ok += row.ok ? 1 : 0;
      agg.latency += row.latencyMs;
      byModel.set(row.model, agg);
    }
    return {
      total: typed.length,
      successRate: okCount / typed.length,
      avgLatencyMs: Math.round(typed.reduce((a, r) => a + r.latencyMs, 0) / typed.length),
      fallbackUsage: typed.filter((r) => r.attempts > 1).length,
      perModel: [...byModel.entries()]
        .map(([model, agg]) => ({
          model,
          calls: agg.calls,
          successRate: agg.ok / agg.calls,
          avgLatencyMs: Math.round(agg.latency / agg.calls),
        }))
        .sort((a, b) => b.calls - a.calls),
    };
  } catch {
    return { total: 0, successRate: 0, avgLatencyMs: 0, fallbackUsage: 0, perModel: [] };
  }
}
