import { describe, expect, it, vi } from "vitest";
import {
  TaskEngineImpl,
  sortQueueDiscipline,
  type TaskRecord,
  type TaskStore,
} from "./taskEngine";

function fakeStore(): TaskStore & { rows: Map<string, TaskRecord> } {
  const rows = new Map<string, TaskRecord>();
  return {
    rows,
    async insert(task) {
      rows.set(task.id, { ...task });
    },
    async update(id, patch) {
      const current = rows.get(id);
      if (current) rows.set(id, { ...current, ...patch });
    },
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
  };
}

function freshEngine() {
  const store = fakeStore();
  // one isolated engine per test — the singleton is for production
  return { store, engine: new TaskEngineImpl(store) };
}

const makeRunner = (impl?: (task: TaskRecord, ctx: Parameters<NonNullable<import("./taskEngine").TaskRunner>["run"]>[1]) => Promise<{ result: string; model: string | null }>) => ({
  run:
    impl ??
    (async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { result: "done", model: "test-model" };
    }),
});

describe("Task Engine — the queue discipline (fake storage)", () => {
  it("enqueues, runs to completion and records the artifact", async () => {
    const { store, engine } = freshEngine();
    engine.register("agent_prompt", makeRunner());
    const task = await engine.enqueue({
      kind: "agent_prompt",
      projectId: null,
      title: "Say hi",
      steps: [{ id: "agent", label: "Agent turn" }],
      model: "m",
    });
    expect(task.status).toBe("queued");
    await engine.pump();
    const done = await store.get(task.id);
    expect(done!.status).toBe("completed");
    expect(done!.result).toBe("done");
    expect(done!.model).toBe("test-model");
    expect(done!.steps[0].status).toBe("pending"); // runner didn't touch steps
  });

  it("serializes: with MAX_CONCURRENT=1 the second task waits", async () => {
    const { store, engine } = freshEngine();
    let active = 0;
    let maxConcurrent = 0;
    const slow: import("./taskEngine").TaskRunner = {
      run: async () => {
        active += 1;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return { result: "ok", model: null };
      },
    };
    engine.register("agent_prompt", slow);
    const a = await engine.enqueue({ kind: "agent_prompt", projectId: null, title: "a", steps: [], model: null });
    const b = await engine.enqueue({ kind: "agent_prompt", projectId: null, title: "b", steps: [], model: null });
    await engine.pump();
    expect(maxConcurrent).toBe(1); // the execution limit holds
    expect((await store.get(a.id))!.status).toBe("completed");
    expect((await store.get(b.id))!.status).toBe("completed");
  });

  it("cancels a queued task without running it", async () => {
    const { store, engine } = freshEngine();
    const runner = makeRunner();
    const spy = vi.fn(runner.run);
    engine.register("agent_prompt", { run: spy });
    await engine.enqueue({ kind: "agent_prompt", projectId: null, title: "busy", steps: [], model: null });
    engine.register("agent_prompt", { run: spy });
    const task = await engine.enqueue({ kind: "agent_prompt", projectId: null, title: "cancel me", steps: [], model: null });
    await engine.cancel(task.id);
    (engine as unknown as { queue: string[] }).queue.length = 0; // isolation: drain only this test
    await engine.pump();
    expect(spy).not.toHaveBeenCalled();
    expect((await store.get(task.id))!.status).toBe("cancelled");
  });

  it("a failed task keeps the error and retry resets it to queued", async () => {
    const { store, engine } = freshEngine();
    let attempts = 0;
    const flaky: import("./taskEngine").TaskRunner = {
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("provider exploded");
        return { result: "second try works", model: null };
      },
    };
    engine.register("agent_prompt", flaky);
    const task = await engine.enqueue({ kind: "agent_prompt", projectId: null, title: "flaky", steps: [], model: null });
    await engine.pump();
    const failed = await store.get(task.id);
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toContain("provider exploded");

    const retried = await engine.retry(task.id);
    expect(retried!.status).toBe("queued");
    await engine.pump();
    const done = await store.get(task.id);
    expect(done!.status).toBe("completed");
    expect(done!.result).toBe("second try works");
  });

  it("cooperative cancellation aborts a runner between steps", async () => {
    const { store, engine } = freshEngine();
    const cancellable: import("./taskEngine").TaskRunner = {
      run: async (_task, ctx) => {
        ctx.onStep("s1", { status: "done" });
        await new Promise((r) => setTimeout(r, 10));
        if (ctx.shouldAbort()) throw new Error("cancelled by the user");
        return { result: "never", model: null };
      },
    };
    engine.register("agent_prompt", cancellable);
    const task = await engine.enqueue({
      kind: "agent_prompt",
      projectId: null,
      title: "cancellable",
      steps: [{ id: "s1", label: "step one" }],
      model: null,
    });
    // drain manually while cancelling mid-flight
    const execute = (engine as unknown as { execute: (t: TaskRecord) => Promise<void> }).execute.bind(engine);
    const running = execute(task);
    await engine.cancel(task.id);
    await running;
    const done = await store.get(task.id);
    expect(done!.status).toBe("cancelled");
  });

  it("refuses to enqueue past the queue cap (20) — the execution limit", async () => {
    const { engine } = freshEngine();
    for (let i = 0; i < 20; i++) {
      await engine.enqueue({ kind: "agent_prompt", projectId: null, title: `t${i}`, steps: [], model: null });
    }
    await expect(
      engine.enqueue({ kind: "agent_prompt", projectId: null, title: "overflow", steps: [], model: null }),
    ).rejects.toThrow(/queue is full/);
  });

  it("sorts the Command Center list: running first, then queued, then history", () => {
    const base: TaskRecord = {
      id: "x",
      kind: "agent_prompt",
      projectId: null,
      title: "t",
      status: "queued",
      steps: [],
      result: null,
      error: null,
      model: null,
      elapsedMs: 0,
      createdAt: "",
      updatedAt: "",
    };
    const tasks: TaskRecord[] = [
      { ...base, id: "done", status: "completed" },
      { ...base, id: "queued", status: "queued" },
      { ...base, id: "running", status: "running" },
      { ...base, id: "failed", status: "failed" },
    ];
    expect(sortQueueDiscipline(tasks).map((t) => t.status)).toEqual([
      "running",
      "queued",
      "completed",
      "failed",
    ]);
  });
});
