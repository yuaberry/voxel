/**
 * Insights (Phase G — Analytics local): the honest dashboard over the
 * machine's own data. Every number is measured from the local SQLite and
 * the local disk — builds, agent runs, moderation, automation, disk usage.
 * No telemetry, no uploads; an empty workspace shows zeros, never bars
 * that were invented to look pretty.
 */
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getInsightsOverview,
  type InsightsOverview,
} from "@/services/insights/insightsService";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / 1_048_576;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="font-mono text-lg font-bold text-primary">{value}</p>
      <p className="text-[11px] text-muted-foreground">
        {label}
        {hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

export function InsightsPage() {
  const [overview, setOverview] = useState<InsightsOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const data = await getInsightsOverview().catch(() => null);
      if (!cancelled) setOverview(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (overview === null) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("Measuring the workspace…")}
      </div>
    );
  }

  const maxDay = Math.max(1, ...overview.builds.byDay.map((d) => d.total));

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Insights")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t(
              "Local data only — every number is measured on this machine from your own database and disk. No telemetry, ever.",
            )}
          </p>
        </div>
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
          {t("0 telemetry")}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t("Builds")}>
          <div className="flex flex-wrap gap-5">
            <Stat label={t("total")} value={String(overview.builds.total)} />
            <Stat
              label={t("success")}
              value={percent(overview.builds.successRate)}
              hint={`${overview.builds.success} ✓ / ${overview.builds.failed} ✕`}
            />
            <Stat
              label={t("median duration")}
              value={overview.builds.medianSeconds != null ? `${overview.builds.medianSeconds}s` : "—"}
              hint={t("recent builds")}
            />
          </div>
          <div className="mt-3 flex h-16 items-end gap-1">
            {overview.builds.byDay.map((day) => (
              <div
                key={day.day}
                title={`${day.day}: ${day.total} (${day.failed} ${t("failed")})`}
                className="flex h-full flex-1 flex-col justify-end gap-0.5"
              >
                {day.failed > 0 && (
                  <div
                    className="w-full rounded-t bg-destructive/70"
                    style={{ height: `${(day.failed / maxDay) * 100}%` }}
                  />
                )}
                <div
                  className={`w-full rounded-t ${day.failed > 0 ? "bg-emerald-500/40" : "bg-emerald-500/70"}`}
                  style={{ height: `${(day.total / maxDay) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("last 14 days")}</p>
        </Card>

        <Card title={t("AI")}>
          <div className="flex flex-wrap gap-5">
            <Stat label={t("runs")} value={String(overview.ai.runs)} />
            <Stat label={t("success")} value={percent(overview.ai.okRate)} />
            <Stat
              label={t("avg latency")}
              value={overview.ai.avgLatencyMs > 0 ? `${overview.ai.avgLatencyMs}ms` : "—"}
              hint={`${overview.ai.fallbackRuns} ${t("fallback runs")}`}
            />
          </div>
          <div className="mt-3 space-y-1">
            {overview.ai.byModel.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("No AI runs yet.")}</p>
            ) : (
              overview.ai.byModel.map((m) => (
                <div key={m.model} className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-mono text-foreground/80">{m.model}</span>
                  <span className="text-muted-foreground">
                    {m.runs} · {percent(m.okRate)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title={t("Workspace")}>
          <div className="flex flex-wrap gap-5">
            <Stat label={t("projects")} value={String(overview.counts.projects)} />
            <Stat label={t("servers")} value={String(overview.counts.servers)} />
            <Stat label={t("instances")} value={String(overview.counts.instances)} />
          </div>
          <div className="mt-3 flex flex-wrap gap-5">
            <Stat label={t("snapshots")} value={String(overview.counts.snapshots)} />
            <Stat label={t("backups")} value={String(overview.counts.backups)} />
          </div>
          {overview.disk ? (
            <div className="mt-3 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("projects disk")}</span>
                <span className="font-mono">{formatBytes(overview.disk.projectsBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("servers disk")}</span>
                <span className="font-mono">{formatBytes(overview.disk.serversBytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("backups disk")}</span>
                <span className="font-mono">{formatBytes(overview.disk.backupsBytes)}</span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t("Disk usage appears once a workspace base is set.")}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t("Most built projects")}>
          {overview.builds.topProjects.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("No builds recorded yet.")}</p>
          ) : (
            <div className="space-y-1">
              {overview.builds.topProjects.map((p) => (
                <div key={p.slug} className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-mono text-foreground/80">{p.slug}</span>
                  <span className="text-muted-foreground">
                    {p.total} · {p.failed > 0 ? `${p.failed} ${t("failed")}` : t("all green")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("Moderation")}>
          <div className="flex flex-wrap gap-5">
            <Stat label={t("punishments")} value={String(overview.punishments.total)} />
            <Stat label="bans" value={String(overview.punishments.bans)} />
            <Stat label="pardons" value={String(overview.punishments.pardons)} />
            <Stat label="kicks" value={String(overview.punishments.kicks)} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {t("From the punishment history — every entry was applied by you.")}
          </p>
        </Card>

        <Card title={t("Automation")}>
          <div className="flex flex-wrap gap-5">
            <Stat label={t("runs")} value={String(overview.automations.total)} />
            <Stat label={t("applied")} value={String(overview.automations.applied)} />
            <Stat label={t("failed")} value={String(overview.automations.failed)} />
            <Stat label={t("skipped")} value={String(overview.automations.skipped)} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {t("From the automation run log — nothing ran silently.")}
          </p>
        </Card>
      </div>
    </div>
  );
}
