-- 004 — Player Management (Super Prompt §19/§20): the punishment history.
-- Every ban/pardon applied through the panel lands here — the owner can
-- audit what the moderation assistant suggested and what was applied.
CREATE TABLE IF NOT EXISTS server_punishments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_slug TEXT NOT NULL,
    player_name TEXT NOT NULL,
    uuid TEXT,
    action TEXT NOT NULL,            -- ban | pardon | kick | whitelist | unwhitelist
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'user', -- user | moderation-assistant (suggestion applied by the user)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_punishments_server
    ON server_punishments (server_slug, created_at DESC);
