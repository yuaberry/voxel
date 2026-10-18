/**
 * Error Center (Fase 4) — turns raw Gradle/javac output into structured,
 * categorized errors that the UI renders and the agent can fix.
 */

export type BuildErrorCategory =
  | "java"
  | "dependency"
  | "configuration"
  | "environment"
  | "unknown";

export interface BuildError {
  category: BuildErrorCategory;
  message: string;
  file: string | null;
  line: number | null;
  raw: string;
}

const JAVAC_ERROR = /^.*?([\w./\\-]+\.java):(\d+): (?:error|warning): (.+)$/;
const GRADLE_RESOLUTION =
  /(?:Could not resolve|Could not find)\s+([^:\s]+(?::[^:\s]+)*)/;

/** Parses build log lines into categorized errors (deduplicated, capped). */
export function parseBuildErrors(logs: Array<{ line: string }>): BuildError[] {
  const errors: BuildError[] = [];
  const seen = new Set<string>();

  for (const { line } of logs) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // javac compile errors — the actionable gold for Auto-Fix
    const javaMatch = JAVAC_ERROR.exec(trimmed);
    if (javaMatch && trimmed.includes("error:")) {
      const [, file, lineNo, message] = javaMatch;
      const key = `${file}:${lineNo}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "java",
          message,
          file: file.replace(/^.*?src[/\\]/, "src/"),
          line: Number(lineNo),
          raw: trimmed,
        });
      }
      continue;
    }

    // Gradle dependency resolution failures
    if (/(Could not resolve|Could not find)/.test(trimmed)) {
      const match = GRADLE_RESOLUTION.exec(trimmed);
      const dep = match?.[1] ?? trimmed.slice(0, 120);
      const key = `dep:${dep}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "dependency",
          message: `Dependency problem: ${dep}`,
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }

    // ENVIRONMENT problems — the owner's "build just failed" cases:
    // no Java, wrong Java, network down, wrapper issues. Each with a FIX.
    if (/(?:'java' is not recognized|java: command not found|Neither the JAVA_HOME| JAVA_HOME variable (?:is not|could not be) set)/i.test(trimmed)) {
      const key = "env:java-missing";
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "environment",
          message:
            "Java was not found — Gradle cannot even start. Install Java 21 (e.g. from adoptium.net) and, if you use a custom install, point Settings → Java to it.",
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }
    if (/(?:Unsupported class file major version|requires a Java (?:version|runtime)|UnsupportedClassVersionError|invalid source release)/i.test(trimmed)) {
      const key = "env:java-version";
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "environment",
          message:
            "The installed Java version does not match this project. Minecraft 1.20.1 projects need Java 17 or 21 (26.x needs Java 25) — set the right one in Settings → Java.",
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }
    if (/(?:Could not download|Read timed out|Connection (?:refused|reset)|UnknownHost|network|offline)/i.test(trimmed) && /(?:gradle|wrapper|maven|fabricmc|neoforged|minecraft|libraries)/i.test(trimmed)) {
      const key = "env:network";
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "environment",
          message:
            "A download failed mid-build (Gradle, libraries or mappings). Check your internet/firewall/antivirus and click Build again — the first build downloads the toolchain, later ones reuse it.",
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }
    if (/(?:No space left on device|disk (?:full|quota)|Permission denied)/i.test(trimmed)) {
      const key = "env:disk";
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "environment",
          message:
            "The build could not write its files — check free disk space and folder permissions for your workspace.",
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }

    // Configuration/DSL problems (groovy compile of build scripts)
    if (
      /(?:build file|settings file|build\.gradle|settings\.gradle).*(?:error|failed)/i.test(
        trimmed,
      ) ||
      /Could not get unknown property/i.test(trimmed)
    ) {
      const key = `cfg:${trimmed.slice(0, 120)}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          category: "configuration",
          message: trimmed.slice(0, 160),
          file: null,
          line: null,
          raw: trimmed,
        });
      }
      continue;
    }
  }

  return errors.slice(0, 50);
}

/** Compact, agent-friendly digest of the errors (for the Auto-Fix prompt). */
export function errorsToPrompt(errors: BuildError[], attempt: number): string {
  const lines = errors.map((error, index) => {
    const where = error.file
      ? ` at ${error.file}${error.line ? `:${error.line}` : ""}`
      : "";
    return `${index + 1}. [${error.category}]${where}: ${error.message}`;
  });
  return [
    `The Gradle build failed (auto-fix attempt ${attempt}).`,
    `Errors (${errors.length}):`,
    ...lines,
    "",
    "You have tools. Fix the project so it compiles:",
    "1. read_file each file mentioned above (paths are relative to the project root)",
    "2. repair the code with edit_file or write_file",
    "3. keep .voxel/project-spec.json truthful and respect the Style Bible",
    "4. never delete files; do not touch build.gradle dependencies",
    "5. when done, summarize the changes in one short paragraph",
  ].join("\n");
}
