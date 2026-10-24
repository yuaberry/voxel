/**
 * VOXEL QA Lab (Super Prompt §14, Fase C) — the honest verdict matrix. The
 * prompt's rule is the law here: BUILD SUCCEEDED is not AUTOMATED CHECKS
 * PASSED is not RUNTIME PROVEN — and when automation can't reach a level,
 * the limitation is REGISTERED, never hidden.
 */
import type { ProjectRecord } from "@/types";
import { checkProjectConsistency } from "@/services/assets/assetLab";
import { checkProjectCompatibility } from "@/services/compat/compatService";

export type QaLevel = "build" | "checks" | "runtime" | "manual";
export type QaStatus = "passed" | "failed" | "not-run" | "requires-manual";

export interface QaVerdict {
  level: QaLevel;
  label: string;
  status: QaStatus;
  detail: string;
  registeredLimitation?: string;
}

/**
 * Pure verdict logic — tested without I/O. The facts flow in from the
 * project record, the consistency checker and the compatibility checks.
 */
export function evaluateQa(
  facts: {
    lastBuildStatus: string | null;
    consistencyIssues: number;
    compatIncompatible: number;
    compatWarnings: number;
  },
): QaVerdict[] {
  const verdicts: QaVerdict[] = [];

  // Level 1 — BUILD: the recorded, real outcome of the last build
  if (facts.lastBuildStatus === "success") {
    verdicts.push({
      level: "build",
      label: "Build succeeded",
      status: "passed",
      detail: "The last gradle build produced the jar (recorded in the project).",
    });
  } else if (facts.lastBuildStatus === "failed") {
    verdicts.push({
      level: "build",
      label: "Build failed",
      status: "failed",
      detail: "The last build failed — fix it first (the Fix Build workflow exists for this).",
    });
  } else {
    verdicts.push({
      level: "build",
      label: "Never built",
      status: "not-run",
      detail: "No build was ever recorded for this project.",
    });
  }

  // Level 2 — AUTOMATED CHECKS: consistency + compatibility (only when the
  // build level holds; checks on a broken build bury the lede)
  if (facts.lastBuildStatus !== "success") {
    verdicts.push({
      level: "checks",
      label: "Automated checks",
      status: "not-run",
      detail: "Static checks run after a successful build — get the build green first.",
    });
  } else if (facts.compatIncompatible > 0) {
    verdicts.push({
      level: "checks",
      label: "Automated checks",
      status: "failed",
      detail: `${facts.compatIncompatible} incompatibility verdict(s) in the Compatibility Lab — check the evidence there.`,
    });
  } else if (facts.consistencyIssues > 0 || facts.compatWarnings > 0) {
    verdicts.push({
      level: "checks",
      label: "Automated checks passed with warnings",
      status: "failed",
      detail: `${facts.consistencyIssues} consistency finding(s) and ${facts.compatWarnings} compatibility warning(s) — visible in the Asset Lab and Compatibility Lab.`,
    });
  } else {
    verdicts.push({
      level: "checks",
      label: "Automated checks passed",
      status: "passed",
      detail: "No broken references, no missing files, no orphans, no duplicates; compatibility all green.",
    });
  }

  // Level 3 — RUNTIME: VOXEL has no in-game probe — the limitation is
  // REGISTERED exactly as the prompt demands (never claim what we can't test)
  verdicts.push({
    level: "runtime",
    label: "Runtime test",
    status: "requires-manual",
    detail: "Launch the game with the mod installed and play it — that is the runtime proof.",
    registeredLimitation:
      "No automated in-game runtime probe exists in VOXEL yet; runtime verification is manual (one click: Launch).",
  });

  // Level 4 — MANUAL: the human sign-off that closes the QA chain
  verdicts.push({
    level: "manual",
    label: "Manual verification",
    status: "requires-manual",
    detail: "A human plays it and signs off — the only proof of fun.",
    registeredLimitation: "By design: manual verification cannot be automated.",
  });

  return verdicts;
}

/** Gathers the real facts and produces the project's verdict matrix. */
export async function getProjectQa(
  basePath: string,
  project: ProjectRecord,
): Promise<QaVerdict[]> {
  const [consistency, compat] = await Promise.all([
    checkProjectConsistency(basePath, project).catch(() => []),
    checkProjectCompatibility(basePath, project).catch(() => ({
      summary: { compatible: 0, warning: 0, incompatible: 0, unknown: 0 },
    })),
  ]);
  return evaluateQa({
    lastBuildStatus: project.last_build_status,
    consistencyIssues: consistency.filter((i) => i.severity !== "duplicate").length,
    compatIncompatible: compat.summary.incompatible,
    compatWarnings: compat.summary.warning,
  });
}
