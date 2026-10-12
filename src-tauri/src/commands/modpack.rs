//! Modpack Creator v1 (briefing §5-adjacent / roadmap §9.5) — the honest
//! export/import loop with zero external dependency sources:
//!
//! Export: user-selected jars (built by THIS workspace's projects) and
//! shaderpacks (authored by THIS app) are bundled into one zip with a
//! manifest the app itself wrote — no third-party mods are fetched or
//! claimed.
//!
//! Import: a VOXEL-exported zip (manifest-validated, zip-slip-guarded)
//! lands its jars and shaderpacks into a prepared launcher instance.
//!
//! All paths pass through the workspace guard; zip entries are refused
//! on traversal, absolute segments and unexpected content types.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

const MANIFEST_NAME: &str = "modpack.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackModIn {
    pub project_slug: String,
    pub jar_file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackExportPayload {
    pub storage_base: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub version: String,
    pub mods: Vec<ModpackModIn>,
    pub shader_packs: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModpackManifest {
    pub name: String,
    pub version: String,
    pub mc_version: String,
    pub loader: String,
    pub mods: Vec<ManifestMod>,
    pub shader_packs: Vec<String>,
    pub created_at: String,
    pub generator: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMod {
    pub project_slug: String,
    pub file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackExportResult {
    pub zip_path: String,
    pub mod_count: usize,
    pub shader_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackImportResult {
    pub modpack_name: String,
    pub mc_version: String,
    pub loader: String,
    pub mod_count: usize,
    pub shader_count: usize,
}

/// A safe single file name (no traversal, no separators, not hidden).
fn safe_file_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
    {
        return Err(format!("Refused unsafe file name: {name:?}"));
    }
    Ok(name)
}

fn workspace_base(storage_base: &str) -> Result<PathBuf, String> {
    PathBuf::from(storage_base)
        .canonicalize()
        .map_err(|e| format!("Storage location is not accessible: {e}"))
}

fn zip_dir(writer: &mut zip::ZipWriter<fs::File>, dir: &Path, prefix: &str, options: zip::write::SimpleFileOptions) -> Result<usize, String> {
    let mut count = 0usize;
    let entries = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            fs::create_dir_all(std::env::temp_dir()).ok();
            writer.add_directory(format!("{prefix}/{name}/"), options).map_err(|e| format!("{e}"))?;
            count += zip_dir(writer, &path, &format!("{prefix}/{name}"), options)?;
        } else {
            writer.start_file(format!("{prefix}/{name}"), options).map_err(|e| format!("{e}"))?;
            let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            writer.write_all(&bytes).map_err(|e| format!("{e}"))?;
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
pub fn modpack_export(payload: ModpackExportPayload) -> Result<ModpackExportResult, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Modpack name cannot be empty".to_string());
    }
    let base = workspace_base(&payload.storage_base)?;

    // Resolve and validate every source INSIDE the workspace, before writing
    let mut mod_files: Vec<(String, PathBuf)> = Vec::new();
    for m in &payload.mods {
        let slug = safe_file_name(&m.project_slug)?;
        let jar = safe_file_name(&m.jar_file)?;
        if !jar.ends_with(".jar") {
            return Err(format!("Not a jar: {jar}"));
        }
        let src = base.join("projects").join(slug).join("build/libs").join(jar);
        if !src.is_file() {
            return Err(format!("Jar not found: projects/{slug}/build/libs/{jar}"));
        }
        mod_files.push((jar.to_string(), src));
    }
    let mut shader_dirs: Vec<(String, PathBuf)> = Vec::new();
    for s in &payload.shader_packs {
        let slug = safe_file_name(s)?;
        let dir = base.join("shaderpacks").join(slug);
        if !dir.is_dir() {
            return Err(format!("Shaderpack not found: shaderpacks/{slug}"));
        }
        shader_dirs.push((slug.to_string(), dir));
    }

    let out_dir = base.join("modpacks");
    fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create modpacks dir: {e}"))?;

    let slugified: String = name
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let zip_name = format!(
        "{}-{}.zip",
        slugified.trim_matches('-'),
        safe_file_name(&payload.version)?
    );
    let zip_path = out_dir.join(&zip_name);

    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create {}: {e}", zip_path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Manifest first — the app wrote it, the app can read it back
    let manifest = ModpackManifest {
        name: name.to_string(),
        version: payload.version.trim().to_string(),
        mc_version: payload.mc_version.trim().to_string(),
        loader: payload.loader.trim().to_string(),
        mods: payload
            .mods
            .iter()
            .map(|m| ManifestMod {
                project_slug: m.project_slug.clone(),
                file_name: m.jar_file.clone(),
            })
            .collect(),
        shader_packs: payload.shader_packs.clone(),
        created_at: chrono_now_iso(),
        generator: format!("VOXEL {}", env!("CARGO_PKG_VERSION")),
    };
    zip.start_file(MANIFEST_NAME, options).map_err(|e| format!("{e}"))?;
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    zip.write_all(&manifest_bytes).map_err(|e| format!("{e}"))?;

    for (jar, src) in &mod_files {
        zip.start_file(format!("mods/{jar}"), options).map_err(|e| format!("{e}"))?;
        let bytes = fs::read(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        zip.write_all(&bytes).map_err(|e| format!("{e}"))?;
    }
    for (slug, dir) in &shader_dirs {
        zip_dir(&mut zip, dir, &format!("shaderpacks/{slug}"), options)?;
    }
    zip.finish().map_err(|e| format!("Failed to finalize zip: {e}"))?;

    Ok(ModpackExportResult {
        zip_path: zip_path.to_string_lossy().to_string(),
        mod_count: mod_files.len(),
        shader_count: shader_dirs.len(),
    })
}

fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 2026-01-01T00:00:00Z = 1767225600; simple UTC math without chrono
    let days = now / 86400;
    let secs = now % 86400;
    let (y, mo, dd) = civil_from_days(days as i64);
    format!(
        "{y:04}-{mo:02}-{dd:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Howard Hinnant's civil-from-days algorithm (same as git.rs).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// A zip entry path is safe when it stays relative and traversal-free.
fn safe_zip_entry(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    for comp in path.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err(format!("Refused zip entry: {name:?}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn modpack_import_into(
    storage_base: String,
    zip_path: String,
    instance_slug: String,
) -> Result<ModpackImportResult, String> {
    let base = workspace_base(&storage_base)?;
    let slug = safe_file_name(&instance_slug)?;
    let instance = base.join("instances").join(slug);
    if !instance.is_dir() {
        return Err(format!("Instance \"{}\" is not prepared — open the Launcher tab and prepare it first", slug));
    }

    let zip_path = PathBuf::from(&zip_path).canonicalize()
        .map_err(|e| format!("Modpack zip not accessible: {e}"))?;
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open modpack zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Not a valid modpack zip: {e}"))?;

    // Manifest first — no manifest, no import (only VOXEL exports are claimed)
    let manifest_bytes = archive
        .by_name(MANIFEST_NAME)
        .map_err(|_| "This zip has no modpack.json — only VOXEL-exported modpacks are supported".to_string())?;
    let manifest: ModpackManifest = serde_json::from_reader(manifest_bytes)
        .map_err(|e| format!("Invalid modpack manifest: {e}"))?;
    if manifest.name.trim().is_empty() {
        return Err("Modpack manifest has no name".to_string());
    }

    let mods_dir = instance.join("mods");
    let shaders_dir = instance.join("shaderpacks");
    fs::create_dir_all(&mods_dir).map_err(|e| format!("Failed to create mods dir: {e}"))?;
    fs::create_dir_all(&shaders_dir).map_err(|e| format!("Failed to create shaderpacks dir: {e}"))?;

    let mut mod_count = 0usize;
    let mut shader_count = 0usize;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("{e}"))?;
        let name = entry.name().to_string();
        safe_zip_entry(&name)?;

        if name == MANIFEST_NAME {
            continue;
        }

        let is_jar = name.starts_with("mods/") && name.ends_with(".jar");
        let is_shader = name.starts_with("shaderpacks/");
        if !is_jar && !is_shader {
            return Err(format!("Unexpected entry in modpack: {name}"));
        }

        let (target, relative_dir): (PathBuf, String) = if is_jar {
            let file_name = name.trim_start_matches("mods/");
            safe_file_name(file_name)?;
            (mods_dir.join(file_name), "mods".to_string())
        } else {
            // shaderpacks/<pack>/<...> — rebuild the inner structure
            let rest = name.trim_start_matches("shaderpacks/");
            let mut comps = rest.split('/');
            let pack = safe_file_name(comps.next().unwrap_or(""))?;
            let inner = comps.collect::<Vec<_>>().join("/");
            let dir = shaders_dir.join(pack);
            if !inner.is_empty() && inner.ends_with('/') {
                // directory entry
                fs::create_dir_all(dir.join(inner.trim_end_matches('/')))
                    .map_err(|e| format!("mkdir: {e}"))?;
                continue;
            }
            let target = if inner.is_empty() {
                // a pack zipped as a single file (shaderpacks/<pack>.zip)
                dir.with_extension("zip");
                dir
            } else {
                dir.join(&inner)
            };
            if !target.starts_with(&shaders_dir) {
                return Err(format!("Refused shader entry escaping target: {name}"));
            }
            (target, "shaderpacks".to_string())
        };
        let _ = relative_dir;

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }

        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| format!("read {name}: {e}"))?;
        let mut out = fs::File::create(&target)
            .map_err(|e| format!("write {}: {e}", target.display()))?;
        out.write_all(&buf).map_err(|e| format!("write {}: {e}", target.display()))?;

        if is_jar {
            mod_count += 1;
        } else if entry.is_dir() {
            // directory entries were handled above; count nothing
        } else {
            shader_count += 1;
        }
    }

    Ok(ModpackImportResult {
        modpack_name: manifest.name,
        mc_version: manifest.mc_version,
        loader: manifest.loader,
        mod_count,
        shader_count,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableJar {
    pub project_slug: String,
    pub project_name: String,
    pub jar_file: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportableAssets {
    pub jars: Vec<ExportableJar>,
    pub shader_packs: Vec<String>,
}

/// Everything the export wizard can truthfully offer: jars actually built by
/// this workspace's projects and shaderpacks authored in this app.
#[tauri::command]
pub fn modpack_exportable_assets(storage_base: String) -> Result<ExportableAssets, String> {
    let base = workspace_base(&storage_base)?;
    let mut jars = Vec::new();
    let projects = base.join("projects");
    if let Ok(entries) = fs::read_dir(&projects) {
        for entry in entries.filter_map(|e| e.ok()) {
            let slug = entry.file_name().to_string_lossy().to_string();
            let libs = projects.join(&slug).join("build/libs");
            let mut best: Option<(std::time::SystemTime, String)> = None;
            if let Ok(files) = fs::read_dir(&libs) {
                for jar in files.filter_map(|j| j.ok()) {
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
            }
            if let Some((_, file_name)) = best {
                let pretty = slug.replace('-', " ");
                let project_name = pretty
                    .split_whitespace()
                    .map(|w| {
                        let mut c = w.chars();
                        match c.next() {
                            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                            None => String::new(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                jars.push(ExportableJar {
                    project_slug: slug,
                    project_name,
                    jar_file: file_name,
                });
            }
        }
    }
    jars.sort_by(|a, b| a.project_slug.cmp(&b.project_slug));

    let mut shader_packs = Vec::new();
    let shader_root = base.join("shaderpacks");
    if let Ok(entries) = fs::read_dir(&shader_root) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                shader_packs.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    shader_packs.sort();

    Ok(ExportableAssets { jars, shader_packs })
}

// ---------------------------------------------------------------------------
// Compatibility Score v2 — REAL checks by reading the manifests INSIDE the
// selected jars (local, no network): mod id duplicates, Minecraft version
// range intersections, and mixed-loader conflicts.
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[derive(Debug)]
pub struct CompatCheck {
    pub id: String,
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackCompatibility {
    pub checks: Vec<CompatCheck>,
    /// 0-100: weighted share of passed checks.
    pub score: u8,
    pub mod_count: usize,
}

#[derive(Clone)]
struct JarFacts {
    mod_id: Option<String>,
    mc_range: Option<String>,
    is_fabric: bool,
    is_java_loader: bool,
    jar_name: String,
}

/// Parses the version range formats both ecosystems use into (min, max)
/// inclusive-exclusive over dot segments: Maven `[a,b)` / `[a,)` / `[a]`,
/// SemVer-ish `>=a`, `~a` (upper = next minor), exact `a`, and `*`.
fn parse_range(range: &str) -> ((Vec<u32>, bool), (Vec<u32>, bool)) {
    let zero = (vec![0], true);
    let inf = (vec![u32::MAX], false);
    let r = range.trim();
    if r == "*" || r.is_empty() {
        return (zero, inf);
    }
    if let Some(rest) = r.strip_prefix('[').or_else(|| r.strip_prefix('(')) {
        let inclusive = r.starts_with('[');
        let close_inf = rest.ends_with(')');
        let body = rest.trim_end_matches([')', ']']);
        let mut parts = body.splitn(2, ',');
        let lo = parts.next().unwrap_or("*").trim();
        let hi = parts.next().unwrap_or("*").trim();
        let lo_v = if lo == "*" { zero.clone() } else { (parse_version(lo), inclusive) };
        let hi_v = if hi == "*" {
            inf
        } else {
            (parse_version(hi), rest.ends_with(']'))
        };
        return (lo_v, hi_v);
    }
    if let Some(v) = r.strip_prefix(">=") {
        return ((parse_version(v), true), inf);
    }
    if let Some(v) = r.strip_prefix('~') {
        let mut segs = parse_version(v);
        while segs.len() < 2 {
            segs.push(0);
        }
        let mut upper = segs.clone();
        *upper.last_mut().unwrap() += 0;
        let minor = upper.get(1).copied().unwrap_or(0) + 1;
        upper[1] = minor;
        for i in 2..upper.len() {
            upper[i] = 0;
        }
        return ((segs, true), (upper, false));
    }
    // exact version
    let v = parse_version(r);
    ((v.clone(), true), (v, true))
}

fn parse_version(v: &str) -> Vec<u32> {
    v.split('.')
        .map(|s| s.trim().split(['-', '+']).next().unwrap_or("0").parse::<u32>().unwrap_or(0))
        .collect()
}

fn cmp_versions(a: &[u32], b: &[u32]) -> std::cmp::Ordering {
    let n = a.len().max(b.len());
    for i in 0..n {
        let av = a.get(i).copied().unwrap_or(0);
        let bv = b.get(i).copied().unwrap_or(0);
        match av.cmp(&bv) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// Two ranges intersect when lower <= upper on both sides.
fn ranges_intersect(
    (lo1, inc1): (&[u32], bool),
    (hi1, inc1h): (&[u32], bool),
    (lo2, inc2): (&[u32], bool),
    (hi2, inc2h): (&[u32], bool),
) -> bool {
    // lower bound of the intersection must not pass its upper bound
    let (max_lo, lo_incl) = if cmp_versions(lo1, lo2) == std::cmp::Ordering::Greater {
        (lo1, inc1)
    } else if cmp_versions(lo1, lo2) == std::cmp::Ordering::Less {
        (lo2, inc2)
    } else {
        (lo1, inc1 && inc2)
    };
    let (min_hi, hi_incl) = if cmp_versions(hi1, hi2) == std::cmp::Ordering::Less {
        (hi1, inc1h)
    } else if cmp_versions(hi1, hi2) == std::cmp::Ordering::Greater {
        (hi2, inc2h)
    } else {
        (hi1, inc1h && inc2h)
    };
    let ord = cmp_versions(max_lo, min_hi);
    match ord {
        std::cmp::Ordering::Less => true,
        std::cmp::Ordering::Greater => false,
        std::cmp::Ordering::Equal => lo_incl && hi_incl,
    }
}

fn read_jar_facts(jar_path: &Path, jar_name: &str) -> JarFacts {
    let mut facts = JarFacts {
        mod_id: None,
        mc_range: None,
        is_fabric: false,
        is_java_loader: false,
        jar_name: jar_name.to_string(),
    };
    let Ok(file) = fs::File::open(jar_path) else { return facts };
    let Ok(mut archive) = zip::ZipArchive::new(file) else { return facts };

    if let Ok(mut entry) = archive.by_name("fabric.mod.json") {
        let mut buf = String::new();
        if std::io::Read::read_to_string(&mut entry, &mut buf).is_ok() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&buf) {
                facts.is_fabric = true;
                facts.mod_id = v.get("id").and_then(|i| i.as_str()).map(String::from);
                if let Some(depends) = v.get("depends").and_then(|d| d.as_object()) {
                    if let Some(mc) = depends.get("minecraft") {
                        facts.mc_range = mc.as_str().map(String::from);
                    }
                }
            }
        }
    }
    if let Ok(mut entry) = archive.by_name("META-INF/mods.toml") {
        let mut buf = String::new();
        if std::io::Read::read_to_string(&mut entry, &mut buf).is_ok() {
            if let Ok(v) = toml::from_str::<toml::Value>(&buf) {
                facts.is_java_loader = true;
                if let Some(mods) = v.get("mods").and_then(|m| m.as_array()) {
                    if let Some(first) = mods.first() {
                        facts.mod_id = first
                            .get("modId")
                            .and_then(|m| m.as_str())
                            .map(String::from);
                    }
                }
                if let Some(deps) = v.get("dependencies").and_then(|d| d.as_table()) {
                    for list in deps.values() {
                        if let Some(arr) = list.as_array() {
                            for dep in arr {
                                if dep.get("modId").and_then(|m| m.as_str()) == Some("minecraft") {
                                    facts.mc_range = dep
                                        .get("versionRange")
                                        .and_then(|r| r.as_str())
                                        .map(String::from);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    facts
}

#[tauri::command]
pub fn modpack_check_compatibility(
    storage_base: String,
    mods: Vec<ModpackModIn>,
) -> Result<ModpackCompatibility, String> {
    let base = workspace_base(&storage_base)?;
    let mut facts = Vec::new();
    for m in &mods {
        let slug = safe_file_name(&m.project_slug)?;
        let jar = safe_file_name(&m.jar_file)?;
        let src = base.join("projects").join(slug).join("build/libs").join(jar);
        if !src.is_file() {
            return Err(format!("Jar not found: projects/{slug}/build/libs/{jar}"));
        }
        facts.push(read_jar_facts(&src, &jar));
    }

    let mut checks = Vec::new();

    // 1. Duplicate mod ids across jars — would shadow/crash on load
    let mut seen: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for f in &facts {
        if let Some(id) = &f.mod_id {
            seen.entry(id.clone()).or_default().push(f.jar_name.clone());
        }
    }
    let dups: Vec<String> = seen
        .iter()
        .filter(|(_, jars)| jars.len() > 1)
        .map(|(id, jars)| format!("{id} ×{} ({})", jars.len(), jars.join(", ")))
        .collect();
    checks.push(CompatCheck {
        id: "unique_mod_ids".into(),
        label: "No duplicate mod ids".into(),
        passed: dups.is_empty(),
        detail: if dups.is_empty() {
            "every jar declares a distinct mod id".into()
        } else {
            dups.join("; ")
        },
    });

    // 2. Minecraft version ranges share at least one common version
    let ranged: Vec<&JarFacts> = facts.iter().filter(|f| f.mc_range.is_some()).collect();
    let mut conflicts: Vec<String> = Vec::new();
    for i in 0..ranged.len() {
        for j in (i + 1)..ranged.len() {
            let (lo1, hi1) = parse_range(ranged[i].mc_range.as_deref().unwrap());
            let (lo2, hi2) = parse_range(ranged[j].mc_range.as_deref().unwrap());
            if !ranges_intersect(
                (&lo1.0, lo1.1), (&hi1.0, hi1.1),
                (&lo2.0, lo2.1), (&hi2.0, hi2.1),
            ) {
                conflicts.push(format!(
                    "{} [{:?}] vs {} [{:?}]",
                    ranged[i].jar_name, ranged[i].mc_range,
                    ranged[j].jar_name, ranged[j].mc_range,
                ));
            }
        }
    }
    checks.push(CompatCheck {
        id: "minecraft_ranges".into(),
        label: "Minecraft version ranges overlap".into(),
        passed: conflicts.is_empty(),
        detail: if conflicts.is_empty() {
            if ranged.is_empty() {
                "no jar declares an explicit range".into()
            } else {
                format!("{} jar(s) share at least one MC version", ranged.len())
            }
        } else {
            conflicts.join("; ")
        },
    });

    // 3. One loader family — fabric.jar mixed with forge/neoforge.jar never boots
    let has_fabric = facts.iter().any(|f| f.is_fabric);
    let has_java = facts.iter().any(|f| f.is_java_loader);
    let mixed = has_fabric && has_java;
    checks.push(CompatCheck {
        id: "single_loader".into(),
        label: "Single loader family".into(),
        passed: !mixed,
        detail: if mixed {
            "fabric.mod.json and META-INF/mods.toml jars cannot load together".into()
        } else if has_fabric {
            "all fabric".into()
        } else if has_java {
            "all forge/neoforge".into()
        } else {
            "no loader manifest detected in these jars".into()
        },
    });

    let passed = checks.iter().filter(|c| c.passed).count();
    let score = if checks.is_empty() {
        100
    } else {
        (passed * 100 / checks.len()) as u8
    };
    Ok(ModpackCompatibility { checks, score, mod_count: facts.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_workspace(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!("voxel-modpack-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("projects/dark-kingdom/build/libs")).unwrap();
        fs::create_dir_all(base.join("shaderpacks/complementary-ish/shaders")).unwrap();
        fs::create_dir_all(base.join("instances/dest")).unwrap();
        fs::write(base.join("projects/dark-kingdom/build/libs/dark_kingdom-0.1.0.jar"), b"PK-fake-jar-bytes").unwrap();
        fs::write(base.join("shaderpacks/complementary-ish/shaders/composite.fsh"), b"void main(){}").unwrap();
        fs::write(base.join("shaderpacks/complementary-ish/shaders.properties"), b"test").unwrap();
        base
    }

    fn payload(base: &Path) -> ModpackExportPayload {
        ModpackExportPayload {
            storage_base: base.to_string_lossy().to_string(),
            name: "Dark Bundle".to_string(),
            mc_version: "1.20.1".to_string(),
            loader: "fabric".to_string(),
            version: "1.0.0".to_string(),
            mods: vec![ModpackModIn {
                project_slug: "dark-kingdom".to_string(),
                jar_file: "dark_kingdom-0.1.0.jar".to_string(),
            }],
            shader_packs: vec!["complementary-ish".to_string()],
        }
    }

    #[test]
    fn exports_a_valid_manifest_and_files() {
        let base = fake_workspace("export");
        let result = modpack_export(payload(&base)).unwrap();
        assert_eq!(result.mod_count, 1);
        assert_eq!(result.shader_count, 1);
        assert!(result.zip_path.ends_with("dark-bundle-1.0.0.zip"), "{}", result.zip_path);

        let file = fs::File::open(&result.zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let manifest: ModpackManifest =
            serde_json::from_reader(archive.by_name(MANIFEST_NAME).unwrap()).unwrap();
        assert_eq!(manifest.name, "Dark Bundle");
        assert_eq!(manifest.mc_version, "1.20.1");
        assert_eq!(manifest.mods.len(), 1);
        assert_eq!(manifest.mods[0].file_name, "dark_kingdom-0.1.0.jar");
        assert_eq!(manifest.shader_packs, vec!["complementary-ish".to_string()]);
        assert!(manifest.generator.starts_with("VOXEL"));

        // shader files preserved under shaderpacks/<pack>/
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"mods/dark_kingdom-0.1.0.jar".to_string()));
        assert!(names.contains(&"shaderpacks/complementary-ish/shaders/composite.fsh".to_string()));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn refuses_traversal_and_missing_sources() {
        let base = fake_workspace("guard");
        let mut p = payload(&base);
        p.mods[0].jar_file = "../escape.jar".to_string();
        assert!(modpack_export(p).is_err());

        let mut p = payload(&base);
        p.mods[0].jar_file = "does-not-exist.jar".to_string();
        assert!(modpack_export(p).is_err());

        let mut p = payload(&base);
        p.shader_packs = vec!["missing-pack".to_string()];
        assert!(modpack_export(p).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn imports_into_a_prepared_instance() {
        let base = fake_workspace("import");
        let result = modpack_export(payload(&base)).unwrap();

        let imported = modpack_import_into(
            base.to_string_lossy().to_string(),
            result.zip_path.clone(),
            "dest".to_string(),
        )
        .unwrap();
        assert_eq!(imported.modpack_name, "Dark Bundle");
        assert_eq!(imported.mod_count, 1);
        assert_eq!(imported.shader_count, 2); // composite.fsh + shaders.properties

        let jar = base.join("instances/dest/mods/dark_kingdom-0.1.0.jar");
        assert!(jar.is_file());
        assert_eq!(fs::read(&jar).unwrap(), b"PK-fake-jar-bytes");
        assert!(base.join("instances/dest/shaderpacks/complementary-ish/shaders/composite.fsh").is_file());
        let _ = fs::remove_dir_all(&base);
    }

    fn fake_jar(path: &Path, manifest: &str, manifest_path: &str) {
        let file = fs::File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(file);
        w.start_file(manifest_path, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(manifest.as_bytes()).unwrap();
        w.finish().unwrap();
    }

    #[test]
    fn compatibility_catches_duplicates_ranges_and_mixed_loaders() {
        let base = fake_workspace("compat");
        let libs = base.join("projects/dark-kingdom/build/libs");
        fake_jar(
            &libs.join("dark_kingdom-0.1.0.jar"),
            r#"{"id":"dark_kingdom","depends":{"minecraft":"~1.20.1"}}"#,
            "fabric.mod.json",
        );
        // second project: duplicate id + disjoint MC range + java loader
        fs::create_dir_all(base.join("projects/other-mod/build/libs")).unwrap();
        fake_jar(
            &base.join("projects/other-mod/build/libs/other-1.0.jar"),
            r#"
modLoader="javafml"
[[mods]]
modId="dark_kingdom"
[[dependencies.dark_kingdom]]
modId="minecraft"
versionRange="[1.21,1.22)"
"#,
            "META-INF/mods.toml",
        );
        // third: overlapping fabric jar
        fs::create_dir_all(base.join("projects/third/build/libs")).unwrap();
        fake_jar(
            &base.join("projects/third/build/libs/third-1.0.jar"),
            r#"{"id":"third_mod","depends":{"minecraft":"[1.20,1.21)"}}"#,
            "fabric.mod.json",
        );

        let result = modpack_check_compatibility(
            base.to_string_lossy().to_string(),
            vec![
                ModpackModIn { project_slug: "dark-kingdom".into(), jar_file: "dark_kingdom-0.1.0.jar".into() },
                ModpackModIn { project_slug: "other-mod".into(), jar_file: "other-1.0.jar".into() },
                ModpackModIn { project_slug: "third".into(), jar_file: "third-1.0.jar".into() },
            ],
        )
        .unwrap();
        assert_eq!(result.mod_count, 3);

        let by_id = |id: &str| result.checks.iter().find(|c| c.id == id).unwrap();
        assert!(!by_id("unique_mod_ids").passed, "duplicate dark_kingdom must fail: {}", by_id("unique_mod_ids").detail);
        assert!(!by_id("minecraft_ranges").passed, "disjoint ranges must fail: {}", by_id("minecraft_ranges").detail);
        assert!(!by_id("single_loader").passed, "fabric+forge mix must fail");
        assert_eq!(result.score, 0);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn compatibility_passes_a_clean_fabric_pair() {
        let base = fake_workspace("clean");
        let libs = base.join("projects/dark-kingdom/build/libs");
        fs::create_dir_all(base.join("projects/ally/build/libs")).unwrap();
        fake_jar(
            &base.join("projects/ally/build/libs/ally-1.0.jar"),
            r#"{"id":"ally_mod","depends":{"minecraft":"[1.20.1,1.21)"}}"#,
            "fabric.mod.json",
        );

        let result = modpack_check_compatibility(
            base.to_string_lossy().to_string(),
            vec![
                ModpackModIn { project_slug: "dark-kingdom".into(), jar_file: "dark_kingdom-0.1.0.jar".into() },
                ModpackModIn { project_slug: "ally".into(), jar_file: "ally-1.0.jar".into() },
            ],
        )
        .unwrap();
        // the fake workspace jar has no manifest — counts as "no range" (neutral)
        assert!(result.checks.iter().all(|c| c.passed), "{:?}", result.checks);
        assert_eq!(result.score, 100);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn range_parser_handles_both_ecosystems() {
        // fabric tilde
        let (lo, hi) = parse_range("~1.20.1");
        assert_eq!(lo.0, vec![1, 20, 1]);
        assert_eq!(hi.0, vec![1, 21, 0]);
        // maven half-open
        let (lo, hi) = parse_range("[1.20.1,1.21)");
        assert_eq!(lo.0, vec![1, 20, 1]);
        assert_eq!(hi.0, vec![1, 21]);
        assert!(hi.1 == false);
        // lower bound only
        let (_, hi) = parse_range(">=47");
        assert_eq!(hi.0, vec![u32::MAX]);
        // wildcards
        let (lo, hi) = parse_range("*");
        assert_eq!(lo.0, vec![0]);
        assert_eq!(hi.0, vec![u32::MAX]);
        // intersect sanity: [1.20.1,1.21) vs [1.20.5,1.20.9)
        let (lo1, hi1) = parse_range("[1.20.1,1.21)");
        let (lo2, hi2) = parse_range("[1.20.5,1.20.9)");
        assert!(ranges_intersect((&lo1.0, lo1.1), (&hi1.0, hi1.1), (&lo2.0, lo2.1), (&hi2.0, hi2.1)));
        // disjoint: [1.20,1.20.1) vs [1.21,1.22)
        let (lo1, hi1) = parse_range("[1.20,1.20.1)");
        let (lo2, hi2) = parse_range("[1.21,1.22)");
        assert!(!ranges_intersect((&lo1.0, lo1.1), (&hi1.0, hi1.1), (&lo2.0, lo2.1), (&hi2.0, hi2.1)));
    }

    #[test]
    fn import_refuses_unknown_zips_and_unprepared_instances() {
        let base = fake_workspace("refuse");
        // instance not prepared
        let err = modpack_import_into(
            base.to_string_lossy().to_string(),
            "/tmp/whatever.zip".to_string(),
            "no-such-instance".to_string(),
        );
        assert!(err.is_err());

        // zip without manifest
        let plain = base.join("plain.zip");
        let file = fs::File::create(&plain).unwrap();
        let mut w = zip::ZipWriter::new(file);
        w.start_file("random.txt", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"hello").unwrap();
        w.finish().unwrap();
        let err = modpack_import_into(
            base.to_string_lossy().to_string(),
            plain.to_string_lossy().to_string(),
            "dest".to_string(),
        );
        assert!(err.is_err());
        let _ = fs::remove_dir_all(&base);
    }
}
