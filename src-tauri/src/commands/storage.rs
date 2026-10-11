//! Storage workspace management.
//!
//! The workspace is a user-chosen base directory containing fixed
//! subfolders (projects, instances, servers, backups, logs,
//! shaderpacks, .gradle-cache).
//! `open_in_file_manager` deliberately only opens paths inside the
//! user's home directory — never arbitrary system paths.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const WORKSPACE_SUBDIRS: [&str; 7] = [
    "projects",
    "instances",
    "servers",
    "backups",
    "logs",
    "shaderpacks",
    ".gradle-cache",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageDirInfo {
    pub name: String,
    pub path: String,
    pub existed: bool,
    pub created: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub base_path: String,
    pub dirs: Vec<StorageDirInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: String,
    pub data_dir: String,
    pub database_path: String,
}

fn home_dir() -> Result<PathBuf, String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .map_err(|_| "Could not resolve user home directory".to_string())
    } else {
        std::env::var("HOME")
            .map(PathBuf::from)
            .map_err(|_| "Could not resolve user home directory".to_string())
    }
}

fn validate_base_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Storage path cannot be empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Storage path must be absolute".to_string());
    }

    // Refuse the filesystem root outright
    if path.parent().is_none() {
        return Err("Refusing to use the filesystem root as storage".to_string());
    }

    if path.exists() && !path.is_dir() {
        return Err(format!("\"{trimmed}\" exists and is not a directory"));
    }

    Ok(path)
}

#[tauri::command]
pub fn get_default_storage_base() -> Result<String, String> {
    let home = home_dir()?;
    // VOXEL workspace by default (~/Voxel). The legacy NexusCraft folder,
    // if present, can be moved here in one click (see Storage settings).
    let base = home.join("Voxel");
    Ok(base.to_string_lossy().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyWorkspaceStatus {
    pub exists: bool,
    pub path: String,
}

#[tauri::command]
pub fn workspace_legacy_status() -> LegacyWorkspaceStatus {
    let legacy = match home_dir() {
        Ok(home) => home.join("NexusCraft"),
        Err(_) => std::path::PathBuf::from(""),
    };
    LegacyWorkspaceStatus {
        exists: legacy.is_dir(),
        path: legacy.to_string_lossy().to_string(),
    }
}

/// One-click move of the legacy ~/NexusCraft workspace to ~/Voxel.
/// Safe: refuses if the target already exists or the source is missing.
#[tauri::command]
pub fn workspace_migrate_legacy() -> Result<String, String> {
    let home = home_dir()?;
    let legacy = home.join("NexusCraft");
    let target = home.join("Voxel");
    if !legacy.is_dir() {
        return Err("Legacy ~/NexusCraft folder not found — nothing to migrate".to_string());
    }
    if target.exists() {
        return Err("~/Voxel already exists — move your data manually to be safe".to_string());
    }
    std::fs::rename(&legacy, &target)
        .map_err(|e| format!("Move failed: {e} — nothing was changed"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_storage_dirs(base_path: String) -> Result<StorageInfo, String> {
    let base = validate_base_path(&base_path)?;

    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create \"{}\": {e}", base.display()))?;

    let mut dirs = Vec::new();
    for name in WORKSPACE_SUBDIRS {
        let dir = base.join(name);
        let existed = dir.exists();
        if !existed {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create \"{}\": {e}", dir.display()))?;
        }
        dirs.push(StorageDirInfo {
            name: name.to_string(),
            path: dir.to_string_lossy().to_string(),
            existed,
            created: !existed,
        });
    }

    Ok(StorageInfo {
        base_path: base.to_string_lossy().to_string(),
        dirs,
    })
}

#[tauri::command]
pub fn get_app_paths(app: AppHandle) -> Result<AppPaths, String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve config dir: {e}"))?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve data dir: {e}"))?;

    Ok(AppPaths {
        database_path: config.join("nexuscraft.db").to_string_lossy().to_string(),
        config_dir: config.to_string_lossy().to_string(),
        data_dir: data.to_string_lossy().to_string(),
    })
}

/// Opens a path in the system file manager.
///
/// Security: the path must be absolute, exist, and be inside the user's
/// home directory. No shell is involved — fixed platform binaries with a
/// single argument.
#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());

    if !target.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let home = home_dir()?;
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Path does not exist ({}): {e}", target.display()))?;

    if !canonical.starts_with(&home) {
        return Err("Refusing to open paths outside your home directory".to_string());
    }
    if !canonical.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let status = if cfg!(target_os = "linux") {
        std::process::Command::new("xdg-open").arg(&canonical).status()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&canonical).status()
    } else {
        std::process::Command::new("explorer").arg(&canonical).status()
    };

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("File manager exited with an error".to_string()),
        Err(e) => Err(format!("Could not launch file manager: {e}")),
    }
}

/// Opens a Microsoft or GitHub authentication page in the system browser.
/// Hard-restricted to sign-in hosts — never arbitrary URLs.
#[tauri::command]
pub fn open_auth_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let allowed = trimmed.starts_with("https://www.microsoft.com/")
        || trimmed.starts_with("https://login.microsoftonline.com/")
        || trimmed.starts_with("https://login.live.com/")
        || trimmed.starts_with("https://github.com/login");
    if !allowed {
        return Err("Only Microsoft sign-in pages can be opened".to_string());
    }

    let program = if cfg!(target_os = "linux") {
        "xdg-open"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "explorer"
    };

    let status = std::process::Command::new(program)
        .arg(trimmed)
        .status()
        .map_err(|e| format!("Could not open browser: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Browser failed to open".to_string())
    }
}
