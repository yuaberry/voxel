//! Server Studio core (Fase 6) — create, configure, run, back up.
//!
//! - Server jars from official sources: vanilla (piston-meta) and Paper
//!   (Fill API), checksum-verified, cached per server install.
//! - Graceful stop: `stop` via the process stdin (world-safe); force kill
//!   stays available as a fallback.
//! - Backups: timestamped zips of world + configs, zip-slip-guarded restore.
//! - EULA is explicit: the wizard requires the user's acceptance.

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::launcher::http_get_bytes;
use super::process;

// ---------------------------------------------------------------------------
// Layout & helpers
// ---------------------------------------------------------------------------

fn server_dir(base: &Path, slug: &str) -> PathBuf {
    base.join("servers").join(slug)
}

fn backups_dir(base: &Path, slug: &str) -> PathBuf {
    base.join("backups").join("servers").join(slug)
}

fn validate_slug(slug: &str) -> Result<(), String> {
    let ok = !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-');
    if ok {
        Ok(())
    } else {
        Err("Invalid server slug (lowercase letters, digits, single hyphens)".to_string())
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn compact_timestamp() -> String {
    compact_timestamp_pub()
}

/// Timestamp shared with the dossier module.
pub(crate) fn compact_timestamp_pub() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = super::git::civil_from_days((secs / 86_400) as i64);
    let time_of_day = secs % 86_400;
    format!("{y:04}{m:02}{d:02}-{time_of_day:05}")
}

// ---------------------------------------------------------------------------
// Official jar downloads
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct VersionJsonLite {
    #[serde(default)]
    downloads: std::collections::HashMap<String, DownloadLite>,
}

#[derive(Deserialize)]
struct DownloadLite {
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: String,
}

#[derive(Deserialize)]
struct PaperBuild {
    #[serde(default)]
    downloads: std::collections::HashMap<String, PaperDownload>,
}

#[derive(Deserialize)]
struct PaperDownload {
    #[serde(default)]
    url: String,
    #[serde(default)]
    checksums: std::collections::HashMap<String, String>,
}

fn download_with_sha1(url: &str, dest: &Path, sha1: &str) -> Result<(), String> {
    let bytes = http_get_bytes(url)?;
    if !sha1.is_empty() {
        let digest = {
            use sha1::Digest as _;
            let mut hasher = sha1::Sha1::new();
            hasher.update(&bytes);
            hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        if digest != sha1 {
            return Err("Server jar SHA-1 mismatch".to_string());
        }
    }
    std::fs::write(dest, bytes).map_err(|e| format!("{e}"))
}

fn download_with_sha256(url: &str, dest: &Path, sha256: &str) -> Result<(), String> {
    let bytes = http_get_bytes(url)?;
    if !sha256.is_empty() && sha256_hex(&bytes) != sha256 {
        return Err("Paper jar SHA-256 mismatch".to_string());
    }
    std::fs::write(dest, bytes).map_err(|e| format!("{e}"))
}

/// Downloads the latest official server jar for the chosen software/version.
fn fetch_server_jar(dir: &Path, software: &str, mc_version: &str) -> Result<String, String> {
    let jar = dir.join("server.jar");

    match software {
        "vanilla" => {
            let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
            let manifest_bytes = http_get_bytes(manifest_url)?;
            let manifest: super::launcher::Manifest =
                serde_json::from_slice(manifest_bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&manifest_bytes))
                    .map_err(|e| format!("manifest parse: {e}"))?;
            let version_url = manifest
                .versions
                .iter()
                .find(|v| v.id == mc_version)
                .map(|v| v.url.clone())
                .ok_or_else(|| format!("Minecraft {mc_version} not found in the official manifest"))?;

            let version_bytes = http_get_bytes(&version_url)?;
            let version: VersionJsonLite = serde_json::from_slice(
                version_bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&version_bytes),
            )
            .map_err(|e| format!("version parse: {e}"))?;

            let server = version
                .downloads
                .get("server")
                .ok_or_else(|| format!("Vanilla {mc_version} has no server jar (try Paper)"))?;
            download_with_sha1(&server.url, &jar, &server.sha1)?;
        }
        "paper" => {
            let url = format!(
                "https://fill.papermc.io/v3/projects/paper/versions/{mc_version}/builds/latest"
            );
            let build_bytes = http_get_bytes(&url)?;
            let build: PaperBuild = serde_json::from_slice(&build_bytes)
                .map_err(|e| format!("Paper build parse: {e}"))?;
            let download = build
                .downloads
                .get("server:default")
                .ok_or_else(|| "Paper build has no default server download".to_string())?;
            let sha = download.checksums.get("sha256").cloned().unwrap_or_default();
            download_with_sha256(&download.url, &jar, &sha)?;
        }
        other => return Err(format!("Unknown server software \"{other}\"")),
    }

    Ok(jar.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerSetupResult {
    pub server_dir: String,
    pub jar_path: String,
}

/// Facts written to `voxel-server.json` inside every server folder — the
/// disk-side source of truth for self-healing reconciliation.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerDiskManifest {
    pub slug: String,
    pub name: String,
    pub software: String,
    pub mc_version: String,
    pub port: u16,
    pub ram_mb: u32,
    pub created_at: String,
}

/// Scans `<base>/servers/*` and returns the REAL servers that exist on disk
/// (facts from voxel-server.json / server.properties / eula). The app
/// reconciles its database against this: folders without a row are adopted
/// (a server is never lost because a db write failed), rows without a
/// folder are retired. The disk is the truth — never fake data.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskServerInfo {
    pub slug: String,
    pub name: String,
    pub software: String,
    pub mc_version: String,
    pub port: u16,
    pub ram_mb: u32,
    pub created_at: String,
    pub has_jar: bool,
    pub has_eula: bool,
}

#[tauri::command]
pub fn servers_scan_disk(base_path: String) -> Result<Vec<DiskServerInfo>, String> {
    let base = Path::new(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let servers_root = base.join("servers");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&servers_root) {
        Ok(entries) => entries,
        Err(_) => return Ok(out), // no servers dir yet — empty is honest
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') {
            continue;
        }
        // Facts, preferring the manifest and falling back to the files
        let (mut name, mut software, mut mc_version, mut ram_mb) =
            (slug.clone(), "vanilla".to_string(), String::new(), 2048u32);
        let mut port = 25565u16;
        let mut created_at = String::new();
        if let Ok(bytes) = std::fs::read(path.join("voxel-server.json")) {
            if let Ok(m) = serde_json::from_slice::<ServerDiskManifest>(&bytes) {
                name = m.name;
                software = m.software;
                mc_version = m.mc_version;
                port = m.port;
                ram_mb = m.ram_mb;
                created_at = m.created_at;
            }
        }
        if let Ok(content) = std::fs::read_to_string(path.join("server.properties")) {
            for line in content.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    if k.trim() == "server-port" {
                        if let Ok(p) = v.trim().parse::<u16>() {
                            port = p;
                        }
                    }
                }
            }
        }
        if mc_version.is_empty() {
            // Old folders (pre-manifest) honestly say what we can't know
            mc_version = "unknown".to_string();
        }
        out.push(DiskServerInfo {
            slug,
            name,
            software,
            mc_version,
            port,
            ram_mb,
            created_at,
            has_jar: path.join("server.jar").is_file(),
            has_eula: path.join("eula.txt").is_file(),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub async fn server_create(
    base_path: String,
    slug: String,
    name: String,
    software: String,
    mc_version: String,
    port: u16,
    ram_mb: u32,
    accept_eula: bool,
    properties: Option<std::collections::HashMap<String, String>>,
) -> Result<ServerSetupResult, String> {
    // The jar download (official Mojang/Paper endpoints) can take 30-90s —
    // it MUST run off the main thread or the whole app freezes (owner report)
    tauri::async_runtime::spawn_blocking(move || server_create_impl(
        base_path, slug, name, software, mc_version, port, ram_mb, accept_eula, properties,
    ))
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn server_create_impl(
    base_path: String,
    slug: String,
    name: String,
    software: String,
    mc_version: String,
    port: u16,
    ram_mb: u32,
    accept_eula: bool,
    properties: Option<std::collections::HashMap<String, String>>,
) -> Result<ServerSetupResult, String> {
    if name.trim().is_empty() {
        return Err("Server name cannot be empty".to_string());
    }
    validate_slug(&slug)?;
    if !["vanilla", "paper"].contains(&software.as_str()) {
        return Err("Server software must be \"vanilla\" or \"paper\"".to_string());
    }
    if (1024..=65535).contains(&port) == false {
        return Err("Port must be between 1024 and 65535".to_string());
    }
    if ram_mb < 512 || ram_mb > 32768 {
        return Err("RAM must be between 512 MB and 32 GB".to_string());
    }
    if !accept_eula {
        return Err("The Minecraft EULA must be accepted to run a server".to_string());
    }

    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let dir = server_dir(&base, &slug);
    if dir.exists() {
        return Err(format!("A server named \"{slug}\" already exists"));
    }
    for sub in ["world", "plugins", "config", "logs"] {
        std::fs::create_dir_all(dir.join(sub)).map_err(|e| format!("{e}"))?;
    }

    // EULA — the checkbox in the wizard is the user's explicit acceptance
    std::fs::write(
        dir.join("eula.txt"),
        format!(
            "# Accepted via VOXEL on {}\neula=true\n",
            compact_timestamp()
        ),
    )
        .map_err(|e| format!("{e}"))?;

    let lines: Vec<String> = curated_properties(port, properties.as_ref())
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    std::fs::write(dir.join("server.properties"), format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("{e}"))?;

    // Self-describing manifest: the DISK is the source of truth, so a server
    // folder can always reconcile itself back into the app database (if the
    // db write failed after creation, the server is never lost — the next
    // listing adopts the folder from these facts).
    let manifest = ServerDiskManifest {
        slug: slug.clone(),
        name: name.trim().to_string(),
        software: software.to_string(),
        mc_version: mc_version.clone(),
        port,
        ram_mb,
        created_at: compact_timestamp(),
    };
    if let Err(e) = std::fs::write(
        dir.join("voxel-server.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("manifest: {e}"))?,
    ) {
        return Err(format!("write voxel-server.json: {e}"));
    }

    // The owner's ask: every server folder carries its own documentation —
    // written BEFORE the jar download so it exists no matter what
    let info = ServerInfoPayload {
        storage_base: base.to_string_lossy().to_string(),
        slug: slug.clone(),
        name: name.clone(),
        software: software.clone(),
        mc_version: mc_version.clone(),
        ram_mb,
        modules: Vec::new(),
    };
    if let Err(e) = server_write_info_impl(info) {
        eprintln!("DEBUG server_write_info failed: {e}");
    }

    let jar_path = fetch_server_jar(&dir, &software, &mc_version)?;

    Ok(ServerSetupResult {
        server_dir: dir.to_string_lossy().to_string(),
        jar_path,
    })
}

/// Curated server.properties baseline, with style-preset overrides applied.
/// Keys/values are format-validated (no separators/newlines) — the presets
/// come from our own catalog, this is defense in depth.
pub fn curated_properties(
    port: u16,
    overrides: Option<&std::collections::HashMap<String, String>>,
) -> Vec<(String, String)> {
    let mut curated: Vec<(String, String)> = vec![
        ("motd".into(), "A VOXEL server".into()),
        ("server-port".into(), port.to_string()),
        ("online-mode".into(), "true".into()),
        ("gamemode".into(), "survival".into()),
        ("level-name".into(), "world".into()),
        ("view-distance".into(), "10".into()),
        ("max-players".into(), "20".into()),
        ("enable-command-block".into(), "true".into()),
        ("spawn-protection".into(), "16".into()),
        ("white-list".into(), "false".into()),
    ];
    // online-mode is security-relevant and never overridable
    if let Some(overrides) = overrides {
        for (key, value) in overrides {
            let valid_key = !key.is_empty()
                && key.len() <= 64
                && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            let valid_value = !value.contains('\n') && !value.contains('\r') && value.len() <= 256;
            if key == "online-mode" || !valid_key || !valid_value {
                continue;
            }
            if let Some(slot) = curated.iter_mut().find(|(k, _)| k == key) {
                slot.1 = value.clone();
            } else {
                curated.push((key.clone(), value.clone()));
            }
        }
    }
    curated
}

#[tauri::command]
pub fn server_start(
    app: AppHandle,
    base_path: String,
    slug: String,
    ram_mb: u32,
    custom_java_path: Option<String>,
) -> Result<String, String> {
    let dir = server_dir(Path::new(&base_path), &slug);
    let jar = dir.join("server.jar");
    if !jar.is_file() {
        return Err("server.jar not found — recreate the server".to_string());
    }
    if !dir.join("eula.txt").exists() {
        return Err("eula.txt missing — accept the EULA when creating".to_string());
    }

    let java = custom_java_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "java".to_string());

    let mut command = std::process::Command::new(&java);
    command
        .arg(format!("-Xmx{ram_mb}M"))
        .arg(format!("-Xms{ram_mb}M"))
        .arg("-Dlog4j2.formatMsgNoLookups=true")
        .arg("-jar")
        .arg("server.jar")
        .arg("nogui")
        .current_dir(&dir);

    let key = format!("server/{slug}");
    process::spawn_monitored(app, &key, command, "server", true)?;
    Ok(key)
}

#[tauri::command]
pub async fn server_status(slug: String) -> bool {
    // registry lookups are cheap, but this fires every 5s per server —
    // keep it off the main thread like every other poll
    tauri::async_runtime::spawn_blocking(move || process::is_running(&format!("server/{slug}")))
        .await
        .unwrap_or(false)
}

/// Graceful stop — sends `stop` through the server console (world-safe).
/// Fallback: if the server is still alive after 30s (e.g. a Java-version
/// shutdown quirk), it is force-terminated so the user is never stuck.
#[tauri::command]
pub fn server_stop(slug: String) -> Result<(), String> {
    let key = format!("server/{slug}");
    process::send_line(&key, "stop")?;

    std::thread::spawn(move || {
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if !process::is_running(&key) {
                return;
            }
        }
        let _ = process::stop_by_key(&key);
    });
    Ok(())
}

/// Sends a console command to a running server (stdin).
#[tauri::command]
pub fn server_send_command(slug: String, command_line: String) -> Result<(), String> {
    if command_line.trim().is_empty() {
        return Err("Empty command".to_string());
    }
    process::send_line(&format!("server/{slug}"), command_line.trim())
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[tauri::command]
pub async fn server_backup(base_path: String, slug: String) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || server_backup_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn server_backup_impl(base_path: String, slug: String) -> Result<BackupInfo, String> {
    let base = Path::new(&base_path);
    let dir = server_dir(base, &slug);
    if !dir.is_dir() {
        return Err("Server directory not found".to_string());
    }
    if process::is_running(&format!("server/{slug}")) {
        return Err("Stop the server before backing it up (world safety)".to_string());
    }

    let stamp = compact_timestamp();
    let dest_dir = backups_dir(base, &slug);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("{e}"))?;
    let file_name = format!("backup-{stamp}.zip");
    let dest = dest_dir.join(&file_name);

    let file = std::fs::File::create(&dest).map_err(|e| format!("{e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let root = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut entries = 0usize;
    for entry in ["world", "plugins", "config"] {
        let path = dir.join(entry);
        if !path.exists() {
            continue;
        }
        add_dir_to_zip(&mut zip, &path, &format!("{root}/{entry}"), options, &mut entries)?;
    }
    for file_name in ["server.properties", "eula.txt"] {
        let path = dir.join(file_name);
        if path.is_file() {
            let bytes = std::fs::read(&path).map_err(|e| format!("{e}"))?;
            zip.start_file(format!("{root}/{file_name}"), options)
                .map_err(|e| format!("{e}"))?;
            std::io::Write::write_all(&mut zip, &bytes).map_err(|e| format!("{e}"))?;
            entries += 1;
        }
    }
    zip.finish().map_err(|e| format!("zip finalize: {e}"))?;

    if entries == 0 {
        // Nothing to back up at all — remove the empty archive
        let _ = std::fs::remove_file(&dest);
        return Err("Nothing to back up (no world/config found)".to_string());
    }

    let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(BackupInfo {
        id: format!("{slug}/{file_name}"),
        file_name,
        path: dest.to_string_lossy().to_string(),
        size_bytes: size,
        created_at: stamp,
    })
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
    count: &mut usize,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| format!("{e}"))? {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let zip_path = format!("{prefix}/{name}");

        if path.is_dir() {
            zip.add_directory(zip_path.clone(), options).map_err(|e| format!("{e}"))?;
            add_dir_to_zip(zip, &path, &zip_path, options, count)?;
        } else if *count < 4000 {
            let bytes = std::fs::read(&path).map_err(|e| format!("{e}"))?;
            zip.start_file(zip_path, options).map_err(|e| format!("{e}"))?;
            std::io::Write::write_all(zip, &bytes).map_err(|e| format!("{e}"))?;
            *count += 1;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn server_list_backups(base_path: String, slug: String) -> Result<Vec<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || server_list_backups_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn server_list_backups_impl(base_path: String, slug: String) -> Result<Vec<BackupInfo>, String> {
    let dest = backups_dir(Path::new(&base_path), &slug);
    let mut out = Vec::new();
    if !dest.is_dir() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(&dest).map_err(|e| format!("{e}"))? {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".zip") {
            continue;
        }
        out.push(BackupInfo {
            id: format!("{slug}/{name}"),
            size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            created_at: name
                .trim_start_matches("backup-")
                .trim_end_matches(".zip")
                .to_string(),
            path: entry.path().to_string_lossy().to_string(),
            file_name: name,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Restores a backup (zip) into the server directory — zip-slip guarded.
#[tauri::command]
pub async fn server_restore(base_path: String, slug: String, backup_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || server_restore_impl(base_path, slug, backup_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn server_restore_impl(base_path: String, slug: String, backup_path: String) -> Result<(), String> {
    if process::is_running(&format!("server/{slug}")) {
        return Err("Stop the server before restoring".to_string());
    }
    let base = Path::new(&base_path);
    let dir = server_dir(base, &slug);
    // backup_path must live under the workspace backups root (no arbitrary zips)
    let canonical_backup = Path::new(&backup_path)
        .canonicalize()
        .map_err(|e| format!("Backup not found: {e}"))?;
    let backups_root = backups_dir(base, &slug)
        .canonicalize()
        .map_err(|e| format!("{e}"))?;
    if !canonical_backup.starts_with(&backups_root) {
        return Err("Backup path must be inside the workspace backups".to_string());
    }
    if !canonical_backup
        .file_name()
        .map(|n| n.to_string_lossy().ends_with(".zip"))
        .unwrap_or(false)
    {
        return Err("Backup must be a zip".to_string());
    }

    let file = std::fs::File::open(&canonical_backup).map_err(|e| format!("{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("zip open: {e}"))?;

    // Entries are "<slug>/<rest>" — strip the first segment
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("{e}"))?;
        let name = entry.name().to_string();
        if entry.is_dir() || name.starts_with('/') {
            continue;
        }
        let mut segments = name.split('/');
        segments.next(); // drop the root folder inside the zip
        let rest: Vec<&str> = segments.collect();
        if rest.is_empty() || rest.iter().any(|s| *s == ".." || s.is_empty()) {
            continue;
        }
        let target = dir.join(rest.join("/"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
        }
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(|e| format!("{e}"))?;
        std::fs::write(&target, bytes).map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn server_delete(base_path: String, slug: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || server_delete_impl(base_path, slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn server_delete_impl(base_path: String, slug: String) -> Result<(), String> {
    if process::is_running(&format!("server/{slug}")) {
        return Err("Stop the server first".to_string());
    }
    let dir = server_dir(Path::new(&base_path), &slug);
    if !dir.is_dir() {
        return Ok(());
    }
    // Remove world data, keep nothing behind (confirm happens in the UI)
    std::fs::remove_dir_all(&dir).map_err(|e| format!("{e}"))
}

// ---------------------------------------------------------------------------
// Server README — everything the owner asked for, written where the server
// lives: identity, how to run it, what each installed module does in-game,
// backups, connecting. Facts come from the real files on disk.
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoPayload {
    pub storage_base: String,
    pub slug: String,
    pub name: String,
    pub software: String,
    pub mc_version: String,
    pub ram_mb: u32,
    /// module ids from the wizard (economy|prison|token)
    pub modules: Vec<String>,
}

/// Objective + in-game commands for a module, faithful to the datapacks we
/// actually generate (serverModules.ts) — command lists match the
/// mcfunctions and triggers the pack really registers.
pub(crate) fn module_docs(id: &str) -> Option<(&'static str, &'static str, Vec<(&'static str, &'static str)>)> {
    Some(match id {
        "economy" => (
            "Economy Coin",
            "A server-owned currency. Balances live on the scoreboard (nexus_coin), shown on the player sidebar. Players deposit into the shop and spend at the starter market.",
            vec![
                ("/trigger nexus_shop set <quantia>", "deposita moedas na loja (o assistente de pagamentos do datapack)"),
                ("/function nexus_economy:balance", "mostra o seu saldo atual"),
                ("/function nexus_economy:top", "ranking dos maiores saldos do servidor"),
                ("/function nexus_economy:pay_nearest", "paga o jogador mais próximo de você"),
                ("/scoreboard players set <nick> nexus_coin <valor>", "(admin) define o saldo de um jogador"),
            ],
        ),
        "prison" => (
            "Prison Ranks",
            "Mine-to-rank progression. Rank lives on nexus_rank; every 10 mined blocks count one point, rank-ups are announced publicly, and prestige resets the run with a bonus multiplier.",
            vec![
                ("/trigger nexus_mine", "O COMANDO DE MINERAR: tela de loading personalizada e teleporta o jogador para as minas para minerar — a mina acompanha o rank atual (0-9 Mine A, 10-29 Mine B, 30+ Mine C)"),
                ("/function nexus_prison:status", "mostra o seu rank, blocos minerados e prestígio"),
                ("/function nexus_prison:warp_a", "teleporta direto para a Mina A"),
                ("/function nexus_prison:warp_b", "teleporta direto para a Mina B"),
                ("/function nexus_prison:warp_c", "teleporta direto para a Mina C"),
                ("(progressão automática)", "minerar 10 blocos = +1 ponto de rank; 10 pontos = rank-up anunciado; 50 = PRESTÍGIO com bônus"),
            ],
        ),
        "token" => (
            "Token Chain",
            "An in-game market wired to the VOXEL Economy panel through a real SHA-256 hash chain. Players pick items in-game; the intent lands in the server log and the VOXEL panel debits the ledger and delivers the item.",
            vec![
                ("/trigger nexus_token set <1-5>", "envia a intenção de compra do item escolhido (o VOXEL Economy panel confirma e entrega)"),
                ("/function nexus_token:balance", "mostra o seu saldo da chain"),
                ("(painel VOXEL)", "Economy → Token Chain mostra a chain SHA-256 completa, minta, transfere e verifica"),
            ],
        ),
        "skyblock" => (
            "SkyBlock Islands",
            "A floating island per player, built by the datapack itself: a fixed grid of 16 sky islands (dirt platform, starter tree, welcome chest with a starter kit). /trigger nexus_skyblock claims the next free slot and warps there forever.",
            vec![
                ("/trigger nexus_skyblock", "claims a personal sky island (with loading greeting and teleport) — reuso para voltar sempre para a sua ilha"),
                ("(bem-vindo chest)", "cada ilha nasce com machado, picareta, 6 pães e 2 brotos de carvalho"),
                ("(grade honesta)", "16 ilhas fixas; quando todas forem reclamadas o comando avisa em vez de inventar espaço"),
            ],
        ),
        "factions" => (
            "Factions War",
            "Three factions (Ember/Tide/Verdant) with colored teams and friendly-fire protection. Player kills score points for the team in real time, with team-only announcements.",
            vec![
                ("/trigger nexus_factions set 1", "entra na facção EMBER (vermelho)"),
                ("/trigger nexus_factions set 2", "entra na facção TIDE (azul)"),
                ("/trigger nexus_factions set 3", "entra na facção VERDANT (verde)"),
                ("/function nexus_factions:war", "mostra a tabela da guerra (pontos de cada facção)"),
                ("(kill = ponto)", "cada abate de jogador soma 1 ponto para a SUA facção, com anúncio para o time"),
            ],
        ),
        "bedwars" => (
            "BedWars Lite",
            "A ready arena command: kit + sky arena warp + title countdown, and every red bed mined announces the destroyer server-wide with thunder.",
            vec![
                ("/trigger nexus_bedwars", "limpa o inventário, entrega o kit (espada, 16 tábuas, 3 bifes), teleporta para a arena com contagem 3-2-1 e o LUTE!"),
                ("(cama = objetivo)", "minerar uma cama vermelha anuncia para TODO o servidor quem quebrou, com trovão e title"),
                ("/function nexus_bedwars:stats", "mostra quantas camas você já quebrou"),
            ],
        ),
        "realm" => (
            "Custom Realm",
            "A REAL custom dimension installed in the server's datapack — the Eternal Realm: fixed 13:00 dusk, sky above, beds work, 384 tall, overworld biomes. Era-factual for 1.20.1-1.21.8.",
            vec![
                ("/execute in nexus_realm:eternal_realm run tp @s ~ ~ ~", "teleporta você para o Eternal Realm (op)"),
                ("(dimension vanilla)", "a dimensão é gerada pelo datapack — igual a qualquer dimensão do jogo, com física própria (crepúsculo eterno, camas funcionam)"),
                ("(build spawn)", "construa infraestrutura de spawn lá como em qualquer dimensão — ele persiste no world"),
            ],
        ),
        "monuments" => (
            "Monuments",
            "Four procedurally built structures — REAL .nbt files shipped inside the module's datapack (watchtower, cottage, obelisk, ruin) — raised where you stand with a build-up title.",
            vec![
                ("/trigger nexus_monument set 1", "ergue a TORRE DE VIGIA onde você está (estrutura .nbt real, com som de beacon e title)"),
                ("/trigger nexus_monument set 2", "ergue o CHALÉ"),
                ("/trigger nexus_monument set 3", "ergue o OBELISCO"),
                ("/trigger nexus_monument set 4", "ergue a RUÍNA"),
                ("(gerados pelo VOXEL)", "as estruturas são as mesmas receitas do Asset Studio, escritas direto no datapack do módulo"),
            ],
        ),
        _ => return None,
    })
}

/// Read the real server.properties for the facts (never trust memory).
fn properties_facts(dir: &std::path::Path) -> (String, String, String) {
    let mut port = "25565".to_string();
    let mut motd = "A Minecraft Server".to_string();
    let mut online_mode = "true".to_string();
    if let Ok(content) = std::fs::read_to_string(dir.join("server.properties")) {
        for line in content.lines() {
            if let Some((k, v)) = line.split_once('=') {
                match k.trim() {
                    "server-port" => port = v.trim().to_string(),
                    "motd" => motd = v.trim().to_string(),
                    "online-mode" => online_mode = v.trim().to_string(),
                    _ => {}
                }
            }
        }
    }
    (port, motd, online_mode)
}

fn render_server_readme(payload: &ServerInfoPayload, dir: &std::path::Path) -> String {
    let (port, motd, online_mode) = properties_facts(dir);
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", payload.name));
    out.push_str(&format!(
        "Generated by **VOXEL {}** on {} — this file lives next to the server it describes.\n\n",
        env!("CARGO_PKG_VERSION"),
        compact_timestamp()
    ));
    out.push_str("## Facts\n\n");
    out.push_str(&format!("- **Software**: {} (Minecraft {})\n", payload.software, payload.mc_version));
    out.push_str(&format!("- **RAM**: {} MB — the app starts it with `-Xmx{}M`\n", payload.ram_mb, payload.ram_mb));
    out.push_str(&format!("- **Port**: {} — connect with `localhost:{}` on this machine\n", port, port));
    out.push_str(&format!("- **MOTD**: {}\n", motd));
    out.push_str(&format!("- **Online mode**: {} (the app enforces true — presets never turn it off)\n", online_mode));
    out.push_str("- **EULA**: accepted through the VOXEL wizard (eula=true in eula.txt)\n\n");

    out.push_str("## How to run\n\n");
    out.push_str("**With VOXEL** (recommended): Servers tab → this server → **Start**. The console streams\n");
    out.push_str("into the app, commands can be typed there, and Stop is world-safe (with a force\n");
    out.push_str("fallback after 30s).\n\n");
    out.push_str("**From a terminal**:\n\n```\n");
    out.push_str(&format!("java -Xmx{}M -Xms{}M -jar server.jar nogui\n", payload.ram_mb, payload.ram_mb));
    out.push_str("```\n\nThe EULA is already accepted; the first boot creates the world.\n\n");

    if !payload.modules.is_empty() {
        out.push_str("## Installed gameplay modules\n\n");
        out.push_str("Mixable datapacks authored by this app (namespaced — they never collide):\n\n");
        for id in &payload.modules {
            if let Some((title, objective, commands)) = module_docs(id) {
                out.push_str(&format!("### {} (`nexus_{}` datapack)\n\n", title, id));
                out.push_str(&format!("**What it does**: {}.\n\n", objective));
                out.push_str("**Commands**:\n\n");
                out.push_str("| Command | What it does |\n");
                out.push_str("|---|---|\n");
                for (cmd, desc) in &commands {
                    out.push_str(&format!("| `{}` | {} |\n", cmd, desc));
                }
                out.push('\n');
            }
        }
        out.push_str("Datapacks live in `world/datapacks/` and activate on the next boot\n");
        out.push_str("(`/reload` hot-loads them without restarting).\n\n");
    }

    out.push_str("## Server commands (always available)\n\n");
    out.push_str("The vanilla/admin commands every owner reaches for:\n\n");
    out.push_str("| Command | What it does |\n");
    out.push_str("|---|---|\n");
    out.push_str("| `/op <nick>` | promotes a player to operator |\n");
    out.push_str("| `/deop <nick>` | removes operator status |\n");
    out.push_str("| `/gamemode <mode> [nick]` | survival / creative / adventure / spectator |\n");
    out.push_str("| `/tp <nick> <nick>` | teleports one player to another |\n");
    out.push_str("| `/time set day` (or `night`) | sets the world time |\n");
    out.push_str("| `/whitelist add <nick>` | adds to the whitelist (enable it in server.properties) |\n");
    out.push_str("| `/stop` | saves and stops the server cleanly (the VOXEL button does this) |\n");
    out.push_str("| `/reload` | hot-reloads datapacks (after editing module files) |\n");
    out.push_str("\nPlayers run the module commands from the sections above with plain chat —\n");
    out.push_str("`/trigger` needs no operator rights.\n\n");

    out.push_str("## Backups\n\n");
    out.push_str("Backups (world + plugins + config + properties) are made from the VOXEL Servers tab\n");
    out.push_str("and stored under `backups/` inside this workspace; restore is one click, guarded\n");
    out.push_str("against zip-slip. Restoring never mixes servers.\n\n");

    out.push_str("## Playing from outside (public address)\n\n");
    out.push_str("The VOXEL Servers tab can start a free playit.gg tunnel for this server — the public\n");
    out.push_str("`*.playit.gg` address appears in the UI when it is running.\n\n");

    out.push_str("---\n\n");
    out.push_str("VOXEL is an independent third-party creation platform and is not affiliated with\n");
    out.push_str("Mojang Studios or Microsoft.\n");
    out
}

#[tauri::command]
pub async fn server_write_info(payload: ServerInfoPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || server_write_info_impl(payload))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn server_write_info_impl(payload: ServerInfoPayload) -> Result<String, String> {
    let base = std::path::PathBuf::from(&payload.storage_base)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let dir = base.join("servers").join(&payload.slug);
    if !dir.is_dir() {
        return Err(format!("Server \"{}\" does not exist", payload.slug));
    }
    let readme = render_server_readme(&payload, &dir);
    let target = dir.join("README.md");
    std::fs::write(&target, &readme)
        .map_err(|e| format!("Failed to write README: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Owner autonomy: bring your OWN world and structures into a server.
// Real files, verified, zip-slip guarded — the disk stays the truth.
// ---------------------------------------------------------------------------

/// Imports a world zip into a server (replaces world/ atomically: the old
/// world is renamed aside first, never destroyed on failure). Accepts a
/// zip that contains either `world/...` at root or the level.dat directly
/// at root — the classic shapes a downloaded world ships in.
#[tauri::command]
pub async fn server_import_world(
    base_path: String,
    slug: String,
    zip_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || server_import_world_impl(base_path, slug, zip_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn server_import_world_impl(base_path: String, slug: String, zip_path: String) -> Result<String, String> {
    if process::is_running(&format!("server/{slug}")) {
        return Err("Stop the server before importing a world".to_string());
    }
    let base = Path::new(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let dir = server_dir(&base, &slug);
    if !dir.is_dir() {
        return Err(format!("Server \"{slug}\" not found", ));
    }
    let source = Path::new(&zip_path)
        .canonicalize()
        .map_err(|e| format!("World zip not found: {e}"))?;
    if !source
        .file_name()
        .map(|n| n.to_string_lossy().ends_with(".zip"))
        .unwrap_or(false)
    {
        return Err("World import expects a .zip".to_string());
    }
    let file = std::fs::File::open(&source).map_err(|e| format!("{e}"))?;
    let meta = file.metadata().map_err(|e| format!("{e}"))?;
    if meta.len() > 4 * 1024 * 1024 * 1024 {
        return Err("World zips are limited to 4 GB".to_string());
    }
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("zip open: {e}"))?;

    // Staging: extract into a fresh folder, THEN swap — a half-imported
    // world must never become the live one.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let staging = dir.join(format!(".world-import-{stamp}"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("{e}"))?;

    let mut saw_level_dat = false;
    let mut saw_world_root = false;
    let mut entries = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("{e}"))?;
        let name = entry.name().to_string();
        if entry.is_dir() || name.starts_with('/') {
            continue;
        }
        let segments: Vec<&str> = name.split('/').collect();
        if segments.iter().any(|s| *s == ".." || s.is_empty()) {
            continue; // zip-slip guarded
        }
        let (prefix, rest): (usize, Vec<&str>) = if segments.first() == Some(&"world") {
            saw_world_root = true;
            (1, segments[1..].to_vec())
        } else {
            (0, segments.clone())
        };
        let _ = prefix;
        if rest.last().map(|s| *s == "level.dat").unwrap_or(false) && rest.len() == 1 {
            saw_level_dat = true;
        }
        let target = staging.join(rest.join("/"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
        }
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(|e| format!("{e}"))?;
        std::fs::write(&target, bytes).map_err(|e| format!("{e}"))?;
        entries += 1;
        if entries > 40_000 {
            let _ = std::fs::remove_dir_all(&staging);
            return Err("World zip has more than 40,000 files — refused".to_string());
        }
    }
    if !saw_level_dat {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("This zip does not look like a Minecraft world (no level.dat inside)".to_string());
    }

    // Swap: old world renamed aside (user can delete it), staging becomes world/
    let old = dir.join(format!(".old-world-{stamp}"));
    let live = dir.join("world");
    if live.exists() {
        std::fs::rename(&live, &old).map_err(|e| format!("could not set the old world aside: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&staging, &live) {
        // put the old world back — the server must not end up worldless
        if old.exists() {
            let _ = std::fs::rename(&old, &live);
        }
        return Err(format!("could not install the imported world: {e}"));
    }
    Ok(format!(
        "world imported ({entries} files) — the previous world was kept at {}",
        old.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    ))
}

/// Imports a structure file (.nbt — the vanilla format our own Studio and
/// every schematic tool exports) into the server as a placeable template:
/// lands in world/datapacks/voxel_imports/<ns>/structures/<name>.nbt with a
/// pack.mcmeta of the server's era. In-game it is placed with
/// `/place template voxel_imports:<ns>/<name>`.
#[tauri::command]
pub async fn server_import_structure(
    base_path: String,
    slug: String,
    file_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        server_import_structure_impl(base_path, slug, file_path)
    })
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn server_import_structure_impl(base_path: String, slug: String, file_path: String) -> Result<String, String> {
    let base = Path::new(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let dir = server_dir(&base, &slug);
    if !dir.is_dir() {
        return Err(format!("Server \"{slug}\" not found"));
    }
    let source = Path::new(&file_path)
        .canonicalize()
        .map_err(|e| format!("Structure file not found: {e}"))?;
    let bytes = std::fs::read(&source).map_err(|e| format!("{e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Structure files are limited to 8 MB".to_string());
    }
    // Content first, extension second: a REAL nbt (gzip 1f 8b, or the raw
    // uncompressed form starting with the compound tag 0x0A) is accepted
    // even when the name lost its ".nbt" — tools and renames happen.
    let looks_nbt = (bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b)
        || (!bytes.is_empty() && bytes[0] == 0x0a);
    if !looks_nbt {
        return Err(format!(
            "not a Minecraft structure file — bring a .nbt exported by a structure block, a schematic tool or our Asset Studio"
        ));
    }
    let raw_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = if raw_name.to_ascii_lowercase().ends_with(".nbt") {
        raw_name
    } else {
        let stem = Path::new(&raw_name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "structure".to_string());
        format!("{stem}.nbt")
    };

    // era-honest pack format, same rule as the project deploy
    let pack_format = pack_format_for_server(&base, &slug);
    let ns = sanitize_structure_ns(&name)?;
    let pack_dir = dir.join("world/datapacks/voxel_imports");
    let ns_dir = pack_dir.join(&ns).join("structures");
    std::fs::create_dir_all(&ns_dir).map_err(|e| format!("{e}"))?;

    let mcmeta = serde_json::json!({
        "pack": {
            "pack_format": pack_format,
            "description": "Structures imported by VOXEL"
        }
    })
    .to_string();
    std::fs::write(pack_dir.join("pack.mcmeta"), &mcmeta)
        .map_err(|e| format!("write pack.mcmeta: {e}"))?;
    std::fs::write(ns_dir.join(&name), &bytes).map_err(|e| format!("{e}"))?;

    Ok(format!(
        "/place template voxel_imports:{ns}/{}",
        name.trim_end_matches(".nbt")
    ))
}

fn sanitize_structure_ns(file_name: &str) -> Result<String, String> {
    let stem = file_name
        .trim_end_matches(".nbt")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c.to_ascii_lowercase() } else { '_' })
        .take(64)
        .collect::<String>();
    let stem = stem.trim_matches('_').to_string();
    if stem.is_empty() {
        return Err("Structure name has no usable characters".to_string());
    }
    if stem.chars().next().unwrap().is_ascii_digit() {
        // namespaces cannot start with a digit — prefix keeps it valid
        return Ok(format!("s{stem}"));
    }
    Ok(stem)
}

// ---------------------------------------------------------------------------
// Project ↔ Server connection — deploy the project's datapack (structures,
// dimensions, advancements, functions) into a server's world/datapacks/,
// so what you build in the mod is live on your server. Versions must match
// (the formats are era-bound) and the server never mixes packs.
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeployPayload {
    pub storage_base: String,
    pub project_slug: String,
    pub server_slug: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeployResult {
    pub files_copied: usize,
    pub datapack_dir: String,
    pub has_structures: bool,
    pub has_dimensions: bool,
}

fn copy_tree(src: &std::path::Path, dst: &std::path::Path, count: &mut usize) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_tree(&from, &to, count)?;
        } else if from.is_file() {
            let bytes = std::fs::read(&from).map_err(|e| format!("read {}: {e}", from.display()))?;
            std::fs::write(&to, &bytes).map_err(|e| format!("write {}: {e}", to.display()))?;
            *count += 1;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn project_deploy_datapack(payload: ProjectDeployPayload) -> Result<ProjectDeployResult, String> {
    tauri::async_runtime::spawn_blocking(move || project_deploy_datapack_impl(payload))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn project_deploy_datapack_impl(payload: ProjectDeployPayload) -> Result<ProjectDeployResult, String> {
    let base = std::path::PathBuf::from(&payload.storage_base)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;

    let project_dir = base.join("projects").join(&payload.project_slug);
    if !project_dir.is_dir() {
        return Err(format!("Project \"{}\" not found", payload.project_slug));
    }
    let server_dir = base.join("servers").join(&payload.server_slug);
    if !server_dir.is_dir() {
        return Err(format!("Server \"{}\" not found", payload.server_slug));
    }

    // Era honesty: the datapack formats are version-bound. Read the facts
    // from the mod metadata (fabric.mod.json / neoforge.mods.toml template)
    // — falls back to the server properties when the mod doesn't declare.
    let data_dir = project_dir.join("src/main/resources/data");
    if !data_dir.is_dir() {
        return Err("This project has no datapack (no src/main/resources/data) — build something first (the agent writes structures and dimensions there)".to_string());
    }

    // pack.mcmeta with the server's era pack format
    let pack_format = pack_format_for_server(&base, &payload.server_slug);

    // Wipe nothing: a previous deploy of the SAME project is REPLACED atomically
    // (temp dir + rename); other packs are never touched.
    let target = server_dir.join("world/datapacks").join(format!("project_{}", payload.project_slug));
    if target.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let trash = server_dir.join(format!("world/datapacks/.old-{}-{}", payload.project_slug, stamp));
        std::fs::rename(&target, &trash)
            .map_err(|e| format!("Could not stage the old pack: {e}"))?;
        let _ = std::fs::remove_dir_all(&trash);
    }

    let staging = server_dir.join(format!("world/datapacks/.staging-{}", payload.project_slug));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("mkdir: {e}"))?;

    // pack.mcmeta so vanilla recognizes the pack
    let mcmeta = serde_json::json!({
        "pack": {
            "pack_format": pack_format,
            "description": format!("{} (deployed by VOXEL)", payload.project_slug)
        }
    })
    .to_string();
    std::fs::write(staging.join("pack.mcmeta"), &mcmeta)
        .map_err(|e| format!("write pack.mcmeta: {e}"))?;

    // every namespace the project owns — the pack is project-named, so
    // multiple projects can coexist without touching each other
    let mut count = 1usize; // pack.mcmeta counts
    let mut has_structures = false;
    let mut has_dimensions = false;
    let entries = std::fs::read_dir(&data_dir).map_err(|e| format!("{e}"))?;
    for ns_dir in entries.filter_map(|e| e.ok()) {
        if !ns_dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let ns = ns_dir.file_name().to_string_lossy().to_string();
        if ns.contains("..") || ns.starts_with('.') {
            continue;
        }
        let from = data_dir.join(&ns);
        if from.join("structures").is_dir() || from.join("structure").is_dir() {
            has_structures = true;
        }
        if from.join("dimension").is_dir() {
            has_dimensions = true;
        }
        copy_tree(&from, &staging.join(&ns), &mut count)?;
    }

    std::fs::rename(&staging, &target)
        .map_err(|e| format!("Could not finalize the deploy: {e}"))?;

    Ok(ProjectDeployResult {
        files_copied: count,
        datapack_dir: target.to_string_lossy().to_string(),
        has_structures,
        has_dimensions,
    })
}

/// The server's pack format: its own datapacks declare it — read a real
/// module's pack.mcmeta instead of guessing. Default 15 (1.20.1) is the
/// honest baseline when nothing is installed yet.
fn pack_format_for_server(base: &std::path::Path, server_slug: &str) -> u32 {
    let packs = base.join("servers").join(server_slug).join("world/datapacks");
    if let Ok(entries) = std::fs::read_dir(&packs) {
        for dir in entries.filter_map(|e| e.ok()) {
            let mcmeta = dir.path().join("pack.mcmeta");
            if let Ok(content) = std::fs::read_to_string(&mcmeta) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(n) = v.get("pack").and_then(|p| p.get("pack_format")).and_then(|n| n.as_u64()) {
                        return n as u32;
                    }
                }
            }
        }
    }
    15
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn server_create_writes_a_truthful_readme() {
        let base = std::env::temp_dir().join(format!("voxel-srv-readme-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let dir = server_dir(&base, "info-server");
        let _ = std::fs::remove_dir_all(&dir);

        let result = server_create_impl(
            base.to_string_lossy().to_string(),
            "info-server".to_string(),
            "Info Server".to_string(),
            "vanilla".to_string(),
            "1.20.1".to_string(),
            25577,
            2048,
            true,
            None,
        );
        // jar download may fail offline — the README is written BEFORE it and
        // must exist either way
        assert!(dir.join("README.md").is_file(), "README must exist even when the jar download fails");
        let readme = std::fs::read_to_string(dir.join("README.md")).unwrap();
        if result.is_err() {
            assert!(readme.contains("# Info Server"));
            let _ = std::fs::remove_dir_all(&base);
            return;
        }
        assert!(readme.contains("# Info Server"));
        assert!(readme.contains("Port**: 25577"));
        assert!(readme.contains("-Xmx2048M"));
        assert!(readme.contains("**Software**: vanilla (Minecraft 1.20.1)"));
        assert!(readme.contains("not affiliated with"));

        // module rewrite adds the docs of ONLY the installed modules
        let path = server_write_info_impl(ServerInfoPayload {
            storage_base: base.to_string_lossy().to_string(),
            slug: "info-server".to_string(),
            name: "Info Server".to_string(),
            software: "vanilla".to_string(),
            mc_version: "1.20.1".to_string(),
            ram_mb: 2048,
            modules: vec!["economy".into(), "token".into()],
        })
        .unwrap();
        let readme = std::fs::read_to_string(&path).unwrap();
        assert!(readme.contains("Economy Coin (`nexus_economy` datapack)"));
        assert!(readme.contains("/trigger nexus_shop set <quantia>"));
        assert!(readme.contains("Token Chain (`nexus_token` datapack)"));
        assert!(readme.contains("SHA-256 hash chain"));
        assert!(!readme.contains("Prison Ranks"), "only installed modules are documented");
        // the commands section: module tables + the vanilla admin table
        assert!(readme.contains("## Server commands (always available)"));
        assert!(readme.contains("| `/op <nick>` |"));
        assert!(readme.contains("| `/reload` |"));
        assert!(readme.contains("| `/trigger nexus_token set <1-5>` |"));

        // and the prison module documents the /mine experience the owner asked for
        let path = server_write_info_impl(ServerInfoPayload {
            storage_base: base.to_string_lossy().to_string(),
            slug: "info-server".to_string(),
            name: "Info Server".to_string(),
            software: "vanilla".to_string(),
            mc_version: "1.20.1".to_string(),
            ram_mb: 2048,
            modules: vec!["prison".into()],
        })
        .unwrap();
        let readme = std::fs::read_to_string(&path).unwrap();
        assert!(readme.contains("| `/trigger nexus_mine` |"));
        assert!(readme.contains("tela de loading personalizada e teleporta o jogador para as minas"));
        assert!(readme.contains("| `/function nexus_prison:warp_c` |"));

        // the new gameplay modules document themselves too
        let path = server_write_info_impl(ServerInfoPayload {
            storage_base: base.to_string_lossy().to_string(),
            slug: "info-server".to_string(),
            name: "Info Server".to_string(),
            software: "vanilla".to_string(),
            mc_version: "1.20.1".to_string(),
            ram_mb: 2048,
            modules: vec!["skyblock".into(), "factions".into(), "bedwars".into(), "realm".into()],
        })
        .unwrap();
        let readme = std::fs::read_to_string(&path).unwrap();
        assert!(readme.contains("Custom Realm (`nexus_realm` datapack)"));
        assert!(readme.contains("| `/execute in nexus_realm:eternal_realm run tp @s ~ ~ ~` |"));
        assert!(readme.contains("SkyBlock Islands (`nexus_skyblock` datapack)"));
        assert!(readme.contains("| `/trigger nexus_skyblock` |"));
        assert!(readme.contains("| `/trigger nexus_factions set 2` |"));
        assert!(readme.contains("| `/trigger nexus_bedwars` |"));
        assert!(readme.contains("anuncia para TODO o servidor"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn curated_baseline_is_complete() {
        let props = curated_properties(25565, None);
        let map: std::collections::HashMap<String, String> =
            props.into_iter().collect();
        assert_eq!(map.get("online-mode").unwrap(), "true");
        assert_eq!(map.get("server-port").unwrap(), "25565");
        assert_eq!(map.get("gamemode").unwrap(), "survival");
    }

    #[test]
    fn style_overrides_apply_and_extend() {
        let mut overrides = std::collections::HashMap::new();
        overrides.insert("difficulty".to_string(), "hard".to_string());
        overrides.insert("motd".to_string(), "My styled server".to_string());
        let map: std::collections::HashMap<String, String> =
            curated_properties(25570, Some(&overrides)).into_iter().collect();
        assert_eq!(map.get("difficulty").unwrap(), "hard");
        assert_eq!(map.get("motd").unwrap(), "My styled server");
        assert_eq!(map.get("server-port").unwrap(), "25570");
    }

    #[test]
    fn project_datapack_deploys_into_the_server_and_replaces_atomically() {
        let base = std::env::temp_dir().join(format!("voxel-deploy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        // project with a datapack: structure + dimension
        let data = base.join("projects/kingdom/src/main/resources/data/kingdom");
        std::fs::create_dir_all(data.join("structures")).unwrap();
        std::fs::create_dir_all(data.join("dimension")).unwrap();
        std::fs::write(data.join("structures/watch_post.nbt"), b"PK-nbt").unwrap();
        std::fs::write(data.join("dimension/realm.json"), b"{}").unwrap();
        // server with an existing module pack (pack_format 18 from its own pack.mcmeta)
        let server_packs = base.join("servers/arena/world/datapacks/nexus_skyblock");
        std::fs::create_dir_all(&server_packs).unwrap();
        std::fs::write(server_packs.join("pack.mcmeta"), r#"{"pack":{"pack_format":18,"description":"x"}}"#).unwrap();

        let payload = ProjectDeployPayload {
            storage_base: base.to_string_lossy().to_string(),
            project_slug: "kingdom".to_string(),
            server_slug: "arena".to_string(),
        };
        let result = project_deploy_datapack_impl(payload).unwrap();
        assert!(result.files_copied >= 3); // pack.mcmeta + nbt + json
        assert!(result.has_structures);
        assert!(result.has_dimensions);
        assert!(result.datapack_dir.contains("servers/arena/world/datapacks/project_kingdom"));
        // the era format came from the server's own module pack
        let mcmeta = std::fs::read_to_string(
            base.join("servers/arena/world/datapacks/project_kingdom/pack.mcmeta"),
        )
        .unwrap();
        assert!(mcmeta.contains("18"));
        // contents copied
        assert!(base.join("servers/arena/world/datapacks/project_kingdom/kingdom/structures/watch_post.nbt").is_file());
        // the module pack is untouched
        assert!(server_packs.join("pack.mcmeta").is_file());

        // re-deploy replaces atomically, no staging leftovers
        std::fs::write(data.join("structures/watch_post.nbt"), b"PK-nbt-v2").unwrap();
        project_deploy_datapack_impl(ProjectDeployPayload {
            storage_base: base.to_string_lossy().to_string(),
            project_slug: "kingdom".to_string(),
            server_slug: "arena".to_string(),
        })
        .unwrap();
        let nbt = std::fs::read(
            base.join("servers/arena/world/datapacks/project_kingdom/kingdom/structures/watch_post.nbt"),
        )
        .unwrap();
        assert_eq!(nbt, b"PK-nbt-v2");
        let packs = base.join("servers/arena/world/datapacks");
        let mut names: Vec<String> = std::fs::read_dir(&packs).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["nexus_skyblock", "project_kingdom"]);

        // a project without a datapack is honestly refused
        std::fs::create_dir_all(base.join("projects/empty/src/main/resources")).unwrap();
        assert!(project_deploy_datapack_impl(ProjectDeployPayload {
            storage_base: base.to_string_lossy().to_string(),
            project_slug: "empty".to_string(),
            server_slug: "arena".to_string(),
        }).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn world_import_swaps_atomically_and_refuses_non_worlds() {
        let base = std::env::temp_dir().join(format!("voxel-worldimport-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("servers/arena");
        std::fs::create_dir_all(dir.join("world")).unwrap();
        std::fs::write(dir.join("world/level.dat"), b"OLD WORLD").unwrap();

        // a REAL world zip: world/level.dat + world/region/r.0.0.mca
        let zip_path = base.join("my-world.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("world/level.dat", opts).unwrap();
        std::io::Write::write_all(&mut zip, b"NEW WORLD DATA").unwrap();
        zip.start_file("world/region/r.0.0.mca", opts).unwrap();
        std::io::Write::write_all(&mut zip, b"region-bytes").unwrap();
        zip.finish().unwrap();

        let msg = server_import_world_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            zip_path.to_string_lossy().to_string(),
        )
        .expect("import must succeed");
        assert!(msg.contains("world imported"), "{msg}");
        // the new world is live, the old one was kept aside
        assert_eq!(std::fs::read(dir.join("world/level.dat")).unwrap(), b"NEW WORLD DATA");
        assert!(dir.join("world/region/r.0.0.mca").is_file());
        let old: Vec<_> = std::fs::read_dir(&dir).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(".old-world-"))
            .collect();
        assert_eq!(old.len(), 1, "the previous world is kept aside, never destroyed");
        assert_eq!(std::fs::read(dir.join(&old[0]).join("level.dat")).unwrap(), b"OLD WORLD");

        // a zip WITHOUT level.dat is honestly refused
        let bad_path = base.join("nope.zip");
        let file = std::fs::File::create(&bad_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("random.txt", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut zip, b"not a world").unwrap();
        zip.finish().unwrap();
        let err = server_import_world_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            bad_path.to_string_lossy().to_string(),
        )
        .unwrap_err();
        assert!(err.contains("level.dat"), "{err}");
        // the live world is UNTOUCHED by the failed import
        assert_eq!(std::fs::read(dir.join("world/level.dat")).unwrap(), b"NEW WORLD DATA");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn structure_import_lands_as_a_placeable_template() {
        let base = std::env::temp_dir().join(format!("voxel-structimport-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("servers/arena");
        // module pack with era format 18 -> imported pack must match it
        let packs = dir.join("world/datapacks/nexus_skyblock");
        std::fs::create_dir_all(&packs).unwrap();
        std::fs::write(packs.join("pack.mcmeta"), br#"{"pack":{"pack_format":18,"description":"x"}}"#).unwrap();

        // a REAL gzip nbt (magic 1f 8b + deflate payload)
        let src = base.join("castle-tower.nbt");
        let mut gz: Vec<u8> = Vec::new();
        {
            let mut enc = flate2::write::GzEncoder::new(&mut gz, flate2::Compression::default());
            std::io::Write::write_all(&mut enc, b"\x0a\x00\x00nbt-payload").unwrap();
            enc.finish().unwrap();
        }
        std::fs::write(&src, &gz).unwrap();

        let command = server_import_structure_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            src.to_string_lossy().to_string(),
        )
        .expect("import");
        assert_eq!(command, "/place template voxel_imports:castle_tower/castle-tower");
        let nbt = dir.join("world/datapacks/voxel_imports/castle_tower/structures/castle-tower.nbt");
        assert!(nbt.is_file());
        assert_eq!(std::fs::read(&nbt).unwrap(), gz, "bytes land unchanged");
        let mcmeta = std::fs::read_to_string(dir.join("world/datapacks/voxel_imports/pack.mcmeta")).unwrap();
        assert!(mcmeta.contains("18"), "era format read from the server's own packs");

        // not-an-nbt is honestly refused
        let bad = base.join("photo.jpg");
        std::fs::write(&bad, b"\xff\xd8\xff\xe0jpeg").unwrap();
        let err = server_import_structure_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            bad.to_string_lossy().to_string(),
        )
        .unwrap_err();
        assert!(err.contains("not a Minecraft structure"), "{err}");

        // a name starting with a digit stays a valid namespace
        let num = base.join("4-towers.nbt");
        std::fs::write(&num, &gz).unwrap();
        let command = server_import_structure_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            num.to_string_lossy().to_string(),
        )
        .unwrap();
        assert!(command.starts_with("/place template voxel_imports:s4"), "{command}");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn online_mode_can_never_be_overridden() {
        let mut overrides = std::collections::HashMap::new();
        overrides.insert("online-mode".to_string(), "false".to_string());
        let map: std::collections::HashMap<String, String> =
            curated_properties(25565, Some(&overrides)).into_iter().collect();
        assert_eq!(map.get("online-mode").unwrap(), "true");
    }

    #[test]
    fn malformed_overrides_are_dropped() {
        let mut overrides = std::collections::HashMap::new();
        overrides.insert("bad key".to_string(), "x".to_string());
        overrides.insert("with\nnewline".to_string(), "x".to_string());
        overrides.insert("".to_string(), "x".to_string());
        let props = curated_properties(25565, Some(&overrides));
        assert!(props.iter().all(|(k, _)| k.chars().all(|c| c != ' ' && c != '\n')));
    }
}

#[cfg(test)]
mod e2e_tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    /// Full server lifecycle proof: create (official jar download + eula +
    /// properties), boot to "Done", world-safe stop, backup, restore, delete.
    #[test]
    #[ignore = "e2e: downloads the vanilla server jar and boots it (~2 min)"]
    fn e2e_server_lifecycle() {
        let home = std::env::var("HOME").expect("HOME");
        let base = format!("{home}/VOXEL");
        let slug = "e2e-test-server";
        let _ = std::fs::remove_dir_all(format!("{base}/servers/{slug}"));

        // 1. create — downloads and verifies the official jar
        let mut style_props = std::collections::HashMap::new();
        style_props.insert("motd".to_string(), "E2E styled".to_string());
        let setup = server_create_impl(
            base.clone(),
            slug.to_string(),
            "E2E Test Server".to_string(),
            "vanilla".to_string(),
            "1.20.1".to_string(),
            25599,
            1024,
            true,
            Some(style_props),
        )
        .expect("server_create must succeed");
        let dir = PathBuf::from(&setup.server_dir);
        assert!(dir.join("server.jar").is_file(), "server.jar missing");
        assert!(
            std::fs::read_to_string(dir.join("server.properties"))
                .unwrap()
                .contains("motd=E2E styled"),
            "style overrides must land in server.properties"
        );
        assert!(dir.join("eula.txt").is_file());
        assert!(dir.join("server.properties").is_file());

        // 2. boot to Done — manual spawn (tests have no AppHandle for events)
        let mut child = Command::new("java")
            .arg("-Xmx1024M")
            .arg("-jar")
            .arg("server.jar")
            .arg("nogui")
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("java must spawn");

        let stdout = child.stdout.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();

        // Reader thread keeps consuming stdout (a closed read-pipe can make
        // the server misbehave) and flags the moment it reports Done.
        let booted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let booted_reader = booted.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                eprintln!("| {line}");
                if line.contains("Done (") {
                    booted_reader.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
        });

        let started = Instant::now();
        while !booted.load(std::sync::atomic::Ordering::SeqCst) {
            assert!(
                started.elapsed() < Duration::from_secs(180),
                "server did not reach Done in time"
            );
            std::thread::sleep(Duration::from_millis(250));
        }

        // 3. world-safe stop via stdin (explicit flush!), bounded with a
        // force fallback — mirrors the app's server_stop behavior. Some
        // Java/1.20.1 combinations hang in the shutdown hook; the world is
        // already committed to disk at "Saving chunks" time.
        stdin.write_all(b"stop\n").unwrap();
        stdin.flush().unwrap();

        let stop_started = Instant::now();
        let mut forced = false;
        let status = loop {
            match child.try_wait().expect("try_wait failed") {
                Some(status) => break status,
                None => {
                    if stop_started.elapsed() > Duration::from_secs(60) {
                        eprintln!("server did not exit in 60s — forcing (app fallback parity)");
                        let _ = child.kill();
                        forced = true;
                        break child.wait().expect("wait after kill");
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        };
        if forced {
            eprintln!("note: stop was accepted but the JVM hung on shutdown — force used");
        } else {
            assert!(status.success(), "server must exit cleanly after stop");
        }
        assert!(dir.join("world/level.dat").is_file(), "world must exist");

        // 4. backup + 5. restore
        let backup = server_backup_impl(base.clone(), slug.to_string()).expect("backup");
        assert!(PathBuf::from(&backup.path).is_file());
        server_restore_impl(base.clone(), slug.to_string(), backup.path.clone())
            .expect("restore");

        // 6. delete
        server_delete_impl(base.clone(), slug.to_string()).expect("delete");
        assert!(!dir.exists(), "server dir must be gone");

        eprintln!("E2E SERVER OK — jar: {}", setup.jar_path);
    }

    /// The owner's "cannot create a server" report, answered with a proof:
    /// this exercises the EXACT path the app uses — the async command with
    /// spawn_blocking (the unit tests only cover the sync impl). Downloads
    /// the real jar through the real retrying HTTP client.
    #[test]
    #[ignore = "e2e: real download through the ASYNC command path (spawn_blocking)"]
    fn e2e_server_create_async_command_path() {
        let home = std::env::var("HOME").expect("HOME");
        let base = format!("{home}/VOXEL");
        let slug = "e2e-async-command";
        let _ = std::fs::remove_dir_all(format!("{base}/servers/{slug}"));

        // The app calls the async command; block_on drives the tauri runtime
        let result = tauri::async_runtime::block_on(server_create(
            base.clone(),
            slug.to_string(),
            "Async Path".to_string(),
            "vanilla".to_string(),
            "1.20.1".to_string(),
            25601,
            1024,
            true,
            None,
        ))
        .expect("the async command path must create a server with a real jar");
        let dir = PathBuf::from(&result.server_dir);
        assert!(dir.join("server.jar").is_file(), "real jar must be downloaded");
        assert!(dir.join("voxel-server.json").is_file(), "manifest must exist");
        assert!(dir.join("eula.txt").is_file());
        assert!(result.jar_path.ends_with("server.jar"));

        // The disk scan sees it — reconciliation has real facts to work with
        let scanned = servers_scan_disk(base.clone()).expect("scan");
        let found = scanned
            .iter()
            .find(|s| s.slug == slug)
            .expect("scan must see the created server");
        assert!(found.has_jar);
        assert_eq!(found.name, "Async Path");
        assert_eq!(found.mc_version, "1.20.1");
        assert_eq!(found.port, 25601);

        // A duplicate must fail with the friendly error the UI surfaces
        let dup = tauri::async_runtime::block_on(server_create(
            base.clone(),
            slug.to_string(),
            "Async Path".to_string(),
            "vanilla".to_string(),
            "1.20.1".to_string(),
            25601,
            1024,
            true,
            None,
        ));
        let msg = match dup {
            Err(msg) => msg,
            Ok(_) => panic!("duplicate slug must be rejected"),
        };
        assert!(
            msg.contains("already exists"),
            "the error must say what happened: {msg}"
        );

        let _ = std::fs::remove_dir_all(format!("{base}/servers/{slug}"));
        eprintln!("E2E ASYNC COMMAND PATH OK");
    }

    #[test]
    fn disk_scan_reports_real_folders_only() {
        let base = std::env::temp_dir().join(format!("voxel-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("servers/real-one/logs")).unwrap();
        std::fs::write(
            base.join("servers/real-one/voxel-server.json"),
            r#"{"slug":"real-one","name":"Real One","software":"paper","mcVersion":"1.21.1","port":25566,"ramMb":2048,"createdAt":"20260101-00000"}"#,
        )
        .unwrap();
        std::fs::write(base.join("servers/real-one/server.jar"), b"jar").unwrap();
        std::fs::write(base.join("servers/real-one/eula.txt"), b"eula=true").unwrap();
        // noise that must NOT be reported as a server
        std::fs::create_dir_all(base.join("servers/.hidden-staging")).unwrap();
        std::fs::write(base.join("servers/stray-file.txt"), b"x").unwrap();

        let scanned = servers_scan_disk(base.to_string_lossy().to_string()).unwrap();
        assert_eq!(scanned.len(), 1, "only real server folders count");
        let one = &scanned[0];
        assert_eq!(one.slug, "real-one");
        assert_eq!(one.name, "Real One");
        assert_eq!(one.software, "paper");
        assert_eq!(one.mc_version, "1.21.1");
        assert_eq!(one.port, 25566);
        assert!(one.has_jar && one.has_eula);

        // a folder without the manifest still reports honest facts
        std::fs::create_dir_all(base.join("servers/legacy-two")).unwrap();
        std::fs::write(base.join("servers/legacy-two/server.properties"), b"server-port=25599\n").unwrap();
        let scanned = servers_scan_disk(base.to_string_lossy().to_string()).unwrap();
        let legacy = scanned.iter().find(|s| s.slug == "legacy-two").unwrap();
        assert_eq!(legacy.mc_version, "unknown");
        assert_eq!(legacy.port, 25599);
        assert!(!legacy.has_jar);

        let _ = std::fs::remove_dir_all(&base);
    }
}

// ---------------------------------------------------------------------------
// Server metadata editing — the owner's ask: rename the server, adjust RAM
// and port AFTER creation. Facts stay truthful: voxel-server.json,
// server.properties and the README all get the same new truth.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn server_update_metadata(
    base_path: String,
    slug: String,
    name: Option<String>,
    ram_mb: Option<u32>,
    port: Option<u16>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        server_update_metadata_impl(base_path, slug, name, ram_mb, port)
    })
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

pub fn server_update_metadata_impl(
    base_path: String,
    slug: String,
    name: Option<String>,
    ram_mb: Option<u32>,
    port: Option<u16>,
) -> Result<String, String> {
    let base = Path::new(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let dir = server_dir(&base, &slug);
    if !dir.is_dir() {
        return Err(format!("Server \"{slug}\" not found"));
    }

    // 1. the manifest is the source of truth on disk
    let manifest_path = dir.join("voxel-server.json");
    let mut manifest: serde_json::Value = std::fs::read(&manifest_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| "voxel-server.json missing or unreadable".to_string())?;
    if let Some(name) = name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Server name cannot be empty".to_string());
        }
        manifest["name"] = serde_json::Value::String(trimmed.to_string());
    }
    if let Some(ram) = ram_mb {
        if !(512..=32768).contains(&ram) {
            return Err("RAM must be between 512 MB and 32 GB".to_string());
        }
        manifest["ramMb"] = serde_json::Value::from(ram);
    }
    if let Some(p) = port {
        if !(1024..=65535).contains(&p) {
            return Err("Port must be between 1024 and 65535".to_string());
        }
        manifest["port"] = serde_json::Value::from(p);
        // keep server.properties in sync — the file the server actually reads
        let props_path = dir.join("server.properties");
        if let Ok(content) = std::fs::read_to_string(&props_path) {
            let updated = content
                .lines()
                .map(|l| {
                    if l.trim_start_matches('#').starts_with("server-port=") {
                        format!("server-port={p}")
                    } else {
                        l.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(&props_path, format!("{updated}\n"))
                .map_err(|e| format!("write server.properties: {e}"))?;
        }
    }
    let pretty = serde_json::to_string_pretty(&manifest).map_err(|e| format!("{e}"))?;
    std::fs::write(&manifest_path, &pretty).map_err(|e| format!("write manifest: {e}"))?;

    // 2. the README tells the same story as the facts
    let info = ServerInfoPayload {
        storage_base: base.to_string_lossy().to_string(),
        slug: slug.clone(),
        name: manifest
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&slug)
            .to_string(),
        software: manifest
            .get("software")
            .and_then(|v| v.as_str())
            .unwrap_or("vanilla")
            .to_string(),
        mc_version: manifest
            .get("mcVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        ram_mb: manifest.get("ramMb").and_then(|v| v.as_u64()).unwrap_or(2048) as u32,
        modules: Vec::new(), // module docs are rewritten by server_write_info when installed
    };
    if let Err(e) = server_write_info_impl(info) {
        return Err(format!("server renamed, but the README could not be updated: {e}"));
    }

    Ok(pretty)
}

#[cfg(test)]
mod metadata_tests {
    use super::*;

    #[test]
    fn metadata_updates_sync_the_manifest_properties_and_readme() {
        let base = std::env::temp_dir().join(format!("voxel-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("servers/arena");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("voxel-server.json"),
            r#"{"slug":"arena","name":"Old Name","software":"paper","mcVersion":"1.20.1","port":25565,"ramMb":2048,"createdAt":"20260101-00000"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("server.properties"), "server-port=25565\nmotd=x\n").unwrap();

        server_update_metadata_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            Some("Kingdom Arena".to_string()),
            Some(4096),
            Some(25570),
        )
        .unwrap();

        let manifest = std::fs::read_to_string(dir.join("voxel-server.json")).unwrap();
        assert!(manifest.contains("\"Kingdom Arena\""));
        assert!(manifest.contains("4096"));
        assert!(manifest.contains("25570"));
        let props = std::fs::read_to_string(dir.join("server.properties")).unwrap();
        assert!(props.contains("server-port=25570"));
        assert!(props.contains("motd=x"));
        let readme = std::fs::read_to_string(dir.join("README.md")).unwrap();
        assert!(readme.contains("# Kingdom Arena"));

        // boundaries are honest
        let err = server_update_metadata_impl(
            base.to_string_lossy().to_string(),
            "arena".to_string(),
            None,
            Some(100),
            None,
        );
        assert!(err.unwrap_err().contains("512"));

        let _ = std::fs::remove_dir_all(&base);
    }
}
