import { describe, expect, it } from "vitest";
import { parseContradictions } from "./memoryService";

describe("Style Memory — contradiction parser (only quoted findings survive)", () => {
  it("parses real contradictions from a fenced json answer", () => {
    const answer =
      'Sure — here is the audit:\n```json\n{"contradictions":[{"between":"Style Bible vs Gameplay Bible","quote":"The Style Bible says every item is dark steel; the Gameplay Bible promises a radiant gem line","why":"The gem line cannot be dark steel and radiant at the same time"}]}\n```\nDone.';
    const found = parseContradictions(answer);
    expect(found).toHaveLength(1);
    expect(found[0].between).toContain("Style Bible");
    expect(found[0].quote).toContain("dark steel");
    expect(found[0].why).toContain("radiant at the same time");
  });

  it("drops entries without a quote — no invented findings", () => {
    const answer =
      '```json\n{"contradictions":[{"between":"A vs B","why":"no quote here"},{"between":"","quote":"x","why":"no between"},{"between":"A vs C","quote":"real quote","why":"real reason"}]}```';
    const found = parseContradictions(answer);
    expect(found).toHaveLength(1);
    expect(found[0].between).toBe("A vs C");
  });

  it("returns empty honestly when there are no conflicts", () => {
    expect(parseContradictions('```json\n{"contradictions":[]}```')).toEqual([]);
    expect(parseContradictions("I see no problems in these files.")).toEqual([]);
    expect(parseContradictions("```json\nnot json```")).toEqual([]);
  });
});
