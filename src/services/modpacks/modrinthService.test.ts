import { describe, expect, it } from "vitest";
import { buildFacets, pickModrinthFile, type ModrinthVersion } from "./modrinthService";

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
