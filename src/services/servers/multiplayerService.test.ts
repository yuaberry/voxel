import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocalServerEntries,
  buildMultiplayerEntries,
  buildReferenceServerEntries,
  writeServerListToAllInstances,
} from "./multiplayerService";
import type { ServerRecord } from "@/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@/services/db/repositories/serversRepository", () => ({
  listServersReconciled: vi.fn(async () => []),
}));
vi.mock("@voxel/core/publicServers", () => ({
  PUBLIC_SERVER_REFS: [
    { id: "nerdzone", name: "NerdZone.gg", address: "nerdzone.gg" },
  ],
}));

function server(name: string, port: number): ServerRecord {
  return {
    id: `id-${name}`,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    software: "vanilla",
    minecraft_version: "1.20.1",
    path: `/workspace/servers/${name}`,
    port,
    ram_mb: 4096,
    status: "stopped",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("multiplayerService — the list the client will show", () => {
  it("points every local server at the loopback on its own port", () => {
    const entries = buildLocalServerEntries([server("Mine Rank", 25565)]);
    expect(entries).toEqual([
      { name: "Mine Rank", address: "127.0.0.1", port: 25565 },
    ]);
  });

  it("keeps the reference address as its authors publish it", () => {
    const entries = buildReferenceServerEntries([
      { name: "NerdZone.gg", address: "nerdzone.gg" },
    ]);
    // no port — the SRV record decides, exactly like the vanilla client
    expect(entries).toEqual([{ name: "NerdZone.gg", address: "nerdzone.gg" }]);
  });

  it("puts the local servers first and the references after them", () => {
    const entries = buildMultiplayerEntries(
      [server("Mine Rank", 25565)],
      [{ name: "NerdZone.gg", address: "nerdzone.gg" }],
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      "Mine Rank",
      "NerdZone.gg",
    ]);
  });

  it("writes an empty list when there is nothing to show", () => {
    expect(buildMultiplayerEntries([], [])).toEqual([]);
  });

  it("never invents a port for a local server", () => {
    const entries = buildLocalServerEntries([server("Mine Rank", 25566)]);
    expect(entries[0].port).toBe(25566);
  });
});

describe("multiplayerService — the list reaches EVERY instance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the list into every instance of the workspace", async () => {
    invokeMock.mockResolvedValue({
      path: "/workspace/instances/mine-rank/servers.dat",
      written: 2,
      entries: [],
    });

    const result = await writeServerListToAllInstances(
      "/workspace",
      ["mine-rank", "dark-kingdom"],
      [{ name: "Mine Rank", address: "127.0.0.1", port: 25565 }],
    );

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      basePath: "/workspace",
      instanceSlug: "mine-rank",
    });
    expect(invokeMock.mock.calls[1][1]).toMatchObject({
      instanceSlug: "dark-kingdom",
    });
    expect(result.written).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  it("reports a broken instance without losing the others", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("Instance not found: broken"))
      .mockResolvedValueOnce({
        path: "/workspace/instances/working/servers.dat",
        written: 1,
        entries: [],
      });

    const result = await writeServerListToAllInstances(
      "/workspace",
      ["broken", "working"],
      [{ name: "Mine Rank", address: "127.0.0.1", port: 25565 }],
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].slug).toBe("broken");
    expect(result.failed[0].error).toContain("not found");
    expect(result.written).toHaveLength(1);
    expect(result.written[0].slug).toBe("working");
  });
});
