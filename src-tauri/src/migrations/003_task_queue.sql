-- v3 — Phase C foundation: the AI task queue and the model metrics.
-- Tasks back the AI Command Center: every agent run, build job and
-- workflow lands here with its per-step state, elapsed time and artifacts.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                      -- agent | build | workflow
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|running|completed|failed|cancelled
  steps_json TEXT NOT NULL DEFAULT '[]',  -- [{id,label,status,detail,elapsedMs}]
  result_json TEXT,
  error TEXT,
  model TEXT,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Real per-call metrics from the AI layer (no invented numbers): ok/fail,
-- latency, attempts (fallbacks) and the task the call belongs to.
CREATE TABLE IF NOT EXISTS ai_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT,
  ok INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  task_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_metrics_created ON ai_metrics(created_at);
