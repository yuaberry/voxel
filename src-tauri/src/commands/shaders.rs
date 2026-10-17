//! Shader Studio (Pós-MVP Wave 2) — shaderpack workspace management.
//!
//! The frontend generates 100% original GLSL (style presets tuned after
//! iconic shaderpack looks) and this module materializes it on disk:
//!
//! - `shaders_create_pack` — writes the generated files under
//!   `shaderpacks/<slug>/`, one pack per slug, traversal-guarded via the
//!   shared `validated_path` with a strict extension allowlist.
//! - `shaders_list_packs` — reads the `voxel.json` manifest each
//!   (legacy packs carry `nexuscraft.json` — read as fallback).
//!   generated pack carries.
//! - `shaders_install_pack` — copies a pack into an instance's
//!   `shaderpacks/` folder (the launcher already bootstraps that folder).
//! - `shaders_list_instances` — prepared instances (marked by the
//!   launcher's `options.txt`), so the UI can offer a real install target.
//!
//! No third-party shaderpacks are downloaded or redistributed here — the
//! pack contents always come from the app's own generator.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::fs::validated_path;

const MAX_PACK_FILES: usize = 64;
const MAX_FILE_BYTES: usize = 256 * 1024;
const ALLOWED_EXTENSIONS: [&str; 5] = ["vsh", "fsh", "glsl", "properties", "json"];

#[derive(Deserialize, Clone)]
pub struct ShaderPackFile {
    /// Path relative to the pack root, e.g. `shaders/composite.fsh`.
    pub path: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShaderPackInfo {
    pub slug: String,
    pub name: String,
    pub style_id: String,
    pub created_at: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShaderInstallResult {
    pub installed_path: String,
}

fn validate_pack_slug(slug: &str) -> Result<(), String> {
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
        Err("Invalid shaderpack slug (lowercase letters, digits, single hyphens)".to_string())
    }
}

fn instance_dir(base: &Path, slug: &str) -> PathBuf {
    base.join("instances").join(slug)
}

fn check_pack_file(path: &str, content: &str) -> Result<(), String> {
    let rel = path.trim().trim_start_matches('/');
    if rel.is_empty() || rel.ends_with('/') {
        return Err("Shaderpack file path must be a file name".to_string());
    }
    if rel.split(['/', '\\']).any(|c| c == ".." || c.is_empty()) {
        return Err("Shaderpack file path escapes the pack".to_string());
    }
    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Shaderpack file type not allowed: .{ext}"));
    }
    if content.len() > MAX_FILE_BYTES {
        return Err(format!("Shaderpack file too large: {rel}"));
    }
    Ok(())
}

/// Recursively validates that every path under `src` stays inside `root`
/// (defense-in-depth against symlink swaps) and copies the tree.
fn copy_tree(root: &Path, src: &Path, dest: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("stat: {e}"))?;
        // Refuse symlinks outright inside generated packs
        if meta.file_type().is_symlink() {
            return Err("Refusing to copy symlinks".to_string());
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if meta.is_dir() {
            let child_dest = dest.join(&name);
            std::fs::create_dir_all(&child_dest).map_err(|e| format!("{e}"))?;
            copy_tree(root, &path, &child_dest)?;
        } else {
            let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err(format!("Shaderpack file too large: {name}"));
            }
            std::fs::write(dest.join(&name), bytes).map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn shaders_create_pack(
    base_path: String,
    slug: String,
    files: Vec<ShaderPackFile>,
) -> Result<ShaderPackInfo, String> {
    tauri::async_runtime::spawn_blocking(move || shaders_create_pack_impl(base_path, slug, files))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn shaders_create_pack_impl(
    base_path: String,
    slug: String,
    files: Vec<ShaderPackFile>,
) -> Result<ShaderPackInfo, String> {
    validate_pack_slug(&slug)?;
    if files.is_empty() || files.len() > MAX_PACK_FILES {
        return Err("A shaderpack needs between 1 and 64 files".to_string());
    }
    for file in &files {
        check_pack_file(&file.path, &file.content)?;
    }

    let pack_root_rel = format!("shaderpacks/{slug}");
    // Parent (`shaderpacks/`) exists via ensure_storage_dirs; the pack root
    // itself is created here, validated by the shared guard.
    let pack_root = validated_path(&base_path, &pack_root_rel, true)?;
    if pack_root.join("voxel.json").exists() || pack_root.join("nexuscraft.json").exists() {
        return Err("Shaderpack already exists".to_string());
    }
    std::fs::create_dir_all(&pack_root).map_err(|e| format!("{e}"))?;

    for file in &files {
        let rel = format!("{pack_root_rel}/{}", file.path.trim().trim_start_matches('/'));
        // Materialize the parent chain first so validated_path can
        // canonicalize it (each validated create_dir_all step).
        if let Some(idx) = rel.rfind('/') {
            let parent = validated_path(&base_path, &rel[..idx], true)?;
            std::fs::create_dir_all(&parent).map_err(|e| format!("{e}"))?;
        }
        let target = validated_path(&base_path, &rel, true)?;
        std::fs::write(&target, &file.content).map_err(|e| format!("write {}: {e}", rel))?;
    }

    // The manifest declares the metadata consumed by `shaders_list_packs`.
    let manifest: &ShaderPackFile = files
        .iter()
        .find(|f| {
            let p = f.path.trim_start_matches('/');
            p == "voxel.json" || p == "nexuscraft.json"
        })
        .ok_or_else(|| "Pack manifest voxel.json is required".to_string())?;
    let manifest_value: serde_json::Value =
        serde_json::from_str(&manifest.content).map_err(|e| format!("manifest parse: {e}"))?;
    let name = manifest_value
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("manifest: name is required")?
        .to_string();
    let style_id = manifest_value
        .get("styleId")
        .and_then(|v| v.as_str())
        .ok_or("manifest: styleId is required")?
        .to_string();
    let created_at = manifest_value
        .get("createdAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(ShaderPackInfo {
        slug,
        name,
        style_id,
        created_at,
        path: pack_root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn shaders_list_packs(base_path: String) -> Result<Vec<ShaderPackInfo>, String> {
    let root = validated_path(&base_path, "shaderpacks", false)?;
    let mut packs = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| format!("{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        if !entry.file_type().map_err(|e| format!("{e}"))?.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        if validate_pack_slug(&slug).is_err() {
            continue; // not one of ours
        }
        let manifest = entry
            .path()
            .join("voxel.json")
            .exists()
            .then(|| entry.path().join("voxel.json"))
            .unwrap_or_else(|| entry.path().join("nexuscraft.json"));
        let Ok(raw) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(name) = value.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        packs.push(ShaderPackInfo {
            name: name.to_string(),
            style_id: value
                .get("styleId")
                .and_then(|v| v.as_str())
                .unwrap_or("custom")
                .to_string(),
            created_at: value
                .get("createdAt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            path: entry.path().to_string_lossy().to_string(),
            slug,
        });
    }
    packs.sort_by(|a, b| a.created_at.cmp(&b.created_at).reverse());
    Ok(packs)
}

#[tauri::command]
pub fn shaders_delete_pack(base_path: String, slug: String) -> Result<(), String> {
    validate_pack_slug(&slug)?;
    let target = validated_path(&base_path, &format!("shaderpacks/{slug}"), false)?;
    std::fs::remove_dir_all(&target).map_err(|e| format!("delete pack: {e}"))
}

#[tauri::command]
pub async fn shaders_install_pack(
    base_path: String,
    instance_slug: String,
    pack_slug: String,
) -> Result<ShaderInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || shaders_install_pack_impl(base_path, instance_slug, pack_slug))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Sync impl — tests call this directly.
fn shaders_install_pack_impl(
    base_path: String,
    instance_slug: String,
    pack_slug: String,
) -> Result<ShaderInstallResult, String> {
    validate_pack_slug(&instance_slug)?;
    validate_pack_slug(&pack_slug)?;

    let instance = instance_dir(Path::new(&base_path), &instance_slug);
    if !instance.join("options.txt").is_file() {
        return Err("Instance not prepared — run the launcher once first".to_string());
    }

    let pack_src = validated_path(&base_path, &format!("shaderpacks/{pack_slug}"), false)?;
    let dest = instance.join("shaderpacks").join(&pack_slug);
    if dest.exists() {
        return Err("Shaderpack already installed in this instance".to_string());
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("{e}"))?;
    copy_tree(&pack_src, &pack_src, &dest)?;

    Ok(ShaderInstallResult {
        installed_path: dest.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn shaders_list_instances(base_path: String) -> Result<Vec<String>, String> {
    let root = validated_path(&base_path, "instances", false)?;
    let mut instances = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| format!("{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        let slug = entry.file_name().to_string_lossy().to_string();
        if validate_pack_slug(&slug).is_err() {
            continue;
        }
        if entry.path().join("options.txt").is_file() {
            instances.push(slug);
        }
    }
    instances.sort();
    Ok(instances)
}

// ---------------------------------------------------------------------------
// Unit tests — sandboxed temp bases (unique label per test, fs.rs pattern)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn base(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexuscraft-shaders-{}-{label}",
            std::process::id()
        ));
        std::fs::create_dir_all(dir.join("shaderpacks")).unwrap();
        std::fs::create_dir_all(dir.join("instances")).unwrap();
        dir
    }

    fn manifest(name: &str, style: &str) -> ShaderPackFile {
        ShaderPackFile {
            path: "voxel.json".into(),
            content: format!(
                r#"{{"name":"{name}","styleId":"{style}","createdAt":"2026-10-02T00:00:00Z"}}"#
            ),
        }
    }

    fn glsl_files() -> Vec<ShaderPackFile> {
        vec![
            ShaderPackFile {
                path: "shaders/composite.vsh".into(),
                content: "#version 120\nvoid main() { gl_Position = ftransform(); }".into(),
            },
            ShaderPackFile {
                path: "shaders/composite.fsh".into(),
                content: "#version 120\nvoid main() { gl_FragColor = vec4(1.0); }".into(),
            },
            manifest("Test Pack", "bsl"),
        ]
    }

    #[test]
    fn slug_validation_rejects_bad_slugs() {
        assert!(validate_pack_slug("bsl-inspired").is_ok());
        assert!(validate_pack_slug("").is_err());
        assert!(validate_pack_slug("-nope").is_err());
        assert!(validate_pack_slug("Nope").is_err());
        assert!(validate_pack_slug("../escape").is_err());
    }

    #[test]
    fn create_list_and_delete_roundtrip() {
        let base = base("roundtrip");
        let info = shaders_create_pack_impl(
            base.to_string_lossy().to_string(),
            "my-pack".into(),
            glsl_files(),
        )
        .unwrap();
        assert_eq!(info.name, "Test Pack");
        assert_eq!(info.style_id, "bsl");
        assert!(base.join("shaderpacks/my-pack/shaders/composite.fsh").is_file());

        let packs = shaders_list_packs(base.to_string_lossy().to_string()).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].slug, "my-pack");

        shaders_delete_pack(base.to_string_lossy().to_string(), "my-pack".into()).unwrap();
        assert!(!base.join("shaderpacks/my-pack").exists());
        assert!(shaders_list_packs(base.to_string_lossy().to_string()).unwrap().is_empty());
    }

    #[test]
    fn traversal_and_bad_extensions_are_refused() {
        let base = base("guards");
        let mut evil = glsl_files();
        evil.push(ShaderPackFile {
            path: "shaders/../../escape.txt".into(),
            content: "x".into(),
        });
        assert!(shaders_create_pack_impl(
            base.to_string_lossy().to_string(),
            "evil".into(),
            evil
        )
        .is_err());

        let mut exe = glsl_files();
        exe.push(ShaderPackFile {
            path: "shaders/payload.exe".into(),
            content: "x".into(),
        });
        assert!(shaders_create_pack_impl(
            base.to_string_lossy().to_string(),
            "exe".into(),
            exe
        )
        .is_err());

        assert!(!base.join("shaderpacks/evil").exists());
        assert!(!base.join("shaderpacks/exe").exists());
    }

    #[test]
    fn duplicate_pack_is_refused_and_original_survives() {
        let base = base("dup");
        let args = base.to_string_lossy().to_string();
        shaders_create_pack_impl(args.clone(), "dup-pack".into(), glsl_files()).unwrap();

        // Packs are immutable — a second create over the same slug is refused
        let second = shaders_create_pack_impl(args, "dup-pack".into(), glsl_files());
        assert!(second.is_err());
        assert!(base.join("shaderpacks/dup-pack/voxel.json").is_file());
        assert_eq!(
            std::fs::read_to_string(base.join("shaderpacks/dup-pack/shaders/composite.fsh"))
                .unwrap(),
            "#version 120\nvoid main() { gl_FragColor = vec4(1.0); }"
        );
    }

    #[test]
    fn install_requires_prepared_instance_and_copies_tree() {
        let base = base("install");
        let args = base.to_string_lossy().to_string();
        shaders_create_pack_impl(args.clone(), "pack-a".into(), glsl_files()).unwrap();

        // Unprepared instance is refused
        std::fs::create_dir_all(base.join("instances/bare")).unwrap();
        assert!(shaders_install_pack_impl(args.clone(), "bare".into(), "pack-a".into()).is_err());

        // Prepared instance (options.txt marker, launcher bootstrap) works
        let inst = base.join("instances/ready");
        std::fs::create_dir_all(inst.join("shaderpacks")).unwrap();
        std::fs::write(inst.join("options.txt"), "version:612\n").unwrap();
        let result = shaders_install_pack_impl(args.clone(), "ready".into(), "pack-a".into()).unwrap();
        assert!(result.installed_path.contains("shaderpacks"));
        assert!(inst.join("shaderpacks/pack-a/shaders/composite.vsh").is_file());

        // Re-install is refused
        assert!(shaders_install_pack_impl(args.clone(), "ready".into(), "pack-a".into()).is_err());

        // Instance listing only reports prepared ones
        let instances = shaders_list_instances(args).unwrap();
        assert_eq!(instances, vec!["ready".to_string()]);
    }
}
