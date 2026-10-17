//! Minecraft Launcher (Fase 5) — instances, official downloads and launch.
//!
//! Pipeline:
//!  1. Version metadata: Mojang piston-meta (manifest -> version json) +
//!     Fabric loader profile (meta.fabricmc.net), merged like real launchers.
//!  2. Downloads: client jar + libraries (vanilla + Fabric) + asset index +
//!     asset objects — all from official endpoints, SHA-1 verified, with
//!     skip-if-present and progress events.
//!  3. Instances: isolated per project under `instances/<slug>/`
//!     (mods, saves, config, options.txt, extracted natives).
//!  4. Launch: java with the merged vanilla+Fabric arguments (KnotClient),
//!     authenticated account data, streaming logs via events.
//!
//! Legal: every artifact is fetched at runtime from official public
//! endpoints for the local user — nothing is redistributed.

use serde::{Deserialize, Serialize};
use sha1::{Digest as _, Sha1};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

use super::process;

// ---------------------------------------------------------------------------
// HTTP (shared client — keep-alive across thousands of asset downloads)
// ---------------------------------------------------------------------------

fn shared_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            // HARD total timeout — the owner report ("nothing works") was an
            // action hanging FOREVER: a connection that opens but stalls
            // (antivirus scanning, proxy, flaky Wi-Fi) never errored without
            // this. 5 minutes is generous for the largest single file we
            // fetch (a ~50MB server jar on slow links) and still finite.
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("reqwest client")
    })
}

/// Turns low-level reqwest errors into something the user can act on —
/// "check your internet / firewall / VPN" instead of a bare send error.
fn friendly_http_error(url: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        format!(
            "Download timed out: {url} — check your internet connection (or firewall/VPN/proxy) and try again"
        )
    } else if err.is_connect() {
        format!(
            "Could not reach {url} — check your internet connection (or firewall/VPN/proxy) and try again"
        )
    } else {
        format!("GET {url} failed: {err}")
    }
}

pub(crate) fn http_get_bytes(url: &str) -> Result<Vec<u8>, String> {
    // Transient networks deserve retries: 3 attempts total, short backoff.
    // HTTP error statuses (4xx/5xx) are NOT retried — they are answers.
    let mut last_err = String::new();
    for attempt in 1..=3 {
        let response = shared_client().get(url).send();
        match response {
            Ok(response) => {
                if !response.status().is_success() {
                    return Err(format!("GET {url} -> HTTP {}", response.status()));
                }
                return Ok(response
                    .bytes()
                    .map_err(|e| friendly_http_error(url, &e))?
                    .to_vec());
            }
            Err(e) => {
                last_err = friendly_http_error(url, &e);
                if !e.is_timeout() && !e.is_connect() {
                    return Err(last_err);
                }
                if attempt < 3 {
                    std::thread::sleep(std::time::Duration::from_millis(
                        750 * attempt as u64,
                    ));
                }
            }
        }
    }
    Err(last_err)
}

fn http_get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    let bytes = http_get_bytes(url)?;
    // Some endpoints ship a UTF-8 BOM — strip before parsing
    let slice = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&bytes);
    serde_json::from_slice(slice).map_err(|e| format!("parse {url}: {e}"))
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn file_sha1_matches(path: &Path, expected: &str) -> bool {
    if expected.is_empty() {
        return path.exists();
    }
    match std::fs::read(path) {
        Ok(bytes) => sha1_hex(&bytes) == expected,
        Err(_) => false,
    }
}

/// Downloads `url` to `path` unless the local SHA-1 already matches.
/// Returns Ok(true) when a download happened.
fn ensure_file(url: &str, path: &Path, sha1: &str) -> Result<bool, String> {
    if file_sha1_matches(path, sha1) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let bytes = http_get_bytes(url)?;
    if !sha1.is_empty() && sha1_hex(&bytes) != sha1 {
        return Err(format!("SHA-1 mismatch for {}", path.display()));
    }
    std::fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Remote metadata models (official formats)
// ---------------------------------------------------------------------------

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

fn fabric_profile_url(mc: &str, loader: &str) -> String {
    format!("https://meta.fabricmc.net/v2/versions/loader/{mc}/{loader}/profile/json")
}

#[derive(Deserialize)]
pub(crate) struct Manifest {
    #[serde(default)]
    pub(crate) versions: Vec<ManifestEntry>,
}

#[derive(Deserialize)]
pub(crate) struct ManifestEntry {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionJson {
    #[serde(default)]
    assets: String,
    #[serde(default)]
    asset_index: Option<AssetIndexInfo>,
    #[serde(default)]
    downloads: HashMap<String, DownloadEntry>,
    #[serde(default)]
    libraries: Vec<VanillaLibrary>,
    #[serde(default)]
    arguments: Arguments,
}

#[derive(Deserialize)]
struct AssetIndexInfo {
    id: String,
    url: String,
    sha1: String,
}

#[derive(Deserialize)]
struct DownloadEntry {
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: String,
}

#[derive(Deserialize)]
struct VanillaLibrary {
    #[serde(default)]
    #[allow(dead_code)] // name kept for log/debug clarity
    name: String,
    #[serde(default)]
    downloads: Option<VanillaDownloads>,
    #[serde(default)]
    rules: Option<Vec<Rule>>,
}

#[derive(Deserialize)]
struct VanillaDownloads {
    #[serde(default)]
    artifact: Option<Artifact>,
}

#[derive(Deserialize, Clone)]
struct Artifact {
    #[serde(default)]
    path: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: String,
}

#[derive(Deserialize, Clone, Default)]
struct Arguments {
    #[serde(default)]
    game: Vec<Arg>,
    #[serde(default)]
    jvm: Vec<Arg>,
}

#[derive(Deserialize, Clone)]
#[serde(untagged)]
enum Arg {
    Plain(String),
    Conditional {
        value: serde_json::Value,
        #[serde(default)]
        rules: Vec<Rule>,
    },
}

#[derive(Deserialize, Clone)]
struct Rule {
    #[serde(default)]
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
    #[serde(default)]
    features: Option<HashMap<String, bool>>,
}

#[derive(Deserialize, Clone)]
struct OsRule {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arch: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FabricProfile {
    #[serde(default)]
    main_class: String,
    #[serde(default)]
    libraries: Vec<FabricLibrary>,
    #[serde(default)]
    arguments: FabricArguments,
}

#[derive(Deserialize, Default)]
struct FabricArguments {
    #[serde(default)]
    game: Vec<String>,
    #[serde(default)]
    jvm: Vec<String>,
}

#[derive(Deserialize)]
struct FabricLibrary {
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: Option<String>,
}

#[derive(Deserialize)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
}

#[derive(Deserialize)]
struct AssetObject {
    hash: String,
}

// ---------------------------------------------------------------------------
// Results / events
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub instance_dir: String,
    pub downloaded: usize,
    pub skipped: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    project: String,
    done: u32,
    total: u32,
    detail: String,
}

// ---------------------------------------------------------------------------
// Rules / args helpers
// ---------------------------------------------------------------------------

fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn os_arch_rule() -> &'static str {
    if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x86_64"
    }
}

/// Minimal Mojang rule evaluator (os name/arch; feature-gated args stay off).
fn rule_allows(rules: &[Rule]) -> bool {
    let mut allowed = true;
    for rule in rules {
        let matched = match (&rule.os, &rule.features) {
            (Some(os), None) => {
                let name_ok = os.name.as_deref().map(|n| n == os_name()).unwrap_or(true);
                let arch_ok = os.arch.as_deref().map(|a| a == os_arch_rule()).unwrap_or(true);
                name_ok && arch_ok
            }
            (None, Some(_)) => false, // demo/custom-resolution args stay off
            _ => true,
        };
        if rule.action == "allow" {
            if matched {
                allowed = true;
            }
        } else if rule.action == "disallow" && matched {
            allowed = false;
        }
    }
    allowed
}

fn arg_values(arg: &Arg, out: &mut Vec<String>) {
    match arg {
        Arg::Plain(text) => out.push(text.clone()),
        Arg::Conditional { value, rules } => {
            if rule_allows(rules) {
                match value {
                    serde_json::Value::String(s) => out.push(s.clone()),
                    serde_json::Value::Array(items) => {
                        for item in items {
                            if let Some(s) = item.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Maven `group:artifact:version[:classifier]` -> maven repo path.
fn maven_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let (artifact, version) = (parts[1], parts[2]);
    let mut file = format!("{artifact}-{version}");
    if parts.len() >= 4 {
        file.push_str(&format!("-{}", parts[3]));
    }
    file.push_str(".jar");
    Some(format!("{group}/{artifact}/{version}/{file}"))
}

// ---------------------------------------------------------------------------
// Directory layout
// ---------------------------------------------------------------------------

fn mc_versions_dir(base: &Path) -> PathBuf {
    base.join("minecraft").join("versions")
}

fn mc_libraries_dir(base: &Path) -> PathBuf {
    base.join("minecraft").join("libraries")
}

fn mc_assets_dir(base: &Path) -> PathBuf {
    base.join("minecraft").join("assets")
}

fn instance_dir(base: &Path, slug: &str) -> PathBuf {
    base.join("instances").join(slug)
}

// ---------------------------------------------------------------------------
// Prepare: metadata + downloads + instance bootstrap + natives
// ---------------------------------------------------------------------------

/// Testable core — `emit` receives (done, total, detail) progress updates.
pub fn prepare_core(
    base_path: &str,
    project_slug: &str,
    mc_version: &str,
    loader_version: &str,
    emit: &(dyn Fn(u32, u32, &str) + Send + Sync),
) -> Result<PrepareResult, String> {
    let app = None::<AppHandle>;
    let app = app; // command-only value; core emits through the callback
    let _ = &app;
    let emit_progress = |project: &str, done: u32, total: u32, detail: &str| {
        emit(done, total, &format!("{project}|{detail}"));
    };

    if project_slug.trim().is_empty() {
        return Err("Project slug is required".to_string());
    }
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;

    let inst = instance_dir(&base, &project_slug);

    // ---- metadata ----
    emit_progress(project_slug, 0, 1, "fetching version manifest…");
    let manifest: Manifest = http_get_json(MANIFEST_URL)?;
    let version_url = manifest
        .versions
        .iter()
        .find(|v| v.id == mc_version)
        .map(|v| v.url.clone())
        .ok_or_else(|| format!("Minecraft {mc_version} not found in the official manifest"))?;

    emit_progress(project_slug, 0, 1, "fetching version metadata…");
    let version_bytes = http_get_bytes(&version_url)?;
    let version_dir = mc_versions_dir(&base).join(&mc_version);
    std::fs::create_dir_all(&version_dir).map_err(|e| format!("{e}"))?;
    std::fs::write(version_dir.join("version.json"), &version_bytes)
        .map_err(|e| format!("{e}"))?;
    let version: VersionJson = serde_json::from_slice(
        version_bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&version_bytes),
    )
    .map_err(|e| format!("version metadata parse: {e}"))?;

    emit_progress(project_slug, 0, 1, "fetching Fabric profile…");
    let fabric_url = fabric_profile_url(&mc_version, &loader_version);
    let fabric_bytes = http_get_bytes(&fabric_url)?;
    std::fs::write(version_dir.join("fabric-profile.json"), &fabric_bytes)
        .map_err(|e| format!("{e}"))?;
    let fabric: FabricProfile = serde_json::from_slice(&fabric_bytes)
        .map_err(|e| format!("fabric profile parse: {e}"))?;

    // ---- plan downloads ----
    struct Planned {
        url: String,
        path: PathBuf,
        sha1: String,
    }
    let mut planned: Vec<Planned> = Vec::new();

    // client jar
    if let Some(client) = version.downloads.get("client") {
        if client.url.is_empty() {
            return Err("This version has no client download".to_string());
        }
        planned.push(Planned {
            url: client.url.clone(),
            path: version_dir.join("client.jar"),
            sha1: client.sha1.clone(),
        });
    } else {
        return Err("This version has no client download".to_string());
    }

    // vanilla libraries (os-filtered — includes per-OS natives entries)
    for library in &version.libraries {
        let rules = library.rules.as_deref().unwrap_or(&[]);
        if !rules.is_empty() && !rule_allows(rules) {
            continue;
        }
        if let Some(artifact) = library.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            if !artifact.path.is_empty() && !artifact.url.is_empty() {
                planned.push(Planned {
                    url: artifact.url.clone(),
                    path: mc_libraries_dir(&base).join(&artifact.path),
                    sha1: artifact.sha1.clone(),
                });
            }
        }
    }

    // fabric libraries (maven.fabricmc.net)
    for library in &fabric.libraries {
        if let Some(path) = maven_path(&library.name) {
            let url = format!("{}{}", library.url, path);
            planned.push(Planned {
                url,
                path: mc_libraries_dir(&base).join(&path),
                sha1: library.sha1.clone().unwrap_or_default(),
            });
        }
    }

    // asset index + objects
    let assets_dir = mc_assets_dir(&base);
    let asset_index = version
        .asset_index
        .as_ref()
        .ok_or_else(|| "Version has no asset index".to_string())?;
    let index_path = assets_dir.join("indexes").join(format!("{}.json", asset_index.id));
    let mut asset_objects: Vec<(String, String)> = Vec::new();
    {
        let bytes = http_get_bytes(&asset_index.url)?;
        if !asset_index.sha1.is_empty() && sha1_hex(&bytes) != asset_index.sha1 {
            return Err("Asset index SHA-1 mismatch".to_string());
        }
        std::fs::create_dir_all(index_path.parent().unwrap()).map_err(|e| format!("{e}"))?;
        std::fs::write(&index_path, &bytes).map_err(|e| format!("{e}"))?;
        let index: AssetIndex = serde_json::from_slice(&bytes)
            .map_err(|e| format!("asset index parse: {e}"))?;
        for object in index.objects.values() {
            asset_objects.push((
                object.hash.clone(),
                format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    &object.hash[..2],
                    object.hash
                ),
            ));
        }
    }

    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let total = (planned.len() + asset_objects.len()) as u32;

    // ---- sequential downloads (client + libraries) ----
    for (index, file) in planned.iter().enumerate() {
        match ensure_file(&file.url, &file.path, &file.sha1) {
            Ok(true) => downloaded += 1,
            Ok(false) => skipped += 1,
            Err(e) => return Err(e),
        }
        emit_progress(
            project_slug,
            index as u32 + 1,
            total,
            &file.path.to_string_lossy(),
        );
    }

    // ---- parallel asset downloads (8 workers, shared progress counter) ----
    let base_done = planned.len() as u32;
    let progress = AtomicU32::new(0);
    let downloads_counter = AtomicU32::new(0);
    let chunk_size = (asset_objects.len() / 8).max(1);
    let slug = project_slug;
    std::thread::scope(|scope| {
        for chunk in asset_objects.chunks(chunk_size) {
            let assets_dir = assets_dir.clone();
            let progress = &progress;
            let downloads_counter = &downloads_counter;
            let emit = emit;
            scope.spawn(move || {
                for (hash, url) in chunk {
                    let path = assets_dir.join("objects").join(&hash[..2]).join(&hash);
                    match ensure_file(url, &path, hash) {
                        Ok(true) => {
                            downloads_counter.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(false) => {}
                        Err(e) => {
                            eprintln!("asset download failed: {e}");
                        }
                    }
                    let done = base_done + progress.fetch_add(1, Ordering::SeqCst) + 1;
                    emit(done, total, &format!("{slug}|assets"));
                }
            });
        }
    });
    let downloaded_assets = downloads_counter.load(Ordering::SeqCst) as usize;
    downloaded += downloaded_assets;
    skipped += asset_objects.len() - downloaded_assets;

    // ---- instance bootstrap ----
    for dir in ["mods", "saves", "config", "resourcepacks", "shaderpacks", "natives"] {
        std::fs::create_dir_all(inst.join(dir)).map_err(|e| format!("{e}"))?;
    }
    let options = inst.join("options.txt");
    if !options.exists() {
        std::fs::write(&options, "version:612\n").map_err(|e| format!("{e}"))?;
    }

    // ---- natives extraction (per-OS natives jars -> instance/natives) ----
    let natives_dir = inst.join("natives");
    let natives_marker = format!("natives-{}", os_name());
    for library in &version.libraries {
        let artifact = match library.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            Some(a) => a,
            None => continue,
        };
        if !artifact.path.contains(&natives_marker) {
            continue;
        }
        let jar_path = mc_libraries_dir(&base).join(&artifact.path);
        if jar_path.is_file() {
            extract_zip_to(&jar_path, &natives_dir)?;
        }
    }

    Ok(PrepareResult {
        instance_dir: inst.to_string_lossy().to_string(),
        downloaded,
        skipped,
    })
}

#[tauri::command]
pub async fn launcher_prepare(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    loader_version: String,
) -> Result<PrepareResult, String> {
    // downloads 718MB+ — off the main thread or the UI freezes
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || launcher_prepare_impl(app, base_path, project_slug, mc_version, loader_version))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn launcher_prepare_impl(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    loader_version: String,
) -> Result<PrepareResult, String> {
    let app_ref = &app;
    let slug_ref = project_slug.clone();
    prepare_core(
        &base_path,
        &project_slug,
        &mc_version,
        &loader_version,
        &move |done, total, detail| {
            let (project, text) = match detail.split_once('|') {
                Some((p, rest)) => (p, rest),
                None => (slug_ref.as_str(), detail),
            };
            let _ = app_ref.emit(
                "launcher:progress",
                ProgressEvent {
                    project: project.to_string(),
                    done,
                    total,
                    detail: text.to_string(),
                },
            );
        },
    )
}

/// Zip extraction with zip-slip protection (policy §43): relative entries
/// only — any `..` segment is refused.
fn extract_zip_to(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("zip open: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut segments = name.split(['/', '\\']);
        if segments.any(|s| s == "..") || name.starts_with('/') {
            continue; // refuse traversal / absolute entries
        }
        let target = dest.join(&name);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{e}"))?;
        }
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(|e| format!("{e}"))?;
        std::fs::write(&target, bytes).map_err(|e| format!("{e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Mod jar deployment
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn launcher_copy_mod_jar(
    base_path: String,
    project_slug: String,
    project_rel: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || launcher_copy_mod_jar_impl(base_path, project_slug, project_rel))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn launcher_copy_mod_jar_impl(
    base_path: String,
    project_slug: String,
    project_rel: String,
) -> Result<Option<String>, String> {
    let base = std::path::PathBuf::from(&base_path);
    let project_dir = super::fs::validated_path(&base_path, &project_rel, false)?;
    let libs = project_dir.join("build").join("libs");
    if !libs.is_dir() {
        return Ok(None);
    }
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(&libs).map_err(|e| format!("{e}"))? {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jar") || name.contains("sources") {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::UNIX_EPOCH);
        if newest.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            newest = Some((modified, entry.path()));
        }
    }
    let (_, jar) = match newest {
        Some(found) => found,
        None => return Ok(None),
    };

    let mods_dir = instance_dir(&base, &project_slug).join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| format!("{e}"))?;
    let file_name = jar.file_name().unwrap_or_default();
    let target = mods_dir.join(file_name);
    // Remove previous mod jars from this project to keep the instance clean
    if mods_dir.is_dir() {
        for entry in std::fs::read_dir(&mods_dir).map_err(|e| format!("{e}"))?.flatten() {
            let n = entry.file_name().to_string_lossy().to_string();
            if n.ends_with(".jar") && n != file_name.to_string_lossy() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    std::fs::copy(&jar, &target).map_err(|e| format!("copy mod jar: {e}"))?;
    Ok(Some(target.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
}

#[tauri::command]
pub fn launcher_launch(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    account: Option<AccountInfo>,
    java_path: Option<String>,
    ram_mb: Option<u32>,
) -> Result<String, String> {
    let account = account.ok_or_else(|| {
        "No authenticated account — sign in via Settings → Launcher first".to_string()
    })?;

    let base = std::path::PathBuf::from(&base_path);
    let inst = instance_dir(&base, &project_slug);
    let version_dir = mc_versions_dir(&base).join(&mc_version);

    let read_json = |path: PathBuf, what: &str| -> Result<Vec<u8>, String> {
        std::fs::read(&path).map_err(|e| format!("{what} missing: {e} — run Prepare first"))
    };

    let version_bytes = read_json(version_dir.join("version.json"), "version.json")?;
    let version: VersionJson = serde_json::from_slice(
        version_bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&version_bytes),
    )
    .map_err(|e| format!("version.json parse: {e}"))?;

    let fabric_bytes = read_json(version_dir.join("fabric-profile.json"), "fabric-profile.json")?;
    let fabric: FabricProfile =
        serde_json::from_slice(&fabric_bytes).map_err(|e| format!("fabric profile parse: {e}"))?;

    // ---- classpath: vanilla artifacts (non-natives) + fabric libs + client ----
    let libs_root = mc_libraries_dir(&base);
    let mut classpath: Vec<String> = Vec::new();
    for library in &version.libraries {
        if let Some(artifact) = library.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            if !artifact.path.contains("natives-") {
                classpath.push(libs_root.join(&artifact.path).to_string_lossy().to_string());
            }
        }
    }
    for library in &fabric.libraries {
        if let Some(path) = maven_path(&library.name) {
            classpath.push(libs_root.join(&path).to_string_lossy().to_string());
        }
    }
    classpath.push(version_dir.join("client.jar").to_string_lossy().to_string());

    let natives = inst.join("natives");
    let assets_root = mc_assets_dir(&base);
    let asset_index_name = version
        .asset_index
        .as_ref()
        .map(|a| a.id.clone())
        .unwrap_or_else(|| version.assets.clone());

    let mut vars: HashMap<String, String> = HashMap::new();
    vars.insert("auth_player_name".into(), account.username);
    vars.insert("auth_uuid".into(), account.uuid);
    vars.insert("auth_access_token".into(), account.access_token);
    vars.insert("auth_xuid".into(), String::new());
    vars.insert("clientid".into(), "voxel".into());
    vars.insert("user_type".into(), "msa".into());
    vars.insert("user_properties".into(), "{}".into());
    vars.insert("version_name".into(), mc_version.clone());
    vars.insert("game_directory".into(), inst.to_string_lossy().to_string());
    vars.insert("assets_root".into(), assets_root.to_string_lossy().to_string());
    vars.insert("assets_index_name".into(), asset_index_name);
    vars.insert("natives_directory".into(), natives.to_string_lossy().to_string());
    vars.insert("library_directory".into(), libs_root.to_string_lossy().to_string());
    vars.insert("classpath".into(), classpath.join(":"));

    let render = |text: &str| -> String {
        let mut out = text.to_string();
        for (key, value) in &vars {
            out = out.replace(&format!("${{{key}}}"), value);
        }
        out
    };

    // ---- merged arguments (vanilla + fabric) ----
    let mut merged_game: Vec<Arg> = version.arguments.game.clone();
    merged_game.extend(fabric.arguments.game.iter().map(|s| Arg::Plain(s.clone())));
    let mut game_args: Vec<String> = Vec::new();
    for arg in &merged_game {
        arg_values(arg, &mut game_args);
    }

    let mut merged_jvm: Vec<Arg> = version.arguments.jvm.clone();
    merged_jvm.extend(fabric.arguments.jvm.iter().map(|s| Arg::Plain(s.clone())));
    let mut jvm_args: Vec<String> = Vec::new();
    for arg in &merged_jvm {
        arg_values(arg, &mut jvm_args);
    }

    let ram = ram_mb.unwrap_or(4096);
    let java = java_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "java".to_string());

    let mut command = std::process::Command::new(&java);
    command.arg(format!("-Xmx{ram}M"));
    command.arg("-Dlog4j2.formatMsgNoLookups=true");
    for arg in &jvm_args {
        command.arg(render(arg));
    }
    command.arg("-cp").arg(render("${classpath}"));
    command.arg(&fabric.main_class);
    for arg in &game_args {
        command.arg(render(arg));
    }
    command.current_dir(&inst);

    let key = format!("launch/{project_slug}");
    process::spawn_monitored(app, &key, command, "launch", false)?;
    Ok(key)
}

#[cfg(test)]
mod e2e_tests {
    use super::*;

    /// Full launcher pipeline proof: official metadata + client jar +
    /// libraries + assets + natives extraction, warming the shared cache.
    #[test]
    #[ignore = "e2e: downloads the full Minecraft runtime (~700MB on first run)"]
    fn e2e_launcher_prepare_full() {
        let home = std::env::var("HOME").expect("HOME");
        let base = format!("{home}/VOXEL");
        std::fs::create_dir_all(&base).unwrap();

        let result = prepare_core(&base, "e2e-launch", "1.20.1", "0.16.9", &|done, total, detail| {
            eprintln!("[{done}/{total}] {detail}");
        })
        .expect("prepare must succeed");

        let inst = std::path::PathBuf::from(&result.instance_dir);
        assert!(inst.join("mods").is_dir());
        assert!(inst.join("options.txt").is_file());

        let base = std::path::PathBuf::from(base);
        let client = base.join("minecraft/versions/1.20.1/client.jar");
        assert!(client.is_file(), "client.jar must exist");
        assert!(std::fs::metadata(&client).unwrap().len() > 10_000_000, "client.jar too small");

        let index = base.join("minecraft/assets/indexes/5.json");
        assert!(index.is_file(), "asset index must exist");

        // natives must have been extracted on this platform
        let natives = inst.join("natives");
        let natives_count = std::fs::read_dir(&natives)
            .map(|d| d.count())
            .unwrap_or(0);
        assert!(natives_count > 0, "natives extraction produced nothing");

        eprintln!(
            "E2E LAUNCHER OK — downloaded: {}, skipped: {}",
            result.downloaded, result.skipped
        );
        let _ = std::fs::remove_dir_all(&inst);
    }
}

// ---------------------------------------------------------------------------
// Launcher overview (the Play tab)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LauncherInstance {
    pub slug: String,
    pub mods: Vec<String>,
    pub shader_packs: Vec<String>,
    pub last_build_jar: Option<String>,
}

fn list_names(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    out.push(name);
                }
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
pub async fn launcher_overview(base_path: String) -> Result<Vec<LauncherInstance>, String> {
    tauri::async_runtime::spawn_blocking(move || launcher_overview_impl(base_path))
        .await
        .map_err(|e| format!("overview worker failed: {e}"))?
}

/// Sync impl (disk I/O over instances/) — tests call this directly.
pub fn launcher_overview_impl(base_path: String) -> Result<Vec<LauncherInstance>, String> {
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let instances = base.join("instances");
    let mut list = Vec::new();
    let entries = match std::fs::read_dir(&instances) {
        Ok(entries) => entries,
        Err(_) => return Ok(list),
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let slug = entry.file_name().to_string_lossy().to_string();
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        // latest compiled jar of the matching project, if any
        let libs = base.join("projects").join(&slug).join("build/libs");
        let mut last_build_jar = None;
        if let Ok(jars) = std::fs::read_dir(&libs) {
            let mut best: Option<(std::time::SystemTime, String)> = None;
            for jar in jars.filter_map(|j| j.ok()) {
                let name = jar.file_name().to_string_lossy().to_string();
                if !name.ends_with(".jar") || name.contains("sources") {
                    continue;
                }
                let modified = jar
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
                    best = Some((modified, name));
                }
            }
            last_build_jar = best.map(|(_, name)| name);
        }
        list.push(LauncherInstance {
            slug,
            mods: list_names(&dir.join("mods")),
            shader_packs: list_names(&dir.join("shaderpacks")),
            last_build_jar,
        });
    }
    list.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(list)
}
