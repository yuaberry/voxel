import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Clock,
  Hammer,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectsStore } from "@/stores/projectsStore";
import {
  getTaskEngine,
  sortQueueDiscipline,
  type TaskRecord,
  type TaskStatus,
} from "@/services/ai/taskEngine";
import { getMetricsSummary, type MetricsSummary } from "@/services/ai/aiMetrics";
import { cn } from "@/lib/utils";

const STATUS_META: Record<TaskStatus, { icon: React.ComponentType<{ className?: string }>; className: string; label: string }> = {
  queued: { icon: Clock, className: "border-border/60 bg-card/50 text-muted-foreground", label: "queued" },
  running: { icon: Loader2, className: "border-primary/40 bg-primary/10 text-primary", label: "running" },
  completed: { icon: CheckCircle2, className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400", label: "completed" },
  failed: { icon: XCircle, className: "border-red-500/40 bg-red-500/5 text-red-400", label: "failed" },
  cancelled: { icon: Ban, className: "border-amber-500/30 bg-amber-500/5 text-amber-400", label: "cancelled" },
};

/**
 * AI Command Center (Super Prompt §8) — the real queue: every autonomous
 * task with its per-step state, elapsed time and artifacts; cancel and
 * retry; the honest AI metrics (success rate, latency, fallback usage)
 * read straight from the rows. One job at a time — the execution limit.
 */
export function CommandCenterPage() {
  const projects = useProjectsStore((s) => s.projects);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // new-task form
  const [kind, setKind] = useState<"agent_prompt" | "workflow_fix_build">("agent_prompt");
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, summary] = await Promise.all([
        getTaskEngine().list(),
        getMetricsSummary(),
      ]);
      setTasks(sortQueueDiscipline(list));
      setMetrics(summary);
    } catch {
      // the queue surfaces on the next poll — never crash the page
    }
  }, []);

  useEffect(() => {
    // microtask: refresh flips state synchronously before its first await
    void Promise.resolve().then(() => refresh());
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  // React's "adjust state during render": first project becomes the selection
  // the moment projects arrive — no effect, no synchronous write
  if (!projectId && projects.length > 0) {
    setProjectId(projects[0].id);
  }

  const create = async () => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || busy) return;
    if (kind === "agent_prompt" && !prompt.trim()) {
      toast.warning("Describe what the agent should do");
      return;
    }
    setBusy(true);
    try {
      const engine = getTaskEngine();
      if (kind === "agent_prompt") {
        await engine.enqueue({
          kind: "agent_prompt",
          projectId: project.id,
          title: prompt.trim().slice(0, 80),
          steps: [{ id: "agent", label: "Agent turn" }],
          model: null,
        });
        toast.success("Task queued", {
          description: "The agent runs it headless — same sandbox, destructive tools denied. Watch it here.",
        });
      } else {
        await engine.enqueue({
          kind: "workflow_fix_build",
          projectId: project.id,
          title: `Fix build: ${project.name}`,
          steps: [
            { id: "preflight", label: "Preflight (Java, project shape)" },
            { id: "build", label: "First build" },
            { id: "analyze", label: "Parse the errors" },
            { id: "fix", label: "Agent fixes" },
            { id: "rebuild", label: "Rebuild" },
            { id: "verdict", label: "Verdict" },
          ],
          model: null,
        });
        toast.success("Fix Build workflow queued", {
          description: "Preflight → build → analyze → agent fix → rebuild → verdict, checkpointed at every step.",
        });
      }
      setNewOpen(false);
      setPrompt("");
      await refresh();
    } catch (error) {
      toast.error("Could not queue the task", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("AI Command Center")}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(
              "The real task queue: autonomous agent runs and workflows with per-step checkpoints, cancel and retry, and the honest AI metrics — one job at a time, capped at 20 waiting.",
            )}
          </p>
        </div>
        <Button size="sm" variant="gradient" onClick={() => setNewOpen(true)} disabled={projects.length === 0}>
          <Sparkles className="h-3.5 w-3.5" />
          {t("New task")}
        </Button>
      </div>

      {/* honest metrics — read from ai_metrics rows */}
      {metrics && metrics.total > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label={t("calls")} value={String(metrics.total)} />
          <MetricCard label={t("success rate")} value={`${Math.round(metrics.successRate * 100)}%`} ok={metrics.successRate >= 0.8} />
          <MetricCard label={t("avg latency")} value={`${(metrics.avgLatencyMs / 1000).toFixed(1)}s`} />
          <MetricCard label={t("fallbacks used")} value={String(metrics.fallbackUsage)} />
        </div>
      )}
      {metrics && metrics.total > 0 && metrics.perModel.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {metrics.perModel.slice(0, 4).map((model) => (
            <Badge key={model.model} variant="outline" className="text-[10px]">
              {model.model}: {Math.round(model.successRate * 100)}% · {model.calls}×
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-2.5">
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-xs text-muted-foreground">
            {t("No tasks yet — queue an agent run or the Fix Build workflow.")}
          </p>
        ) : (
          tasks.map((task) => {
            const meta = STATUS_META[task.status];
            const project = projects.find((p) => p.id === task.projectId);
            const open = expanded === task.id;
            return (
              <div key={task.id} className="rounded-xl border border-border/70 bg-card/60">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                  onClick={() => setExpanded(open ? null : task.id)}
                >
                  <meta.icon className={cn("h-4 w-4 shrink-0", task.status === "running" && "animate-spin")} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
                  {project && (
                    <Badge variant="outline" className="text-[9px]">{project.name}</Badge>
                  )}
                  <Badge variant="outline" className={cn("text-[9px]", meta.className)}>
                    {meta.label}
                  </Badge>
                  {task.elapsedMs > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {(task.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span className="flex gap-1">
                    {(task.status === "queued" || task.status === "running") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void getTaskEngine().cancel(task.id).then(refresh);
                        }}
                      >
                        <Ban className="h-3 w-3" />
                      </Button>
                    )}
                    {(task.status === "failed" || task.status === "cancelled") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void getTaskEngine().retry(task.id).then(refresh);
                        }}
                        title={t("Retry")}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-border/60 px-4 py-3">
                    {task.steps.map((step) => (
                      <div key={step.id} className="flex items-start gap-2 text-[11px]">
                        <span
                          className={cn(
                            "mt-1 h-2 w-2 shrink-0 rounded-full",
                            step.status === "done" && "bg-emerald-400",
                            step.status === "running" && "animate-pulse-soft bg-primary",
                            step.status === "failed" && "bg-red-400",
                            step.status === "skipped" && "bg-muted-foreground/30",
                            step.status === "pending" && "border border-muted-foreground/40",
                          )}
                        />
                        <div className="min-w-0">
                          <p className="font-medium">{step.label}</p>
                          {step.detail && (
                            <p className="break-words text-muted-foreground">{step.detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {task.result && (
                      <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] leading-relaxed">
                        {task.result}
                      </p>
                    )}
                    {task.error && (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
                        {task.error}
                      </p>
                    )}
                    {task.model && (
                      <p className="text-[10px] text-muted-foreground">model: {task.model}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* New task */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("New task")}</DialogTitle>
            <DialogDescription>
              {t(
                "Queued jobs run headless with the same sandbox and the autonomous policy: writes allowed, destructive tools denied.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("What")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent_prompt">Agent: run a prompt on the project</SelectItem>
                  <SelectItem value="workflow_fix_build">Workflow: Fix Build (build → analyze → fix → rebuild → verdict)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Project")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind === "agent_prompt" && (
              <div className="space-y-1.5">
                <Label>{t("Prompt")}</Label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder={t('e.g. "add a Void Gem item with a recipe and real art"')}
                  className="w-full resize-none rounded-lg border border-input bg-background/60 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setNewOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button size="sm" variant="gradient" onClick={() => void create()} disabled={busy || !projectId}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hammer className="h-3.5 w-3.5" />}
              {t("Queue it")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-bold", ok === true && "text-emerald-400", ok === false && "text-red-400")}>
        {value}
      </p>
    </div>
  );
}
