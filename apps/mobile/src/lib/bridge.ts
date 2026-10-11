/**
 * VOXEL Bridge client — the phone talks to the REAL desktop engine over
 * the local network (Settings → Mobile on the PC shows the address and
 * the pairing token). Plain fetch for data; the live console polls the
 * PC's ring buffer (RN's fetch does not stream responses).
 */

import { useConnection } from "./store";

export function bridgeBase(): string {
  const connection = useConnection.getState().connection;
  if (!connection) throw new Error("Not connected to a PC yet");
  return `http://${connection.address}`;
}

function authHeaders(): Record<string, string> {
  const connection = useConnection.getState().connection;
  if (!connection) throw new Error("Not connected to a PC yet");
  return { Authorization: `Bearer ${connection.token}` };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeBase()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  if (response.status === 401) {
    throw new Error("Invalid pairing token — reconnect to the PC");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Shared shapes (mirror the bridge; ping types shared with @voxel/core)
// ---------------------------------------------------------------------------

import type { ServerPingData } from "@voxel/core";

export interface BridgeStatus {
  app: string;
  version: string;
  workspace: {
    projects: number;
    servers: number;
    shaderPacks: number;
    instances: number;
  };
  ai: { provider: string; model: string; ready: boolean };
}

export interface BridgeProject {
  slug: string;
  name: string;
  minecraftVersion: string;
  loader: string | null;
  description: string | null;
  status: string;
  lastBuildStatus: string | null;
  lastBuildAt: string | null;
}

export interface BridgeServer {
  slug: string;
  name: string;
  software: string;
  minecraftVersion: string;
  port: number;
  ramMb: number;
  status: string;
  running: boolean;
}

/** Chat content — plain text or multimodal parts (vision). */
export type AskContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; media_type: string; base64: string }
    >;

export interface ConsoleTail {
  lines: string[];
  total: number;
}

export const bridge = {
  status: () => api<BridgeStatus>("/api/status"),
  projects: () => api<{ projects: BridgeProject[] }>("/api/projects"),
  build: (slug: string) =>
    api<{ ok: boolean }>(`/api/projects/${slug}/build`, { method: "POST" }),
  servers: () => api<{ servers: BridgeServer[] }>("/api/servers"),
  startServer: (slug: string, ramMb?: number) =>
    api<{ ok: boolean; pid: string }>(`/api/servers/${slug}/start`, {
      method: "POST",
      body: JSON.stringify({ ramMb: ramMb ?? null }),
    }),
  stopServer: (slug: string) =>
    api<{ ok: boolean }>(`/api/servers/${slug}/stop`, { method: "POST" }),
  consoleTail: (slug: string, after: number) =>
    api<ConsoleTail>(`/api/servers/${slug}/console/tail?after=${after}`),
  ping: (address: string) =>
    api<ServerPingData>("/api/ping", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),
  ask: (messages: Array<{ role: string; content: AskContent }>) =>
    api<{ text: string }>("/api/ai/ask", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
};
