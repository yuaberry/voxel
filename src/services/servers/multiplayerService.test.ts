import { describe, expect, it } from "vitest";
import {
  buildLocalServerEntries,
  buildMultiplayerEntries,
  buildReferenceServerEntries,
} from "./multiplayerService";
import type { ServerRecord } from "@/types";

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
