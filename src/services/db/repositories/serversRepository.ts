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
export async function listServersReconciled(
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
  const adopted: ServerRecord[] = [];

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
        adopted.push(record);
        rows.unshift(record);
      } catch (error) {
        console.warn("server adoption failed:", error);
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
