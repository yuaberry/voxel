-- 005 — Server Automation (Super Prompt §22): the run log. Every action an
-- automation rule applied lands here — nothing runs silently, and the owner
-- can audit what fired, when, and with which outcome.
CREATE TABLE IF NOT EXISTS automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_slug TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,                       -- outcome note ("restarted", error text…)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_server
    ON automation_runs (server_slug, created_at DESC);
