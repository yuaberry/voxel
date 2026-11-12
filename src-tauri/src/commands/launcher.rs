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
use sha2::Sha256;
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

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
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

/// Downloads an artifact only when its SHA-256 does not match the pinned
/// official digest. The checked file is never trusted from a previous run
/// unless its bytes still match exactly.
fn ensure_sha256_file(
    url: &str,
    path: &Path,
    expected_sha256: &str,
) -> Result<bool, String> {
    if std::fs::read(path)
        .map(|bytes| sha256_hex(&bytes) == expected_sha256)
        .unwrap_or(false)
    {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let bytes = http_get_bytes(url)?;
    if sha256_hex(&bytes) != expected_sha256 {
        return Err(format!("SHA-256 mismatch for {}", path.display()));
    }
    std::fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Remote metadata models (official formats)
// ---------------------------------------------------------------------------

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

const AUTHLIB_INJECTOR_VERSION: &str = "1.2.8";
const AUTHLIB_INJECTOR_URL: &str =
    "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";
const AUTHLIB_INJECTOR_SHA256: &str =
    "9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10";
const ELYBY_AUTHLIB_API: &str = "ely.by";

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
    /// Vanilla entry point (`net.minecraft.client.main.Main`). The Fabric
    /// profile replaces it with the loader's own main class.
    #[serde(default)]
    main_class: Option<String>,
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
// Loader (vanilla vs fabric)
// ---------------------------------------------------------------------------

/// Which client runtime an instance launches with.
///
/// * `vanilla` — the Mojang client exactly as shipped. This is what a
///   datapack/resource-pack project needs: no loader, no mod jar, and the
///   protocol version matches the vanilla server.
/// * `fabric` — the Mojang client plus the Fabric loader profile.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LaunchLoader {
    #[default]
    Fabric,
    Vanilla,
}

impl LaunchLoader {
    /// Parses the loader declared by the project record. Unknown loaders are
    /// refused with an actionable message instead of silently launching a
    /// different runtime than the project expects.
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "fabric" => Ok(LaunchLoader::Fabric),
            "vanilla" => Ok(LaunchLoader::Vanilla),
            "paper" => Err(
                "Paper is a server software — the VOXEL client launches with Vanilla or Fabric"
                    .to_string(),
            ),
            other => Err(format!(
                "Loader '{other}' is not supported by the VOXEL launcher yet (Vanilla or Fabric)"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            LaunchLoader::Fabric => "fabric",
            LaunchLoader::Vanilla => "vanilla",
        }
    }
}

/// The vanilla client entry point. Used when the version metadata does not
/// declare one (and always for the vanilla profile).
const VANILLA_MAIN_CLASS: &str = "net.minecraft.client.main.Main";

/// Resolves the JVM entry point of the launch.
///
/// * fabric — the loader's own main class (`net.fabricmc.loader.impl.launch.knot.KnotClient`).
/// * vanilla — the class declared by the version metadata
///   (`net.minecraft.client.main.Main`).
fn resolve_main_class(
    loader: LaunchLoader,
    version_main_class: Option<&str>,
    fabric_main_class: Option<&str>,
) -> String {
    match loader {
        LaunchLoader::Fabric => fabric_main_class
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
            .unwrap_or(VANILLA_MAIN_CLASS)
            .to_string(),
        LaunchLoader::Vanilla => version_main_class
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
            .unwrap_or(VANILLA_MAIN_CLASS)
            .to_string(),
    }
}

/// Classpath separator of the host OS (`:` on unix, `;` on windows).
fn classpath_separator() -> char {
    if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    }
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

/// Mojang rule evaluator (os name/arch + feature-gated args).
///
/// The official semantics (the same the vanilla launcher uses):
/// * an arg WITHOUT rules is always included;
/// * an arg WITH rules is included when AT LEAST ONE rule allows it;
/// * an `allow` rule allows it when the os/arch match AND every feature it
///   asks for is enabled (VOXEL enables none of them);
/// * a `disallow` rule allows it when the os/arch does NOT match.
///
/// The previous implementation started from "allowed" and only removed an
/// arg on a MATCHING disallow — so an `allow osx` rule still shipped
/// `-XstartOnFirstThread` to Linux, and the JVM refused to start at all
/// ("Unrecognized option: -XstartOnFirstThread"). That was the reason the
/// owner's game never opened.
fn rule_allows(rules: &[Rule]) -> bool {
    if rules.is_empty() {
        return true;
    }
    rules.iter().any(|rule| {
        let os_matches = rule
            .os
            .as_ref()
            .map(|os| {
                let name_ok = os.name.as_deref().map(|n| n == os_name()).unwrap_or(true);
                let arch_ok = os.arch.as_deref().map(|a| a == os_arch_rule()).unwrap_or(true);
                name_ok && arch_ok
            })
            .unwrap_or(true);
        let features_match = rule
            .features
            .as_ref()
            .map(|features| features.values().all(|enabled| !*enabled))
            .unwrap_or(true);
        match rule.action.as_str() {
            "allow" => os_matches && features_match,
            "disallow" => !os_matches,
            _ => false,
        }
    })
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

fn authlib_injector_path(base: &Path) -> PathBuf {
    base.join("minecraft")
        .join("authlib-injector")
        .join(format!("authlib-injector-{AUTHLIB_INJECTOR_VERSION}.jar"))
}

fn ensure_authlib_injector(base: &Path) -> Result<PathBuf, String> {
    let path = authlib_injector_path(base);
    ensure_sha256_file(AUTHLIB_INJECTOR_URL, &path, AUTHLIB_INJECTOR_SHA256)?;
    Ok(path)
}

fn elyby_javaagent_argument(path: &Path) -> String {
    format!(
        "-javaagent:{}={ELYBY_AUTHLIB_API}",
        path.to_string_lossy()
    )
}

// ---------------------------------------------------------------------------
// Prepare: metadata + downloads + instance bootstrap + natives
// ---------------------------------------------------------------------------

/// Testable core — `emit` receives (done, total, detail) progress updates.
///
/// `loader` decides which runtime is materialized:
/// * `vanilla` — client jar + vanilla libraries + assets + natives. The
///   Fabric profile is NOT fetched (a vanilla/datapack project must not
///   depend on a mod loader).
/// * `fabric` — everything above plus the Fabric profile and its libraries.
pub fn prepare_core(
    base_path: &str,
    project_slug: &str,
    mc_version: &str,
    loader: &str,
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
    let loader = LaunchLoader::parse(loader)?;
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

    // The Fabric profile only exists for the fabric profile — a vanilla
    // runtime must not depend on a mod loader (and a stale profile from a
    // previous fabric run must not leak into a vanilla launch).
    let fabric: Option<FabricProfile> = match loader {
        LaunchLoader::Vanilla => {
            let _ = std::fs::remove_file(version_dir.join("fabric-profile.json"));
            None
        }
        LaunchLoader::Fabric => {
            emit_progress(project_slug, 0, 1, "fetching Fabric profile…");
            let fabric_url = fabric_profile_url(&mc_version, &loader_version);
            let fabric_bytes = http_get_bytes(&fabric_url)?;
            std::fs::write(version_dir.join("fabric-profile.json"), &fabric_bytes)
                .map_err(|e| format!("{e}"))?;
            Some(
                serde_json::from_slice(&fabric_bytes)
                    .map_err(|e| format!("fabric profile parse: {e}"))?,
            )
        }
    };

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
    if let Some(fabric) = fabric.as_ref() {
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
    loader: Option<String>,
    loader_version: String,
) -> Result<PrepareResult, String> {
    // downloads 718MB+ — off the main thread or the UI freezes
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || launcher_prepare_impl(app, base_path, project_slug, mc_version, loader, loader_version))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn launcher_prepare_impl(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    loader: Option<String>,
    loader_version: String,
) -> Result<PrepareResult, String> {
    let app_ref = &app;
    let slug_ref = project_slug.clone();
    prepare_core(
        &base_path,
        &project_slug,
        &mc_version,
        loader.as_deref().unwrap_or("fabric"),
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

#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountProvider {
    #[default]
    Microsoft,
    Elyby,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    /// Missing provider means Microsoft for payloads created by older VOXEL builds.
    #[serde(default)]
    pub provider: AccountProvider,
    pub username: String,
    pub uuid: String,
    pub access_token: String,
}

#[tauri::command]
pub async fn launcher_launch(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    loader: Option<String>,
    account: Option<AccountInfo>,
    java_path: Option<String>,
    ram_mb: Option<u32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        launcher_launch_impl(
            app,
            base_path,
            project_slug,
            mc_version,
            loader,
            account,
            java_path,
            ram_mb,
        )
    })
    .await
    .map_err(|e| format!("launch worker failed: {e}"))?
}

fn launcher_launch_impl(
    app: AppHandle,
    base_path: String,
    project_slug: String,
    mc_version: String,
    loader: Option<String>,
    account: Option<AccountInfo>,
    java_path: Option<String>,
    ram_mb: Option<u32>,
) -> Result<String, String> {
    let account = account.ok_or_else(|| {
        "No authenticated account — sign in via Settings → Launcher first".to_string()
    })?;
    let plan = build_launch_plan(
        &base_path,
        &project_slug,
        &mc_version,
        loader.as_deref().unwrap_or("fabric"),
        &account,
        java_path.as_deref(),
        ram_mb,
    )?;

    let mut command = std::process::Command::new(&plan.java);
    for arg in &plan.args {
        command.arg(arg);
    }
    command.current_dir(&plan.game_dir);

    let key = format!("launch/{project_slug}");
    process::spawn_monitored(app, &key, command, "launch", false)?;
    Ok(key)
}

/// The exact process a launch runs — built without spawning it, so the
/// arguments can be proven by tests.
#[derive(Debug, Clone)]
pub struct LaunchPlan {
    pub java: String,
    /// Every argument after the java binary (javaagent, jvm args, main
    /// class and the game arguments).
    pub args: Vec<String>,
    pub main_class: String,
    pub game_dir: PathBuf,
}

/// Builds the java command line of a launch.
fn build_launch_plan(
    base_path: &str,
    project_slug: &str,
    mc_version: &str,
    loader: &str,
    account: &AccountInfo,
    java_path: Option<&str>,
    ram_mb: Option<u32>,
) -> Result<LaunchPlan, String> {
    let loader = LaunchLoader::parse(loader)?;

    let base = std::path::PathBuf::from(base_path);
    let inst = instance_dir(&base, project_slug);
    let version_dir = mc_versions_dir(&base).join(mc_version);
    let (user_type, elyby_agent) = match account.provider {
        AccountProvider::Microsoft => ("msa", None),
        AccountProvider::Elyby => {
            let injector = ensure_authlib_injector(&base)?;
            ("mojang", Some(elyby_javaagent_argument(&injector)))
        }
    };

    let read_json = |path: PathBuf, what: &str| -> Result<Vec<u8>, String> {
        std::fs::read(&path).map_err(|e| format!("{what} missing: {e} — run Prepare first"))
    };

    let version_bytes = read_json(version_dir.join("version.json"), "version.json")?;
    let version: VersionJson = serde_json::from_slice(
        version_bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&version_bytes),
    )
    .map_err(|e| format!("version.json parse: {e}"))?;

    // The Fabric profile is only part of a fabric launch. A vanilla launch
    // (datapack project) must NOT require it — that was the reason the game
    // never started for the owner.
    let fabric: Option<FabricProfile> = match loader {
        LaunchLoader::Vanilla => None,
        LaunchLoader::Fabric => {
            let bytes = read_json(version_dir.join("fabric-profile.json"), "fabric-profile.json")?;
            Some(
                serde_json::from_slice(&bytes)
                    .map_err(|e| format!("fabric profile parse: {e}"))?,
            )
        }
    };

    let main_class = resolve_main_class(
        loader,
        version.main_class.as_deref(),
        fabric.as_ref().map(|p| p.main_class.as_str()),
    );

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
    if let Some(fabric) = fabric.as_ref() {
        for library in &fabric.libraries {
            if let Some(path) = maven_path(&library.name) {
                classpath.push(libs_root.join(&path).to_string_lossy().to_string());
            }
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
    vars.insert("auth_player_name".into(), account.username.clone());
    vars.insert("auth_uuid".into(), account.uuid.clone());
    vars.insert("auth_access_token".into(), account.access_token.clone());
    vars.insert("auth_xuid".into(), String::new());
    vars.insert("clientid".into(), "voxel".into());
    vars.insert("user_type".into(), user_type.into());
    vars.insert("user_properties".into(), "{}".into());
    vars.insert("version_name".into(), mc_version.to_string());
    // The vanilla game args carry `--versionType ${version_type}` and the JVM
    // args carry `${launcher_name}`/`${launcher_version}`. Without these the
    // literal placeholders reach the game.
    vars.insert("version_type".into(), loader.as_str().to_string());
    vars.insert("launcher_name".into(), "voxel".into());
    vars.insert(
        "launcher_version".into(),
        env!("CARGO_PKG_VERSION").to_string(),
    );
    vars.insert("game_directory".into(), inst.to_string_lossy().to_string());
    vars.insert("assets_root".into(), assets_root.to_string_lossy().to_string());
    vars.insert("assets_index_name".into(), asset_index_name);
    vars.insert("natives_directory".into(), natives.to_string_lossy().to_string());
    vars.insert("library_directory".into(), libs_root.to_string_lossy().to_string());
    vars.insert(
        "classpath".into(),
        classpath.join(&classpath_separator().to_string()),
    );

    let render = |text: &str| -> String {
        let mut out = text.to_string();
        for (key, value) in &vars {
            out = out.replace(&format!("${{{key}}}"), value);
        }
        out
    };

    // ---- merged arguments (vanilla + fabric) ----
    let mut merged_game: Vec<Arg> = version.arguments.game.clone();
    let mut merged_jvm: Vec<Arg> = version.arguments.jvm.clone();
    if let Some(fabric) = fabric.as_ref() {
        merged_game.extend(fabric.arguments.game.iter().map(|s| Arg::Plain(s.clone())));
        merged_jvm.extend(fabric.arguments.jvm.iter().map(|s| Arg::Plain(s.clone())));
    }
    let mut game_args: Vec<String> = Vec::new();
    for arg in &merged_game {
        arg_values(arg, &mut game_args);
    }

    let mut jvm_args: Vec<String> = Vec::new();
    for arg in &merged_jvm {
        arg_values(arg, &mut jvm_args);
    }

    let ram = ram_mb.unwrap_or(4096);
    let java = java_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "java".to_string());

    let mut args: Vec<String> = Vec::new();
    if let Some(agent) = elyby_agent {
        args.push(agent);
    }
    args.push(format!("-Xmx{ram}M"));
    args.push("-Dlog4j2.formatMsgNoLookups=true".to_string());
    for arg in &jvm_args {
        args.push(render(arg));
    }
    args.push("-cp".to_string());
    args.push(render("${classpath}"));
    args.push(main_class.clone());
    for arg in &game_args {
        args.push(render(arg));
    }

    Ok(LaunchPlan {
        java,
        args,
        main_class,
        game_dir: inst,
    })
}

#[cfg(test)]
mod launcher_auth_tests {
    use super::*;

    #[test]
    fn legacy_account_payload_defaults_to_microsoft() {
        let account: AccountInfo = serde_json::from_value(serde_json::json!({
            "username": "Player",
            "uuid": "00000000-0000-0000-0000-000000000000",
            "accessToken": "token"
        }))
        .expect("legacy Microsoft payload must remain valid");
        assert_eq!(account.provider, AccountProvider::Microsoft);
    }

    #[test]
    fn unknown_account_provider_is_refused_at_the_boundary() {
        let result = serde_json::from_value::<AccountInfo>(serde_json::json!({
            "provider": "unknown",
            "username": "Player",
            "uuid": "00000000-0000-0000-0000-000000000000",
            "accessToken": "token"
        }));
        assert!(result.is_err());
    }

    #[test]
    fn sha256_verification_matches_the_standard_digest() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn elyby_javaagent_uses_the_official_api_name() {
        let path = Path::new("/tmp/authlib-injector.jar");
        assert_eq!(
            elyby_javaagent_argument(path),
            "-javaagent:/tmp/authlib-injector.jar=ely.by"
        );
    }

    #[test]
    #[ignore = "e2e: downloads the official authlib-injector and verifies SHA-256"]
    fn e2e_downloads_verified_authlib_injector() {
        let base = std::env::temp_dir().join(format!(
            "voxel-authlib-injector-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let path = ensure_authlib_injector(&base).expect("injector download must succeed");
        let bytes = std::fs::read(&path).expect("injector file must exist");
        assert_eq!(sha256_hex(&bytes), AUTHLIB_INJECTOR_SHA256);
        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod launcher_loader_tests {
    use super::*;

    #[test]
    fn vanilla_and_fabric_are_the_only_accepted_loaders() {
        assert_eq!(LaunchLoader::parse("vanilla").unwrap(), LaunchLoader::Vanilla);
        assert_eq!(LaunchLoader::parse("Vanilla").unwrap(), LaunchLoader::Vanilla);
        assert_eq!(LaunchLoader::parse("fabric").unwrap(), LaunchLoader::Fabric);
        assert_eq!(LaunchLoader::parse("").unwrap(), LaunchLoader::Fabric);
    }

    #[test]
    fn a_server_only_loader_is_refused_with_an_explanation() {
        let error = LaunchLoader::parse("paper").expect_err("paper is a server software");
        assert!(error.contains("server"), "the message must explain why: {error}");
    }

    #[test]
    fn an_unknown_loader_is_refused_instead_of_silently_launching_fabric() {
        let error = LaunchLoader::parse("quilt").expect_err("unknown loaders must fail");
        assert!(error.contains("quilt"), "the message must name the loader: {error}");
    }

    #[test]
    fn a_vanilla_launch_uses_the_mojang_entry_point() {
        assert_eq!(
            resolve_main_class(LaunchLoader::Vanilla, Some("net.minecraft.client.main.Main"), None),
            "net.minecraft.client.main.Main"
        );
        // even without the metadata declaration the vanilla entry point is known
        assert_eq!(
            resolve_main_class(LaunchLoader::Vanilla, None, None),
            VANILLA_MAIN_CLASS
        );
    }

    #[test]
    fn a_fabric_launch_uses_the_loader_entry_point() {
        assert_eq!(
            resolve_main_class(
                LaunchLoader::Fabric,
                Some("net.minecraft.client.main.Main"),
                Some("net.fabricmc.loader.impl.launch.knot.KnotClient"),
            ),
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        // an empty loader profile must not launch an empty main class
        assert_eq!(
            resolve_main_class(LaunchLoader::Fabric, None, Some("  ")),
            VANILLA_MAIN_CLASS
        );
    }

    /// A runtime that is only HALF there must not report "ready" — this is
    /// exactly the owner's bug (the instance folder existed, the runtime did
    /// not, and the app skipped the download).
    #[test]
    fn runtime_status_reports_a_missing_runtime() {
        let base = std::env::temp_dir().join(format!(
            "voxel-runtime-status-missing-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let status = launcher_runtime_status_impl(
            base.to_string_lossy().to_string(),
            "1.20.1".to_string(),
            Some("vanilla".to_string()),
            Some("mine-rank".to_string()),
        )
        .expect("status must be computable");

        assert!(!status.ready, "an empty workspace is not a ready runtime");
        assert!(status.missing.iter().any(|m| m.contains("version metadata")));
        assert!(status.missing.iter().any(|m| m.contains("client.jar")));
        assert!(status.missing.iter().any(|m| m.contains("instance folder")));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A complete vanilla runtime (no Fabric profile at all) IS ready — the
    /// datapack project does not need a mod loader.
    #[test]
    fn runtime_status_is_ready_for_a_complete_vanilla_runtime() {
        let base = std::env::temp_dir().join(format!(
            "voxel-runtime-status-ready-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let version_dir = base.join("minecraft/versions/1.20.1");
        let libs = base.join("minecraft/libraries/com/example/lib/1.0/lib-1.0.jar");
        let asset_hash = "0123456789abcdef0123456789abcdef01234567";
        let asset = base
            .join("minecraft/assets/objects")
            .join(&asset_hash[..2])
            .join(asset_hash);
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::create_dir_all(libs.parent().unwrap()).unwrap();
        std::fs::create_dir_all(asset.parent().unwrap()).unwrap();
        std::fs::create_dir_all(
            base.join("minecraft/assets/indexes"),
        )
        .unwrap();

        std::fs::write(
            version_dir.join("version.json"),
            serde_json::json!({
                "id": "1.20.1",
                "mainClass": "net.minecraft.client.main.Main",
                "assetIndex": { "id": "5", "url": "https://example.invalid/5.json", "sha1": "" },
                "downloads": { "client": { "url": "https://example.invalid/c.jar", "sha1": "" } },
                "libraries": [{
                    "name": "com.example:lib:1.0",
                    "downloads": { "artifact": { "path": "com/example/lib/1.0/lib-1.0.jar", "url": "https://example.invalid/lib.jar", "sha1": "" } }
                }]
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(version_dir.join("client.jar"), b"client").unwrap();
        std::fs::write(libs, b"lib").unwrap();
        std::fs::write(asset, b"asset").unwrap();
        std::fs::write(
            base.join("minecraft/assets/indexes/5.json"),
            serde_json::json!({ "objects": { "minecraft/sounds/x.ogg": { "hash": asset_hash } } })
                .to_string(),
        )
        .unwrap();

        let inst = base.join("instances/mine-rank");
        std::fs::create_dir_all(inst.join("natives")).unwrap();
        std::fs::write(inst.join("natives/lib.so"), b"native").unwrap();
        std::fs::write(inst.join("options.txt"), "version:612\n").unwrap();

        let status = launcher_runtime_status_impl(
            base.to_string_lossy().to_string(),
            "1.20.1".to_string(),
            Some("vanilla".to_string()),
            Some("mine-rank".to_string()),
        )
        .expect("status must be computable");

        assert!(
            status.ready,
            "a complete vanilla runtime must be ready — missing: {:?}",
            status.missing
        );
        assert!(status.missing.is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The Fabric profile is part of a fabric runtime — and of nothing else.
    #[test]
    fn runtime_status_requires_the_fabric_profile_only_for_fabric() {
        let base = std::env::temp_dir().join(format!(
            "voxel-runtime-status-fabric-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("minecraft/versions/1.20.1")).unwrap();

        let status = launcher_runtime_status_impl(
            base.to_string_lossy().to_string(),
            "1.20.1".to_string(),
            Some("fabric".to_string()),
            None,
        )
        .expect("status must be computable");
        assert!(status
            .missing
            .iter()
            .any(|m| m.contains("fabric-profile.json")));
        let _ = std::fs::remove_dir_all(&base);
    }

    fn rule_from_json(value: serde_json::Value) -> Rule {
        serde_json::from_value(value).expect("the rule must parse")
    }

    /// The owner's game never started because the JVM received
    /// `-XstartOnFirstThread` (a macOS flag) on Linux. An `allow` rule that
    /// does NOT match must EXCLUDE the argument.
    #[test]
    fn an_allow_rule_for_another_os_excludes_the_argument() {
        let other_os = if os_name() == "linux" { "osx" } else { "linux" };
        let rules = vec![rule_from_json(serde_json::json!({
            "action": "allow",
            "os": { "name": other_os }
        }))];
        assert!(
            !rule_allows(&rules),
            "the macOS-only argument must not reach the JVM on this OS"
        );
    }

    /// The real 1.20.1 metadata, verbatim: the three conditional JVM args.
    #[test]
    fn the_real_1201_conditional_jvm_arguments_are_filtered_by_the_os() {
        let macos = vec![rule_from_json(serde_json::json!({
            "action": "allow", "os": { "name": "osx" }
        }))];
        let windows = vec![rule_from_json(serde_json::json!({
            "action": "allow", "os": { "name": "windows" }
        }))];
        let x86 = vec![rule_from_json(serde_json::json!({
            "action": "allow", "os": { "arch": "x86" }
        }))];

        let expected = match os_name() {
            "osx" => (true, false, false),
            "windows" => (false, true, false),
            _ => (false, false, false),
        };
        assert_eq!(
            (
                rule_allows(&macos),
                rule_allows(&windows),
                rule_allows(&x86)
            ),
            expected,
            "the conditional JVM arguments must follow the running OS"
        );
    }

    #[test]
    fn an_argument_without_rules_is_always_allowed() {
        assert!(rule_allows(&[]));
    }

    #[test]
    fn a_disallow_rule_removes_the_argument_on_the_matching_os() {
        let this_os = os_name();
        let rules = vec![rule_from_json(serde_json::json!({
            "action": "disallow", "os": { "name": this_os }
        }))];
        assert!(!rule_allows(&rules));
    }

    /// Feature-gated arguments (demo, quick play, custom resolution) stay
    /// off — VOXEL enables none of those features.
    #[test]
    fn feature_gated_arguments_stay_off() {
        let rules = vec![rule_from_json(serde_json::json!({
            "action": "allow", "features": { "is_demo_user": true }
        }))];
        assert!(!rule_allows(&rules));
    }

    /// Writes a minimal but REAL version.json (the shape the Mojang metadata
    /// has) so the launch plan can be built without the network.
    fn write_fake_version(base: &Path) {
        let version_dir = base.join("minecraft/versions/1.20.1");
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::write(
            version_dir.join("version.json"),
            serde_json::json!({
                "id": "1.20.1",
                "mainClass": "net.minecraft.client.main.Main",
                "assetIndex": { "id": "5", "url": "https://example.invalid/5.json", "sha1": "" },
                "downloads": { "client": { "url": "https://example.invalid/c.jar", "sha1": "" } },
                "libraries": [{
                    "name": "com.example:lib:1.0",
                    "downloads": { "artifact": { "path": "com/example/lib/1.0/lib-1.0.jar", "url": "https://example.invalid/lib.jar", "sha1": "" } }
                }],
                "arguments": {
                    "game": ["--username", "${auth_player_name}", "--versionType", "${version_type}", "--uuid", "${auth_uuid}"],
                    "jvm": ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"]
                }
            })
            .to_string(),
        )
        .unwrap();
    }

    fn fake_account() -> AccountInfo {
        AccountInfo {
            provider: AccountProvider::Microsoft,
            username: "Yua".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: "token".to_string(),
        }
    }

    /// The owner's bug, proven in a unit test: a vanilla launch must not
    /// need the Fabric profile, must use the Mojang entry point and must
    /// not leak a single `${placeholder}` into the command line.
    #[test]
    fn a_vanilla_launch_needs_no_fabric_profile_and_leaves_no_placeholder() {
        let base = std::env::temp_dir().join(format!(
            "voxel-launch-plan-vanilla-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        write_fake_version(&base);

        let plan = build_launch_plan(
            &base.to_string_lossy(),
            "mine-rank",
            "1.20.1",
            "vanilla",
            &fake_account(),
            Some("/usr/bin/java"),
            Some(4096),
        )
        .expect("the vanilla launch plan must build without a fabric profile");

        assert_eq!(plan.main_class, "net.minecraft.client.main.Main");
        assert!(plan.args.contains(&"net.minecraft.client.main.Main".to_string()));
        // the classpath is a real path list, with the client jar at the end
        let classpath = plan
            .args
            .iter()
            .position(|a| a == "-cp")
            .map(|i| plan.args[i + 1].clone())
            .expect("the classpath argument must exist");
        assert!(classpath.contains("client.jar"));
        assert!(!classpath.contains("natives-"));
        // the version type is resolved — no literal placeholder
        let version_type = plan
            .args
            .iter()
            .position(|a| a == "--versionType")
            .map(|i| plan.args[i + 1].clone())
            .expect("--versionType must exist");
        assert_eq!(version_type, "vanilla");
        assert!(
            !plan.args.iter().any(|a| a.contains("${")),
            "a placeholder reached the command line: {:?}",
            plan.args
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A fabric launch still uses the loader's own entry point.
    #[test]
    fn a_fabric_launch_uses_the_knot_client() {
        let base = std::env::temp_dir().join(format!(
            "voxel-launch-plan-fabric-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        write_fake_version(&base);
        std::fs::write(
            base.join("minecraft/versions/1.20.1/fabric-profile.json"),
            serde_json::json!({
                "id": "fabric-loader-1.20.1",
                "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
                "libraries": [],
                "arguments": { "game": [], "jvm": [] }
            })
            .to_string(),
        )
        .unwrap();

        let plan = build_launch_plan(
            &base.to_string_lossy(),
            "dark-kingdom",
            "1.20.1",
            "fabric",
            &fake_account(),
            Some("/usr/bin/java"),
            Some(4096),
        )
        .expect("the fabric launch plan must build");

        assert_eq!(
            plan.main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert!(!plan.args.iter().any(|a| a.contains("${")));
        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod e2e_tests {
    use super::*;

    /// The owner's report, proven for real: "o jogo minecraft não inicia".
    ///
    /// This starts the ACTUAL vanilla client (the official 1.20.1 runtime
    /// already in the shared cache) and waits for the game log to show the
    /// main menu. It needs a display — the owner's desktop has one.
    #[test]
    #[ignore = "e2e: starts the real Minecraft client (needs a display)"]
    fn e2e_the_vanilla_client_starts_and_reaches_the_main_menu() {
        let home = std::env::var("HOME").expect("HOME");
        let base = std::env::var("VOXEL_E2E_BASE")
            .unwrap_or_else(|_| format!("{home}/Voxel"));
        // the owner's real instance can be proven too:
        // VOXEL_E2E_SLUG=mine-rank cargo test --lib ... -- --ignored
        let slug = std::env::var("VOXEL_E2E_SLUG")
            .unwrap_or_else(|_| "e2e-vanilla-launch".to_string());

        // 1. the instance (the runtime itself is shared and already cached)
        prepare_core(&base, &slug, "1.20.1", "vanilla", "", &|_, _, _| {})
            .expect("prepare must succeed");

        // 2. the exact command the app runs
        let account = AccountInfo {
            provider: AccountProvider::Microsoft,
            username: "VOXEL_E2E".to_string(),
            uuid: "00000000000040008000000000000000".to_string(),
            access_token: "0".to_string(),
        };
        let plan = build_launch_plan(
            &base,
            &slug,
            "1.20.1",
            "vanilla",
            &account,
            Some("java"),
            Some(2048),
        )
        .expect("the launch plan must build");

        let mut command = std::process::Command::new(&plan.java);
        for arg in &plan.args {
            command.arg(arg);
        }
        command.current_dir(&plan.game_dir);
        command.env(
            "DISPLAY",
            std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string()),
        );
        let mut child = command.spawn().expect("the game process must spawn");

        // 3. the main menu: the sound engine and the resource atlases are
        //    created only after the window is really up
        let log = plan.game_dir.join("logs").join("latest.log");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        let mut reached_menu = false;
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if let Ok(text) = std::fs::read_to_string(&log) {
                if text.contains("Sound engine started")
                    || text.contains("Created: 256x256x4 minecraft:textures/atlas/blocks.png-atlas")
                {
                    reached_menu = true;
                    break;
                }
                if text.contains("Failed to start the minecraft server") {
                    break;
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("the game exited early with {status}");
                eprintln!(
                    "{}",
                    std::fs::read_to_string(&log).unwrap_or_default()
                );
                break;
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        let log_text = std::fs::read_to_string(&log).unwrap_or_default();
        assert!(
            reached_menu,
            "the client never reached the main menu — log tail:\n{}",
            log_text.lines().rev().take(25).collect::<Vec<_>>().join("\n")
        );
        eprintln!("E2E VANILLA LAUNCH OK — the client reached the main menu");
    }

    /// The owner's report, proven for real: "I cannot join any server".
    ///
    /// This starts the ACTUAL vanilla client with `--quickPlayMultiplayer`
    /// pointing at the local Mine Rank server and waits for the SERVER to
    /// register the join in its own console log. It proves the whole
    /// chain at once: the client starts, the socket opens, the handshake
    /// happens and the player appears in the world.
    ///
    /// Needs a display and a running server (the systemd user service
    /// `voxel-mine-rank.service`).
    #[test]
    #[ignore = "e2e: the real client joins the local server (needs a display + the server running)"]
    fn e2e_the_client_joins_the_local_server() {
        let home = std::env::var("HOME").expect("HOME");
        let base = std::env::var("VOXEL_E2E_BASE")
            .unwrap_or_else(|_| format!("{home}/Voxel"));
        let slug = std::env::var("VOXEL_E2E_SLUG")
            .unwrap_or_else(|_| "e2e-vanilla-launch".to_string());
        let server_log = std::env::var("VOXEL_E2E_SERVER_LOG").unwrap_or_else(|_| {
            format!("{home}/Voxel/servers/mine-rank/console.log")
        });
        let address = std::env::var("VOXEL_E2E_SERVER")
            .unwrap_or_else(|_| "127.0.0.1:25565".to_string());

        prepare_core(&base, &slug, "1.20.1", "vanilla", "", &|_, _, _| {})
            .expect("prepare must succeed");

        let account = AccountInfo {
            provider: AccountProvider::Microsoft,
            username: "VOXEL_E2E".to_string(),
            uuid: "00000000000040008000000000000000".to_string(),
            access_token: "0".to_string(),
        };
        let mut plan = build_launch_plan(
            &base,
            &slug,
            "1.20.1",
            "vanilla",
            &account,
            Some("java"),
            Some(2048),
        )
        .expect("the launch plan must build");

        // the game connects to the server by itself — the same argument
        // the official launcher uses
        plan.args.push("--quickPlayMultiplayer".to_string());
        plan.args.push(address.clone());

        // only the lines written from now on count
        let before = std::fs::read_to_string(&server_log)
            .unwrap_or_default()
            .lines()
            .count();

        let mut command = std::process::Command::new(&plan.java);
        for arg in &plan.args {
            command.arg(arg);
        }
        command.current_dir(&plan.game_dir);
        command.env(
            "DISPLAY",
            std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string()),
        );
        let mut child = command.spawn().expect("the game process must spawn");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        let mut joined = false;
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if let Ok(text) = std::fs::read_to_string(&server_log) {
                let fresh: String = text
                    .lines()
                    .skip(before)
                    .collect::<Vec<_>>()
                    .join("\n");
                if fresh.contains("joined the game") || fresh.contains("logged in with entity id")
                {
                    joined = true;
                    break;
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                eprintln!("the game exited early with {status}");
                break;
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        let fresh: String = std::fs::read_to_string(&server_log)
            .unwrap_or_default()
            .lines()
            .skip(before)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            joined,
            "the client never joined {address} — the server said:\n{fresh}"
        );
        eprintln!("E2E CLIENT JOIN OK — the client joined {address}");
    }

    /// Full launcher pipeline proof: official metadata + client jar +
    /// libraries + assets + natives extraction, warming the shared cache.
    #[test]
    #[ignore = "e2e: downloads the full Minecraft runtime (~700MB on first run)"]
    fn e2e_launcher_prepare_full() {
        let home = std::env::var("HOME").expect("HOME");
        let base = format!("{home}/VOXEL");
        std::fs::create_dir_all(&base).unwrap();

        let result = prepare_core(&base, "e2e-launch", "1.20.1", "fabric", "0.16.9", &|done, total, detail| {
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
// Runtime readiness — "can the game actually start?"
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    /// True when every artifact the launch needs is on disk.
    pub ready: bool,
    pub mc_version: String,
    pub loader: String,
    /// Human-readable list of what is still missing (empty when ready).
    pub missing: Vec<String>,
}

#[tauri::command]
pub async fn launcher_runtime_status(
    base_path: String,
    mc_version: String,
    loader: Option<String>,
    project_slug: Option<String>,
) -> Result<RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        launcher_runtime_status_impl(base_path, mc_version, loader, project_slug)
    })
    .await
    .map_err(|e| format!("status worker failed: {e}"))?
}

/// Sync impl (disk probing) — tests call this directly.
pub fn launcher_runtime_status_impl(
    base_path: String,
    mc_version: String,
    loader: Option<String>,
    project_slug: Option<String>,
) -> Result<RuntimeStatus, String> {
    let loader = LaunchLoader::parse(loader.as_deref().unwrap_or("fabric"))?;
    let base = std::path::PathBuf::from(&base_path)
        .canonicalize()
        .map_err(|e| format!("Storage base not accessible: {e}"))?;
    let version_dir = mc_versions_dir(&base).join(&mc_version);
    let mut missing: Vec<String> = Vec::new();

    let version: Option<VersionJson> = match std::fs::read(version_dir.join("version.json")) {
        Ok(bytes) => serde_json::from_slice(
            bytes
                .strip_prefix(&[0xEF, 0xBB, 0xBF][..])
                .unwrap_or(&bytes),
        )
        .ok(),
        Err(_) => None,
    };
    if version.is_none() {
        missing.push(format!("version metadata ({mc_version})"));
    }
    if !version_dir.join("client.jar").is_file() {
        missing.push("client.jar".to_string());
    }
    if loader == LaunchLoader::Fabric && !version_dir.join("fabric-profile.json").is_file() {
        missing.push("fabric-profile.json".to_string());
    }

    if let Some(version) = version.as_ref() {
        let mut missing_libs = 0usize;
        for library in &version.libraries {
            let rules = library.rules.as_deref().unwrap_or(&[]);
            if !rules.is_empty() && !rule_allows(rules) {
                continue;
            }
            if let Some(artifact) = library.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
                if artifact.path.is_empty() {
                    continue;
                }
                if !mc_libraries_dir(&base).join(&artifact.path).is_file() {
                    missing_libs += 1;
                }
            }
        }
        if missing_libs > 0 {
            missing.push(format!("{missing_libs} librar(ies)"));
        }

        if let Some(asset_index) = version.asset_index.as_ref() {
            let index_path = mc_assets_dir(&base)
                .join("indexes")
                .join(format!("{}.json", asset_index.id));
            if !index_path.is_file() {
                missing.push(format!("asset index ({})", asset_index.id));
            } else if let Ok(bytes) = std::fs::read(&index_path) {
                if let Ok(index) = serde_json::from_slice::<AssetIndex>(&bytes) {
                    let mut missing_assets = 0usize;
                    for object in index.objects.values() {
                        let path = mc_assets_dir(&base)
                            .join("objects")
                            .join(&object.hash[..2])
                            .join(&object.hash);
                        if !path.is_file() {
                            missing_assets += 1;
                        }
                    }
                    if missing_assets > 0 {
                        missing.push(format!("{missing_assets} asset(s)"));
                    }
                }
            }
        }
    }

    // The instance itself (optional): its folder, the extracted natives and
    // the options file are part of a runnable instance.
    if let Some(slug) = project_slug
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let inst = instance_dir(&base, slug);
        if !inst.is_dir() {
            missing.push("instance folder".to_string());
        } else {
            let natives_count = std::fs::read_dir(inst.join("natives"))
                .map(|entries| entries.count())
                .unwrap_or(0);
            if natives_count == 0 {
                missing.push("natives".to_string());
            }
            if !inst.join("options.txt").is_file() {
                missing.push("options.txt".to_string());
            }
        }
    }

    Ok(RuntimeStatus {
        ready: missing.is_empty(),
        mc_version,
        loader: loader.as_str().to_string(),
        missing,
    })
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
