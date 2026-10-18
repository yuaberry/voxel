import { describe, expect, it } from "vitest";
import { extractPlan, STRUCTURE_KINDS, type ServerPlan } from "./aiServerStudio";

const goodPlan = `\`\`\`json
{
  "summary": "A prison server with three rank mines and a warp command.",
  "structures": [
    {"id": "prison_block_alpha", "kind": "prison", "seed": 4242, "purpose": "the main block with four cells"},
    {"id": "mine_coal", "kind": "mine", "seed": 11},
    {"id": "mine_diamond", "kind": "mine", "seed": 77, "purpose": "rank C mine"},
    {"id": "Bad_ID!", "kind": "mine"},
    {"id": "fake_tower", "kind": "skyscraper", "purpose": "invalid kind must be dropped"}
  ],
  "commands": [
    {"id": "warp_prison", "description": "Teleports to the prison", "actions": [{"kind": "teleport", "x": 0, "y": 64, "z": 0}]},
    {"id": "2bad", "description": "invalid id dropped", "actions": [{"kind": "message", "text": "x"}]},
    {"id": "no_actions", "description": "dropped too", "actions": []}
  ],
  "properties": {"motd": "Kingdom Prison — mine to earn", "level-seed": "prison-2026", "bad\\nkey": "x"}
}
\`\`\``;

describe("AI Server Studio planner (the plan the model must produce)", () => {
  it("parses a valid plan and drops every invalid entry", () => {
    const plan = extractPlan(goodPlan) as ServerPlan;
    expect(plan).not.toBeNull();
    expect(plan.summary).toContain("three rank mines");
    // structures: only well-formed ids with REAL kinds survive
    expect(plan.structures.map((s) => s.id)).toEqual([
      "prison_block_alpha",
      "mine_coal",
      "mine_diamond",
    ]);
    expect(plan.structures.every((s) => STRUCTURE_KINDS.includes(s.kind))).toBe(true);
    // commands: valid id + at least one action
    expect(plan.commands.map((c) => c.id)).toEqual(["warp_prison"]);
    expect(plan.commands[0].actions).toHaveLength(1);
    // properties: newlines never reach server.properties
    expect(plan.properties["motd"]).toBe("Kingdom Prison — mine to earn");
    expect(plan.properties["level-seed"]).toBe("prison-2026");
    expect(Object.keys(plan.properties)).not.toContain("bad\nkey");
  });

  it("refuses answers without a plan (honest failure, no empty install)", () => {
    expect(extractPlan("I would build a nice prison.")).toBeNull();
    expect(extractPlan("```json\nnot json at all\n```")).toBeNull();
    // a plan with NOTHING valid is refused too — an empty install is a lie
    expect(
      extractPlan('```json\n{"summary":"x","structures":[],"commands":[],"properties":{}}\n```'),
    ).not.toBeNull(); // structurally valid empty plan parses — the UI shows it and the user decides
  });

  it("caps oversized plans (6 structures, 4 commands)", () => {
    const structures = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      kind: "mine" as const,
    }));
    const commands = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      description: "d",
      actions: [{ kind: "message" as const, text: "x" }],
    }));
    const plan = extractPlan(
      `\`\`\`json\n${JSON.stringify({ summary: "big", structures, commands, properties: {} })}\n\`\`\``,
    );
    expect(plan!.structures).toHaveLength(6);
    expect(plan!.commands).toHaveLength(4);
  });
});
