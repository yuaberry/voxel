import { describe, expect, it } from "vitest";
import { errorsToPrompt, parseBuildErrors } from "./errorParser";

describe("parseBuildErrors", () => {
  it("extracts javac errors with file, line and dedup", () => {
    const logs = [
      { line: "  src/main/java/com/x/ModItems.java:12: error: cannot find symbol" },
      { line: "  src/main/java/com/x/ModItems.java:12: error: cannot find symbol" },
      { line: "  src/main/java/com/x/ModItems.java:20: error: incompatible types: int cannot be converted to String" },
      { line: "Note: Some input files use unchecked or unsafe operations." },
    ];
    const errors = parseBuildErrors(logs);
    expect(errors).toHaveLength(2);
    expect(errors[0].category).toBe("java");
    expect(errors[0].file).toBe("src/main/java/com/x/ModItems.java");
    expect(errors[0].line).toBe(12);
    expect(errors[0].message).toBe("cannot find symbol");
  });

  it("categorizes dependency resolution failures", () => {
    const errors = parseBuildErrors([
      { line: "Could not resolve net.fabricmc:fabric-api:0.92.2+1.20.1." },
    ]);
    expect(errors[0].category).toBe("dependency");
    expect(errors[0].message).toContain("net.fabricmc:fabric-api");
  });

  it("ignores warnings and plain lines", () => {
    const errors = parseBuildErrors([
      { line: "src/A.java:5: warning: [deprecation] something" },
      { line: "> Task :compileJava" },
    ]);
    expect(errors).toHaveLength(0);
  });

  it("builds an actionable agent prompt", () => {
    const prompt = errorsToPrompt(
      [
        {
          category: "java",
          message: "cannot find symbol",
          file: "src/main/java/A.java",
          line: 10,
          raw: "",
        },
      ],
      1,
    );
    expect(prompt).toContain("auto-fix attempt 1");
    expect(prompt).toContain("src/main/java/A.java:10");
    expect(prompt).toContain("never delete files");
  });
});

describe("environment diagnosis (the build that failed before compiling)", () => {
  it("names a missing Java with the exact fix", () => {
    const errors = parseBuildErrors([{ line: "'java' is not recognized as an internal or external command" }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe("environment");
    expect(errors[0].message).toContain("Install Java 21");
    expect(errors[0].message).toContain("Settings → Java");
  });

  it("recognizes a Java version mismatch (Windows wording)", () => {
    const errors = parseBuildErrors([{ line: "error: invalid source release: 21 with -source 8" }]);
    expect(errors[0].category).toBe("environment");
    expect(errors[0].message).toContain("Java 17 or 21");
  });

  it("recognizes mid-build download failures with the retry guidance", () => {
    const errors = parseBuildErrors([{ line: "Could not download gradle-8.8-bin.zip ... Read timed out" }]);
    expect(errors[0].category).toBe("environment");
    expect(errors[0].message).toContain("first build downloads");
  });

  it("recognizes a full disk", () => {
    const errors = parseBuildErrors([{ line: "java.io.IOException: No space left on device" }]);
    expect(errors[0].category).toBe("environment");
    expect(errors[0].message).toContain("disk space");
  });
});
