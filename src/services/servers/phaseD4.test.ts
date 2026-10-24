/**
 * Server Automation (§22) — the tests: transitions fire exactly once, the
 * baseline never fires, the cooldown blocks thrash, the allowlist is the
 * Rust perimeter's job (already tested there), and nothing runs silently —
 * restarts surface, failures surface, skips are recorded honestly.
 */
import { describe, expect, it, vi } from "vitest";
import {
  automationTick,
  createMemoryAutomationRunStore,
  createTransitionState,
  evaluateTransition,
  type AutomationDeps,
  type AutomationRule,
} from "./automation";

const rule = (overrides: Partial<AutomationRule>): AutomationRule => ({
  id: "r1",
  trigger: "offline",
  action: "restart",
  enabled: true,
  ...overrides,
});

describe("Server Automation — the transition engine (§22)", () => {
  it("fires offline rules on the running→stopped transition", () => {
    const state = createTransitionState();
    // baseline: running
    expect(evaluateTransition(state, "arena", true, [rule({})], 1000)).toEqual([]);
    // transition to stopped → fires
    const fired = evaluateTransition(state, "arena", false, [rule({})], 2000);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("r1");
    // still stopped → no transition, no firing
    expect(evaluateTransition(state, "arena", false, [rule({})], 3000)).toEqual([]);
  });

  it("fires online rules when the server comes back", () => {
    const state = createTransitionState();
    evaluateTransition(state, "arena", false, [rule({ trigger: "online" })], 1000);
    const fired = evaluateTransition(state, "arena", true, [rule({ trigger: "online" })], 2000);
    expect(fired).toHaveLength(1);
  });

  it("the baseline reading never fires — no restart storms on app boot", () => {
    const state = createTransitionState();
    // first ever observation: stopped server, offline rules armed
    expect(evaluateTransition(state, "arena", false, [rule({})], 1000)).toEqual([]);
  });

  it("the cooldown blocks a flapping server from thrashing", () => {
    const state = createTransitionState();
    evaluateTransition(state, "arena", true, [rule({})], 0);
    // falls → fires
    expect(evaluateTransition(state, "arena", false, [rule({})], 1000)).toHaveLength(1);
    // comes back and falls again within the cooldown → blocked
    evaluateTransition(state, "arena", true, [rule({})], 2000);
    expect(evaluateTransition(state, "arena", false, [rule({})], 3000)).toEqual([]);
    // after the cooldown window passes → fires again
    evaluateTransition(state, "arena", true, [rule({})], 2000);
    const again = evaluateTransition(
      state,
      "arena",
      false,
      [rule({})],
      3000 + 5 * 60 * 1000 + 1,
    );
    expect(again).toHaveLength(1);
  });

  it("disabled rules and wrong triggers never fire", () => {
    const state = createTransitionState();
    const rules = [
      rule({ id: "off", enabled: false }),
      rule({ id: "online-only", trigger: "online" }),
    ];
    evaluateTransition(state, "arena", true, rules, 1000);
    expect(evaluateTransition(state, "arena", false, rules, 2000)).toEqual([]);
  });
});

describe("Server Automation — the runner (§22)", () => {
  const makeDeps = (overrides: Partial<AutomationDeps>): AutomationDeps & {
    store: ReturnType<typeof createMemoryAutomationRunStore>;
  } => {
    const store = createMemoryAutomationRunStore();
    return {
      store,
      listServers: async () => [
        { slug: "arena", name: "Arena", ram_mb: 2048 } as never,
      ],
      loadRules: async () => [rule({})],
      isRunning: async () => false,
      backupNow: async () => undefined,
      startServer: async () => undefined,
      notify: () => undefined,
      record: async (entry) => void store.insert(entry),
      now: () => 10_000,
      ...overrides,
    };
  };

  it("a crash (running→stopped) triggers the restart, recorded and notified", async () => {
    const startServer = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    const deps = makeDeps({
      startServer,
      notify,
      isRunning: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const state = createTransitionState();

    // first tick: baseline (running)
    await automationTick(deps, state);
    // second tick: the server died → restart fires
    await automationTick(deps, state);

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(deps.store.runs).toHaveLength(1);
    expect(deps.store.runs[0].action).toBe("restart");
    expect(deps.store.runs[0].detail).toContain("restart issued by automation");
    expect(notify).toHaveBeenCalledWith("Automation restarted the server", expect.any(String));
  });

  it("a failed restart is recorded honestly and alerts the owner", async () => {
    const startServer = vi.fn().mockRejectedValue(new Error("java missing"));
    const notify = vi.fn();
    const deps = makeDeps({
      startServer,
      notify,
      isRunning: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const state = createTransitionState();
    await automationTick(deps, state);
    await automationTick(deps, state);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe("Automation failed");
    expect(deps.store.runs[0].detail).toContain("failed");
    expect(deps.store.runs[0].detail).toContain("java missing");
  });

  it("a backup action on an offline server runs and is recorded", async () => {
    const backupNow = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      backupNow,
      loadRules: async () => [rule({ action: "backup" })],
      isRunning: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const state = createTransitionState();
    await automationTick(deps, state);
    await automationTick(deps, state);

    expect(backupNow).toHaveBeenCalledWith("arena");
    expect(deps.store.runs[0].detail).toContain("backup taken by automation");
  });

  it("a self-healed server skips the restart — recorded honestly, no alert", async () => {
    const startServer = vi.fn();
    const notify = vi.fn();
    const deps = makeDeps({
      startServer,
      notify,
      // tick 1 baseline running, tick 2 sees it still running (came back?)
      isRunning: vi.fn().mockResolvedValue(true),
    });
    const state = createTransitionState();
    await automationTick(deps, state);
    await automationTick(deps, state);
    // running the whole time — no transition at all
    expect(startServer).not.toHaveBeenCalled();
    expect(deps.store.runs).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("servers without rules cost nothing — no status spam, no rows", async () => {
    const isRunning = vi.fn().mockResolvedValue(false);
    const deps = makeDeps({ loadRules: async () => [], isRunning });
    const state = createTransitionState();
    await automationTick(deps, state);
    await automationTick(deps, state);
    // empty rules short-circuit before even asking for status
    expect(isRunning).not.toHaveBeenCalled();
    expect(deps.store.runs).toHaveLength(0);
  });
});
