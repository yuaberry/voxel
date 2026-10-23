/**
 * VOXEL Task Engine (Super Prompt §8/§9, Fase C) — the real queue behind the
 * AI Command Center: every agent run, build job and workflow lands in the
 * database with per-step state, elapsed time and artifacts. Cooperative
 * cancellation between steps, retry for failures, a hard concurrency limit
 * (never more than one autonomous job at a time — the prompt demands
 * execution limits), and metrics per AI call through the router.
 */
import { getDb } from "@/services/db/client";
import type { ProjectRecord } from "@/types";

export type TaskKind = "agent_prompt" | "build" | "workflow_fix_build";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TaskStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  elapsedMs?: number;
}

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  projectId: string | null;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  result: string | null;
  error: string | null;
  model: string | null;
  elapsedMs: number;
  createdAt: string;
  updatedAt: string;
}

/** Injectable storage — the SQLite adapter in production, fakes in tests. */
export interface TaskStore {
  insert(task: TaskRecord): Promise<void>;
  update(id: string, patch: Partial<TaskRecord>): Promise<void>;
  list(): Promise<TaskRecord[]>;
  get(id: string): Promise<TaskRecord | null>;
}

export function createSqliteTaskStore(): TaskStore {
  const serialize = (task: TaskRecord) => ({
    ...task,
    steps_json: JSON.stringify(task.steps),
    result_json: task.result,
  });
  const rowToTask = (row: Record<string, unknown>): TaskRecord => ({
    id: String(row.id),
    kind: String(row.kind) as TaskKind,
    projectId: row.project_id ? String(row.project_id) : null,
    title: String(row.title),
    status: String(row.status) as TaskStatus,
    steps: JSON.parse(String(row.steps_json ?? "[]")) as TaskStep[],
    result: row.result_json ? String(row.result_json) : null,
    error: row.error ? String(row.error) : null,
    model: row.model ? String(row.model) : null,
    elapsedMs: Number(row.elapsed_ms ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  });
  return {
    async insert(task) {
      const t = serialize(task);
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (id, kind, project_id, title, status, steps_json, result_json, error, model, elapsed_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          t.id,
          t.kind,
          t.projectId,
          t.title,
          t.status,
          t.steps_json,
          t.result ?? null,
          t.error,
          t.model,
          t.elapsedMs,
        ],
      );
    },
    async update(id, patch) {
      const db = await getDb();
      const current = await this.get(id);
      if (!current) return;
      const merged = { ...current, ...patch };
      await db.execute(
        `UPDATE tasks SET status=$2, steps_json=$3, result_json=$4, error=$5, model=$6, elapsed_ms=$7, updated_at=datetime('now') WHERE id=$1`,
        [
          id,
          merged.status,
          JSON.stringify(merged.steps),
          merged.result,
          merged.error,
          merged.model,
          merged.elapsedMs,
        ],
      );
    },
    async list() {
      const db = await getDb();
      const rows = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50",
      );
      return rows.map(rowToTask);
    },
    async get(id) {
      const db = await getDb();
      const rows = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM tasks WHERE id=$1",
        [id],
      );
      return rows[0] ? rowToTask(rows[0]) : null;
    },
  };
}

/** A runner performs a task and reports step transitions. */
export interface TaskRunner {
  run(task: TaskRecord, ctx: {
    /** update the steps (checkpointed) */
    onStep: (stepId: string, patch: Partial<TaskStep>) => Promise<void>;
    /** cooperative cancellation — checked between steps */
    shouldAbort: () => boolean;
    /** the project the task belongs to (may be null for global tasks) */
    project: ProjectRecord | null;
    basePath: string;
  }): Promise<{ result: string; model: string | null }>;
}

const MAX_CONCURRENT = 1; // the execution limit — one autonomous job at a time

export class TaskEngineImpl {
  private store: TaskStore;
  private runners = new Map<TaskKind, TaskRunner>();
  private cancelled = new Set<string>();
  private runningCount = 0;
  private queue: string[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: TaskStore) {
    this.store = store;
  }

  register(kind: TaskKind, runner: TaskRunner) {
    this.runners.set(kind, runner);
  }

  async enqueue(input: {
    kind: TaskKind;
    projectId: string | null;
    title: string;
    steps: Array<{ id: string; label: string }>;
    model: string | null;
  }): Promise<TaskRecord> {
    if (this.queue.length >= 20) {
      throw new Error("The queue is full (20 pending tasks) — let the agents catch up first");
    }
    const now = new Date().toISOString();
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const task: TaskRecord = {
      id,
      kind: input.kind,
      projectId: input.projectId,
      title: input.title,
      status: "queued",
      steps: input.steps.map((s) => ({ ...s, status: "pending" as StepStatus })),
      result: null,
      error: null,
      model: input.model,
      elapsedMs: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert(task);
    this.queue.push(task.id);
    this.schedule();
    return task;
  }

  async cancel(id: string): Promise<void> {
    const task = await this.store.get(id);
    if (!task) return;
    if (task.status === "queued") {
      await this.store.update(id, { status: "cancelled" });
      this.queue = this.queue.filter((qid) => qid !== id);
      return;
    }
    if (task.status === "running") {
      this.cancelled.add(id); // the runner notices between steps
    }
  }

  async retry(id: string): Promise<TaskRecord | null> {
    const task = await this.store.get(id);
    if (!task || (task.status !== "failed" && task.status !== "cancelled")) return null;
    const reset: TaskRecord = {
      ...task,
      status: "queued",
      steps: task.steps.map((s) => ({ ...s, status: "pending" as StepStatus, detail: undefined, elapsedMs: undefined })),
      error: null,
      result: null,
      elapsedMs: 0,
    };
    await this.store.update(id, reset);
    this.queue.push(id);
    this.schedule();
    return reset;
  }

  list(): Promise<TaskRecord[]> {
    return this.store.list();
  }

  /** test hook: remove ids from the pending queue (isolation in tests) */
  unqueue(id: string) {
    this.queue = this.queue.filter((qid) => qid !== id);
  }

  /** test hook: force a drain without the timer */
  pump = async (): Promise<void> => {
    while (this.runningCount < MAX_CONCURRENT && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const task = await this.store.get(id);
      if (!task || task.status !== "queued") continue;
      await this.execute(task);
    }
  };

  private schedule() {
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.pump();
    }, 50);
  }

  private async execute(task: TaskRecord): Promise<void> {
    const runner = this.runners.get(task.kind);
    if (!runner) {
      await this.store.update(task.id, {
        status: "failed",
        error: `no runner registered for "${task.kind}"`,
      });
      return;
    }
    this.runningCount += 1;
    const startedAt = Date.now();
    await this.store.update(task.id, { status: "running" });
    try {
      const onStep = async (stepId: string, patch: Partial<TaskStep>) => {
        const current = await this.store.get(task.id);
        if (!current) return;
        const steps = current.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
        await this.store.update(task.id, { steps });
      };
      const shouldAbort = () => this.cancelled.has(task.id);
      const project = ctxProject(task.projectId);
      const basePath = currentBasePath();
      const outcome = await runner.run(task, { onStep, shouldAbort, project, basePath });
      const elapsed = Date.now() - startedAt;
      if (this.cancelled.has(task.id)) {
        this.cancelled.delete(task.id);
        await this.store.update(task.id, {
          status: "cancelled",
          elapsedMs: elapsed,
          error: "cancelled by the user",
        });
      } else {
        await this.store.update(task.id, {
          status: "completed",
          result: outcome.result,
          model: outcome.model ?? task.model,
          elapsedMs: elapsed,
        });
      }
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const wasCancelled = this.cancelled.has(task.id);
      this.cancelled.delete(task.id);
      await this.store.update(task.id, {
        status: wasCancelled ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: elapsed,
      });
    } finally {
      this.runningCount -= 1;
    }
  }
}

// providers wired lazily to avoid store cycles
let engineProjectProvider: () => ProjectRecord[] = () => [];
let engineBasePathProvider: () => string = () => "";
export function wireTaskEngineContexts(
  projectProvider: () => ProjectRecord[],
  basePathProvider: () => string,
) {
  engineProjectProvider = projectProvider;
  engineBasePathProvider = basePathProvider;
}
function ctxProject(projectId: string | null): ProjectRecord | null {
  if (!projectId) return null;
  return engineProjectProvider().find((p) => p.id === projectId) ?? null;
}
function currentBasePath(): string {
  return engineBasePathProvider();
}

let singleton: TaskEngineImpl | null = null;
export function getTaskEngine(store?: TaskStore): TaskEngineImpl {
  if (!singleton) {
    singleton = new TaskEngineImpl(store ?? createSqliteTaskStore());
  }
  return singleton;
}

/** Pure helpers — the queue discipline, tested without a database. */
export function sortQueueDiscipline(tasks: TaskRecord[]): TaskRecord[] {
  const order: Record<TaskStatus, number> = {
    running: 0,
    queued: 1,
    completed: 2,
    failed: 3,
    cancelled: 4,
  };
  return [...tasks].sort((a, b) => order[a.status] - order[b.status]);
}
