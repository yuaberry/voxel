//! Secret storage — the credential perimeter.
//!
//! Strategy: use the OS credential manager (GNOME Keyring / Windows
//! Credential Manager / macOS Keychain) via the `keyring` crate. If the
//! OS keyring is unavailable (headless sessions, missing dbus service),
//! fall back to a permission-restricted JSON file inside the app config
//! directory (chmod 600 on Unix). The active backend is always reported
//! to the UI — never silently downgraded.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use serde::Serialize;

const KEYRING_SERVICE: &str = "voxel";
const PROBE_KEY: &str = "__backend_probe__";

/// The keyring API cannot list credentials, so every key VOXEL owns is
/// enumerated here for complete cleanup operations.
const KNOWN_SECRET_KEYS: &[&str] = &[
    "ai_api_key",
    "github_token",
    "mc_active_provider",
    "mc_username",
    "mc_uuid",
    "mc_access_token",
    "mc_token_expiry",
    "ely_username",
    "ely_uuid",
    "ely_access_token",
    "ely_token_expiry",
    "ely_refresh_token",
    "ely_client_id",
];

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretBackend {
    OsKeyring,
    LocalFile,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretsOpResult {
    pub success: bool,
    pub backend: SecretBackend,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretBackendInfo {
    pub backend: SecretBackend,
    pub available: bool,
}

fn keyring_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, PROBE_KEY) else {
            return false;
        };
        let probe_ok = entry
            .set_password("probe")
            .and_then(|_| entry.get_password())
            .map(|v| v == "probe")
            .unwrap_or(false);
        let _ = entry.delete_credential();
        probe_ok
    })
}

fn fallback_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve config dir: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create config dir: {e}"))?;
    Ok(dir.join("secrets.json"))
}

fn load_fallback(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = fallback_file_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read secrets file: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Secrets file is corrupted: {e}"))
}

fn save_fallback(app: &AppHandle, secrets: &HashMap<String, String>) -> Result<(), String> {
    let path = fallback_file_path(app)?;
    let raw = serde_json::to_string_pretty(secrets)
        .map_err(|e| format!("Could not encode secrets: {e}"))?;
    std::fs::write(&path, raw).map_err(|e| format!("Could not write secrets file: {e}"))?;

    // Restrict to the current user (best-effort, Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn remove_fallback_secret(app: &AppHandle, key: &str) -> Result<bool, String> {
    let path = fallback_file_path(app)?;
    if !path.exists() {
        return Ok(false);
    }
    let mut secrets = load_fallback(app)?;
    if secrets.remove(key).is_none() {
        return Ok(false);
    }
    save_fallback(app, &secrets)?;
    Ok(true)
}

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("Keyring error: {e}"))
}

#[tauri::command]
pub fn secrets_set(app: AppHandle, key: String, value: String) -> Result<SecretsOpResult, String> {
    if key.is_empty() || key == PROBE_KEY {
        return Err("Invalid secret key".to_string());
    }

    if keyring_available() {
        keyring_entry(&key)?
            .set_password(&value)
            .map_err(|e| format!("Keyring error: {e}"))?;
        // A previous fallback write must not survive after the keyring becomes
        // available again, otherwise a stale credential can reappear later.
        remove_fallback_secret(&app, &key)?;
        return Ok(SecretsOpResult {
            success: true,
            backend: SecretBackend::OsKeyring,
        });
    }

    let mut secrets = load_fallback(&app)?;
    secrets.insert(key, value);
    save_fallback(&app, &secrets)?;
    Ok(SecretsOpResult {
        success: true,
        backend: SecretBackend::LocalFile,
    })
}

#[tauri::command]
pub fn secrets_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    if keyring_available() {
        match keyring_entry(&key)?.get_password() {
            Ok(value) => return Ok(Some(value)),
            Err(keyring::Error::NoEntry) => {
                // Migrate a credential written while the keyring was
                // unavailable. The fallback copy is removed only after the
                // keyring write succeeds.
                let fallback = load_fallback(&app)?;
                if let Some(value) = fallback.get(&key).cloned() {
                    keyring_entry(&key)?
                        .set_password(&value)
                        .map_err(|e| format!("Keyring error: {e}"))?;
                    remove_fallback_secret(&app, &key)?;
                    return Ok(Some(value));
                }
                return Ok(None);
            }
            Err(e) => return Err(format!("Keyring error: {e}")),
        }
    }

    let secrets = load_fallback(&app)?;
    Ok(secrets.get(&key).cloned())
}

#[tauri::command]
pub fn secrets_has(app: AppHandle, key: String) -> Result<bool, String> {
    Ok(secrets_get(app, key)?.is_some())
}

#[tauri::command]
pub fn secrets_delete(app: AppHandle, key: String) -> Result<SecretsOpResult, String> {
    let mut errors: Vec<String> = Vec::new();
    let backend = if keyring_available() {
        match keyring_entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => errors.push(format!("Keyring error: {e}")),
        }
        SecretBackend::OsKeyring
    } else {
        SecretBackend::LocalFile
    };

    // Always remove the fallback copy as well. This closes the transition
    // window where a key exists in both backends.
    if let Err(e) = remove_fallback_secret(&app, &key) {
        errors.push(e);
    }

    if errors.is_empty() {
        Ok(SecretsOpResult {
            success: true,
            backend,
        })
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub fn secrets_clear_all(app: AppHandle) -> Result<SecretsOpResult, String> {
    let mut errors: Vec<String> = Vec::new();
    let backend = if keyring_available() {
        // The keyring API has no "list" operation — clear the keys we own
        // by convention. Known keys are enumerated explicitly above.
        for key in KNOWN_SECRET_KEYS {
            if let Ok(entry) = keyring_entry(key) {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(e) => errors.push(format!("Keyring error for {key}: {e}")),
                }
            }
        }
        SecretBackend::OsKeyring
    } else {
        SecretBackend::LocalFile
    };

    // The fallback file is cleared unconditionally, even when the keyring is
    // currently active. Otherwise an old local copy could reappear after a
    // later backend transition.
    if let Err(e) = save_fallback(&app, &HashMap::new()) {
        errors.push(e);
    }

    if errors.is_empty() {
        Ok(SecretsOpResult {
            success: true,
            backend,
        })
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub fn secrets_backend_info() -> Result<SecretBackendInfo, String> {
    let available = keyring_available();
    Ok(SecretBackendInfo {
        backend: if available {
            SecretBackend::OsKeyring
        } else {
            SecretBackend::LocalFile
        },
        available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_includes_every_microsoft_and_elyby_secret() {
        for key in [
            "mc_active_provider",
            "mc_username",
            "mc_uuid",
            "mc_access_token",
            "mc_token_expiry",
            "ely_username",
            "ely_uuid",
            "ely_access_token",
            "ely_token_expiry",
            "ely_refresh_token",
            "ely_client_id",
        ] {
            assert!(
                KNOWN_SECRET_KEYS.contains(&key),
                "known secret list is missing {key}"
            );
        }
    }
}
