//! GitHub integration (Fase 7) — local commits and authenticated pushes.
//!
//! - Token NEVER touches any remote URL or the repository config: pushes
//!   use a one-shot `-c http.<url>.extraheader` argument (process argv,
//!   no shell, nothing persisted).
//! - Token comes from the OS keyring (device flow sign-in in Settings → GitHub).
//! - Repository metadata is stored in the github_repositories table.

use serde::Serialize;
use std::process::Command;

use super::fs;

fn git(project: &std::path::Path, args: &[&str]) -> Result<std::process::Output, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(project)
        .args(args)
        .output()
        .map_err(|e| format!("failed to launch git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            if stderr.is_empty() { stdout } else { stderr }
        ));
    }
    Ok(output)
}

fn stdout_trim(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Commits every pending change in the project (used before publishing).
#[tauri::command]
pub async fn git_commit_all(base_path: String, project_rel: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_all_impl(base_path, project_rel, message))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn git_commit_all_impl(
    base_path: String,
    project_rel: String,
    message: String,
) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    let project = fs::validated_path(&base_path, &project_rel, false)?;

    let status = stdout_trim(&git(&project, &["status", "--porcelain"])?);
    if status.is_empty() {
        return Ok("Nothing to commit — working tree is clean".to_string());
    }

    git(&project, &["add", "-A"])?;
    git(&project, &["commit", "-m", message.trim()])?;
    let sha = stdout_trim(&git(&project, &["rev-parse", "--short", "HEAD"])?);
    Ok(sha)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub branch: String,
    pub remote: String,
}

/// Adds the GitHub remote (if missing) and pushes the branch with the token
/// sent via a transient http extraheader — nothing is persisted on disk.
#[tauri::command]
pub async fn git_push_github(base_path: String, project_rel: String, remote_url: String, token: String) -> Result<PushResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_push_github_impl(base_path, project_rel, remote_url, token))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn git_push_github_impl(
    base_path: String,
    project_rel: String,
    remote_url: String,
    token: String,
) -> Result<PushResult, String> {
    let project = fs::validated_path(&base_path, &project_rel, false)?;

    if !remote_url.starts_with("https://github.com/") {
        return Err("Only https://github.com remotes are supported".to_string());
    }
    if token.trim().is_empty() {
        return Err("GitHub token missing — sign in first".to_string());
    }

    let branch = stdout_trim(&git(&project, &["rev-parse", "--abbrev-ref", "HEAD"])?);

    let remotes = stdout_trim(&git(&project, &["remote"])?);
    if remotes.split_whitespace().any(|r| r == "origin") {
        git(&project, &["remote", "set-url", "origin", &remote_url])?;
    } else {
        git(&project, &["remote", "add", "origin", &remote_url])?;
    }

    // one-shot auth header (x-access-token user, per GitHub's guidance)
    let userpass = format!("x-access-token:{}", token.trim());
    let encoded = super::fs::base64_encode(userpass.as_bytes());
    let header = format!("AUTHORIZATION: basic {encoded}");

    let push = Command::new("git")
        .arg("-C")
        .arg(&project)
        .arg("-c")
        .arg("http.https://github.com/.extraheader=".to_string() + &header)
        .args(["push", "-u", "origin", &branch])
        .output()
        .map_err(|e| format!("failed to launch git push: {e}"))?;

    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr).trim().to_string();
        return Err(format!("push failed: {}", stderr.chars().take(400).collect::<String>()));
    }

    Ok(PushResult {
        branch,
        remote: remote_url,
    })
}
