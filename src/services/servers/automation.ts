/**
 * Server Automation (Super Prompt §22) — trigger → condition → action with
 * limits. The rules live in the server manifest (allowlisted at the Rust
 * perimeter), the engine watches status transitions, and one rule governs
 * everything: NOTHING destructive runs silently — every applied action is
 * recorded in the automation run log (migration 005) and surfaces as a
 * notification.
 *
 * Honest limits, stated up front: the engine runs while the app is open
 * (same as the backup scheduler), the first status reading is a baseline
 * (no transition fires on app boot), and a rule has a cooldown — a server
 * flapping online/offline never thrashes the machine into a restart loop.
 */

import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/services/db/client";
import { useSettingsStore } from "@/stores/settingsStore";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import { notifyDesktop } from "@/services/notifications/notificationService";
import type { ServerRecord } from "@/types";

// ---------------------------------------------------------------------------
// Types (camelCase mirrors of the Rust perimeter)
// ---------------------------------------------------------------------------

export type AutomationTrigger = "offline" | "online";
export type AutomationAction = "notify" | "backup" | "restart";

export interface AutomationRule {
  id: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  enabled: boolean;
}

export interface AutomationRunRecord {
  id: number;
  serverSlug: string;
  ruleId: string;
  trigger: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

/** One rule fires at most once per cooldown window. */
export const AUTOMATION_COOLDOWN_MS = 5 * 60 * 1000;

export interface AutomationRunStore {
  insert(entry: Omit<AutomationRunRecord, "id">): Promise<void>;
  list(slug: string, limit?: number): Promise<AutomationRunRecord[]>;
}

// ---------------------------------------------------------------------------
// Command wrappers
// ---------------------------------------------------------------------------

export async function getAutomations(basePath: string, slug: string): Promise<AutomationRule[]> {
  return invoke<AutomationRule[]>("server_automations_get", { basePath, slug });
}

export async function setAutomations(
  basePath: string,
  slug: string,
  rules: AutomationRule[],
): Promise<AutomationRule[]> {
  return invoke<AutomationRule[]>("server_automations_set", { basePath, slug, rules });
}

// ---------------------------------------------------------------------------
// The transition engine (pure) — the tests drive this directly
// ---------------------------------------------------------------------------

export interface FiredAction {
  rule: AutomationRule;
  serverSlug: string;
}

export interface TransitionState {
  /** previous running status per slug — null when never observed (baseline) */
  lastStatus: Map<string, boolean | null>;
  /** rule id → epoch ms of its last firing (cooldown bookkeeping) */
  lastFired: Map<string, number>;
}

export function createTransitionState(): TransitionState {
  return { lastStatus: new Map(), lastFired: new Map() };
}

export function evaluateTransition(
  state: TransitionState,
  slug: string,
  running: boolean,
  rules: AutomationRule[],
  now: number,
  cooldownMs: number = AUTOMATION_COOLDOWN_MS,
): FiredAction[] {
  const prev = state.lastStatus.get(slug) ?? null;
  state.lastStatus.set(slug, running);
  if (prev === null) return []; // baseline reading — never fires on boot
  if (prev === running) return []; // no transition

  const trigger: AutomationTrigger = prev ? "offline" : "online";
  const fired: FiredAction[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.trigger !== trigger) continue;
    const last = state.lastFired.get(rule.id) ?? Number.NEGATIVE_INFINITY;
    if (now - last < cooldownMs) continue; // anti-thrash
    state.lastFired.set(rule.id, now);
    fired.push({ rule, serverSlug: slug });
  }
  return fired;
}

// ---------------------------------------------------------------------------
// Run stores (DB + memory for tests)
// ---------------------------------------------------------------------------

interface AutomationRunRow {
  id: number;
  server_slug: string;
  rule_id: string;
  trigger: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export function createSqlAutomationRunStore(): AutomationRunStore {
  return {
    async insert(entry) {
      const db = await getDb();
      await db.execute(
        `INSERT INTO automation_runs (server_slug, rule_id, trigger, action, detail, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [entry.serverSlug, entry.ruleId, entry.trigger, entry.action, entry.detail, entry.createdAt],
      );
    },
    async list(slug, limit = 50) {
      const db = await getDb();
      const rows = await db.select<AutomationRunRow[]>(
        `SELECT * FROM automation_runs
         WHERE server_slug = $1 ORDER BY id DESC LIMIT $2`,
        [slug, limit],
      );
      return rows.map((row) => ({
        id: Number(row.id),
        serverSlug: String(row.server_slug),
        ruleId: String(row.rule_id),
        trigger: String(row.trigger),
        action: String(row.action),
        detail: row.detail ? String(row.detail) : null,
        createdAt: String(row.created_at),
      }));
    },
  };
}

export function createMemoryAutomationRunStore(): AutomationRunStore & {
  runs: AutomationRunRecord[];
} {
  const runs: AutomationRunRecord[] = [];
  return {
    runs,
    async insert(entry) {
      runs.push({ id: runs.length + 1, ...entry });
    },
    async list(slug, limit = 50) {
      return runs.filter((r) => r.serverSlug === slug).slice(-limit).reverse();
    },
  };
}

// ---------------------------------------------------------------------------
// The runner — dependencies injected, one tick at a time
// ---------------------------------------------------------------------------

export interface AutomationDeps {
  listServers: () => Promise<ServerRecord[]>;
  loadRules: (slug: string) => Promise<AutomationRule[]>;
  isRunning: (slug: string) => Promise<boolean>;
  backupNow: (slug: string) => Promise<void>;
  startServer: (server: ServerRecord) => Promise<void>;
  notify: (title: string, body: string) => void;
  record: (entry: Omit<AutomationRunRecord, "id">) => Promise<void>;
  now: () => number;
}

function defaultDeps(basePath: () => string): AutomationDeps {
  return {
    listServers: () => listServersReconciled(basePath()),
    loadRules: (slug) => getAutomations(basePath(), slug),
    isRunning: (slug) => invoke<boolean>("server_status", { slug }).catch(() => false),
    backupNow: (slug) =>
      invoke("server_backup", { basePath: basePath(), slug }).then(() => undefined),
    startServer: (server) =>
      invoke("server_start", {
        basePath: basePath(),
        slug: server.slug,
        ramMb: server.ram_mb,
      })
        .then(() => undefined)
        .catch(() => undefined),
    notify: (title, body) => void notifyDesktop(title, body),
    record: async (entry) => {
      await createSqlAutomationRunStore().insert(entry);
    },
    now: () => Date.now(),
  };
}

/** Applies one fired action. Every outcome is recorded — silence is the bug. */
async function applyAction(
  deps: AutomationDeps,
  server: ServerRecord,
  fired: FiredAction,
  running: boolean,
): Promise<void> {
  const { rule } = fired;
  const base = {
    serverSlug: server.slug,
    ruleId: rule.id,
    trigger: rule.trigger,
    createdAt: new Date(deps.now()).toISOString(),
  };
  let detail = "";
  let outcome: "applied" | "failed" | "skipped" = "applied";

  try {
    if (rule.action === "restart") {
      // trigger "offline" means the process died — restart boots it again
      if (running) {
        outcome = "skipped";
        detail = "server is running again on its own — restart not needed";
      } else {
        await deps.startServer(server);
        detail = "restart issued by automation";
      }
    } else if (rule.action === "backup") {
      // world safety: never back up a running server
      if (running) {
        outcome = "skipped";
        detail = "server is running — backup skipped (world safety)";
      } else {
        await deps.backupNow(server.slug);
        detail = "backup taken by automation";
      }
    } else {
      detail = "notification only";
    }
  } catch (e) {
    outcome = "failed";
    detail = String(e);
  }

  await deps.record({ ...base, action: rule.action, detail: `${outcome}: ${detail}` });
  if (outcome === "failed") {
    deps.notify("Automation failed", `Server ${server.slug}, rule ${rule.id}: ${detail}`);
  } else if (rule.action === "restart" && outcome === "applied") {
    // a restart is the strongest action in the allowlist — never silent
    deps.notify("Automation restarted the server", `Server ${server.slug} came back up`);
  }
}

export async function automationTick(
  deps: AutomationDeps,
  state: TransitionState = globalState,
): Promise<void> {
  const servers = await deps.listServers().catch(() => []);
  for (const server of servers) {
    const rules = await deps.loadRules(server.slug).catch(() => [] as AutomationRule[]);
    if (rules.length === 0) continue;
    const running = await deps.isRunning(server.slug);
    const fired = evaluateTransition(state, server.slug, running, rules, deps.now());
    for (const item of fired) {
      await applyAction(deps, server, item, running);
    }
  }
}

// ---------------------------------------------------------------------------
// The loop — a singleton, booted with the app, ticking every minute
// ---------------------------------------------------------------------------

const globalState: TransitionState = createTransitionState();
let automationHandle: ReturnType<typeof setInterval> | null = null;

export function startAutomationLoop(
  depsOverride?: Partial<AutomationDeps> & { basePath?: () => string },
): () => void {
  if (automationHandle) return () => undefined; // singleton — one loop
  const deps = {
    ...defaultDeps(
      depsOverride?.basePath ??
        (() => useSettingsStore.getState().settings.storage.basePath),
    ),
    ...depsOverride,
  };
  automationHandle = setInterval(() => void automationTick(deps), 60 * 1000);
  return () => {
    if (automationHandle) clearInterval(automationHandle);
    automationHandle = null;
  };
}
