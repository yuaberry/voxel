import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE, searchKnowledge, articleForErrorCategory } from "./knowledgeBase";

describe("Knowledge Center — verified knowledge, searchable (§11)", () => {
  it("holds only verified articles with official sources", () => {
    expect(KNOWLEDGE_BASE.length).toBeGreaterThanOrEqual(8);
    for (const article of KNOWLEDGE_BASE) {
      expect(article.verified.length).toBeGreaterThan(10); // HOW it was verified is stated
      expect(article.sources.length).toBeGreaterThan(0); // official links, always
      expect(article.body.length).toBeGreaterThan(200); // real content, not stubs
    }
  });

  it("finds articles by title, tags and body terms", () => {
    const byTitle = searchKnowledge("eras");
    expect(byTitle[0].id).toBe("minecraft-eras");
    const byTag = searchKnowledge("minecraft.mined");
    expect(byTag[0].id).toBe("datapack-triggers");
    const byTerm = searchKnowledge("fallback");
    expect(byTerm.some((a) => a.id === "ai-models-setup")).toBe(true);
  });

  it("refuses too-short queries honestly", () => {
    expect(searchKnowledge("")).toEqual([]);
    expect(searchKnowledge("a")).toEqual([]);
  });

  it("ranks multi-term matches above single hits", () => {
    const results = searchKnowledge("java gradle build");
    expect(results[0].id).toBe("gradle-first-build");
  });

  it("maps Error Center categories to the explaining article", () => {
    expect(articleForErrorCategory("environment")!.id).toBe("build-errors");
    expect(articleForErrorCategory("dependency")!.id).toBe("gradle-first-build");
    expect(articleForErrorCategory("java")!.id).toBe("build-errors");
    expect(articleForErrorCategory("unknown-category")).toBeNull();
  });
});
