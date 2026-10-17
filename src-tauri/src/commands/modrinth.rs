//! Modrinth catalog downloads (Modpack Creator v3, roadmap §9.5) — the
//! external slice, done the way every other download in this app is done:
//! from the OFFICIAL platform, through the Rust perimeter, with a verified
//! checksum before the file ever lands.
//!
//! Search/version listing happens in the frontend (small JSON via the
//! http plugin, capability-scoped to api.modrinth.com). The actual FILE
//! download is a Rust command: host allowlist (cdn.modrinth.com only),
//! size cap, SHA-1 verification against the hash Modrinth publishes,
//! and the same instance path guard as every install.

use crate::commands::launcher::http_get_bytes;
use serde::{Deserialize, Serialize};
use sha1::{Digest as _, Sha1};
use std::path::PathBuf;

/// The only host files may ever come from.
const ALLOWED_HOST: &str = "cdn.modrinth.com";
/// Sanity cap — real mods are far below this; guards against redirects gone wrong.
const MAX_FILE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthDownloadPayload {
    pub storage_base: String,
    /// Prepared instance the mod lands in (e.g. "dark-kingdom")
    pub instance_slug: String,
    /// CDN url returned by the Modrinth version API
    pub url: String,
    /// SHA-1 hex published by Modrinth for this file
    pub sha1: String,
    /// Target file name inside mods/
    pub file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthDownloadResult {
    pub file_path: String,
    pub bytes: u64,
    pub sha1_verified: bool,
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Only exact-host https URLs from the Modrinth CDN are accepted — no
/// subdomain look-alikes, no http, no redirects to other hosts.
pub(crate) fn is_modrinth_cdn_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str() == Some(ALLOWED_HOST)
        && parsed.port().is_none()
}

fn safe_mod_file_name(name: &str) -> Result<String, String> {
    if name.is_empty()
        || !name.ends_with(".jar")
        || name.starts_with('.')
        || name
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+')))
    {
        return Err(format!("Refused unsafe mod file name: {name:?}"));
    }
    Ok(name.to_string())
}

#[tauri::command]
pub async fn modrinth_download(payload: ModrinthDownloadPayload) -> Result<ModrinthDownloadResult, String> {
    // downloads mod jars — off the main thread
    tauri::async_runtime::spawn_blocking(move || modrinth_download_impl(payload))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn modrinth_download_impl(payload: ModrinthDownloadPayload) -> Result<ModrinthDownloadResult, String> {
    if !is_modrinth_cdn_url(&payload.url) {
        return Err(format!(
            "Only https files from {ALLOWED_HOST} are accepted (got: {})",
            payload.url
        ));
    }
    let expected = payload.sha1.trim().to_ascii_lowercase();
    if expected.len() != 40 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("A valid SHA-1 hex digest from the Modrinth API is required".to_string());
    }
    let file_name = safe_mod_file_name(&payload.file_name)?;

    let base = PathBuf::from(&payload.storage_base)
        .canonicalize()
        .map_err(|e| format!("Storage location is not accessible: {e}"))?;
    let mods_dir = base.join("instances").join(&payload.instance_slug).join("mods");
    if !base.join("instances").join(&payload.instance_slug).is_dir() {
        return Err(format!(
            "Instance \"{}\" is not prepared — open the Launcher tab and prepare it first",
            payload.instance_slug
        ));
    }
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("Failed to create {}: {e}", mods_dir.display()))?;

    let bytes = http_get_bytes(&payload.url)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File exceeds the {MAX_FILE_BYTES}-byte safety cap (got {})",
            bytes.len()
        ));
    }
    let actual = sha1_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "SHA-1 mismatch — download refused (expected {expected}, got {actual})"
        ));
    }

    let target = mods_dir.join(&file_name);
    std::fs::write(&target, &bytes).map_err(|e| format!("Failed to write {}: {e}", target.display()))?;

    Ok(ModrinthDownloadResult {
        file_path: target.to_string_lossy().to_string(),
        bytes: bytes.len() as u64,
        sha1_verified: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdn_url_allowlist_is_strict() {
        assert!(is_modrinth_cdn_url("https://cdn.modrinth.com/data/AABBCC/JHW.jar"));
        assert!(!is_modrinth_cdn_url("https://evil.example/data/JHW.jar"));
        assert!(!is_modrinth_cdn_url("https://cdn.modrinth.com.evil.example/JHW.jar"));
        assert!(!is_modrinth_cdn_url("http://cdn.modrinth.com/data/JHW.jar"));
        assert!(!is_modrinth_cdn_url("https://cdn.modrinth.com:8443/data/JHW.jar"));
        assert!(!is_modrinth_cdn_url("notaurl"));
    }

    #[test]
    fn mod_file_names_are_guarded() {
        // '+' is standard in Maven-style mod versions (fabric-api-0.92.12+1.20.1.jar)
        assert!(safe_mod_file_name("fabric-api-0.92.12+1.20.1.jar").is_ok());
        assert!(safe_mod_file_name("fabric-api-0.92.2.jar").is_ok());
        assert!(safe_mod_file_name("some_mod-1.0.0.jar").is_ok());
        assert!(safe_mod_file_name("../escape.jar").is_err());
        assert!(safe_mod_file_name("with space.jar").is_err());
        assert!(safe_mod_file_name("notajar.zip").is_err());
        assert!(safe_mod_file_name(".hidden.jar").is_err());
        assert!(safe_mod_file_name("a/b.jar").is_err());
    }

    #[test]
    #[ignore = "e2e: real network — downloads a real Modrinth mod and verifies the published SHA-1"]
    fn e2e_downloads_a_real_mod_with_verified_sha1() {
        let base = std::env::temp_dir().join(format!("voxel-modrinth-{}", std::process::id()));
        let instance = base.join("instances/dark-kingdom");
        std::fs::create_dir_all(&instance).unwrap();

        // Live Modrinth version API: newest fabric-api for 1.20.1/fabric
        let versions_url = "https://api.modrinth.com/v2/project/fabric-api/version?game_versions=%5B%221.20.1%22%5D&loaders=%5B%22fabric%22%5D";
        let json = http_get_bytes(versions_url).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&json).unwrap();
        let first = v.as_array().unwrap().first().unwrap();
        let file = first["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["primary"].as_bool().unwrap_or(false))
            .or_else(|| first["files"].as_array().unwrap().first())
            .unwrap();
        let url = file["url"].as_str().unwrap().to_string();
        let sha1 = file["hashes"]["sha1"].as_str().unwrap().to_string();
        let file_name = file["filename"].as_str().unwrap().to_string();
        eprintln!("e2e target: {file_name} sha1={sha1}");

        let payload = ModrinthDownloadPayload {
            storage_base: base.to_string_lossy().to_string(),
            instance_slug: "dark-kingdom".to_string(),
            url,
            sha1,
            file_name,
        };
        let result = modrinth_download_impl(payload).unwrap();
        assert!(result.sha1_verified);
        assert!(result.bytes > 100_000, "fabric-api jar should be substantial: {}", result.bytes);
        assert!(result.file_path.ends_with(".jar"));
        assert!(std::path::PathBuf::from(&result.file_path).is_file());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn sha1_hex_is_stable() {
        assert_eq!(sha1_hex(b"hello"), "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    }
}
