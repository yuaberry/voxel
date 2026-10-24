/**
 * Player Management + Moderation Assistant (Super Prompt §19 + §20).
 *
 * §19 — the REAL player files: usercache.json (everyone who ever joined),
 * whitelist.json, banned-players.json, banned-ips.json and ops.json, read
 * from the server's own directory by the Rust perimeter. Actions go through
 * the running server's console stdin (server_send_command) — the app never
 * edits the vanilla files behind the server's back, because the server
 * caches them in memory and would overwrite our edits.
 *
 * §20 — the AI never bans on its own. The moderation assistant only reads
 * the log and SUGGESTS, and every suggestion must quote evidence that
 * literally exists in the log (filterAiFindings drops anything else).
 * The apply is always a click by the owner, and every applied action lands
 * in the punishment history (migration 004) with its source.
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

/** camelCase mirror of the Rust `PlayersFiles`. */
export interface PlayersFiles {
  usercache: RawPlayerRecord[];
  whitelist: RawPlayerRecord[];
  bannedPlayers: RawPlayerRecord[];
  bannedIps: string[];
  ops: RawPlayerRecord[];
}

/** A player merged across every file. */
export interface ManagedPlayer {
  name: string;
  uuid: string;
  whitelisted: boolean;
  banned: boolean;
  banReason: string | null;
  opped: boolean;
  /** true when the player only exists on whitelist/ops — never joined yet. */
  neverJoined: boolean;
}

export type PlayerAction =
  | "whitelist"
  | "unwhitelist"
  | "op"
  | "deop"
  | "ban"
  | "pardon"
  | "kick";

export interface PunishmentRecord {
  id: number;
  serverSlug: string;
  playerName: string;
  uuid: string | null;
  action: string;
  reason: string | null;
  source: string;
  createdAt: string;
}

/** Punishable actions — whitelist membership is not a punishment. */
const HISTORY_ACTIONS: ReadonlySet<PlayerAction> = new Set(["ban", "pardon", "kick"]);

export interface ModerationFinding {
  player: string;
  kind: string;
  /** The assistant never suggests more than a kick — a ban is the owner's call. */
  suggestedAction: "watch" | "kick";
  reason: string;
  evidence: string[];
  /** Suggestions coming from the AI always carry this — the owner decides. */
  requiresOwnerDecision: boolean;
}

export interface PunishmentStore {
  insert(entry: Omit<PunishmentRecord, "id">): Promise<void>;
  list(slug: string, limit?: number): Promise<PunishmentRecord[]>;
}

// ---------------------------------------------------------------------------
// Merge (pure)
// ---------------------------------------------------------------------------

function recordKey(r: RawPlayerRecord): string {
  // uuid is the identity when present; name (case-folded) is the fallback
  return r.uuid ? `u:${r.uuid.toLowerCase()}` : `n:${r.name.toLowerCase()}`;
}

export function mergePlayers(files: PlayersFiles): ManagedPlayer[] {
  const byKey = new Map<string, ManagedPlayer>();

  const upsert = (record: RawPlayerRecord, patch: Partial<ManagedPlayer>) => {
    const key = recordKey(record);
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, patch);
      // usercache names are the freshest (the server refreshes them on join)
      if (!existing.name && record.name) existing.name = record.name;
      return;
    }
    byKey.set(key, {
      name: record.name,
      uuid: record.uuid,
      neverJoined: true,
      whitelisted: false,
      banned: false,
      banReason: null,
      opped: false,
      ...patch,
    });
  };

  // usercache first — it is the base of players who really joined
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
  for (const record of files.bannedPlayers) {
    upsert(record, { banned: true, banReason: record.reason ?? null });
  }
  for (const record of files.ops) upsert(record, { opped: true });

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Console commands (pure)
// ---------------------------------------------------------------------------

export function buildConsoleCommand(
  action: PlayerAction,
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
      // a ban without a reason is unauditable — refuse it
      const cleanReason = (reason ?? "").replace(/[\n\r]/g, " ").trim();
      if (!cleanReason) throw new Error("A ban needs a reason (audit trail)");
      return `ban ${name} ${cleanReason}`;
    }
  }
}

export interface ApplyActionInput {
  slug: string;
  action: PlayerAction;
  player: ManagedPlayer;
  reason?: string;
  /** A running server — console commands go through its stdin. */
  running: boolean;
  sendCommand: (slug: string, command: string) => Promise<void>;
  store: PunishmentStore;
  /** "user" (a click) or "moderation-assistant" (an approved suggestion). */
  source?: "user" | "moderation-assistant";
}

/** Sends the action through the console and records the punishment. */
export async function applyPlayerAction(input: ApplyActionInput): Promise<PunishmentRecord> {
  const { slug, action, player, reason, running, sendCommand, store } = input;
  if (!running) {
    throw new Error(
      "Start the server first — player actions go through the running console",
    );
  }
  const command = buildConsoleCommand(action, player.name, reason);
  await sendCommand(slug, command);

  if (HISTORY_ACTIONS.has(action)) {
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
  // non-punishment actions carry no history row
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
// Punishment stores
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
        `INSERT INTO server_punishments
           (server_slug, player_name, uuid, action, reason, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          entry.serverSlug,
          entry.playerName,
          entry.uuid,
          entry.action,
          entry.reason,
          entry.source,
          entry.createdAt,
        ],
      );
    },
    async list(slug, limit = 50) {
      const db = await getDb();
      const rows = await db.select<PunishmentRow[]>(
        `SELECT * FROM server_punishments
         WHERE server_slug = $1 ORDER BY id DESC LIMIT $2`,
        [slug, limit],
      );
      return rows.map((row) => ({
        id: Number(row.id),
        serverSlug: String(row.server_slug),
        playerName: String(row.player_name),
        uuid: row.uuid ? String(row.uuid) : null,
        action: String(row.action),
        reason: row.reason ? String(row.reason) : null,
        source: String(row.source),
        createdAt: String(row.created_at),
      }));
    },
  };
}

export function createMemoryPunishmentStore(): PunishmentStore & {
  records: PunishmentRecord[];
} {
  const records: PunishmentRecord[] = [];
  return {
    records,
    async insert(entry) {
      records.push({ id: records.length + 1, ...entry });
    },
    async list(slug, limit = 50) {
      return records
        .filter((r) => r.serverSlug === slug)
        .slice(-limit)
        .reverse();
    },
  };
}

// ---------------------------------------------------------------------------
// Moderation — deterministic heuristics over the real log lines
// ---------------------------------------------------------------------------

const JOIN_RE = /: (\S+) joined the game/;
const LEAVE_RE = /: (\S+) (?:left the game|lost connection)/;
const CHAT_RE = /<(\S+)> (.*)/;

/**
 * Deterministic pattern hunting over the log tail. No network, no model —
 * just what the server itself wrote. The assistant never suggests a ban:
 * that is the owner's decision (§20).
 */
export function analyzeLogTail(lines: string[]): ModerationFinding[] {
  const joins = new Map<string, number>();
  const leaves = new Map<string, number>();
  const chatLines = new Map<string, { player: string; message: string; count: number; sample: string }>();

  for (const line of lines) {
    const join = JOIN_RE.exec(line);
    if (join) {
      const player = join[1];
      joins.set(player, (joins.get(player) ?? 0) + 1);
    }
    const leave = LEAVE_RE.exec(line);
    if (leave) {
      const player = leave[1];
      leaves.set(player, (leaves.get(player) ?? 0) + 1);
    }
    const chat = CHAT_RE.exec(line);
    if (chat) {
      const player = chat[1];
      const message = chat[2];
      const key = `${player}\u0000${message}`;
      const bucket = chatLines.get(key) ?? { player, message, count: 0, sample: line };
      bucket.count += 1;
      chatLines.set(key, bucket);
    }
  }

  const findings: ModerationFinding[] = [];

  for (const [player, joinCount] of joins) {
    const leaveCount = leaves.get(player) ?? 0;
    // rapid reconnect cycles — the classic logbot/scan signature
    if (joinCount >= 4 && leaveCount >= 3) {
      findings.push({
        player,
        kind: "join-leave flood",
        suggestedAction: "kick",
        reason: `${joinCount} joins and ${leaveCount} disconnects in the recent log — reconnect cycling`,
        evidence: lines
          .filter((l) => JOIN_RE.exec(l)?.[1] === player || LEAVE_RE.exec(l)?.[1] === player)
          .slice(0, 6),
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
        reason: `The same message repeated ${bucket.count} times: "${bucket.message}"`,
        evidence: lines
          .filter((l) => CHAT_RE.exec(l)?.[1] === bucket.player && l.includes(`<${bucket.player}> ${bucket.message}`))
          .slice(0, 4),
        requiresOwnerDecision: false,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Moderation — the AI layer, strictly grounded
// ---------------------------------------------------------------------------

/**
 * The system prompt for the moderation assistant (§20). The rules that
 * matter: quote evidence copied LITERALLY from the log, never invent
 * players or lines, and understand that the final call is the owner's.
 */
export const MODERATION_SYSTEM_PROMPT = `You are the moderation assistant of a Minecraft server panel.
You read a server log tail and report suspicious behavior as JSON.

Rules:
- Output ONLY a JSON array, no prose. Example format:
  [{"player":"Name","action":"watch|kick|ban","reason":"short explanation","evidence":["<lines copied LITERALLY from the log>"]}]
- Every finding MUST quote at least one line copied LITERALLY from the log.
- Never invent players, lines or events. If nothing is suspicious, output [].
- Suggest "ban" only for clearly abusive behavior; suggest "kick" for
  probable spam or bot cycling; suggest "watch" for mild suspicion.
- You are an assistant: the server owner reads your findings and decides.
  Nothing you output is applied automatically.`;

interface AiFinding {
  player?: unknown;
  action?: unknown;
  reason?: unknown;
  evidence?: unknown;
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

/**
 * Filters the AI's suggestions against the log. A finding only survives when
 * its quoted evidence literally exists in the log lines — an AI that
 * hallucinates evidence gets its suggestion dropped, silently and surely.
 * AI-suggested bans are kept but flagged requiresOwnerDecision — the owner
 * reads, decides and clicks; nothing is applied automatically.
 */
export function filterAiFindings(aiText: string, lines: string[]): ModerationFinding[] {
  const parsed = extractJsonBlock(aiText);
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(["watch", "kick", "ban"]);

  const findings: ModerationFinding[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const finding = raw as AiFinding;
    const player = typeof finding.player === "string" ? finding.player.trim() : "";
    const action = typeof finding.action === "string" ? finding.action.trim().toLowerCase() : "";
    const reason = typeof finding.reason === "string" ? finding.reason.trim() : "";
    const evidence =
      Array.isArray(finding.evidence) &&
      finding.evidence.every((e) => typeof e === "string")
        ? (finding.evidence as string[])
        : [];

    if (!player || !allowed.has(action) || !reason) continue;
    if (evidence.length === 0) continue; // a suggestion without a quote is a guess

    // every quoted line must literally exist in the real log
    const grounded = evidence.filter((quote) =>
      lines.some((line) => line.includes(quote.trim())),
    );
    if (grounded.length === 0) continue;

    findings.push({
      player,
      kind: "AI suggestion",
      suggestedAction: action === "ban" ? "watch" : (action as "watch" | "kick"),
      // never hand the AI a ban button — downgrade to watch, owner decides
      reason,
      evidence: grounded,
      requiresOwnerDecision: true,
    });
  }
  return findings;
}
