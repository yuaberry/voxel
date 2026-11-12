/**
 * Multiplayer server list (`servers.dat`) — the REAL vanilla file the
 * Minecraft client reads on the Multiplayer screen.
 *
 * The bytes are written by the Rust perimeter (`multiplayer_write_servers_dat`):
 * a gzip-compressed NBT with a `servers` list, exactly the format the
 * client expects. The service only decides WHAT goes into the list — the
 * local servers of this workspace and the public references the owner
 * chose — and reports what really landed in the file.
 */

import { invoke } from "@tauri-apps/api/core";
import { listServersReconciled } from "@/services/db/repositories/serversRepository";
import { PUBLIC_SERVER_REFS } from "@voxel/core/publicServers";
import type { ServerRecord } from "@/types";
export interface MultiplayerServerEntry {
  /** the name the client shows in the list */
  name: string;
  /** the host (or IP) — with or without a `:port` suffix */
  address: string;
  /** an explicit port; when absent the SRV record decides (like the client) */
  port?: number;
  /** a hidden entry is never listed by the client (direct connect only) */
  hidden?: boolean;
}

export interface WrittenMultiplayerServer {
  name: string;
  address: string;
  port: number;
  hidden: boolean;
  /** true when the port came from the SRV record instead of the default */
  srv: boolean;
}

export interface ServersDatResult {
  /** the absolute path of the file that was written */
  path: string;
  /** how many entries the list holds */
  written: number;
  entries: WrittenMultiplayerServer[];
}

/**
 * The local servers of this workspace — the client reaches them through
 * the loopback, on the very port the server listens on.
 */
export function buildLocalServerEntries(
  servers: ServerRecord[],
): MultiplayerServerEntry[] {
  return servers.map((server) => ({
    name: server.name,
    address: "127.0.0.1",
    port: server.port,
  }));
}

/**
 * The public references — each one points at the address its own authors
 * publish, so the client resolves it the same way a player would.
 */
export function buildReferenceServerEntries(
  references: readonly { name: string; address: string }[],
): MultiplayerServerEntry[] {
  return references.map((reference) => ({
    name: reference.name,
    address: reference.address,
  }));
}

/** The whole list: the local servers first, then the references. */
export function buildMultiplayerEntries(
  servers: ServerRecord[],
  references: readonly { name: string; address: string }[],
): MultiplayerServerEntry[] {
  return [
    ...buildLocalServerEntries(servers),
    ...buildReferenceServerEntries(references),
  ];
}

/**
 * The list of THIS workspace: the local servers (through the loopback, on
 * the port they really listen on) plus the public references the owner
 * kept enabled.
 */
export async function buildWorkspaceServerEntries(
  basePath: string,
  publicServerIds: readonly string[],
): Promise<MultiplayerServerEntry[]> {
  const servers = await listServersReconciled(basePath).catch(() => []);
  const references = PUBLIC_SERVER_REFS.filter((reference) =>
    publicServerIds.includes(reference.id),
  );
  return buildMultiplayerEntries(servers, references);
}

/** Writes the list into the game directory of an instance. */
export async function writeInstanceServerList(
  basePath: string,
  instanceSlug: string,
  servers: MultiplayerServerEntry[],
): Promise<ServersDatResult> {
  return invoke<ServersDatResult>("multiplayer_write_servers_dat", {
    basePath,
    instanceSlug,
    servers: servers.map((server) => ({
      name: server.name,
      address: server.address,
      port: server.port ?? null,
      hidden: server.hidden ?? false,
    })),
  });
}

/** What happened to the list of every instance. */
export interface MultiplayerSyncResult {
  /** the instances whose list was written */
  written: { slug: string; path: string; servers: number }[];
  /** the instances that could not be written (with the reason) */
  failed: { slug: string; error: string }[];
}

/**
 * Writes the multiplayer list into EVERY instance of the workspace.
 *
 * The list lives in the game directory of the instance — the folder the
 * client uses when it launches. A list written into one instance is
 * invisible to the others: the owner launches another project and the
 * Multiplayer screen is EMPTY ("I cannot join any server"). Every
 * instance gets the same list.
 */
export async function writeServerListToAllInstances(
  basePath: string,
  instanceSlugs: string[],
  servers: MultiplayerServerEntry[],
): Promise<MultiplayerSyncResult> {
  const result: MultiplayerSyncResult = { written: [], failed: [] };
  for (const slug of instanceSlugs) {
    try {
      const written = await writeInstanceServerList(basePath, slug, servers);
      result.written.push({
        slug,
        path: written.path,
        servers: written.written,
      });
    } catch (error) {
      result.failed.push({
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
