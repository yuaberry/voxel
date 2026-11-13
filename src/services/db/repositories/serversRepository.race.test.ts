/**
 * The race that made the LOCAL SERVER DISAPPEAR from the list.
 *
 * `listServersReconciled` is called from five places at once (the
 * multiplayer panel, the Run dialog, the servers page poll, backup and
 * automation schedulers). Two callers used to see the same folder with
 * no database row, both generate a different `crypto.randomUUID()`, and
 * one of them hit the UNIQUE(slug) constraint — its `catch` only logged,
 * so THAT caller returned the list WITHOUT the local server.
 *
 * The owner's consequence: "Your servers" came back empty and the
 * `servers.dat` he had just written was missing the Mine Rank — "I
 * cannot join my own server".
 *
 * Two guarantees are tested here:
 *  1. two concurrent callers perform the writes only ONCE;
 *  2. when the insert loses the race, the server is still returned.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRow {
  id: string;
  slug: string;
  name: string;
}

const rows: FakeRow[] = [];
const insertCalls: string[] = [];

// um banco apenas com as chamadas que o repositório realmente faz
const db = {
  select: async <T,>(query: string, values?: unknown[]): Promise<T> => {
    if (/FROM servers/i.test(query)) {
      const slugs = (values?.[0] as string[] | undefined)?.filter(Boolean) ?? null;
      const found = rows.filter((r) => !slugs || slugs.includes(r.slug));
      return found as unknown as T;
    }
    return [] as unknown as T;
  },
  execute: async (query: string, values?: unknown[]) => {
    if (/^\s*INSERT INTO servers/i.test(query)) {
      // (id, name, slug, ...) — slug é o TERCEIRO parâmetro
      const slug = String(values?.[2] ?? "");
      insertCalls.push(slug);
      if (rows.some((r) => r.slug === slug)) {
        // o UNIQUE(slug) de verdade: outra chamada adotou primeiro
        throw new Error("UNIQUE constraint failed: servers.slug");
      }
      rows.push({
        id: String(values?.[0] ?? ""),
        slug,
        name: String(values?.[2] ?? slug),
      });
      return { rowsAffected: 1, lastInsertId: 0 };
    }
    return { rowsAffected: 0, lastInsertId: 0 };
  },
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "servers_scan_disk" ? diskFolders : []),
}));

let diskFolders: unknown[] = [];

vi.mock("@/services/db/client", () => ({
  getDb: async () => db,
}));

describe("listServersReconciled — no server is lost to a race", () => {
  beforeEach(() => {
    rows.length = 0;
    insertCalls.length = 0;
    diskFolders = [
      {
        slug: "mine-rank",
        name: "Mine Rank",
        software: "vanilla",
        mcVersion: "1.20.1",
        port: 25565,
        ramMb: 1024,
        createdAt: null,
      },
    ];
  });

  it("adopts a folder that is only on disk", async () => {
    const { listServersReconciled } = await import("./serversRepository");
    const list = await listServersReconciled("/workspace");
    expect(insertCalls).toEqual(["mine-rank"]);
    expect(list.map((r) => r.slug)).toContain("mine-rank");
  });

  it("writes only ONCE when two callers reconcile together", async () => {
    const { listServersReconciled } = await import("./serversRepository");
    const [first, second] = await Promise.all([
      listServersReconciled("/workspace"),
      listServersReconciled("/workspace"),
    ]);
    expect(insertCalls).toEqual(["mine-rank"]);
    expect(first.map((r) => r.slug)).toContain("mine-rank");
    expect(second.map((r) => r.slug)).toContain("mine-rank");
  });

  it("returns the server even when OUR insert lost the UNIQUE race", async () => {
    // a linha já existe — outra chamou ganhou a corrida antes de nós
    rows.push({ id: "db-1", slug: "mine-rank", name: "Mine Rank" });

    const { listServersReconciled } = await import("./serversRepository");
    const list = await listServersReconciled("/workspace");
    expect(list.map((r) => r.slug)).toContain("mine-rank");
  });
});
