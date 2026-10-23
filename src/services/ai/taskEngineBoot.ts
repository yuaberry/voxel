/**
 * Task engine boot — registers the real runners, wires the live stores
 * (projects, storage base) and wraps everything with the honest AI
 * metric. Called once from the App so the queue is alive on every page.
 */
import { getTaskEngine, wireTaskEngineContexts, type TaskRunner } from "./taskEngine";
import { agentPromptRunner, fixBuildRunner, recordTaskOutcome } from "./taskRunners";
import { useProjectsStore } from "@/stores/projectsStore";
import { useSettingsStore } from "@/stores/settingsStore";

let booted = false;

/** Wraps a runner so every finished task records its REAL outcome. */
function withMetrics(runner: TaskRunner): TaskRunner {
  return {
    run: async (task, ctx) => {
      const startedAt = Date.now();
      try {
        const outcome = await runner.run(task, ctx);
        void recordTaskOutcome(
          { id: task.id, model: outcome.model },
          { ok: true, latencyMs: Date.now() - startedAt, attempts: 1 },
        );
        return outcome;
      } catch (error) {
        void recordTaskOutcome(
          { id: task.id, model: task.model },
          {
            ok: false,
            latencyMs: Date.now() - startedAt,
            attempts: error instanceof Error && error.message.includes("cancelled") ? 1 : 1,
          },
        );
        throw error;
      }
    },
  };
}

export function bootTaskEngine(): void {
  if (booted) return;
  booted = true;

  wireTaskEngineContexts(
    () => useProjectsStore.getState().projects,
    () => useSettingsStore.getState().settings.storage.basePath,
  );

  const engine = getTaskEngine();
  engine.register("agent_prompt", withMetrics(agentPromptRunner));
  engine.register("workflow_fix_build", withMetrics(fixBuildRunner));
}
