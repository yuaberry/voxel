/**
 * VOXEL Security Center (Super Prompt §17, Phase D) — a REAL checklist read
 * from the server's own files: online-mode (the app enforces it, but a
 * hand-edited properties file reopens the hole — we check the DISK), RCON
 * credentials sitting in server.properties (the classic leak), whitelist,
 * EULA, backup recency, and unknown plugin jars. Findings carry severity
 * and a concrete recommendation; passing is never called "fully secure".
 */
export type SecuritySeverity = "critical" | "warning" | "info" | "pass";

export interface SecurityFinding {
  id: string;
  title: string;
  severity: SecuritySeverity;
  evidence: string;
  recommendation: string;
}

/** Parses a real server.properties payload into a map (comments skipped). */
export function parseProperties(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export interface SecurityFacts {
  properties: Record<string, string>;
  eulaAccepted: boolean;
  backupCount: number;
  newestBackupAgeHours: number | null;
  pluginJars: string[];
}

/**
 * Pure evaluation — tested standalone. The severity ladder is honest:
 * critical = accounts or credentials exposed; warning = risk worth fixing;
 * info = worth knowing; pass = the check ran clean.
 */
export function evaluateSecurity(facts: SecurityFacts): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // 1. online-mode — the account gate. The app enforces true, but the DISK is the truth.
  const onlineMode = facts.properties["online-mode"] ?? "true";
  if (onlineMode !== "true") {
    findings.push({
      id: "online-mode",
      title: "online-mode is OFF",
      severity: "critical",
      evidence: `server.properties has online-mode=${onlineMode}`,
      recommendation:
        "Turn it back ON (VOXEL's editor refuses to write false — this was edited by hand). With it off, anyone can join with any name, including yours.",
    });
  } else {
    findings.push({
      id: "online-mode",
      title: "online-mode is ON",
      severity: "pass",
      evidence: "only genuine Minecraft accounts can join",
      recommendation: "Keep it that way.",
    });
  }

  // 2. RCON — a remote console password sitting in server.properties in PLAIN TEXT
  const rconEnabled = facts.properties["enable-rcon"] === "true";
  if (rconEnabled) {
    const password = facts.properties["rcon.password"];
    if (password && password.length > 0) {
      findings.push({
        id: "rcon",
        title: "RCON password is stored in plain text",
        severity: "critical",
        evidence: "enable-rcon=true and the rcon.password is stored in plain text inside server.properties",
        recommendation:
          "RCON gives full console access over the network. Disable it if unused; if needed, firewall the port to localhost and use a long unique password — and never share the file.",
      });
    } else {
      findings.push({
        id: "rcon",
        title: "RCON is enabled without a password",
        severity: "critical",
        evidence: "enable-rcon=true and no rcon.password in server.properties",
        recommendation:
          "An unauthenticated RCON endpoint lets ANYONE who reaches the port run commands as the console. Disable it (VOXEL's editor does not need RCON).",
      });
    }
  } else {
    findings.push({
      id: "rcon",
      title: "RCON is off",
      severity: "pass",
      evidence: "no remote console endpoint",
      recommendation: "VOXEL talks to the server through its own stdin — RCON stays unnecessary.",
    });
  }

  // 3. whitelist — fine either way, but the owner should KNOW the state
  const whitelist = facts.properties["white-list"] === "true";
  findings.push({
    id: "whitelist",
    title: whitelist ? "Whitelist is ON" : "Whitelist is OFF",
    severity: whitelist ? "pass" : "info",
    evidence: `white-list=${facts.properties["white-list"] ?? "false"} — ${whitelist ? "only listed players join" : "anyone who finds the address joins"}`,
    recommendation: whitelist
      ? "Good for private servers."
      : "For a public server that's normal; for friends-only, `/whitelist on` after adding the first names.",
  });

  // 4. EULA — the legality gate
  if (!facts.eulaAccepted) {
    findings.push({
      id: "eula",
      title: "EULA not accepted",
      severity: "warning",
      evidence: "no eula.txt with eula=true",
      recommendation: "Accept it in the VOXEL wizard or the server will refuse to boot.",
    });
  }

  // 5. backups — recency is the whole point of a backup
  if (facts.backupCount === 0) {
    findings.push({
      id: "backups",
      title: "No backups exist",
      severity: "warning",
      evidence: "the backups folder for this server is empty",
      recommendation: "Take one from the console (Backup button) and consider the scheduled workspace snapshots in Settings → Storage.",
    });
  } else if (facts.newestBackupAgeHours === null) {
    findings.push({
      id: "backups",
      title: "Backups exist",
      severity: "info",
      evidence: `${facts.backupCount} backup(s)`,
      recommendation: "Verify one restores before you need it.",
    });
  } else if (facts.newestBackupAgeHours > 24 * 7) {
    findings.push({
      id: "backups",
      title: "The newest backup is over a week old",
      severity: "warning",
      evidence: `newest backup is ${Math.round(facts.newestBackupAgeHours / 24)} day(s) old (${facts.backupCount} total)`,
      recommendation: "A week of world progress is at stake. Take a fresh one now.",
    });
  } else {
    findings.push({
      id: "backups",
      title: "Backups are recent",
      severity: "pass",
      evidence: `newest backup is ${Math.round(facts.newestBackupAgeHours)}h old (${facts.backupCount} total)`,
      recommendation: "Keep the cadence.",
    });
  }

  // 6. plugins without provenance — honest: we can only LIST them
  if (facts.pluginJars.length > 0) {
    findings.push({
      id: "plugins",
      title: `${facts.pluginJars.length} plugin jar(s) installed`,
      severity: "info",
      evidence: facts.pluginJars.join(", "),
      recommendation:
        "VOXEL installed the ones from Modrinth (SHA-1 verified). Any jar you dropped by hand: confirm its origin before the next boot — a plugin has full server access.",
    });
  }

  return findings;
}

/** The summary the UI badge shows — never claims "fully secure". */
export function securitySummary(findings: SecurityFinding[]): {
  critical: number;
  warnings: number;
  verdict: string;
} {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const verdict =
    critical > 0
      ? `${critical} critical issue(s) — fix before going public`
      : warnings > 0
        ? `${warnings} warning(s) worth fixing`
        : "No known issues — passing these checks is not a guarantee, stay updated";
  return { critical, warnings, verdict };
}
