import { getDb } from "@/services/db/client";
import { invoke } from "@tauri-apps/api/core";
import type { ServerRecord } from "@/types";

function rowToServer(row: Record<string, unknown>): ServerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    software: row.software as ServerRecord["software"],
    minecraft_version: String(row.minecraft_version),
    path: String(row.path),
    port: Number(row.port ?? 25565),
    ram_mb: Number(row.ram_mb ?? 2048),
    status: String(row.status ?? "stopped"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listServers(): Promise<ServerRecord[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM servers ORDER BY created_at DESC",
  );
  return rows.map(rowToServer);
}

export async function insertServer(server: ServerRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO servers
      (id, name, slug, software, minecraft_version, path, port, ram_mb, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      server.id,
      server.name,
      server.slug,
      server.software,
      server.minecraft_version,
      server.path,
      server.port,
      server.ram_mb,
      server.status,
      server.created_at,
      server.updated_at,
    ],
  );
}

export async function updateServerStatus(
  slug: string,
  status: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE servers SET status = $2, updated_at = datetime('now') WHERE slug = $1",
    [slug, status],
  );
}

export async function updateServerRecord(
  slug: string,
  patch: { name?: string; port?: number; ram_mb?: number },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE servers SET name = COALESCE($2, name), port = COALESCE($3, port), ram_mb = COALESCE($4, ram_mb), updated_at = datetime('now') WHERE slug = $1",
    [slug, patch.name ?? null, patch.port ?? null, patch.ram_mb ?? null],
  );
}

export async function removeServer(slug: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM servers WHERE slug = $1", [slug]);
}

interface DiskServerInfo {
  slug: string;
  name: string;
  software: string;
  mcVersion: string;
  port: number;
  ramMb: number;
  createdAt: string;
  hasJar: boolean;
  hasEula: boolean;
}

/**
 * The DISK is the source of truth. This reconciles the database against the
 * real server folders before listing:
 *  - a folder without a row is ADOPTED (a server is never lost because a
 *    database write failed after creation — the exact "cannot create"
 *    frustration the owner reported)
 *  - a row without a folder is RETIRED (no ghost cards that error on Start)
 *
 * Facts for adoption come from voxel-server.json, written by server_create.
 */
/**
 * The single owner of the reconciliation WRITES.
 *
 * `listServersReconciled` is called from five places (the multiplayer
 * panel, the Run dialog, the servers page poll, backup and automation
 * schedulers) — sometimes at the same moment (React StrictMode mounts
 * twice, and a launch can overlap a 5 s poll). Two callers saw the same
 * folder with no row, both generated a different `crypto.randomUUID()`,
 * and one of the two hit the UNIQUE(slug) constraint — its `catch` only
 * logged, so THAT caller returned the list WITHOUT the local server. The
 * owner opened the Launcher, saw "No local server yet", and the
 * `servers.dat` he just wrote was missing the Mine Rank — which is
 * precisely the bug this session is chasing.
 *
 * The first caller performs the writes; everybody else awaits the same
 * result and can never race against it.
 */
let reconcileInFlight: Promise<ServerRecord[]> | null = null;

/** Adopts the folders on disk into the DB and retires the ghost rows. */
export async function listServersReconciled(
  basePath: string,
): Promise<ServerRecord[]> {
  if (reconcileInFlight) return reconcileInFlight;

  reconcileInFlight = reconcileServersOnce(basePath)
    // the failure is kept for this caller and cleared for the next one:
    // a retry must be able to succeed, so the shared promise is always
    // a fresh one
    .catch((error) => {
      reconcileInFlight = null;
      throw error;
    })
    .then((rows) => {
      reconcileInFlight = null;
      return rows;
    });

  return reconcileInFlight;
}

async function reconcileServersOnce(
  basePath: string,
): Promise<ServerRecord[]> {
  const [rows, disk] = await Promise.all([
    listServers(),
    invoke<DiskServerInfo[]>("servers_scan_disk", { basePath }).catch(
      () => [] as DiskServerInfo[],
    ),
  ]);

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const now = new Date().toISOString();

  for (const folder of disk) {
    const existing = bySlug.get(folder.slug);
    if (!existing) {
      const record: ServerRecord = {
        id: crypto.randomUUID(),
        name: folder.name,
        slug: folder.slug,
        software: (folder.software === "paper" ? "paper" : "vanilla") as ServerRecord["software"],
        minecraft_version: folder.mcVersion,
        path: `${basePath}/servers/${folder.slug}`,
        port: folder.port,
        ram_mb: folder.ramMb,
        status: "stopped",
        created_at: folder.createdAt ? `${folder.createdAt}` : now,
        updated_at: now,
      };
      try {
        await insertServer(record);
        rows.unshift(record);
        bySlug.set(folder.slug, record);
      } catch {
        // Another caller adopted the same folder first (UNIQUE(slug)) — or
        // the row is simply already there. Refusing to give up because of
        // a lost race: re-read the row that WON and return it, so the
        // local server never disappears from the list.
        const fresh = await listServers().catch(() => []);
        const winner = fresh.find((r) => r.slug === folder.slug);
        if (winner) {
          rows.unshift(winner);
          bySlug.set(folder.slug, winner);
        }
      }
    } else {
      // keep db row but correct drift in the basics
      if (!existing.path || existing.path === "pending") {
        existing.path = `${basePath}/servers/${folder.slug}`;
      }
    }
  }

  // retire ghosts: rows whose folder is gone
  for (const row of [...rows]) {
    const folderExists = disk.some((d) => d.slug === row.slug);
    if (!folderExists) {
      try {
        await removeServer(row.slug);
      } catch (error) {
        console.warn("ghost server retire failed:", error);
      }
      const idx = rows.indexOf(row);
      if (idx >= 0) rows.splice(idx, 1);
    }
  }

  return rows;
}

export async function recordBackup(entry: {
  id: string;
  slug: string;
  path: string;
  sizeBytes: number;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO backups (id, kind, path, size_bytes, created_at)
       VALUES ($1, 'server', $2, $3, datetime('now'))`,
      [entry.id, entry.path, entry.sizeBytes],
    );
  } catch (error) {
    console.warn("backup row insert failed:", error);
  }
}
