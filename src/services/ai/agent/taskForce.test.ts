import { describe, expect, it } from "vitest";
import {
  architectSystemPrompt,
  reviewerSystemPrompt,
} from "./promptBuilder";
import { READ_ONLY_TOOLS } from "./orchestrator";
import { WRITE_TOOL_NAMES } from "./writeTools";
import type { ProjectRecord } from "@/types";

const project = {
  id: "p1",
  name: "Dark Kingdom",
  slug: "dark-kingdom",
  type: "mod",
  minecraft_version: "1.20.1",
  loader: "fabric",
  description: "",
  license: "MIT",
  path: "/x",
  repository_url: null,
  status: "active",
  last_build_status: null,
  last_build_at: null,
  created_at: "",
  updated_at: "",
} as unknown as ProjectRecord;

const context = {
  project,
  projectSpec: null,
  projectSpecParsed: null,
  styleBible: null,
  aiMemory: null,
  loreBible: null,
  gameplayBible: null,
  decisions: null,
  fileTreePreview: "",
  referenceCount: 0,
};

describe("task-force personas (multi-agent v1)", () => {
  it("architect is explicitly read-only and ends with a plan", () => {
    const prompt = architectSystemPrompt(context);
    expect(prompt).toContain("READ-ONLY PHASE");
    expect(prompt).toContain("PLAN:");
    expect(prompt).toContain("RISKS:");
    expect(prompt).toContain("1.20.1");
    // no promised powers: writes are enforced elsewhere, never in the prompt
    expect(prompt).not.toMatch(/you (may|can) write/i);
  });

  it("reviewer audits read-only with a structured verdict", () => {
    const prompt = reviewerSystemPrompt(context);
    expect(prompt).toContain("READ-ONLY PHASE");
    expect(prompt).toContain("REVIEW:");
    expect(prompt).toContain("PASS");
    expect(prompt).toContain("Never invent");
  });

  it("read-only toolset never contains write tools", () => {
    for (const tool of WRITE_TOOL_NAMES) {
      expect(READ_ONLY_TOOLS.has(tool)).toBe(false);
    }
    expect(READ_ONLY_TOOLS.has("read_file")).toBe(true);
    expect(READ_ONLY_TOOLS.has("search_project")).toBe(true);
  });
});
