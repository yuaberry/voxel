/**
 * VOXEL Compatibility Lab (Super Prompt §12, Fase B) — every verdict comes
 * with its justification and evidence, exactly as the prompt demands. The
 * facts are the project record, the version catalog (era schemas) and the
 * REAL files on disk (gradle.properties, java on this machine).
 */
import { invoke } from "@tauri-apps/api/core";
import type { ProjectRecord } from "@/types";
import {
  resolveTemplateParams,
  isLoaderAvailable,
  compareMcVersions,
} from "@/services/minecraft/versionCatalog";
import { readProjectFile } from "@/services/projects/projectsService";

export type CompatVerdict = "compatible" | "warning" | "incompatible" | "unknown";

export interface CompatCheck {
  id: string;
  title: string;
  verdict: CompatVerdict;
  /** the FACT the verdict rests on */
  evidence: string;
  fix: string | null;
}

export interface ProjectCompat {
  project: ProjectRecord;
  checks: CompatCheck[];
  summary: { compatible: number; warning: number; incompatible: number; unknown: number };
}

/** Pure verdict logic — tested with plain inputs, no I/O. */
export function evaluateCompatibility(
  project: Pick<ProjectRecord, "name" | "minecraft_version" | "loader">,
  params: {
    javaRelease: number;
    experimental: boolean;
    packFormat: number;
    templateId: string;
    loaderVersion: string;
    loaderAvailable: boolean;
  },
  environment: { javaMajor: number | null },
  gradleProps: Record<string, string> | null,
): CompatCheck[] {
  const checks: CompatCheck[] = [];
  const { loader } = project;

  // 1. loader support for this Minecraft version — the catalog's era truth
  checks.push({
    id: "loader",
    title: `${loader} ${params.loaderVersion} × Minecraft ${project.minecraft_version}`,
    verdict: params.loaderAvailable ? "compatible" : "incompatible",
    evidence: params.loaderAvailable
      ? `the version catalog lists ${loader} for ${project.minecraft_version}`
      : `the version catalog has NO ${loader} toolchain for ${project.minecraft_version} (check the supported eras)`,
    fix: params.loaderAvailable ? null : "Pick a supported loader for this version in the catalog (or change the project's Minecraft version)",
  });

  // 2. Java — the release the template targets vs the machine's java
  if (environment.javaMajor === null) {
    checks.push({
      id: "java",
      title: `Java ${params.javaRelease}+`,
      verdict: "unknown",
      evidence: "no Java detected on this machine's PATH (Settings → Java can point to one)",
      fix: "Install Java 21+ (e.g. from adoptium.net) and set it in Settings → Java to build",
    });
  } else if (environment.javaMajor < params.javaRelease) {
    checks.push({
      id: "java",
      title: `Java ${params.javaRelease}+`,
      verdict: "incompatible",
      evidence: `this project's era needs Java ${params.javaRelease}, this machine has Java ${environment.javaMajor}`,
      fix: `Install Java ${params.javaRelease}+ and point Settings → Java to it`,
    });
  } else if (environment.javaMajor > params.javaRelease + 7) {
    checks.push({
      id: "java",
      title: `Java ${params.javaRelease}+`,
      verdict: "warning",
      evidence: `needs Java ${params.javaRelease}; running on Java ${environment.javaMajor} (a whole LTS generation ahead can surprise older Gradle builds)`,
      fix: null,
    });
  } else {
    checks.push({
      id: "java",
      title: `Java ${params.javaRelease}+`,
      verdict: "compatible",
      evidence: `Java ${environment.javaMajor} covers the required release ${params.javaRelease}`,
      fix: null,
    });
  }

  // 3. experimental era — the honest flag the catalog carries
  checks.push({
    id: "era",
    title: "Era / mappings",
    verdict: params.experimental ? "warning" : "compatible",
    evidence: params.experimental
      ? `${project.minecraft_version} is beyond the fully-tested eras (experimental template ${params.templateId}, pack_format ${params.packFormat})`
      : `stable template ${params.templateId} for ${project.minecraft_version} (pack_format ${params.packFormat})`,
    fix: params.experimental ? "Experimental-era projects compile against today's facts; pin a known-good version for releases" : null,
  });

  // 4. build facts — the real gradle.properties of the project
  if (gradleProps === null) {
    checks.push({
      id: "gradle",
      title: "gradle.properties",
      verdict: "unknown",
      evidence: "gradle.properties not found/readable in this project",
      fix: null,
    });
  } else {
    const missing = ["minecraft_version", "loader_version"]
      .concat(loader === "fabric" ? ["yarn_mappings"] : ["neoforge_version"])
      .filter((key) => !gradleProps[key]?.trim());
    if (missing.length > 0) {
      checks.push({
        id: "gradle",
        title: "gradle.properties",
        verdict: "incompatible",
        evidence: `missing or empty: ${missing.join(", ")} — the build cannot resolve the toolchain`,
        fix: `Fill ${missing.join(", ")} in gradle.properties (or ask the agent to fix it)`,
      });
    } else {
      checks.push({
        id: "gradle",
        title: "gradle.properties",
        verdict: "compatible",
        evidence: `minecraft_version=${gradleProps.minecraft_version}, loader_version=${gradleProps.loader_version}`,
        fix: null,
      });
    }
  }

  return checks;
}

function parseGradleProperties(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export async function checkProjectCompatibility(
  basePath: string,
  project: ProjectRecord,
): Promise<ProjectCompat> {
  const params = await resolveTemplateParams(project.minecraft_version, project.loader);
  const loaderAvailable = await (async () => {
    const { getVersions } = await import("@/services/minecraft/versionCatalog");
    const info = (await getVersions()).find((v) => v.version === project.minecraft_version);
    if (!info) return false;
    return isLoaderAvailable(info, project.loader);
  })();

  let javaMajor: number | null = null;
  try {
    const env = await invoke<{ java: { found: boolean; majorVersion: number | null } }>(
      "detect_environment",
    );
    javaMajor = env.java.found ? env.java.majorVersion : null;
  } catch {
    javaMajor = null;
  }

  let gradleProps: Record<string, string> | null = null;
  try {
    const raw = await readProjectFile(
      basePath,
      `projects/${project.slug}/gradle.properties`,
    );
    gradleProps = parseGradleProperties(raw);
  } catch {
    gradleProps = null;
  }

  const checks = evaluateCompatibility(
    project,
    {
      javaRelease: params.javaRelease,
      experimental: params.experimental,
      packFormat: params.packFormat,
      templateId: params.templateId,
      loaderVersion: params.loaderVersion,
      loaderAvailable,
    },
    { javaMajor },
    gradleProps,
  );

  return {
    project,
    checks,
    summary: {
      compatible: checks.filter((c) => c.verdict === "compatible").length,
      warning: checks.filter((c) => c.verdict === "warning").length,
      incompatible: checks.filter((c) => c.verdict === "incompatible").length,
      unknown: checks.filter((c) => c.verdict === "unknown").length,
    },
  };
}

/** The version × loader matrix with EVIDENCE per cell (the catalog's truth). */
export interface MatrixCell {
  version: string;
  loader: string;
  available: boolean;
  kind: string;
  experimental: boolean;
}

export async function buildCompatibilityMatrix(
  versions: (Parameters<typeof isLoaderAvailable>[0] & { kind: string })[],
  loaders: readonly string[],
): Promise<MatrixCell[]> {
  const cells: MatrixCell[] = [];
  for (const info of versions) {
    const experimental =
      compareMcVersions(info.version, "1.21.1") > 0 && !/^26\./.test(info.version);
    for (const loader of loaders) {
      const available = isLoaderAvailable(info, loader as never);
      cells.push({
        version: info.version,
        loader,
        available,
        kind: info.kind,
        experimental,
      });
    }
  }
  return cells;
}
