//! Git integration for projects — snapshot backbone (AD-7).
//!
//! All invocations use fixed argument vectors against a validated project
//! directory. Commit messages built here are plain strings passed as a single
//! argv element — no shell is ever involved.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub sha: String,
    pub short_sha: String,
    pub label: String,
    pub reason: String,
    pub date: String,
}

const SNAPSHOT_PREFIX: &str = "nexuscraft/snapshot/";

/// Current year for LICENSE headers — no external date crates needed.
pub fn current_year() -> String {
    days_to_civil(unix_days()).0.to_string()
}

/// Civil date from days since epoch (Howard Hinnant's algorithm).
fn days_to_civil(z: i64) -> (i64, u32, u32) {
    civil_impl(z)
}

/// Public wrapper for other modules (server backup timestamps).
pub(crate) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    civil_impl(z)
}

fn civil_impl(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn unix_days() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86_400)
        .unwrap_or(0)
}

fn today_stamp() -> String {
    let (y, m, d) = days_to_civil(unix_days());
    format!("{y:04}-{m:02}-{d:02}")
}

fn git(project: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(project)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to launch git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format!("git {} failed: {}", args.join(" "), if stderr.is_empty() { stdout } else { stderr }));
    }
    Ok(output)
}

fn stdout_trim(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Initializes a project repo with deterministic, local-only identity.
/// Returns the initial commit sha.
pub fn init_project_repo(project: &Path, author: &str) -> Result<String, String> {
    git(project, &["init"])?;
    git(project, &["config", "user.name", author])?;
    git(project, &["config", "user.email", "nexuscraft@localhost"])?;
    git(project, &["config", "commit.gpgsign", "false"])?;
    git(project, &["add", "-A"])?;
    git(
        project,
        &["commit", "-m", "Initial project scaffold (via VOXEL)"],
    )?;
    let sha = stdout_trim(&git(project, &["rev-parse", "HEAD"])?);
    Ok(sha)
}

fn commit_count(project: &Path) -> u32 {
    let output = Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| stdout_trim(&o))
        .unwrap_or_default();
    output.parse::<u32>().unwrap_or(0)
}

fn valid_label_component(reason: &str) -> String {
    reason
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

#[tauri::command]
pub async fn project_create_snapshot(base_path: String, project_rel: String, reason: String) -> Result<SnapshotEntry, String> {
    tauri::async_runtime::spawn_blocking(move || project_create_snapshot_impl(base_path, project_rel, reason))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn project_create_snapshot_impl(
    base_path: String,
    project_rel: String,
    reason: String,
) -> Result<SnapshotEntry, String> {
    let project = super::fs::validated_path(&base_path, &project_rel, false)?;

    let count = commit_count(&project);
    let label = format!("{}-{:03}", today_stamp(), count + 1);
    let clean_reason = valid_label_component(&reason);
    let message = if clean_reason.is_empty() {
        format!("{SNAPSHOT_PREFIX}{label}")
    } else {
        format!("{SNAPSHOT_PREFIX}{label}: {clean_reason}")
    };

    git(&project, &["add", "-A"])?;
    git(&project, &["commit", "--allow-empty", "-m", &message])?;
    let sha = stdout_trim(&git(&project, &["rev-parse", "HEAD"])?);
    let short = stdout_trim(&git(&project, &["rev-parse", "--short", "HEAD"])?);
    let date = stdout_trim(&git(&project, &["log", "-1", "--format=%ci"])?);

    Ok(SnapshotEntry {
        sha,
        short_sha: short,
        label,
        reason: clean_reason,
        date,
    })
}

#[tauri::command]
pub fn project_list_snapshots(
    base_path: String,
    project_rel: String,
) -> Result<Vec<SnapshotEntry>, String> {
    let project = super::fs::validated_path(&base_path, &project_rel, false)?;

    let output = git(
        &project,
        &[
            "log",
            "-n",
            "100",
            &format!("--grep=^{SNAPSHOT_PREFIX}"),
            "--format=%H%x1f%h%x1f%s%x1f%ci",
        ],
    )?;

    let raw = stdout_trim(&output);
    let mut snapshots = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() != 4 {
            continue;
        }
        let subject = parts[2].to_string();
        let (label, reason) = match subject.strip_prefix(SNAPSHOT_PREFIX) {
            Some(rest) => match rest.split_once(": ") {
                Some((l, r)) => (l.to_string(), r.to_string()),
                None => (rest.to_string(), String::new()),
            },
            None => continue,
        };
        snapshots.push(SnapshotEntry {
            sha: parts[0].to_string(),
            short_sha: parts[1].to_string(),
            label,
            reason,
            date: parts[3].to_string(),
        });
    }
    Ok(snapshots)
}

/// Restores the working tree from a snapshot commit while preserving history
/// (working-tree restore + a new restore commit).
#[tauri::command]
pub async fn project_snapshot_restore(base_path: String, project_rel: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || project_snapshot_restore_impl(base_path, project_rel, sha))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn project_snapshot_restore_impl(
    base_path: String,
    project_rel: String,
    sha: String,
) -> Result<(), String> {
    // Validate sha format strictly — it is passed to git as a ref.
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) || sha.len() < 7 || sha.len() > 40 {
        return Err("Invalid snapshot id".to_string());
    }
    // Must reference a snapshot commit, not an arbitrary ref
    let belongs = project_list_snapshots(base_path.clone(), project_rel.clone())?
        .iter()
        .any(|s| s.sha == sha || s.sha.starts_with(&sha));
    if !belongs {
        return Err("Snapshot not found in project history".to_string());
    }

    let project = super::fs::validated_path(&base_path, &project_rel, false)?;
    git(&project, &["checkout", &sha, "--", "."])?;
    git(&project, &["add", "-A"])?;
    git(
        &project,
        &["commit", "-m", &format!("{SNAPSHOT_PREFIX}restore: {sha}")],
    )?;
    Ok(())
}

#[tauri::command]
pub fn project_git_status(base_path: String, project_rel: String) -> Result<String, String> {
    let project = super::fs::validated_path(&base_path, &project_rel, false)?;
    let output = git(&project, &["status", "--porcelain"])?;
    Ok(stdout_trim(&output))
}

/// Working tree + staged diff against HEAD (agent tool + Changes panel).
#[tauri::command]
pub fn project_git_diff(base_path: String, project_rel: String) -> Result<String, String> {
    let project = super::fs::validated_path(&base_path, &project_rel, false)?;
    let output = git(&project, &["diff", "HEAD"])?;
    let diff = stdout_trim(&output);
    Ok(if diff.is_empty() {
        "No changes against the last snapshot.".to_string()
    } else {
        diff
    })
}
