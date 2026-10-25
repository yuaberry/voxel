/**
 * Analytics local (Phase G) — the tests: the aggregations stay honest with
 * empty data (zeros, never invented bars), the elapsed parser reads only
 * what the build service really writes, medians are real medians, and the
 * daily buckets are zero-filled — the quiet days are honest zeros.
 */
import { describe, expect, it } from "vitest";
import {
  aiInsights,
  buildInsights,
  getInsightsOverview,
  parseBuildSeconds,
  type AiMetricRow,
  type BuildLogRow,
} from "./insightsService";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const buildRow = (
  slug: string,
  level: string,
  message: string,
  ms: number,
): BuildLogRow => ({
  level,
  source: `build:${slug}`,
  message,
  created_at: iso(ms),
});

describe("Analytics local — build aggregation", () => {
  it("parses the elapsed seconds the build service really writes", () => {
    expect(parseBuildSeconds("Build success (build) — 275 lines in 213s")).toBe(213);
    expect(parseBuildSeconds("Build failed (exit 1) — 12 lines in 45s — tail: x")).toBe(45);
    // older entries have no elapsed — honestly absent
    expect(parseBuildSeconds("Build success (build) — 275 lines")).toBeNull();
  });

  it("counts success and failure, rate guarded against zero builds", () => {
    const now = Date.now();
    const rows = [
      buildRow("arena", "info", "ok in 10s", now - 1000),
      buildRow("arena", "error", "failed", now - 2000),
      buildRow("dark", "info", "ok in 30s", now - 3000),
    ];
    const insights = buildInsights(rows, now);
    expect(insights.total).toBe(3);
    expect(insights.success).toBe(2);
    expect(insights.failed).toBe(1);
    expect(insights.successRate).toBeCloseTo(2 / 3);

    const empty = buildInsights([], now);
    expect(empty.total).toBe(0);
    expect(empty.successRate).toBe(0); // no NaN on an empty workspace
    expect(empty.medianSeconds).toBeNull();
  });

  it("fills the 14 daily buckets with honest zeros on quiet days", () => {
    const now = Date.now();
    const rows = [
      buildRow("arena", "info", "ok", now), // today
      buildRow("arena", "error", "no", now - DAY * 5), // five days ago
    ];
    const insights = buildInsights(rows, now);
    expect(insights.byDay).toHaveLength(14);
    expect(insights.byDay[13]).toEqual({ day: iso(now).slice(0, 10), total: 1, failed: 0 });
    expect(insights.byDay[8].total).toBe(1);
    expect(insights.byDay[8].failed).toBe(1);
    const quiet = insights.byDay.filter((d) => d.total === 0);
    expect(quiet).toHaveLength(12); // every quiet day is a real zero
  });

  it("ranks the top projects by build volume", () => {
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => buildRow("arena", "info", "ok", now - i * 1000)),
      buildRow("dark", "info", "ok", now - 10_000),
    ];
    const insights = buildInsights(rows, now);
    expect(insights.topProjects[0]).toEqual({ slug: "arena", total: 5, failed: 0 });
    expect(insights.topProjects).toHaveLength(2);
  });

  it("computes a real median of the elapsed seconds", () => {
    const now = Date.now();
    const rows = [
      buildRow("a", "info", "Build success (build) — 5 lines in 100s", now),
      buildRow("a", "info", "Build success (build) — 5 lines in 200s", now - 1000),
      buildRow("a", "error", "Build failed (exit 1) — 5 lines in 300s", now - 2000),
      buildRow("a", "info", "Build success (build) — 5 lines", now - 3000),
    ];
    expect(buildInsights(rows, now).medianSeconds).toBe(200); // median of [100,200,300]
  });
});

describe("Analytics local — AI aggregation", () => {
  it("rates runs, latency and fallbacks from the real metrics table", () => {
    const now = Date.now();
    const rows: AiMetricRow[] = [
      { provider: "p", model: "m1", ok: 1, latency_ms: 1000, attempts: 1, created_at: iso(now) },
      { provider: "p", model: "m1", ok: 1, latency_ms: 3000, attempts: 1, created_at: iso(now) },
      { provider: "p", model: "m2", ok: 0, latency_ms: 5000, attempts: 2, created_at: iso(now) },
    ];
    const insights = aiInsights(rows);
    expect(insights.runs).toBe(3);
    expect(insights.okRate).toBeCloseTo(2 / 3);
    expect(insights.avgLatencyMs).toBe(3000);
    expect(insights.fallbackRuns).toBe(1); // attempts > 1 = the router retried
    expect(insights.byModel[0].model).toBe("m1");
    expect(insights.byModel[1].okRate).toBe(0);
  });

  it("is all zeros on a fresh install — never NaN", () => {
    const empty = aiInsights([]);
    expect(empty.runs).toBe(0);
    expect(empty.okRate).toBe(0);
    expect(empty.avgLatencyMs).toBe(0);
    expect(empty.fallbackRuns).toBe(0);
    expect(empty.byModel).toEqual([]);
  });
});

describe("Analytics local — the overview over an injected DB", () => {
  it("assembles every panel from real rows and survives empty tables", async () => {
    const db = {
      select: async <T>(sql: string): Promise<T> => {
        if (sql.includes("FROM logs")) return [
          buildRow("arena", "info", "ok in 120s", Date.now()),
        ] as unknown as T;
        if (sql.includes("FROM ai_metrics")) return [
          { provider: "p", model: "m", ok: 1, latency_ms: 800, attempts: 1, created_at: iso(Date.now()) },
        ] as unknown as T;
        if (sql.includes("server_punishments GROUP BY")) return [
          { action: "ban", n: 3 },
          { action: "pardon", n: 1 },
        ] as unknown as T;
        if (sql.includes("automation_runs")) return [
          { action: "restart", detail: "applied: restart issued by automation" },
          { action: "restart", detail: "failed: java missing" },
        ] as unknown as T;
        if (sql.includes("COUNT(*)")) return [{ n: 2 }] as unknown as T;
        return [] as unknown as T;
      },
    };

    const overview = await getInsightsOverview(db as never);
    expect(overview.builds.total).toBe(1);
    expect(overview.builds.medianSeconds).toBe(120);
    expect(overview.ai.runs).toBe(1);
    expect(overview.ai.okRate).toBe(1);
    expect(overview.punishments).toEqual({ total: 4, bans: 3, pardons: 1, kicks: 0 });
    expect(overview.automations.total).toBe(2);
    expect(overview.automations.applied).toBe(1);
    expect(overview.automations.failed).toBe(1);
    expect(overview.automations.skipped).toBe(0);
    expect(overview.counts.projects).toBe(2);
    expect(overview.disk).toBeNull(); // no workspace base in the test env — honest null
  });
});
