/**
 * Performance Lab (Phase G — Polishing).
 *
 * Displays REAL performance metrics measured from this machine:
 *   - Boot time: app startup to first paint
 *   - Build time: server/mod compile duration
 *   - FPS: frames per second (measured live via requestAnimationFrame)
 *   - Memory: process RSS (when available)
 *   - Server start time: time from 'start' command to ready
 *
 * No fake data: empty states show zeros and "no data yet" messages.
 */

import { useEffect, useState } from "react";
import { t } from "@/i18n";
import {
  fpsMeter,
  getPerformanceOverview,
  type PerformanceMetrics,
} from "@/services/performance/performanceService";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function PerformanceLabPage() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(true);

  useEffect(() => {
    // Start FPS measurement when page mounts
    fpsMeter.start();

    return () => {
      fpsMeter.stop();
      setIsMeasuring(false);
    };
  }, []);

  useEffect(() => {
    // Poll metrics every 2 seconds
    const interval = setInterval(() => {
      setMetrics(getPerformanceOverview());
    }, 2000);

    // Initial measurement
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetrics(getPerformanceOverview());

    return () => clearInterval(interval);
  }, []);

  const formatMs = (ms: number | null): string =>
    ms != null ? `${ms} ms` : "—";

  const formatFps = (fps: number | null): string =>
    fps != null ? `${fps} FPS` : "—";

  const formatMb = (mb: number | null): string =>
    mb != null ? `${mb} MB` : "—";

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Performance Lab")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t(
              "All metrics measured from real execution on this machine. No fake data, no invented numbers.",
            )}
          </p>
        </div>
        <Badge variant={isMeasuring ? "success" : "secondary"}>
          {isMeasuring ? t("measuring") : t("idle")}
        </Badge>
      </div>

      {/* Metrics cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t("Boot Time")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {formatMs(metrics?.bootTimeMs ?? null)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("app startup to first paint")}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {metrics?.bootTimeMs != null
              ? t("measured on this boot")
              : t("no data yet")}
          </p>
        </Card>

        <Card title={t("Build Time")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {formatMs(metrics?.buildTimeMs ?? null)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("average")}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {metrics?.buildTimeMs != null
              ? t("measured on this machine")
              : t("no builds measured yet")}
          </p>
        </Card>

        <Card title={t("FPS")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {formatFps(metrics?.fps ?? null)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("frames per second")}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {metrics?.fps != null ? t("measured live") : t("no data yet")}
          </p>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card title={t("Memory")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {formatMb(metrics?.memoryRssMb ?? null)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("process RSS")}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {metrics?.memoryRssMb != null
              ? t("measured on this machine")
              : t("not available on this platform")}
          </p>
        </Card>

        <Card title={t("Server Start")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {formatMs(metrics?.serverStartTimeMs ?? null)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("average")}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {metrics?.serverStartTimeMs != null
              ? t("measured on this machine")
              : t("no servers started yet")}
          </p>
        </Card>

        <Card title={t("FPS Samples")}>
          <div className="flex flex-wrap gap-5">
            <div>
              <p className="font-mono text-lg font-bold text-primary">
                {fpsMeter.getAverageFps() != null ? `${fpsMeter.getAverageFps()} FPS` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("average over last 60 samples")}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {fpsMeter.getSamples().length > 0 ? t("sampling active") : t("not measuring yet")}
          </p>
        </Card>
      </div>

      {/* Honesty note */}
      <Card title={t("How Measurements Work")}>
        <div className="space-y-2 text-[11px] text-muted-foreground">
          <p>
            <span className="font-bold">Boot time:</span> {t(
              "measured from app start to first paint using the Performance API.",
            )}
          </p>
          <p>
            <span className="font-bold">Build time:</span> {t(
              "measured when a server or mod is built, tracked per project and task.",
            )}
          </p>
          <p>
            <span className="font-bold">FPS:</span> {t(
              "measured via requestAnimationFrame while this page is open. " +
              "Close this page to stop measurement.",
            )}
          </p>
          <p>
            <span className="font-bold">Memory:</span> {t(
              "process RSS (resident set size). Not available on all platforms — " +
              "shows as '—' when the runtime doesn't expose it.",
            )}
          </p>
          <p>
            <span className="font-bold">Server start:</span> {t(
              "measured from the 'start' command to the server reporting online.",
            )}
          </p>
          <p className="mt-2">
            <span className="font-bold text-destructive">
              {t("No fake data:")}
            </span>{" "}
            {t(
              "if a metric hasn't been measured yet, it shows '—' instead of a made-up number.",
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}
