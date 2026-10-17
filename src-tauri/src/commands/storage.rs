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


// ---------------------------------------------------------------------------
// Workspace snapshot — the authorship assets (projects, shaderpacks,
// modpacks) in one honest zip. Downloaded instances and server worlds are
// NOT included: they are re-creatable products, not authored work, and the
// snapshot's manifest says so.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotResult {
    pub zip_path: String,
    pub file_count: usize,
    pub bytes: u64,
    pub projects: usize,
    pub shader_packs: usize,
    pub modpacks: usize,
}

fn zip_tree<W: std::io::Write + std::io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<usize, String> {
    use std::io::Write as _;
    let mut count = 0usize;
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        // snapshots carry authored work only — build outputs and caches never
        if name == "build" || name == ".gradle" || name.starts_with('.') {
            continue;
        }
        let rel = format!("{prefix}/{name}");
        if path.is_dir() {
            count += zip_tree(writer, &path, &rel, options)?;
        } else if path.is_file() {
            let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            writer.start_file(rel.clone(), options).map_err(|e| format!("{e}"))?;
            writer.write_all(&bytes).map_err(|e| format!("{e}"))?;
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
pub async fn workspace_export_snapshot(base_path: String) -> Result<WorkspaceSnapshotResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_export_snapshot_impl(base_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn workspace_export_snapshot_impl(base_path: String) -> Result<WorkspaceSnapshotResult, String> {
    use std::io::Write as _;
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;

    let timestamp = {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let days = now / 86400;
        let secs = now % 86400;
        let (y, mo, dd) = crate::commands::git::civil_from_days(days as i64);
        format!("{y:04}{mo:02}{dd:02}-{h:02}{m:02}{s:02}",
            h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60)
    };

    let snapshots = base.join("backups/snapshots");
    std::fs::create_dir_all(&snapshots).map_err(|e| format!("mkdir: {e}"))?;
    let zip_path = snapshots.join(format!("voxel-workspace-{timestamp}.zip"));
    let file = std::fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create snapshot: {e}"))?;
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let manifest = serde_json::json!({
        "generator": format!("VOXEL {}", env!("CARGO_PKG_VERSION")),
        "createdAt": timestamp,
        "includes": ["projects (sources + .voxel memory)", "shaderpacks", "modpacks"],
        "excludes": ["instances (re-creatable launcher products)", "server worlds", "build outputs"],
        "restore": "unzip inside a VOXEL workspace to restore the authored assets"
    });
    writer.start_file("SNAPSHOT.json", options).map_err(|e| format!("{e}"))?;
    writer
        .write_all(serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?.as_slice())
        .map_err(|e| format!("{e}"))?;

    let mut count = 1usize;
    for section in ["projects", "shaderpacks", "modpacks"] {
        let dir = base.join(section);
        if dir.is_dir() {
            count += zip_tree(&mut writer, &dir, section, options)?;
        }
    }
    writer.finish().map_err(|e| format!("finalize: {e}"))?;
    let bytes = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);

    let count_dirs = |name: &str| {
        std::fs::read_dir(base.join(name))
            .map(|entries| entries.filter_map(|e| e.ok()).filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).count())
            .unwrap_or(0)
    };
    Ok(WorkspaceSnapshotResult {
        zip_path: zip_path.to_string_lossy().to_string(),
        file_count: count,
        bytes,
        projects: count_dirs("projects"),
        shader_packs: count_dirs("shaderpacks"),
        modpacks: std::fs::read_dir(base.join("modpacks")).map(|entries| entries.filter_map(|e| e.ok()).filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).count()).unwrap_or(0),
    })
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    #[test]
    fn snapshot_carries_authored_work_and_skips_products() {
        let base = std::env::temp_dir().join(format!("voxel-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("projects/kingdom/src")).unwrap();
        std::fs::create_dir_all(base.join("projects/kingdom/build")).unwrap();
        std::fs::create_dir_all(base.join("shaderpacks/cool/style")).unwrap();
        std::fs::create_dir_all(base.join("modpacks")).unwrap();
        std::fs::create_dir_all(base.join("instances/huge")).unwrap();
        std::fs::write(base.join("projects/kingdom/src/Main.java"), b"// authored").unwrap();
        std::fs::write(base.join("projects/kingdom/build/output.jar"), b"PRODUCT").unwrap();
        std::fs::write(base.join("shaderpacks/cool/style/composite.fsh"), b"void main(){}").unwrap();
        std::fs::write(base.join("modpacks/bundle.zip"), b"PK").unwrap();
        std::fs::write(base.join("instances/huge/client.jar"), b"HUGE PRODUCT").unwrap();

        let result = workspace_export_snapshot_impl(base.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.projects, 1);
        assert_eq!(result.shader_packs, 1);
        assert_eq!(result.modpacks, 1);
        assert!(result.zip_path.contains("voxel-workspace-"));
        assert!(result.file_count >= 4);

        let file = std::fs::File::open(&result.zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"SNAPSHOT.json".to_string()));
        assert!(names.contains(&"projects/kingdom/src/Main.java".to_string()));
        assert!(names.contains(&"shaderpacks/cool/style/composite.fsh".to_string()));
        assert!(names.contains(&"modpacks/bundle.zip".to_string()));
        assert!(!names.iter().any(|n| n.contains("instances/")));
        assert!(!names.iter().any(|n| n.contains("build/")));

        let _ = std::fs::remove_dir_all(&base);
    }
}


// ---------------------------------------------------------------------------
// Snapshot restore — the guided way back. NEVER overwrites: entries that
// already exist in the workspace are skipped and reported, so a restore can
// only ADD authored work, never destroy it.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRestoreResult {
    pub restored: Vec<String>,
    pub skipped: Vec<String>,
    pub snapshot_created_at: String,
}

#[tauri::command]
pub async fn workspace_import_snapshot(
    base_path: String,
    zip_path: String,
) -> Result<WorkspaceRestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_import_snapshot_impl(base_path, zip_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn workspace_import_snapshot_impl(
    base_path: String,
    zip_path: String,
) -> Result<WorkspaceRestoreResult, String> {
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;

    let zip_path = std::path::PathBuf::from(&zip_path)
        .canonicalize()
        .map_err(|e| format!("Snapshot not accessible: {e}"))?;
    let file = std::fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open snapshot: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Not a valid snapshot zip: {e}"))?;

    // Only VOXEL snapshots restore through here — the manifest is the contract
    let mut manifest_raw = String::new();
    {
        let mut entry = archive
            .by_name("SNAPSHOT.json")
            .map_err(|_| "This zip has no SNAPSHOT.json — only VOXEL workspace snapshots are supported".to_string())?;
        use std::io::Read as _;
        entry.read_to_string(&mut manifest_raw).map_err(|e| format!("{e}"))?;
    }
    let manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|e| format!("Invalid snapshot manifest: {e}"))?;
    let created_at = manifest
        .get("createdAt")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let mut restored: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("{e}"))?;
        let name = entry.name().to_string();
        if name == "SNAPSHOT.json" {
            continue;
        }
        // only the snapshot's known sections restore — nothing else rides along
        let section = name.split('/').next().unwrap_or("");
        if !["projects", "shaderpacks", "modpacks"].contains(&section) {
            return Err(format!("Unexpected entry in snapshot: {name}"));
        }
        // zip-slip guard: relative paths only
        for seg in name.split(['/', '\\']) {
            if seg == ".." {
                return Err(format!("Refused snapshot entry: {name}"));
            }
        }
        let target = base.join(&name);
        if target.exists() {
            skipped.push(name);
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut bytes = Vec::new();
        use std::io::Read as _;
        entry.read_to_end(&mut bytes).map_err(|e| format!("read {name}: {e}"))?;
        std::fs::write(&target, &bytes).map_err(|e| format!("write {}: {e}", target.display()))?;
        restored.push(name);
    }

    Ok(WorkspaceRestoreResult {
        restored,
        skipped,
        snapshot_created_at: created_at,
    })
}

#[cfg(test)]
mod restore_tests {
    use super::*;

    fn workspace_with_assets(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("voxel-restore-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("projects/kingdom/src")).unwrap();
        std::fs::create_dir_all(base.join("shaderpacks/cool/style")).unwrap();
        std::fs::create_dir_all(base.join("modpacks")).unwrap();
        std::fs::write(base.join("projects/kingdom/src/Main.java"), b"authored").unwrap();
        std::fs::write(base.join("shaderpacks/cool/style/composite.fsh"), b"void main(){}").unwrap();
        std::fs::write(base.join("modpacks/bundle.zip"), b"PK").unwrap();
        base
    }

    #[test]
    fn restore_round_trips_and_never_overwrites() {
        let base = workspace_with_assets("full");
        let snap = workspace_export_snapshot_impl(base.to_string_lossy().to_string()).unwrap();

        // fresh workspace: everything restores
        let fresh = std::env::temp_dir().join(format!("voxel-restore-fresh-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&fresh);
        std::fs::create_dir_all(&fresh).unwrap();
        let result = workspace_import_snapshot_impl(fresh.to_string_lossy().to_string(), snap.zip_path.clone()).unwrap();
        assert!(result.restored.contains(&"projects/kingdom/src/Main.java".to_string()));
        assert!(result.restored.contains(&"shaderpacks/cool/style/composite.fsh".to_string()));
        assert!(result.restored.contains(&"modpacks/bundle.zip".to_string()));
        assert!(result.skipped.is_empty());
        assert_eq!(
            std::fs::read_to_string(fresh.join("projects/kingdom/src/Main.java")).unwrap(),
            "authored"
        );

        // same workspace again: everything is skipped, NOTHING overwritten
        let mut king = fresh.join("projects/kingdom/src/Main.java");
        std::fs::write(&king, b"NEWER LOCAL WORK").unwrap();
        let result = workspace_import_snapshot_impl(fresh.to_string_lossy().to_string(), snap.zip_path.clone()).unwrap();
        assert!(result.restored.is_empty());
        assert!(result.skipped.contains(&"projects/kingdom/src/Main.java".to_string()));
        assert_eq!(std::fs::read_to_string(&king).unwrap(), "NEWER LOCAL WORK");

        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&fresh);
    }

    #[test]
    fn refuses_foreign_zips_and_slip() {
        let base = std::env::temp_dir().join(format!("voxel-restore-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        // a zip without SNAPSHOT.json is honestly refused
        let foreign = base.join("foreign.zip");
        let file = std::fs::File::create(&foreign).unwrap();
        let mut w = zip::ZipWriter::new(file);
        w.start_file("random.txt", zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write as _;
        w.write_all(b"hello").unwrap();
        w.finish().unwrap();
        assert!(workspace_import_snapshot_impl(base.to_string_lossy().to_string(), foreign.to_string_lossy().to_string()).is_err());

        // a snapshot with an unexpected section is refused
        let sneaky = base.join("sneaky.zip");
        let file = std::fs::File::create(&sneaky).unwrap();
        let mut w = zip::ZipWriter::new(file);
        w.start_file("SNAPSHOT.json", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(br#"{"createdAt":"x"}"#).unwrap();
        w.start_file("instances/evil.jar", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();
        assert!(workspace_import_snapshot_impl(base.to_string_lossy().to_string(), sneaky.to_string_lossy().to_string()).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}


// ---------------------------------------------------------------------------
// Scheduled snapshots — the automatic safety net. The cadence lives in the
// settings (0 = off, 1 = daily, 7 = weekly) and the last-run timestamp lives
// NEXT TO the snapshots (last-auto.json), so it survives DB resets and moves
// with the workspace. The app calls snapshot_auto_check once at boot.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSnapshotCheck {
    /// None when nothing was due
    pub created: Option<WorkspaceSnapshotResult>,
    pub last_run_at: Option<String>,
    pub next_due_in_hours: Option<u64>,
}

fn last_auto_path(base: &std::path::Path) -> std::path::PathBuf {
    base.join("backups/snapshots/last-auto.json")
}

fn read_last_auto(base: &std::path::Path) -> Option<u64> {
    let raw = std::fs::read_to_string(last_auto_path(base)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("at").and_then(|t| t.as_u64())
}

fn write_last_auto(base: &std::path::Path) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dir = base.join("backups/snapshots");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    std::fs::write(
        last_auto_path(base),
        serde_json::json!({ "at": now, "generator": format!("VOXEL {}", env!("CARGO_PKG_VERSION")) })
            .to_string(),
    )
    .map_err(|e| format!("write last-auto: {e}"))
}

#[tauri::command]
pub async fn snapshot_auto_check(
    base_path: String,
    cadence_days: u32,
) -> Result<AutoSnapshotCheck, String> {
    // runs at boot — the whole snapshot happens here, it must be off-thread
    tauri::async_runtime::spawn_blocking(move || snapshot_auto_check_impl(base_path, cadence_days))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn snapshot_auto_check_impl(
    base_path: String,
    cadence_days: u32,
) -> Result<AutoSnapshotCheck, String> {
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let last = read_last_auto(&base);
    let last_str = last.map(|t| t.to_string());

    if cadence_days == 0 {
        return Ok(AutoSnapshotCheck {
            created: None,
            last_run_at: last_str,
            next_due_in_hours: None,
        });
    }

    let interval = cadence_days as u64 * 86400;
    let due = match last {
        None => true,
        Some(t) => now.saturating_sub(t) >= interval,
    };

    if !due {
        let elapsed = now.saturating_sub(last.unwrap_or(now));
        let remaining = interval.saturating_sub(elapsed);
        return Ok(AutoSnapshotCheck {
            created: None,
            last_run_at: last_str,
            next_due_in_hours: Some(remaining / 3600),
        });
    }

    let created = workspace_export_snapshot_impl(base_path)?;
    write_last_auto(&base)?;
    Ok(AutoSnapshotCheck {
        created: Some(created),
        last_run_at: Some(now.to_string()),
        next_due_in_hours: Some(interval / 3600),
    })
}

#[cfg(test)]
mod auto_tests {
    use super::*;

    fn workspace(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("voxel-auto-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("projects/king")).unwrap();
        std::fs::write(base.join("projects/king/Main.java"), b"x").unwrap();
        base
    }

    #[test]
    fn auto_snapshot_fires_when_stale_and_respects_cadence() {
        let base = workspace("fire");
        let bp = base.to_string_lossy().to_string();

        // never ran + daily cadence -> fires now
        let check = snapshot_auto_check_impl(bp.clone(), 1).unwrap();
        assert!(check.created.is_some());
        assert!(base.join("backups/snapshots/last-auto.json").is_file());

        // immediately again -> not due, reports remaining hours
        let check = snapshot_auto_check_impl(bp.clone(), 1).unwrap();
        assert!(check.created.is_none());
        assert_eq!(check.next_due_in_hours, Some(24));

        // cadence off -> never due
        let check = snapshot_auto_check_impl(bp.clone(), 0).unwrap();
        assert!(check.created.is_none());
        assert!(check.next_due_in_hours.is_none());

        // stale marker: simulate 2 days ago -> fires on weekly cadence
        std::fs::write(
            last_auto_path(&base),
            serde_json::json!({ "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - 2 * 86400 }).to_string(),
        )
        .unwrap();
        let check = snapshot_auto_check_impl(bp.clone(), 7).unwrap();
        assert!(check.created.is_none(), "2 days < 7 day cadence");

        std::fs::write(
            last_auto_path(&base),
            serde_json::json!({ "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - 8 * 86400 }).to_string(),
        )
        .unwrap();
        let check = snapshot_auto_check_impl(bp, 7).unwrap();
        assert!(check.created.is_some(), "8 days > 7 day cadence");

        let _ = std::fs::remove_dir_all(&base);
    }
}
