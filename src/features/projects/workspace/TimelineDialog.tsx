import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { Bot, Camera, Hammer, Loader2, MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getProjectTimeline,
  type TimelineEvent,
  type TimelineKind,
} from "@/services/projects/timelineService";
import type { ProjectRecord } from "@/types";

const KIND_META: Record<TimelineKind, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  build: { icon: Hammer, label: "Build", color: "text-cyan-300" },
  snapshot: { icon: Camera, label: "Snapshot", color: "text-violet-300" },
  agent: { icon: Bot, label: "Agent", color: "text-fuchsia-300" },
  session: { icon: MessageSquare, label: "Session", color: "text-amber-200" },
};

/**
 * Project Timeline — the unified, FACTUAL history of one project: builds,
 * agent tool calls (the audit), snapshots (real commits) and AI sessions.
 * Every line came from a real store; restore happens where it already
 * lives (SnapshotPanel), inspect where it already lives (Error Center).
 */
export function TimelineDialog({
  project,
  open,
  onOpenChange,
  basePath,
}: {
  project: ProjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
}) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [filter, setFilter] = useState<TimelineKind | "all">("all");

  useEffect(() => {
    if (!open) return;
    setEvents(null);
    getProjectTimeline(project, basePath)
      .then(setEvents)
      .catch((error) => {
        toast.error("Could not load the timeline", {
          description: error instanceof Error ? error.message : String(error),
        });
        setEvents([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id, basePath]);

  const shown = events?.filter((e) => filter === "all" || e.kind === filter) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Project timeline")} — {project.name}</DialogTitle>
          <DialogDescription>
            {t(
              "Everything that happened to this project, from the real records: builds, agent actions (audited), snapshots and AI sessions.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(["all", "build", "snapshot", "agent", "session"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setFilter(kind)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === kind
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/30",
              )}
            >
              {kind === "all" ? t("Everything") : KIND_META[kind].label}
            </button>
          ))}
        </div>

        {events === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("Loading the real records…")}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t("Nothing recorded in this filter yet — build, chat or let the agent work and it lands here.")}
          </p>
        ) : (
          <ol className="relative space-y-2 border-l border-border/70 pl-4">
            {shown.map((event, i) => {
              const meta = KIND_META[event.kind];
              return (
                <li key={`${event.kind}-${event.at}-${i}`} className="relative">
                  <span className="absolute -left-[21px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card">
                    <meta.icon className={cn("h-2.5 w-2.5", meta.color)} />
                  </span>
                  <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
                    <p className="flex items-center gap-2 text-xs font-semibold">
                      {event.title}
                      {event.status === "failed" && (
                        <Badge variant="destructive" className="text-[9px]">failed</Badge>
                      )}
                      {event.status === "success" && event.kind === "build" && (
                        <Badge className="bg-emerald-500/15 text-[9px] text-emerald-400">ok</Badge>
                      )}
                    </p>
                    {event.detail && (
                      <p className="mt-0.5 break-words text-[10px] leading-relaxed text-muted-foreground">
                        {event.detail}
                      </p>
                    )}
                    <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground/60">
                      {meta.label} · {event.at || "date unknown"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
