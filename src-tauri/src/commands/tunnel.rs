//! Public Tunnel (free) — expose local servers to the internet with zero
//! cost and zero port-forwarding, via playit.gg (the agent built for game
//! servers). The agent is downloaded from its OFFICIAL GitHub releases into
//! the workspace tunnel directory and run as a monitored process.
//!
//! Interface reserved: `TunnelProvider` — future providers (ngrok, VPS,
//! cloudflared) plug in without touching the caller.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::process;

fn tunnel_dir(base: &Path) -> PathBuf {
    base.join("tunnel")
}

fn agent_path(base: &Path) -> PathBuf {
    tunnel_dir(base).join("playit-agent")
}

fn shared_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("reqwest client")
    })
}

#[derive(Deserialize)]
struct GhRelease {
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    #[serde(default)]
    browser_download_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TunnelSetup {
    pub agent_path: String,
    pub downloaded: bool,
}

/// Downloads the playit agent once from its official GitHub releases
/// (linux amd64). Returns the local path; `downloaded` tells whether the
/// binary was fetched in this call.
#[tauri::command]
pub async fn tunnel_setup(base_path: String) -> Result<TunnelSetup, String> {
    // downloads the playit.gg agent
    tauri::async_runtime::spawn_blocking(move || tunnel_setup_impl(base_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn tunnel_setup_impl(base_path: String) -> Result<TunnelSetup, String> {
    let base = PathBuf::from(&base_path);
    let dir = tunnel_dir(&base);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let target = agent_path(&base);

    if target.is_file() {
        return Ok(TunnelSetup {
            agent_path: target.to_string_lossy().to_string(),
            downloaded: false,
        });
    }

    // Official source: the playit-cloud/playit-agent GitHub releases
    let response = shared_client()
        .get("https://api.github.com/repos/playit-cloud/playit-agent/releases/latest")
        .header("User-Agent", "voxel")
        .send()
        .map_err(|e| format!("GitHub API unreachable: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("GitHub API HTTP {}", response.status()));
    }
    let release: GhRelease = response
        .json()
        .map_err(|e| format!("release parse: {e}"))?;

    let asset = release
        .assets
        .iter()
        .find(|a| a.name.starts_with("playit-linux-amd64") && a.name.ends_with(".exe") == false)
        .or_else(|| release.assets.iter().find(|a| a.name.contains("linux-amd64")))
        .ok_or_else(|| "No linux-amd64 asset in the latest playit release".to_string())?;

    let bytes = shared_client()
        .get(&asset.browser_download_url)
        .send()
        .map_err(|e| format!("agent download failed: {e}"))?
        .bytes()
        .map_err(|e| format!("agent download read: {e}"))?
        .to_vec();
    std::fs::write(&target, bytes).map_err(|e| format!("agent write: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&target).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&target, perms).map_err(|e| format!("chmod: {e}"))?;
    }

    Ok(TunnelSetup {
        agent_path: target.to_string_lossy().to_string(),
        downloaded: true,
    })
}

#[tauri::command]
pub async fn tunnel_start(
    app: tauri::AppHandle,
    base_path: String,
    slug: String,
    local_port: u16,
    secret: Option<String>,
) -> Result<String, String> {
    // downloads the agent on first use
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || tunnel_start_impl(app, base_path, slug, local_port, secret))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn tunnel_start_impl(
    app: tauri::AppHandle,
    base_path: String,
    slug: String,
    local_port: u16,
    secret: Option<String>,
) -> Result<String, String> {
    let key = format!("tunnel/{slug}");
    if process::is_running(&key) {
        return Err("A tunnel is already running for this server".to_string());
    }

    let setup = tunnel_setup_impl(base_path)?;
    let agent = PathBuf::from(&setup.agent_path);

    let mut command = std::process::Command::new(&agent);
    command.arg("--platform").arg("minecraft-java");
    if let Some(secret_value) = secret.as_deref() {
        if !secret_value.trim().is_empty() {
            command.arg("--secret").arg(secret_value.trim());
        }
    }
    // Route traffic to the local server port
    command.env(
        "PLAYIT_AGENT_PORT",
        format!("tcp://127.0.0.1:{local_port},udp://127.0.0.1:{local_port}"),
    );

    process::spawn_monitored(app, &key, command, "tunnel", true)?;
    Ok(key)
}

#[tauri::command]
pub fn tunnel_stop(slug: String) -> Result<(), String> {
    process::send_line(&format!("tunnel/{slug}"), "exit")
}

#[tauri::command]
pub fn tunnel_force_stop(slug: String) -> Result<(), String> {
    process::stop_by_key(&format!("tunnel/{slug}"))
}

#[tauri::command]
pub fn tunnel_status(slug: String) -> bool {
    process::is_running(&format!("tunnel/{slug}"))
}
