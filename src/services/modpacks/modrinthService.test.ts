import { describe, expect, it } from "vitest";
import {
  buildFacets,
  pickModrinthFile,
  resolveModrinthTree,
  type ModrinthVersion,
} from "./modrinthService";

const version = (over: Partial<ModrinthVersion>): ModrinthVersion => ({
  id: "v1",
  name: "1.0.0",
  version_number: "1.0.0",
  files: [],
  ...over,
});

describe("modrinth facets", () => {
  it("filter by project type, game version and loader", () => {
    const facets = JSON.parse(buildFacets("1.20.1", "fabric"));
    expect(facets).toContainEqual(["project_type:mod"]);
    expect(facets).toContainEqual(["versions:1.20.1"]);
    expect(facets).toContainEqual(["categories:fabric"]);
  });
});

describe("pickModrinthFile — never install an unverifiable file", () => {
  it("prefers the primary file of the newest version", () => {
    const picked = pickModrinthFile([
      version({
        version_number: "2.0.0",
        files: [
          {
            url: "https://cdn.modrinth.com/data/x/secondary.jar",
            filename: "secondary.jar",
            primary: false,
            hashes: { sha1: "aaa" },
          },
          {
            url: "https://cdn.modrinth.com/data/x/primary.jar",
            filename: "primary.jar",
            primary: true,
            hashes: { sha1: "bbb" },
          },
        ],
      }),
    ]);
    expect(picked?.fileName).toBe("primary.jar");
    expect(picked?.versionNumber).toBe("2.0.0");
  });

  it("skips versions whose files carry no sha1 — honesty over convenience", () => {
    const picked = pickModrinthFile([
      version({
        files: [
          {
            url: "https://cdn.modrinth.com/data/x/nohash.jar",
            filename: "nohash.jar",
            primary: true,
            hashes: {},
          },
        ],
      }),
      version({
        version_number: "1.5.0",
        files: [
          {
            url: "https://cdn.modrinth.com/data/x/ok.jar",
            filename: "ok.jar",
            primary: true,
            hashes: { sha1: "ccc" },
          },
        ],
      }),
    ]);
    expect(picked?.versionNumber).toBe("1.5.0");
  });

  it("returns null when nothing is verifiable", () => {
    expect(
      pickModrinthFile([
        version({ files: [{ url: "u", filename: "f.jar", primary: true, hashes: {} }] }),
      ]),
    ).toBeNull();
    expect(pickModrinthFile([])).toBeNull();
  });
});

function vWith(
  versionNumber: string,
  deps: ModrinthVersion["dependencies"],
): ModrinthVersion {
  return {
    id: versionNumber,
    name: versionNumber,
    version_number: versionNumber,
    files: [
      {
        url: `https://cdn.modrinth.com/data/x/${versionNumber}.jar`,
        filename: `${versionNumber}.jar`,
        primary: true,
        hashes: { sha1: `sha-${versionNumber}` },
      },
    ],
    dependencies: deps,
  };
}

const asGraph = (graph: Record<string, ModrinthVersion["dependencies"]>) =>
  async (projectId: string): Promise<ModrinthVersion[]> => [vWith(`${projectId}-v1`, graph[projectId] ?? [])];

describe("resolveModrinthTree — the transitive dependency graph", () => {
  it("walks the required chain and keeps the order honest", async () => {
    const fetchVersions = asGraph({
      root: [{ version_id: "v", project_id: "lib-a", dependency_type: "required" }],
      "lib-a": [{ version_id: "v", project_id: "lib-b", dependency_type: "required" }],
      "lib-b": [],
    });
    const tree = await resolveModrinthTree("root", "1.20.1", "fabric", fetchVersions as never);
    expect(tree.mods.map((m) => m.projectId)).toEqual(["root", "lib-a", "lib-b"]);
    expect(tree.mods[1].requiredBy).toBe("root");
    expect(tree.mods[2].requiredBy).toBe("lib-a");
    expect(tree.skippedOptional).toEqual([]);
  });

  it("cycles terminate (visited set) and dedupe repeated deps", async () => {
    const fetchVersions = asGraph({
      root: [
        { version_id: "v", project_id: "lib-a", dependency_type: "required" },
        { version_id: "v", project_id: "lib-b", dependency_type: "required" },
      ],
      "lib-a": [{ version_id: "v", project_id: "lib-b", dependency_type: "required" }],
      "lib-b": [{ version_id: "v", project_id: "lib-a", dependency_type: "required" }],
    });
    const tree = await resolveModrinthTree("root", "1.20.1", "fabric", fetchVersions as never);
    expect(tree.mods.map((m) => m.projectId).sort()).toEqual(["lib-a", "lib-b", "root"]);
  });

  it("skips optional and embedded, never inventing requirements", async () => {
    const fetchVersions = asGraph({
      root: [
        { version_id: "v", project_id: "opt", dependency_type: "optional" },
        { version_id: "v", project_id: "inside", dependency_type: "embedded" },
      ],
      opt: [],
    });
    const tree = await resolveModrinthTree("root", "1.20.1", "fabric", fetchVersions as never);
    expect(tree.mods).toHaveLength(1);
    expect(tree.skippedOptional).toEqual(["opt"]);
  });

  it("fails on an incompatible edge against the install set", async () => {
    const fetchVersions = asGraph({
      root: [{ version_id: "v", project_id: "lib-a", dependency_type: "required" }],
      "lib-a": [{ version_id: "v", project_id: "root", dependency_type: "incompatible" }],
    });
    await expect(
      resolveModrinthTree("root", "1.20.1", "fabric", fetchVersions as never),
    ).rejects.toThrow(/incompatible with root/);
  });

  it("fails when a required dep has nothing installable — no broken modpack", async () => {
    const fetchVersions = async (): Promise<ModrinthVersion[]> => [];
    await expect(
      resolveModrinthTree("root", "1.20.1", "fabric", fetchVersions as never),
    ).rejects.toThrow(/No SHA-1-verified version/);
  });

  it("refuses pathological graphs beyond the cap", async () => {
    const fetchVersions = async (projectId: string): Promise<ModrinthVersion[]> => {
      const next = Number(projectId.replace("m", "")) + 1;
      return [vWith(projectId, [{ version_id: "v", project_id: `m${next}`, dependency_type: "required" }])];
    };
    await expect(
      resolveModrinthTree("m0", "1.20.1", "fabric", fetchVersions as never),
    ).rejects.toThrow(/exceeds 25 mods/);
  });
});
