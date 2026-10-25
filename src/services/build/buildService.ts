import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ProjectRecord } from "@/types";
import { detectEnvironment } from "@/services/environment/environmentService";
import { readProjectFile } from "@/services/projects/projectsService";
import { updateProjectBuildStatus } from "@/services/db/repositories/projectsRepository";
import { notifyDesktop } from "@/services/notifications/notificationService";

/**
 * Build Service (Fase 4) — real gradle processes, streamed through Rust
 * events. One run per project; logs buffered client-side for the drawer.
 */

export interface BuildLogLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface BuildRun {
  projectRel: string;
  task: string;
  startedAt: number;
  endedAt: number | null;
  status: "running" | "success" | "failed" | "stopped";
  exitCode: number | null;
  logs: BuildLogLine[];
}

export async function startBuildCommand(
  basePath: string,
  projectRel: string,
  task: string,
  customJavaPath?: string,
): Promise<string> {
  return invoke<string>("start_build", {
    basePath,
    projectRel,
    task,
    customJavaPath: customJavaPath?.trim() ? customJavaPath.trim() : null,
  });
}

export async function stopBuildCommand(projectRel: string): Promise<void> {
  await invoke("stop_build", { projectRel });
}

export interface PreflightResult {
  ok: boolean;
  issues: string[];
  javaMajor: number | null;
  firstBuildHint: boolean;
}

/** Checks the machine before a build: Java version + project shape. */
export async function preflightBuild(
  project: ProjectRecord,
  basePath: string,
): Promise<PreflightResult> {
  const issues: string[] = [];
  let javaMajor: number | null = null;

  try {
    const env = await detectEnvironment();
    javaMajor = env.java.majorVersion;
    if (!env.java.found) {
      issues.push("Java was not found on this machine (Settings → Java).");
    }
    // 1.20.x needs 17+; 26.x needs 21 — the template targets >= 17
    else if ((env.java.majorVersion ?? 0) < 17) {
      issues.push(`Java ${env.java.majorVersion} found — mods need Java 17 or newer.`);
    }
  } catch {
    issues.push("Could not detect Java (Settings → Java).");
  }

  const buildGradle = await readProjectFile(
    basePath,
    `projects/${project.slug}/build.gradle`,
  ).catch(() => null);
  if (!buildGradle) {
    issues.push("build.gradle not found — is this a mod project?");
  }

  // Deterministic "first build" signal: the project never built before.
  // The first build downloads Gradle + dependencies into the shared cache.
  const firstBuildHint = project.last_build_status === null;

  return { ok: issues.length === 0, issues, javaMajor, firstBuildHint };
}

/**
 * Runs a build and follows it to completion (or failure), buffering logs.
 * Resolves when the process exits. onExit persists the build status.
 */
export async function runBuild(
  project: ProjectRecord,
  basePath: string,
  task: "build" | "clean" | "jar",
  onLine: (run: BuildRun) => void,
  customJavaPath?: string,
): Promise<BuildRun> {
  const projectRel = `projects/${project.slug}`;
  const run: BuildRun = {
    projectRel,
    task,
    startedAt: Date.now(),
    endedAt: null,
    status: "running",
    exitCode: null,
    logs: [],
  };

  let unlistenFns: UnlistenFn[] = [];

  try {
    // Register listeners BEFORE spawning so early log lines are never lost
    await new Promise<void>((resolveTop) => {
      let started = false;
      const startOnce = () => {
        if (started) return;
        started = true;
        void startBuildCommand(basePath, projectRel, task, customJavaPath)
          .catch((error) => {
            run.status = "failed";
            run.endedAt = Date.now();
            run.logs.push({ stream: "stderr", line: String(error) });
            onLine(run);
            resolveTop();
          });
      };

      void listen<{ project: string; stream: string; line: string }>("build:log", (event) => {
        const payload = event.payload;
        if (payload.project !== projectRel) return;
        run.logs.push({ stream: payload.stream as BuildLogLine["stream"], line: payload.line });
        onLine(run);
      }).then((fn) => {
        unlistenFns.push(fn);
        startOnce();
      });

      void listen<{ project: string; code: number | null; success: boolean }>(
        "build:exit",
        (event) => {
          const payload = event.payload;
          if (payload.project !== projectRel) return;
          run.endedAt = Date.now();
          run.exitCode = payload.code;
          run.status = payload.success ? "success" : "failed";
          onLine(run);
          // Desktop ping (briefing §62) — the build ends while the user is
          // elsewhere; a no-op without OS permission.
          void notifyDesktop(
            payload.success ? "Build succeeded" : "Build failed",
            `${project.name} — exit code ${payload.code ?? "n/a"}`,
          );
          resolveTop();
        },
      ).then((fn) => {
        unlistenFns.push(fn);
        startOnce();
      });
    });
  } finally {
    for (const fn of unlistenFns) fn();
    unlistenFns = [];
  }

  // Persist the outcome (best-effort)
  void updateProjectBuildStatus(project.id, run.status).catch(() => {});

  return run;
}

/**
 * Persists a compact build outcome to the `logs` table (AD-8).
 * Full transcripts stay in the drawer; the DB keeps the searchable record.
 */
export async function persistBuildLogEntry(
  project: ProjectRecord,
  run: BuildRun,
): Promise<void> {
  try {
    const { getDb } = await import("@/services/db/client");
    const db = await getDb();
    const errorLines = run.logs
      .filter((l) => l.line.includes("error") || l.stream === "stderr")
      .slice(-8)
      .map((l) => l.line.slice(0, 200))
      .join(" | ");
    const elapsedMs = run.endedAt != null ? run.endedAt - run.startedAt : 0;
    const elapsedNote = elapsedMs > 0 ? ` in ${Math.round(elapsedMs / 1000)}s` : "";
    const message =
      run.status === "success"
        ? `Build success (${run.task}) — ${run.logs.length} lines${elapsedNote}`
        : `Build failed (exit ${run.exitCode ?? "?"}) — ${run.logs.length} lines${elapsedNote}${errorLines ? ` — tail: ${errorLines}` : ""}`;
    await db.execute(
      `INSERT INTO logs (level, source, message) VALUES ($1, $2, $3)`,
      [run.status === "success" ? "info" : "error", `build:${project.slug}`, message],
    );
  } catch (error) {
    console.warn("Failed to persist build log entry:", error);
  }
}
