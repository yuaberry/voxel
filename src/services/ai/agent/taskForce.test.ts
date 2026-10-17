import { describe, expect, it } from "vitest";
import {
  architectSystemPrompt,
  reviewerSystemPrompt,
} from "./promptBuilder";
import { READ_ONLY_TOOLS, phaseModelFor } from "./orchestrator";
import type { AiSettings } from "@/types";
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
  briefing: null,
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

describe("model routing (briefing §66)", () => {
  it("routes a phase to its override model", () => {
    const settings = {
      ...baseAi(),
      model: "global-model",
      phaseModels: { architect: "big-model", developer: "", reviewer: "fast-model" },
    };
    expect(phaseModelFor(settings, "architect")).toBe("big-model");
    expect(phaseModelFor(settings, "reviewer")).toBe("fast-model");
  });

  it("empty override falls back to the global model", () => {
    expect(phaseModelFor({ ...baseAi(), phaseModels: { architect: "", developer: "", reviewer: "" } }, "architect")).toBe("qwen/qwen3");
  });
});

function baseAi(over: Record<string, unknown> = {}) {
  return {
    provider: "openrouter",
    model: "qwen/qwen3",
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: "",
    ...over,
  } as AiSettings;
}
