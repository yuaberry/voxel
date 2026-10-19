//! Sandboxed project filesystem operations.
//!
//! Every command takes the storage `base_path` plus a **relative** path and
//! resolves the target inside the base — `..` components, absolute targets and
//! symlink escapes are rejected. This is the same guard the VOXEL Agent will
//! inherit in Phase 3.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB
const IGNORED_TOP_DIRS: [&str; 4] = [".git", "build", ".gradle", "run"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub content: String,
}

/// Validates a relative path against a base directory and returns the
/// canonicalized absolute target. `allow_missing` permits non-existent
/// targets (writes/creates) by canonicalizing the existing parent.
pub fn validated_path(base: &str, rel: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let rel_clean = rel.trim().trim_start_matches('/');
    if rel_clean.is_empty() {
        return Err("Empty relative path".to_string());
    }
    if rel_clean.split(['/', '\\']).any(|c| c == "..") {
        return Err("Path traversal is not allowed".to_string());
    }

    let base_canon = fs::canonicalize(base)
        .map_err(|e| format!("Base path is not accessible: {e}"))?;

    let target = base_canon.join(rel_clean);
    if target.exists() {
        let canon = fs::canonicalize(&target)
            .map_err(|e| format!("Failed to resolve target: {e}"))?;
        if !canon.starts_with(&base_canon) {
            return Err("Path escapes the workspace".to_string());
        }
        return Ok(canon);
    }

    if !allow_missing {
        return Err(format!("Path does not exist: {rel_clean}"));
    }

    // Missing target: validate via its (existing) parent
    let parent = target
        .parent()
        .ok_or_else(|| "Invalid target path".to_string())?
        .to_path_buf();
    let parent_canon = fs::canonicalize(&parent)
        .map_err(|_| format!("Parent directory does not exist: {rel_clean}"))?;
    if !parent_canon.starts_with(&base_canon) {
        return Err("Path escapes the workspace".to_string());
    }
    let name = target
        .file_name()
        .ok_or_else(|| "Target must not end with a separator".to_string())?;
    Ok(parent_canon.join(name))
}

fn validate_rel_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("Invalid name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name must not contain path separators".to_string());
    }
    Ok(())
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<FileEntry>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let meta = entry.metadata().map_err(|e| format!("Stat error: {e}"))?;

        if meta.is_dir() {
            out.push(FileEntry {
                path: rel.clone(),
                is_dir: true,
                size_bytes: 0,
            });
            walk(&entry.path(), &rel, out)?;
        } else {
            out.push(FileEntry {
                path: rel,
                is_dir: false,
                size_bytes: meta.len(),
            });
        }
    }
    Ok(())
}

/// Lists all files of a project, skipping VCS/build artifacts at the root.
#[tauri::command]
pub fn list_project_files(base_path: String, project_rel: String) -> Result<Vec<FileEntry>, String> {
    let project = validated_path(&base_path, &project_rel, false)?;
    if !project.is_dir() {
        return Err("Project directory not found".to_string());
    }

    let mut out = Vec::new();
    let entries = fs::read_dir(&project)
        .map_err(|e| format!("Failed to read project root: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| format!("Stat error: {e}"))?;

        if meta.is_dir() {
            if IGNORED_TOP_DIRS.contains(&name.as_str()) {
                continue;
            }
            out.push(FileEntry {
                path: name.clone(),
                is_dir: true,
                size_bytes: 0,
            });
            walk(&entry.path(), &name, &mut out)?;
        } else {
            out.push(FileEntry {
                path: name,
                is_dir: false,
                size_bytes: meta.len(),
            });
        }
    }

    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Reads a UTF-8 text file. Binary or oversized files are refused with a
/// clear error instead of corrupting the editor buffer.
#[tauri::command]
pub fn read_project_file(
    base_path: String,
    rel: String,
) -> Result<ReadFileResult, String> {
    let target = validated_path(&base_path, &rel, false)?;
    if !target.is_file() {
        return Err("Not a file".to_string());
    }

    let meta = fs::metadata(&target).map_err(|e| format!("Stat failed: {e}"))?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large to open in the editor ({} KB > 2048 KB)",
            meta.len() / 1024
        ));
    }

    let bytes = fs::read(&target).map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes.contains(&0u8) {
        return Err("This looks like a binary file — the editor only opens text files".to_string());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "File is not valid UTF-8 text".to_string())?;
    Ok(ReadFileResult { content })
}

#[tauri::command]
pub fn write_project_file(base_path: String, rel: String, content: String) -> Result<(), String> {
    let target = validated_path(&base_path, &rel, true)?;
    fs::write(&target, content).map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
pub fn create_project_directory(base_path: String, rel: String) -> Result<(), String> {
    let target = validated_path(&base_path, &rel, true)?;
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {e}"))
}

#[tauri::command]
pub async fn delete_project_entry(base_path: String, rel: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_project_entry_impl(base_path, rel))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn delete_project_entry_impl(base_path: String, rel: String) -> Result<(), String> {
    let target = validated_path(&base_path, &rel, false)?;

    // Refuse to delete the project root itself via relative empty-ish paths
    let base_canon = fs::canonicalize(&base_path)
        .map_err(|e| format!("Base path error: {e}"))?;
    if target == base_canon {
        return Err("Refusing to delete the workspace root".to_string());
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("Failed to delete directory: {e}"))
    } else {
        fs::remove_file(&target).map_err(|e| format!("Failed to delete file: {e}"))
    }
}

#[tauri::command]
pub fn rename_project_entry(
    base_path: String,
    rel: String,
    new_name: String,
) -> Result<(), String> {
    validate_rel_name(new_name.trim())?;
    let target = validated_path(&base_path, &rel, false)?;

    let new_name = new_name.trim();
    let parent = target
        .parent()
        .ok_or_else(|| "Invalid source path".to_string())?
        .to_path_buf();
    let destination = parent.join(new_name);
    if destination.exists() {
        return Err(format!("\"{new_name}\" already exists"));
    }
    fs::rename(&target, &destination)
        .map_err(|e| format!("Failed to rename: {e}"))
}

// ---------------------------------------------------------------------------
// Reference Board support (Fase 2) — binary-safe reads and user-initiated
// imports. Same path-guard rules as the rest of the module.
// ---------------------------------------------------------------------------

const MAX_BINARY_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_IMPORT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileBase64 {
    pub data: String,
    pub media_type: String,
    pub size_bytes: u64,
}

fn media_type_for(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
    // Minimal, dependency-free base64 (standard alphabet, padded)
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let triple = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Reads a binary file inside a project as base64 (for the AI vision layer).
#[tauri::command]
pub fn read_project_file_base64(
    base_path: String,
    rel: String,
) -> Result<FileBase64, String> {
    let target = validated_path(&base_path, &rel, false)?;
    if !target.is_file() {
        return Err("Not a file".to_string());
    }
    let meta = fs::metadata(&target).map_err(|e| format!("Stat failed: {e}"))?;
    if meta.len() > MAX_BINARY_FILE_BYTES {
        return Err("Reference image is too large (max 10 MB)".to_string());
    }

    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let bytes = fs::read(&target).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(FileBase64 {
        data: base64_encode(&bytes),
        media_type: media_type_for(&name),
        size_bytes: bytes.len() as u64,
    })
}

/// Copies a user-chosen file (from a native dialog) into the project tree.
/// The destination goes through the full path guard; the source is read-only.
#[tauri::command]
pub fn import_project_file(
    base_path: String,
    project_rel: String,
    dest_rel: String,
    source_path: String,
) -> Result<(), String> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_absolute() {
        return Err("Source path must be absolute".to_string());
    }
    let meta = fs::metadata(&source)
        .map_err(|e| format!("Source file is not accessible: {e}"))?;
    if !meta.is_file() {
        return Err("Source must be a file".to_string());
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err("File is too large to import (max 10 MB)".to_string());
    }

    // Destination: validated relative to the storage base, inside the project
    let dest_full_rel = format!("{project_rel}/{dest_rel}");
    let target = validated_path(&base_path, &dest_full_rel, true)?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }

    fs::copy(&source, &target)
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Failed to import into {}: {e}",
                target.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_encoding_matches_standard() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"hell"), "aGVsbA==");
        assert_eq!(base64_encode(b"he"), "aGU=");
        assert_eq!(base64_encode(b"h"), "aA==");
        // RFC 4648 test vector
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn rejects_traversal_in_validated_path() {
        let base = std::env::temp_dir().join(format!("nexuscraft-guard-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let err = validated_path(
            base.to_string_lossy().as_ref(),
            "projects/x/../../etc/passwd",
            false,
        );
        assert!(err.is_err());
        let _ = fs::remove_dir_all(&base);
    }
}

// ---------------------------------------------------------------------------
// VOXEL Agent tools (Phase 3) — surgical edits and project-wide search.
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    pub occurrences: u32,
    pub new_length: usize,
}

/// Find & replace inside a project file. Refuses empty needles and missing
/// occurrences with clear errors — the agent relies on those messages to
/// self-correct.
#[tauri::command]
pub fn edit_project_file(
    base_path: String,
    rel: String,
    find: String,
    replace: String,
    replace_all: bool,
) -> Result<EditResult, String> {
    if find.is_empty() {
        return Err("edit_file: \"find\" cannot be empty".to_string());
    }
    if find == replace {
        return Err("edit_file: \"find\" and \"replace\" are identical".to_string());
    }

    let target = validated_path(&base_path, &rel, false)?;
    if !target.is_file() {
        return Err(format!("edit_file: \"{rel}\" is not a file"));
    }

    let meta = fs::metadata(&target).map_err(|e| format!("Stat failed: {e}"))?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!("edit_file: \"{rel}\" is too large to edit in place"));
    }

    let content = fs::read_to_string(&target)
        .map_err(|e| format!("edit_file: read failed: {e}"))?;

    let occurrences = content.matches(&find).count() as u32;
    if occurrences == 0 {
        return Err(format!(
            "edit_file: text not found in \"{rel}\" — read the file again and match it exactly"
        ));
    }

    let updated = if replace_all {
        content.replace(&find, &replace)
    } else {
        content.replacen(&find, &replace, 1)
    };

    fs::write(&target, &updated).map_err(|e| format!("edit_file: write failed: {e}"))?;

    Ok(EditResult {
        occurrences: if replace_all { occurrences } else { 1 },
        new_length: updated.len(),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line_number: u32,
    pub line_text: String,
}

const SKIP_DIRS_SEARCH: [&str; 4] = [".git", "build", ".gradle", "run"];
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;

fn walk_search(
    dir: &Path,
    prefix: &str,
    needle: &str,
    case_sensitive: bool,
    budget: &mut u32,
    out: &mut Vec<SearchMatch>,
) -> Result<(), String> {
    if *budget == 0 {
        return Ok(());
    }
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?;

    for entry in entries {
        if *budget == 0 {
            return Ok(());
        }
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let path = entry.path();

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if meta.is_dir() {
            if SKIP_DIRS_SEARCH.contains(&name.as_str()) && prefix == "" {
                continue;
            }
            walk_search(&path, &rel, needle, case_sensitive, budget, out)?;
        } else if meta.len() <= MAX_SEARCH_FILE_BYTES {
            if let Ok(content) = fs::read_to_string(&path) {
                for (index, line) in content.lines().enumerate() {
                    let hit = if case_sensitive {
                        line.contains(needle)
                    } else {
                        line.to_lowercase().contains(&needle.to_lowercase())
                    };
                    if hit {
                        out.push(SearchMatch {
                            path: rel.clone(),
                            line_number: index as u32 + 1,
                            line_text: line.trim().chars().take(240).collect(),
                        });
                        *budget = budget.saturating_sub(1);
                        if *budget == 0 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Case-insensitive text search across the project (agent tool).
#[tauri::command]
pub async fn search_project(base_path: String, project_rel: String, query: String, case_sensitive: Option<bool>, max_results: Option<u32>) -> Result<Vec<SearchMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || search_project_impl(base_path, project_rel, query, case_sensitive, max_results))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn search_project_impl(
    base_path: String,
    project_rel: String,
    query: String,
    case_sensitive: Option<bool>,
    max_results: Option<u32>,
) -> Result<Vec<SearchMatch>, String> {
    if query.trim().is_empty() {
        return Err("search_project: query cannot be empty".to_string());
    }
    let project = validated_path(&base_path, &project_rel, false)?;
    if !project.is_dir() {
        return Err("Project directory not found".to_string());
    }

    let mut out = Vec::new();
    let mut budget = max_results.unwrap_or(50).min(200);
    walk_search(
        &project,
        "",
        query.trim(),
        case_sensitive.unwrap_or(false),
        &mut budget,
        &mut out,
    )?;
    Ok(out)
}

#[cfg(test)]
mod agent_tool_tests {
    use super::*;

    fn base(label: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "nexuscraft-agent-{}-{label}",
            std::process::id()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn edit_file_replaces_once_and_all() {
        let base = base("edit");
        fs::write(base.join("file.txt"), "alpha beta gamma beta").unwrap();

        let rel = "file.txt";
        let r = edit_project_file(
            base.to_string_lossy().to_string(),
            rel.into(),
            "beta".into(),
            "omega".into(),
            false,
        )
        .unwrap();
        assert_eq!(r.occurrences, 1);
        assert_eq!(fs::read_to_string(base.join("file.txt")).unwrap(), "alpha omega gamma beta");

        let r = edit_project_file(
            base.to_string_lossy().to_string(),
            rel.into(),
            "beta".into(),
            "omega".into(),
            true,
        )
        .unwrap();
        assert_eq!(r.occurrences, 1); // only one beta remains
        assert_eq!(fs::read_to_string(base.join("file.txt")).unwrap(), "alpha omega gamma omega");

        let err = edit_project_file(
            base.to_string_lossy().to_string(),
            rel.into(),
            "nonexistent".into(),
            "x".into(),
            false,
        );
        assert!(err.is_err());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn search_finds_matches_and_skips_artifacts() {
        let base = base("search");
        let src = base.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("Main.java"), "class Main {\n  // VOIDCUTTER here\n}\n").unwrap();
        fs::write(src.join("Other.java"), "// voidcutter lowercase\n").unwrap();
        let git_dir = base.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(git_dir.join("config"), "voidcutter should not appear").unwrap();

        let matches = search_project_impl(
            base.to_string_lossy().to_string(),
            ".".into(),
            "voidcutter".into(),
            Some(false),
            Some(50),
        )
        .unwrap();

        assert_eq!(matches.len(), 2, "case-insensitive, .git skipped");
        assert!(matches.iter().all(|m| m.path.starts_with("src/")));

        let _ = fs::remove_dir_all(&base);
    }
}

// ---------------------------------------------------------------------------
// Unified Search Engine (Super Prompt §34, Fase A) — one textual query across
// the whole workspace: projects (names AND file contents), servers,
// shaderpacks, modpacks and briefings. Every hit is a real thing on disk.
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHit {
    pub category: String, // project | server | shaderpack | modpack | file
    pub title: String,
    pub detail: String,
    pub rel_path: String,
}

pub fn search_workspace_impl(
    base_path: String,
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<WorkspaceHit>, String> {
    let q = query.trim();
    if q.len() < 2 {
        return Err("Type at least 2 characters".to_string());
    }
    let q = q.to_lowercase();
    let base = fs::canonicalize(&base_path)
        .map_err(|e| format!("Base path is not accessible: {e}"))?;
    let mut out: Vec<WorkspaceHit> = Vec::new();
    let cap = max_results.unwrap_or(40).min(120) as usize;

    // 1. projects — name match first, then their text files
    let projects = base.join("projects");
    let mut project_names: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&projects) {
        for entry in entries.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            if slug.starts_with('.') {
                continue;
            }
            project_names.push(slug.clone());
            if out.len() < cap && slug.to_lowercase().contains(&q) {
                out.push(WorkspaceHit {
                    category: "project".into(),
                    title: slug.clone(),
                    detail: "project".into(),
                    rel_path: format!("projects/{slug}"),
                });
            }
        }
    }
    // file-content search per project (budgeted, like the agent's search)
    if out.len() < cap {
        for slug in &project_names {
            if out.len() >= cap {
                break;
            }
            let mut budget = 6u32;
            let mut matches: Vec<SearchMatch> = Vec::new();
            let _ = walk_search(
                &projects.join(slug),
                "",
                q.as_str(),
                false,
                &mut budget,
                &mut matches,
            );
            for m in matches {
                if out.len() >= cap {
                    break;
                }
                let rel = format!("projects/{slug}/{}", m.path);
                out.push(WorkspaceHit {
                    category: "file".into(),
                    title: m.path.rsplit('/').next().unwrap_or(&m.path).to_string(),
                    detail: m.line_text.trim().chars().take(90).collect(),
                    rel_path: rel,
                });
            }
            if out.len() >= cap {
                break;
            }
        }
    }

    // 2. servers — real names from the manifests on disk
    if let Ok(entries) = fs::read_dir(base.join("servers")) {
        for entry in entries.filter_map(|e| e.ok()) {
            if out.len() >= cap {
                break;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            let manifest = path.join("voxel-server.json");
            if !manifest.is_file() {
                continue;
            }
            if let Ok(bytes) = fs::read(&manifest) {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or(&slug);
                    let software = v.get("software").and_then(|n| n.as_str()).unwrap_or("vanilla");
                    let mc = v.get("mcVersion").and_then(|n| n.as_str()).unwrap_or("");
                    if name.to_lowercase().contains(&q) || slug.to_lowercase().contains(&q) {
                        out.push(WorkspaceHit {
                            category: "server".into(),
                            title: name.to_string(),
                            detail: format!("{software} {mc}"),
                            rel_path: format!("servers/{slug}"),
                        });
                    }
                }
            }
        }
    }

    // 3. shaderpacks — by folder name (the manifest carries the style)
    if let Ok(entries) = fs::read_dir(base.join("shaderpacks")) {
        for entry in entries.filter_map(|e| e.ok()) {
            if out.len() >= cap {
                break;
            }
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().contains(&q) {
                out.push(WorkspaceHit {
                    category: "shaderpack".into(),
                    title: name.clone(),
                    detail: "shaderpack".into(),
                    rel_path: format!("shaderpacks/{name}"),
                });
            }
        }
    }

    // 4. modpacks — the .zip file names
    if let Ok(entries) = fs::read_dir(base.join("modpacks")) {
        for entry in entries.filter_map(|e| e.ok()) {
            if out.len() >= cap {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".zip") && name.to_lowercase().contains(&q) {
                out.push(WorkspaceHit {
                    category: "modpack".into(),
                    title: name.clone(),
                    detail: "modpack".into(),
                    rel_path: format!("modpacks/{name}"),
                });
            }
        }
    }

    Ok(out)
}

#[tauri::command]
pub async fn search_workspace(
    base_path: String,
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<WorkspaceHit>, String> {
    // walks every project's text files — off the main thread like all I/O
    tauri::async_runtime::spawn_blocking(move || {
        search_workspace_impl(base_path, query, max_results)
    })
    .await
    .map_err(|e| format!("worker failed: {e}"))?
}

#[cfg(test)]
mod search_tests {
    use super::*;

    #[test]
    fn unified_search_finds_real_things_across_categories() {
        let base = std::env::temp_dir().join(format!("voxel-usearch-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // a project with a matching file
        fs::create_dir_all(base.join("projects/dark-kingdom/src/main/java")).unwrap();
        fs::write(base.join("projects/dark-kingdom/src/main/java/ModItems.java"), "public class ModItems {\n  // VOIDCUTTER sword here\n}\n").unwrap();
        // a server with a real manifest name
        fs::create_dir_all(base.join("servers/arena-kings")).unwrap();
        fs::write(base.join("servers/arena-kings/voxel-server.json"), r#"{"slug":"arena-kings","name":"Arena Kings","software":"paper","mcVersion":"1.20.1","port":25565,"ramMb":2048,"createdAt":"20260101-00000"}"#).unwrap();
        // noise that must NOT match
        fs::create_dir_all(base.join("projects/unrelated")).unwrap();
        fs::write(base.join("projects/unrelated/src.txt"), "nothing here").unwrap();
        fs::create_dir_all(base.join("shaderpacks/Bright Days")).unwrap();
        fs::create_dir_all(base.join("modpacks")).unwrap();
        fs::write(base.join("modpacks/Kitchen Sink.zip"), b"PK").unwrap();

        let hits = search_workspace_impl(base.to_string_lossy().to_string(), "king".into(), None).unwrap();
        let categories: Vec<(String, String)> = hits.iter().map(|h| (h.category.clone(), h.title.clone())).collect();
        assert!(categories.contains(&("project".into(), "dark-kingdom".into())), "{categories:?}");
        assert!(categories.contains(&("server".into(), "Arena Kings".into())), "{categories:?}");
        assert!(categories.iter().all(|(c, _)| c != "shaderpack"), "Bright Days does not match");
        assert!(categories.iter().all(|(_, t)| t != "unrelated"));

        // file-content search: the word inside the java file
        let hits = search_workspace_impl(base.to_string_lossy().to_string(), "voidcutter".into(), None).unwrap();
        assert!(hits.iter().any(|h| h.category == "file" && h.rel_path.ends_with("ModItems.java")), "{:?}", hits.iter().map(|h| &h.rel_path).collect::<Vec<_>>());

        // too-short queries are refused honestly
        assert!(search_workspace_impl(base.to_string_lossy().to_string(), "k".into(), None).is_err());

        let _ = fs::remove_dir_all(&base);
    }
}
