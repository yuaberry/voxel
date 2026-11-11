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
