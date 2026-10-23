/**
 * Task runners (Super Prompt §8/§9, Phase C) — what the queue actually
 * executes. The agent runs headless with the SAME sandboxed tools and the
 * autonomous policy the orchestrator has always enforced (destructive
 * calls auto-denied); the Fix Build workflow is the production Auto-Fix
 * pipeline formalized into checkpointed steps: preflight → build →
 * analyze → agent fix → rebuild → verdict.
 */
import { runAgent } from "@/services/ai/agent/orchestrator";
import { loadProjectContext } from "@/services/ai/contextService";
import { createSession } from "@/services/ai/sessions";
import { useSettingsStore } from "@/stores/settingsStore";
import { secretsGet, AI_API_KEY_ID } from "@/services/secrets/secretsService";
import { runBuild, preflightBuild, type BuildRun } from "@/services/build/buildService";
import { parseBuildErrors } from "@/services/build/errorParser";
import { recordTaskMetric } from "@/services/ai/aiMetrics";
import type { ProjectRecord } from "@/types";
import type { TaskRunner } from "./taskEngine";

/** The autonomous policy: writes are allowed, destruction is not. */
const DENIED_IN_AUTONOMOUS_MODE = new Set([
  "delete_file",
  "rename_file",
  "create_snapshot",
]);

async function currentAi() {
  const settings = useSettingsStore.getState().settings.ai;
  const apiKey = await secretsGet(AI_API_KEY_ID).catch(() => null);
  return { settings, apiKey: apiKey ?? null };
}

/** An agent turn with no UI: every event lands in the task's step detail. */
export const agentPromptRunner: TaskRunner = {
  async run(task, ctx) {
    const { settings } = await currentAi();
    if (!ctx.project) {
      throw new Error("This task needs a project");
    }
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const prompt = String(
      (JSON.parse(task.result ?? "{}") as { prompt?: string }).prompt ??
        task.title,
    );

    const context = await loadProjectContext(ctx.project);
    const session = await createSession(ctx.project.id, `Task: ${task.title}`);
    const toolLog: string[] = [];

    const result = await runAgent({
      settings,
      project: ctx.project,
      context,
      basePath: ctx.basePath,
      sessionId: session.id,
      history,
      userText: prompt,
      shouldAbort: ctx.shouldAbort,
      onEvent: (event) => {
        if (event.type === "tool_start") {
          toolLog.push(event.tool);
          void ctx.onStep("agent", {
            status: "running",
            detail: `${event.tool}: ${event.summary}`,
          });
        }
        if (event.type === "tool_result" && !event.ok) {
          toolLog.push(`${event.tool} FAILED: ${event.output.slice(0, 120)}`);
        }
      },
      confirm: async (tool) => {
        // autonomous policy: destructive tools are denied, writes proceed
        return !DENIED_IN_AUTONOMOUS_MODE.has(tool);
      },
    });

    return {
      result: result.text || `agent finished (${result.toolCalls} tool calls, ${result.writes} writes)`,
      model: settings.model || null,
    };
  },
};

/** The Fix Build workflow — the production Auto-Fix formalized. */
export const fixBuildRunner: TaskRunner = {
  async run(_task, ctx) {
    const project = ctx.project;
    if (!project) {
      throw new Error("This workflow needs a project");
    }
    const { settings } = await currentAi();

    // 1. preflight — the honest gate (Java, project shape)
    await ctx.onStep("preflight", { status: "running" });
    const pre = await preflightBuild(project, ctx.basePath);
    if (!pre.ok) {
      await ctx.onStep("preflight", {
        status: "failed",
        detail: pre.issues.join("; "),
      });
      throw new Error(`Preflight failed: ${pre.issues[0]}`);
    }
    await ctx.onStep("preflight", {
      status: "done",
      detail: pre.firstBuildHint ? "first build — Gradle will download the toolchain" : "machine ready",
    });
    if (ctx.shouldAbort()) throw new Error("cancelled");

    // 2. build #1
    await ctx.onStep("build", { status: "running", detail: "gradle build…" });
    const first = await timedBuild(project, ctx.basePath);
    if (first.status === "success") {
      await ctx.onStep("build", { status: "done", detail: "BUILD SUCCESS" });
      await ctx.onStep("analyze", { status: "skipped" });
      await ctx.onStep("fix", { status: "skipped" });
      await ctx.onStep("rebuild", { status: "skipped" });
      await ctx.onStep("verdict", {
        status: "done",
        detail: "The project already builds — nothing to fix.",
      });
      return {
        result: "BUILD SUCCESS on the first try — no fixes needed.",
        model: null,
      };
    }
    await ctx.onStep("build", {
      status: "done",
      detail: `first build failed (${first.logs.length} lines) — analyzing`,
    });
    if (ctx.shouldAbort()) throw new Error("cancelled");

    // 3. analyze the errors with the production parser
    await ctx.onStep("analyze", { status: "running" });
    const errors = parseBuildErrors(first.logs.map((l) => ({ line: l.line })));
    const digest = errors.slice(0, 10).map((e) => `${e.category}: ${e.message}`).join("\n");
    await ctx.onStep("analyze", {
      status: errors.length > 0 ? "done" : "failed",
      detail: errors.length > 0 ? `${errors.length} errors parsed` : "no structured errors found in the log",
    });

    // 4. agent fix (headless, autonomous policy)
    await ctx.onStep("fix", { status: "running", detail: "agent is fixing…" });
    const context = await loadProjectContext(project);
    const session = await createSession(project.id, `Workflow: fix ${project.name}`);
    const fixResult = await runAgent({
      settings,
      project,
      context,
      basePath: ctx.basePath,
      sessionId: session.id,
      history: [],
      userText: `The build failed. Fix the project so it compiles. The Error Center parsed these errors:\n\n${digest}\n\nRead the affected files before editing. Keep every change minimal.`,
      shouldAbort: ctx.shouldAbort,
      onEvent: () => {},
      confirm: async (tool) => !DENIED_IN_AUTONOMOUS_MODE.has(tool),
    });
    await ctx.onStep("fix", {
      status: "done",
      detail: `${fixResult.toolCalls} tool calls, ${fixResult.writes} writes`,
    });
    if (ctx.shouldAbort()) throw new Error("cancelled");

    // 5. rebuild
    await ctx.onStep("rebuild", { status: "running", detail: "gradle build…" });
    const second = await timedBuild(project, ctx.basePath);
    await ctx.onStep("rebuild", {
      status: "done",
      detail: second.status === "success" ? "BUILD SUCCESS" : "still failing",
    });

    // 6. verdict — honest, per §14: build success is not runtime proof
    const verdict =
      second.status === "success"
        ? "Build succeeded after the agent's fixes. (Build success compiles the jar — it is not runtime proof; launch it to verify in game.)"
        : `The build still fails after the fix attempt. Latest errors:\n${parseBuildErrors(
            second.logs.map((l) => ({ line: l.line })),
          )
            .slice(0, 5)
            .map((e) => e.message)
            .join("\n")}`;
    await ctx.onStep("verdict", {
      status: second.status === "success" ? "done" : "failed",
      detail: verdict,
    });
    return { result: verdict, model: fixResult.text ? settings.model || null : null };
  },
};

async function timedBuild(
  project: ProjectRecord,
  basePath: string,
): Promise<BuildRun> {
  let last: BuildRun | null = null;
  const result = await runBuild(project, basePath, "build", (run) => {
    last = run;
  });
  return result.status === "running" && last ? last : result;
}

/** Records the real metric for every finished task — called by the engine wiring. */
export async function recordTaskOutcome(
  task: { id: string; model: string | null },
  outcome: { ok: boolean; latencyMs: number; attempts: number },
): Promise<void> {
  const { settings } = await currentAi();
  await recordTaskMetric({
    provider: settings.provider,
    model: task.model || settings.model || "unknown",
    phase: "task",
    ok: outcome.ok,
    latencyMs: outcome.latencyMs,
    attempts: outcome.attempts,
    taskId: task.id,
  });
}
