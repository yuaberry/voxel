import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Loader2,
  Square,
  Terminal,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectRecord } from "@/types";
import {
  persistBuildLogEntry,
  preflightBuild,
  runBuild,
  stopBuildCommand,
  type BuildRun,
} from "@/services/build/buildService";
import {
  errorsToPrompt,
  parseBuildErrors,
  type BuildError,
} from "@/services/build/errorParser";
import { useSettingsStore } from "@/stores/settingsStore";
import { useProjectsStore } from "@/stores/projectsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { getProviderMeta } from "@/services/ai/providers";
import { loadProjectContext } from "@/services/ai/contextService";
import { runAgent, type AgentEvent } from "@/services/ai/agent/orchestrator";
import { createSession } from "@/services/ai/sessions";

const AUTO_FIX_MAX_ATTEMPTS = 5;

interface AutoFixState {
  running: boolean;
  attempt: number;
  log: string[];
}

interface Props {
  project: ProjectRecord;
  open: boolean;
  onToggle: (open: boolean) => void;
  buildStatus: string | null;
}

/**
 * Bottom drawer of the workspace — real build terminal + Error Center +
 * the Auto-Fix loop that feeds errors back into the VOXEL Agent.
 */
export function BuildDrawer({ project, open, onToggle, buildStatus }: Props) {
  const navigate = useNavigate();
  const basePath = useSettingsStore((s) => s.settings.storage.basePath);
  const customJava = useSettingsStore((s) => s.settings.java.customJavaPath);
  const aiSettings = useSettingsStore((s) => s.settings.ai);
  const patchProject = useProjectsStore((s) => s.patchProject);

  const [run, setRun] = useState<BuildRun | null>(null);
  const [building, setBuilding] = useState(false);
  // Live elapsed seconds while building — a tick state keeps Date.now() out
  // of the render (React Compiler rule), and the interval only runs when busy
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [building]);

  const [autoFix, setAutoFix] = useState<AutoFixState | null>(null);
  const abortRef = useRef(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const errors = useMemo<BuildError[]>(
    () => (run ? parseBuildErrors(run.logs) : []),
    [run],
  );

  useEffect(() => {
    if (open && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [run, open]);

  const handleBuild = useCallback(async () => {
    if (!basePath || building) return;
    const pre = await preflightBuild(project, basePath);
    if (!pre.ok) {
      toast.error("Preflight failed", { description: pre.issues.join(" · ") });
      return;
    }
    if (pre.firstBuildHint) {
      toast.info("First build of this project", {
        description:
          "Gradle + dependencies are downloaded once into the shared workspace cache — this can take a few minutes.",
        duration: 8000,
      });
    }

    setBuilding(true);
    onToggle(true);
    setAutoFix(null);
    try {
      const result = await runBuild(
        project,
        basePath,
        "build",
        (updated) => {
          setRun({ ...updated, logs: [...updated.logs] });
        },
        customJava,
      );
      setRun(result);
      patchProject(project.id, {
        last_build_status: result.status,
        last_build_at: new Date().toISOString(),
      });
      void persistBuildLogEntry(project, result);
      if (result.status === "success") {
        toast.success("Build completed", {
          description: "The compiled mod jar is in build/libs/.",
        });
      } else if (result.status === "failed") {
        toast.error("Build failed", {
          description: "Check the Error Center below — try Fix with VOXEL Agent.",
        });
      }
    } catch (error) {
      toast.error("Could not start build", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBuilding(false);
    }
  }, [basePath, building, project, onToggle, patchProject, customJava]);

  const handleStop = useCallback(async () => {
    abortRef.current = true;
    await stopBuildCommand(`projects/${project.slug}`).catch(() => {});
  }, [project.slug]);

  // -------------------------------------------------------------------------
  // Auto-Fix: build errors -> agent -> rebuild -> repeat (max 5 attempts)
  // -------------------------------------------------------------------------
  const handleAutoFix = useCallback(async () => {
    if (!basePath || !run || errors.length === 0) return;
    const meta = getProviderMeta(aiSettings.provider);
    if (meta.requiresKey && !(await secretsGet(AI_API_KEY_ID))) {
      toast.error("Configure your AI provider first", {
        description: "Settings → AI — Auto-Fix needs a model and key.",
      });
      navigate("/settings/ai");
      return;
    }

    abortRef.current = false;
    const state: AutoFixState = { running: true, attempt: 0, log: [] };
    setAutoFix(state);
    const push = (line: string) => {
      state.log.push(line);
      setAutoFix({ ...state });
    };

    // Local working set — never mutate the memoized parser output
    let currentErrors = errors.map((e) => ({ ...e }));

    try {
      const context = await loadProjectContext(project);

      for (let attempt = 1; attempt <= AUTO_FIX_MAX_ATTEMPTS; attempt++) {
        state.attempt = attempt;
        setAutoFix({ ...state });
        push(`Attempt ${attempt}/${AUTO_FIX_MAX_ATTEMPTS} — agent is fixing ${currentErrors.length} error(s)…`);

        const session = await createSession(
          project.id,
          `auto-fix attempt ${attempt}`,
        );

        await runAgent({
          settings: aiSettings,
          project,
          context,
          basePath,
          sessionId: session.id,
          history: [],
          userText: errorsToPrompt(currentErrors, attempt),
          shouldAbort: () => abortRef.current,
          onEvent: (event: AgentEvent) => {
            if (event.type === "tool_start") {
              push(`  → ${event.tool} ${event.summary}`);
            } else if (event.type === "tool_result" && !event.ok) {
              push(`  ✗ ${event.tool}: ${event.output.slice(0, 120)}`);
            } else if (event.type === "snapshot") {
              push(`  · snapshot ${event.label}`);
            }
          },
          // Auto-Fix is autonomous but never destructive
          confirm: async () => false,
        });

        if (abortRef.current) {
          push("Auto-Fix stopped by the user.");
          break;
        }

        push("Rebuilding…");
        const rebuilt = await runBuild(project, basePath, "build", () => {}, customJava);
        patchProject(project.id, {
          last_build_status: rebuilt.status,
          last_build_at: new Date().toISOString(),
        });
        setRun(rebuilt);

        if (rebuilt.status === "success") {
          push(`Build is green after ${attempt} attempt(s) ✓`);
          toast.success(`Auto-Fix succeeded on attempt ${attempt}`, {
            description: "The project compiles again.",
          });
          break;
        }

        const nextErrors = parseBuildErrors(rebuilt.logs);
        push(`Build still failing (${nextErrors.length} error(s)).`);
        void persistBuildLogEntry(project, rebuilt);
        if (attempt === AUTO_FIX_MAX_ATTEMPTS) {
          push("Attempt budget exhausted — review the errors and continue manually.");
          toast.warning("Auto-Fix budget exhausted", {
            description: "The agent could not fully repair the build. Review the Error Center.",
          });
        } else {
          currentErrors = nextErrors;
        }
      }
    } catch (error) {
      push(`Auto-Fix failed: ${String(error)}`);
    } finally {
      state.running = false;
      setAutoFix({ ...state });
    }
  }, [basePath, run, errors, aiSettings, project, navigate, patchProject, customJava]);

  const busy = building || (autoFix?.running ?? false);
  const statusDot =
    buildStatus === "success"
      ? "bg-emerald-400"
      : buildStatus === "failed"
        ? "bg-red-400"
        : "bg-muted-foreground/40";

  return (
    <div
      className={cn(
        "flex flex-col border-t border-border/60 bg-card/40 transition-all",
        open ? "h-[42%]" : "h-auto",
      )}
    >
      {/* Bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Build
          </span>
          <span className={cn("h-2 w-2 rounded-full", building ? "animate-pulse-soft bg-primary" : statusDot)} />
          {run && !building && (
            <Badge variant={run.status === "success" ? "success" : run.status === "failed" ? "destructive" : "secondary"}>
              {run.status} {run.exitCode !== null ? `(${run.exitCode})` : ""}
            </Badge>
          )}
          {run && !building && run.endedAt !== null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {((run.endedAt - run.startedAt) / 1000).toFixed(1)}s
            </span>
          )}
          {building && run && (
            <span className="font-mono text-[10px] text-primary/80">
              {((nowTick - run.startedAt) / 1000).toFixed(0)}s…
            </span>
          )}
          {autoFix && (
            <Badge variant="default" className="gap-1">
              <Wrench className="h-3 w-3" /> Auto-Fix {autoFix.attempt}/{AUTO_FIX_MAX_ATTEMPTS}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {busy ? (
            <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => void handleStop()}>
              <Square className="h-3 w-3" /> Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="gradient"
              className="h-7 text-[11px]"
              onClick={() => void handleBuild()}
            >
              <Zap className="h-3 w-3" /> Build
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onToggle(!open)}
            title={open ? "Collapse" : "Expand"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "" : "rotate-180")} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Terminal */}
          <div
            ref={terminalRef}
            className="min-h-0 flex-1 overflow-y-auto bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed"
          >
            {run?.logs.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  entry.stream === "stderr" ? "text-red-300/90" : "text-muted-foreground",
                  /^BUILD SUCCESS/i.test(entry.line) && "font-semibold text-emerald-400",
                  /^BUILD FAILED/i.test(entry.line) && "font-semibold text-red-400",
                  /^> Task/i.test(entry.line) && "text-foreground/70",
                )}
              >
                {entry.line}
              </div>
            ))}
            {autoFix && (
              <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2">
                {autoFix.log.map((line, index) => (
                  <div key={index} className="text-foreground/80">
                    {line}
                  </div>
                ))}
                {autoFix.running && (
                  <div className="flex items-center gap-1.5 text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" /> working…
                  </div>
                )}
              </div>
            )}
            {!run && !autoFix && (
              <p className="text-muted-foreground/50">
                No build yet — press Build to compile the project (./gradlew build).
              </p>
            )}
          </div>

          {/* Error Center */}
          {errors.length > 0 && (
            <div className="max-h-40 shrink-0 space-y-1.5 overflow-y-auto border-t border-border/40 p-2">
              <p className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-red-400">
                <TriangleAlert className="h-3 w-3" /> Error Center — {errors.length}
              </p>
              {errors.map((error, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5"
                >
                  <Badge variant="destructive" className="shrink-0 text-[9px] uppercase">
                    {error.category}
                  </Badge>
                  <div className="min-w-0">
                    {error.file && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {error.file}
                        {error.line ? `:${error.line}` : ""}
                      </p>
                    )}
                    <p className="text-[11px] leading-snug text-foreground/90">{error.message}</p>
                  </div>
                </div>
              ))}
              {run?.status === "failed" && !busy && (
                <div className="flex items-center gap-2 px-1 pt-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-[11px]"
                    onClick={() => void handleAutoFix()}
                  >
                    <Wrench className="h-3 w-3" /> Fix with VOXEL Agent
                  </Button>
                  <span className="text-[10px] text-muted-foreground/70">
                    up to {AUTO_FIX_MAX_ATTEMPTS} autonomous attempts — destructive operations are refused
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
