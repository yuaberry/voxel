/**
 * Player Management (Super Prompt §19).
 *
 * Provides real, checkable player management for server owners:
 * - Read real player files: usercache.json, whitelist.json, banned-players.json, banned-ips.json, ops.json
 * - Apply actions via server console stdin: whitelist add/remove, op/deop, ban, pardon
 * - Punishment history tracking (audit trail)
 * - AI never bans alone - moderation assistant only suggests
 */

import { getDb } from "@/services/db/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawPlayerRecord {
  name: string;
  uuid: string;
  reason?: string;
  expires?: string;
  level?: number;
}

export interface PlayersFiles {
  usercache: RawPlayerRecord[];
  whitelist: RawPlayerRecord[];
  bannedPlayers: RawPlayerRecord[];
  bannedIps: string[];
  ops: RawPlayerRecord[];
}

export interface ManagedPlayer {
  name: string;
  uuid: string;
  whitelisted: boolean;
  banned: boolean;
  banReason: string | null;
  opped: boolean;
  neverJoined: boolean;
}

export type PunishmentType = "ban" | "pardon" | "kick" | "whitelist" | "unwhitelist" | "op" | "deop";

export interface PunishmentRecord {
  id: number;
  serverSlug: string;
  playerName: string;
  uuid: string | null;
  action: PunishmentType;
  reason: string | null;
  source: "user" | "moderation-assistant";
  createdAt: string;
}

export interface PunishmentStore {
  insert(entry: Omit<PunishmentRecord, "id">): Promise<void>;
  list(slug: string, limit?: number): Promise<PunishmentRecord[]>;
}

export interface ModerationFinding {
  player: string;
  kind: string;
  suggestedAction: "watch" | "kick";
  reason: string;
  evidence: string[];
  requiresOwnerDecision: boolean;
}

// ---------------------------------------------------------------------------
// Pure merge logic (testable)
// ---------------------------------------------------------------------------

function recordKey(r: RawPlayerRecord): string {
  return r.uuid ? `u:${r.uuid.toLowerCase()}` : `n:${r.name.toLowerCase()}`;
}

export function mergePlayers(files: PlayersFiles): ManagedPlayer[] {
  const byKey = new Map<string, ManagedPlayer>();

  const upsert = (record: RawPlayerRecord, patch: Partial<ManagedPlayer>) => {
    const key = recordKey(record);
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, patch);
      if (!existing.name && record.name) existing.name = record.name;
      return;
    }
    byKey.set(key, {
      name: record.name,
      uuid: record.uuid,
      whitelisted: false,
      banned: false,
      banReason: null,
      opped: false,
      neverJoined: true,
      ...patch,
    });
  };

  // usercache first - base of players who really joined
  for (const record of files.usercache) {
    const key = recordKey(record);
    const entry = byKey.get(key);
    if (entry) {
      entry.neverJoined = false;
      if (record.name) entry.name = record.name;
    } else {
      byKey.set(key, {
        name: record.name,
        uuid: record.uuid,
        whitelisted: false,
        banned: false,
        banReason: null,
        opped: false,
        neverJoined: false,
      });
    }
  }
  for (const record of files.whitelist) upsert(record, { whitelisted: true });
  for (const record of files.bannedPlayers) upsert(record, { banned: true, banReason: record.reason ?? null });
  for (const record of files.ops) upsert(record, { opped: true });

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Console commands - pure, testable
// ---------------------------------------------------------------------------

export function buildConsoleCommand(
  action: PunishmentType,
  playerName: string,
  reason?: string,
): string {
  const name = playerName.trim();
  if (!name) throw new Error("Player name is empty");
  if (/[\n\r;]/.test(name)) throw new Error("Player name has invalid characters");

  switch (action) {
    case "whitelist":
      return `whitelist add ${name}`;
    case "unwhitelist":
      return `whitelist remove ${name}`;
    case "op":
      return `op ${name}`;
    case "deop":
      return `deop ${name}`;
    case "pardon":
      return `pardon ${name}`;
    case "kick": {
      const cleanReason = (reason ?? "").replace(/[\n\r]/g, " ").trim();
      return cleanReason ? `kick ${name} ${cleanReason}` : `kick ${name}`;
    }
    case "ban": {
      const cleanReason = (reason ?? "").replace(/[\n\r]/g, " ").trim();
      if (!cleanReason) throw new Error("A ban needs a reason");
      return `ban ${name} ${cleanReason}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Punishment stores - injectable for tests
// ---------------------------------------------------------------------------

interface PunishmentRow {
  id: number;
  server_slug: string;
  player_name: string;
  uuid: string | null;
  action: string;
  reason: string | null;
  source: string;
  created_at: string;
}

export function createSqlPunishmentStore(): PunishmentStore {
  return {
    async insert(entry) {
      const db = await getDb();
      await db.execute(
        `INSERT INTO server_punishments (server_slug, player_name, uuid, action, reason, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [entry.serverSlug, entry.playerName, entry.uuid, entry.action, entry.reason, entry.source, entry.createdAt],
      );
    },
    async list(slug, limit = 50) {
      const db = await getDb();
      const rows = await db.select<PunishmentRow[]>(
        `SELECT * FROM server_punishments WHERE server_slug = $1 ORDER BY id DESC LIMIT $2`,
        [slug, limit],
      );
      return rows.map((row) => ({
        id: Number(row.id),
        serverSlug: String(row.server_slug),
        playerName: String(row.player_name),
        uuid: row.uuid ? String(row.uuid) : null,
        action: String(row.action) as PunishmentType,
        reason: row.reason ? String(row.reason) : null,
        source: String(row.source) as "user" | "moderation-assistant",
        createdAt: String(row.created_at),
      }));
    },
  };
}

export function createMemoryPunishmentStore(): PunishmentStore & { records: PunishmentRecord[] } {
  const records: PunishmentRecord[] = [];
  return {
    records,
    async insert(entry) {
      records.push({ id: records.length + 1, ...entry });
    },
    async list(slug, limit = 50) {
      return records.filter((r) => r.serverSlug === slug).slice(-limit).reverse();
    },
  };
}

// ---------------------------------------------------------------------------
// Action runner - applies actions through console + records in history
// ---------------------------------------------------------------------------

export interface ApplyActionInput {
  slug: string;
  action: PunishmentType;
  player: ManagedPlayer;
  reason?: string;
  running: boolean;
  sendCommand: (slug: string, command: string) => Promise<void>;
  store: PunishmentStore;
  source?: "user" | "moderation-assistant";
}

export async function applyPlayerAction(input: ApplyActionInput): Promise<PunishmentRecord> {
  const { slug, action, player, reason, running, sendCommand, store } = input;

  if (!running) {
    throw new Error("Start the server first - player actions go through the running console");
  }

  const command = buildConsoleCommand(action, player.name, reason);
  await sendCommand(slug, command);

  if (action === "ban" || action === "pardon" || action === "kick") {
    const record: Omit<PunishmentRecord, "id"> = {
      serverSlug: slug,
      playerName: player.name,
      uuid: player.uuid || null,
      action,
      reason: reason ?? null,
      source: input.source ?? "user",
      createdAt: new Date().toISOString(),
    };
    await store.insert(record);
    return { id: -1, ...record };
  }

  return {
    id: -1,
    serverSlug: slug,
    playerName: player.name,
    uuid: player.uuid || null,
    action,
    reason: null,
    source: input.source ?? "user",
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Moderation heuristics - deterministic, grounded in real log lines
// ---------------------------------------------------------------------------

const JOIN_RE = /: (\S+) joined the game/;
const LEAVE_RE = /: (\S+) (?:left the game|lost connection)/;
const CHAT_RE = /<(\S+)> (.*)/;

export function analyzeLogTail(lines: string[]): ModerationFinding[] {
  const joins = new Map<string, number>();
  const leaves = new Map<string, number>();
  const chatLines = new Map<string, { player: string; message: string; count: number; sample: string }>();

  for (const line of lines) {
    const join = JOIN_RE.exec(line);
    if (join) joins.set(join[1], (joins.get(join[1]) ?? 0) + 1);
    const leave = LEAVE_RE.exec(line);
    if (leave) leaves.set(leave[1], (leaves.get(leave[1]) ?? 0) + 1);
    const chat = CHAT_RE.exec(line);
    if (chat) {
      const key = `${chat[1]}\u0000${chat[2]}`;
      const bucket = chatLines.get(key) ?? { player: chat[1], message: chat[2], count: 0, sample: line };
      bucket.count += 1;
      chatLines.set(key, bucket);
    }
  }

  const findings: ModerationFinding[] = [];

  for (const [player, joinCount] of joins) {
    const leaveCount = leaves.get(player) ?? 0;
    if (joinCount >= 4 && leaveCount >= 3) {
      findings.push({
        player,
        kind: "join-leave flood",
        suggestedAction: "kick",
        reason: `${joinCount} joins and ${leaveCount} disconnects - reconnect cycling`,
        evidence: lines.filter((l) => JOIN_RE.exec(l)?.[1] === player || LEAVE_RE.exec(l)?.[1] === player).slice(0, 6),
        requiresOwnerDecision: false,
      });
    }
  }

  for (const bucket of chatLines.values()) {
    if (bucket.count >= 4) {
      findings.push({
        player: bucket.player,
        kind: "chat spam",
        suggestedAction: "kick",
        reason: `Same message repeated ${bucket.count} times: "${bucket.message}"`,
        evidence: lines.filter((l) => CHAT_RE.exec(l)?.[1] === bucket.player && l.includes(`<${bucket.player}> ${bucket.message}`)).slice(0, 4),
        requiresOwnerDecision: false,
      });
    }
  }

  return findings;
}

export function filterAiFindings(aiText: string, lines: string[]): ModerationFinding[] {
  const parsed = extractJsonBlock(aiText);
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(["watch", "kick", "ban"]);

  const findings: ModerationFinding[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const f = raw as any;
    const player = typeof f.player === "string" ? f.player.trim() : "";
    const action = typeof f.action === "string" ? f.action.trim().toLowerCase() : "";
    const reason = typeof f.reason === "string" ? f.reason.trim() : "";
    const evidence = Array.isArray(f.evidence) && f.evidence.every((e: unknown) => typeof e === "string") ? (f.evidence as string[]) : [];

    if (!player || !allowed.has(action) || !reason) continue;
    if (evidence.length === 0) continue;

    const grounded = evidence.filter((e) => lines.some((l) => l.includes(e.trim())));
    if (grounded.length === 0) continue;

    findings.push({
      player,
      kind: "AI suggestion",
      suggestedAction: action === "ban" ? "watch" : (action as "watch" | "kick"),
      reason,
      evidence: grounded,
      requiresOwnerDecision: true,
    });
  }
  return findings;
}

function extractJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
