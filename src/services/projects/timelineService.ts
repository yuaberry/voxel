/**
 * Project Timeline (Super Prompt §23, Fase A) — one unified, factual line of
 * what happened to a project: builds (from the logs table), agent tool
 * calls (from the audit table), snapshots (real git commits) and sessions.
 * Every event comes from a real store — no invented history.
 */
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/services/db/client";
import type { ProjectRecord, SnapshotEntry } from "@/types";

export type TimelineKind = "build" | "snapshot" | "agent" | "session";

export interface TimelineEvent {
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string;
  status?: "success" | "failed" | "running";
}

export async function getProjectTimeline(
  project: ProjectRecord,
  basePath: string,
): Promise<TimelineEvent[]> {
  const db = await getDb();

  // 1. builds — recorded by the build service per project slug
  const buildRows = await db.select<{ level: string; message: string; created_at: string }[]>(
    "SELECT level, message, created_at FROM logs WHERE source = $1 ORDER BY created_at DESC LIMIT 25",
    [`build:${project.slug}`],
  );
  const builds: TimelineEvent[] = buildRows.map((row) => ({
    kind: "build",
    at: row.created_at,
    title: row.message.split(" — ")[0] ?? "Build",
    detail: row.message.slice(0, 220),
    status: row.level === "error" ? "failed" : "success",
  }));

  // 2. agent tool calls — the audit trail, scoped by this project's sessions
  const toolRows = await db.select<{ tool: string; status: string; result_summary: string | null; created_at: string }[]>(
    `SELECT c.tool, c.status, c.result_summary, c.created_at
       FROM ai_tool_calls c
       JOIN ai_sessions s ON s.id = c.session_id
      WHERE s.project_id = $1
      ORDER BY c.created_at DESC LIMIT 30`,
    [project.id],
  );
  const tools: TimelineEvent[] = toolRows.map((row) => ({
    kind: "agent",
    at: row.created_at,
    title: `Agent · ${row.tool}`,
    detail: (row.result_summary ?? row.status).slice(0, 180),
    status: row.status === "ok" ? "success" : row.status === "error" ? "failed" : undefined,
  }));

  // 3. snapshots — real git commits created by the app (and its agent)
  const snapshots = await invoke<SnapshotEntry[]>("project_list_snapshots", {
    basePath,
    projectRel: `projects/${project.slug}`,
  }).catch(() => [] as SnapshotEntry[]);
  const snapEvents: TimelineEvent[] = snapshots.slice(0, 30).map((snap) => ({
    kind: "snapshot",
    at: snap.date,
    title: `Snapshot ${snap.shortSha}`,
    detail: snap.reason || snap.label,
    status: "success",
  }));

  // 4. AI sessions — the conversations this project had
  const sessionRows = await db.select<{ title: string | null; created_at: string }[]>(
    "SELECT title, created_at FROM ai_sessions WHERE project_id = $1 ORDER BY created_at DESC LIMIT 15",
    [project.id],
  );
  const sessions: TimelineEvent[] = sessionRows.map((row) => ({
    kind: "session",
    at: row.created_at,
    title: row.title?.trim() || "AI session",
    detail: "chat session with the AI Creator",
  }));

  const all = [...builds, ...tools, ...snapEvents, ...sessions];
  // newest first, empty dates sink honestly
  all.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return all.slice(0, 100);
}
