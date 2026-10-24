import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleHelp,
  Loader2,
  Play,
  RotateCcw,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getProjectQa, type QaVerdict } from "@/services/qa/qaLab";
import { getTaskEngine } from "@/services/ai/taskEngine";
import { cn } from "@/lib/utils";

const STATUS_META = {
  passed: { icon: CheckCircle2, className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" },
  failed: { icon: XCircle, className: "border-red-500/40 bg-red-500/5 text-red-400" },
  "not-run": { icon: RotateCcw, className: "border-border/60 bg-card/50 text-muted-foreground" },
  "requires-manual": { icon: CircleHelp, className: "border-amber-500/40 bg-amber-500/5 text-amber-400" },
} as const;

/**
 * QA Lab (§14) — the verdict matrix with the prompt's core rule: build
 * success is not automated checks is not runtime proof. When automation
 * can't reach a level, the limitation is REGISTERED, never hidden.
 */
export function QaPage() {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const [projectId, setProjectId] = useState("");
  const [verdicts, setVerdicts] = useState<QaVerdict[] | null>(null);
  const [busy, setBusy] = useState(false);

  const project = projects.find((p) => p.id === projectId) ?? null;

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    if (!basePath || !project) return;
    setBusy(true);
    getProjectQa(basePath, project)
      .then(setVerdicts)
      .catch((error) => {
        toast.error("Could not build the verdict matrix", {
          description: error instanceof Error ? error.message : String(error),
        });
        setVerdicts([]);
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, basePath]);

  const runFixBuild = async () => {
    if (!project) return;
    try {
      await getTaskEngine().enqueue({
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
      toast.success("Fix Build queued", {
        description: "Follow it live in the AI Command Center.",
      });
    } catch (error) {
      toast.error("Could not queue the workflow", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("QA Lab")}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(
              "The verdict matrix, honestly: build succeeded is not automated checks passed is not runtime proven. Levels automation cannot reach carry their registered limitation.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 ? (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-60">
                <SelectValue placeholder={t("Project")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.loader} {p.minecraft_version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">{t("Create a project first")}</Badge>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2.5">
        {busy && !verdicts ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("Gathering the real facts…")}
          </div>
        ) : null}
        {verdicts?.map((verdict) => {
          const meta = STATUS_META[verdict.status];
          return (
            <div key={verdict.level} className={cn("rounded-xl border px-4 py-3", meta.className)}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <meta.icon className="h-4 w-4 shrink-0" />
                {verdict.label}
                <Badge variant="outline" className="ml-auto text-[9px] uppercase">
                  {verdict.status}
                </Badge>
              </p>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-foreground/80">{verdict.detail}</p>
              {verdict.registeredLimitation && (
                <p className="mt-1.5 pl-6 text-[11px] italic text-muted-foreground">
                  {t("Registered limitation")}: {verdict.registeredLimitation}
                </p>
              )}
              {verdict.level === "build" && verdict.status === "failed" && (
                <Button size="sm" variant="outline" className="ml-6 mt-2" onClick={() => void runFixBuild()}>
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {t("Run the Fix Build workflow")}
                </Button>
              )}
              {verdict.level === "runtime" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-6 mt-2"
                  onClick={() => navigate("/launcher")}
                >
                  <Play className="h-3.5 w-3.5" />
                  {t("Launch to verify in game")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
