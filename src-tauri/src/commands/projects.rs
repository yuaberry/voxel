//! Project creation — the only place the app writes outside an existing
//! project tree. Validates input strictly, renders a whitelisted template
//! and initializes a git repository for snapshot support.

use super::templates::{self, TemplateTokens};
use crate::commands::git;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectPayload {
    pub storage_base: String,
    pub slug: String,
    pub name: String,
    pub template: String,
    pub mod_id: String,
    pub mod_id_class: String,
    pub package: String,
    pub description: String,
    pub license: String,
    pub author: String,
    // Version Adapter Layer — resolved from the auto-updating catalog
    pub minecraft_version: String,
    pub java_release: u32,
    pub yarn_mappings: String,
    pub loader_version: String,
    pub loader_min: String,
    pub fabric_api_version: String,
    pub mc_depends: String,
    pub mappings_line: String,
    // Loader identity — must agree with the template (fabric|forge|neoforge).
    pub loader: String,
    // Resource/data pack format for the template's pack.mcmeta (15 for 1.20.1).
    pub pack_format: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResult {
    pub project_path: String,
    pub files_created: usize,
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
}

fn valid_package(package: &str) -> bool {
    !package.is_empty()
        && package.split('.').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        })
}

#[tauri::command]
pub fn create_project(payload: CreateProjectPayload) -> Result<CreateProjectResult, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if !valid_slug(&payload.slug) {
        return Err(
            "Invalid slug: use lowercase letters, digits and single hyphens (max 64 chars)"
                .to_string(),
        );
    }
    if !valid_package(&payload.package) {
        return Err(
            "Invalid Java package: segments of lowercase letters/digits/underscores, e.g. com.voxel.example"
                .to_string(),
        );
    }
    if !payload.mod_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        return Err("Invalid mod id: lowercase letters, digits and underscores only".to_string());
    }
    if payload.minecraft_version.trim().is_empty() {
        return Err("Minecraft version is required".to_string());
    }
    let valid_java = [8u32, 17, 21];
    if !valid_java.contains(&payload.java_release) {
        return Err(format!("Unsupported Java release: {}", payload.java_release));
    }
    // Template and loader must agree — defense in depth for a bug the
    // frontend can never produce (but a stale client could).
    let expected_prefix = match payload.loader.as_str() {
        "fabric" | "forge" | "neoforge" => payload.loader.as_str(),
        other => return Err(format!("Unsupported loader: {other}")),
    };
    if !payload.template.starts_with(expected_prefix) {
        return Err(format!(
            "Template \"{}\" does not match loader \"{}\"",
            payload.template, payload.loader
        ));
    }
    if payload.pack_format == 0 {
        return Err("Pack format must be a positive number".to_string());
    }

    // Resolve and lock the workspace root
    let base = PathBuf::from(&payload.storage_base)
        .canonicalize()
        .map_err(|e| format!("Storage location is not accessible: {e}"))?;

    let projects_root = base.join("projects");
    fs_ensure_dir(&projects_root)?;

    let project_dir = projects_root.join(&payload.slug);
    if project_dir.exists() {
        return Err(format!(
            "A project named \"{}\" already exists at {}",
            payload.slug,
            project_dir.display()
        ));
    }

    // Template — embedded in the binary, rendered per project
    let package_path = payload.package.replace('.', "/");
    let year = git::current_year();

    let tokens = TemplateTokens {
        mod_id: payload.mod_id.clone(),
        mod_id_class: payload.mod_id_class.clone(),
        mod_name: name.to_string(),
        slug: payload.slug.clone(),
        package: payload.package.clone(),
        package_path,
        entrypoint_class: format!("{}.{}", payload.package, payload.mod_id_class),
        author: if payload.author.trim().is_empty() {
            "Anonymous".to_string()
        } else {
            payload.author.trim().to_string()
        },
        description: if payload.description.trim().is_empty() {
            format!("{name} — a Minecraft mod")
        } else {
            payload.description.trim().to_string()
        },
        license: payload.license,
        year,
        mc_version: payload.minecraft_version.trim().to_string(),
        java_release: payload.java_release,
        java_enum: match payload.java_release {
            8 => "1_8".to_string(),
            other => other.to_string(),
        },
        java_min: format!(">={}", payload.java_release),
        yarn_mappings: payload.yarn_mappings.trim().to_string(),
        loader_version: payload.loader_version.trim().to_string(),
        loader_min: payload.loader_min.trim().to_string(),
        fabric_api_version: payload.fabric_api_version.trim().to_string(),
        mc_depends: payload.mc_depends.trim().to_string(),
        mappings_line: payload.mappings_line.trim().to_string(),
        loader_id: payload.loader.clone(),
        pack_format: payload.pack_format,
    };

    let files = templates::write_template(&payload.template, &tokens, &project_dir)?;

    // Initialize the project's git repository (snapshot backbone, AD-7).
    // Errors propagate — a project without git is not a valid project.
    let author = if payload.author.trim().is_empty() {
        "VOXEL".to_string()
    } else {
        payload.author.trim().to_string()
    };
    git::init_project_repo(&project_dir, &author)?;

    Ok(CreateProjectResult {
        project_path: project_dir.to_string_lossy().to_string(),
        files_created: files,
    })
}

fn fs_ensure_dir(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(slug: &str) -> CreateProjectPayload {
        CreateProjectPayload {
            storage_base: String::new(), // filled per-test
            slug: slug.to_string(),
            name: "Dark Kingdom".to_string(),
            template: "fabric-1.20.1-mod".to_string(),
            mod_id: "dark_kingdom".to_string(),
            mod_id_class: "DarkKingdom".to_string(),
            package: "com.voxel.darkkingdom".to_string(),
            description: "A dark medieval RPG mod".to_string(),
            license: "MIT".to_string(),
            author: "Test Author".to_string(),
            minecraft_version: "1.20.1".to_string(),
            java_release: 17,
            yarn_mappings: "1.20.1+build.10".to_string(),
            loader_version: "0.16.9".to_string(),
            loader_min: ">=0.16.0".to_string(),
            fabric_api_version: "0.92.2+1.20.1".to_string(),
            mc_depends: "~1.20.1".to_string(),
            mappings_line: "mappings \"net.fabricmc:yarn:1.20.1+build.10:v2\"".to_string(),
            loader: "fabric".to_string(),
            pack_format: 15,
        }
    }

    #[test]
    fn rejects_invalid_slugs_and_packages() {
        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.slug = "Invalid Slug".to_string();
        assert!(create_project(p).is_err());

        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.package = "Invalid.Package".to_string();
        assert!(create_project(p).is_err());

        // Template and loader must agree (stale client defense)
        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.loader = "forge".to_string();
        assert!(create_project(p).is_err(), "fabric template with forge loader must be refused");
        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.template = "forge-1.20.1-mod".to_string();
        p.loader = "fabric".to_string();
        assert!(create_project(p).is_err(), "forge template with fabric loader must be refused");
        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.loader = "quilt".to_string();
        assert!(create_project(p).is_err(), "unknown loader must be refused");

        let mut p = payload("valid-slug");
        p.storage_base = std::env::temp_dir().to_string_lossy().to_string();
        p.pack_format = 0;
        assert!(create_project(p).is_err(), "pack_format=0 must be refused");
    }

    #[test]
    fn creates_project_with_git_and_template() {
        let base = std::env::temp_dir().join(format!("nexuscraft-proj-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();

        let mut p = payload("dark-kingdom");
        p.storage_base = base.to_string_lossy().to_string();

        let result = create_project(p).unwrap();
        let project_dir = std::path::PathBuf::from(&result.project_path);
        assert!(project_dir.join("build.gradle").is_file());
        assert!(project_dir
            .join("src/main/java/com/voxel/darkkingdom/DarkKingdom.java")
            .is_file());
        assert!(project_dir.join(".git").is_dir(), "git repo must exist");
        assert!(result.files_created >= 16);

        // Duplicate slug must be refused
        let mut dup = payload("dark-kingdom");
        dup.storage_base = base.to_string_lossy().to_string();
        assert!(create_project(dup).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod e2e_tests {
    use super::*;
    use std::process::Command;

    /// Full end-to-end proof shared by every loader template: creates a real
    /// project from the embedded template and compiles it with the real
    /// Gradle wrapper. This is the acceptance criterion ("the project compiles").
    fn e2e_gradle_build(
        slug: &str,
        template: &str,
        loader: &str,
        loader_version: &str,
        mc_depends: &str,
        loader_min: &str,
    ) {
        let home = std::env::var("HOME").expect("HOME is set");
        let base = std::path::PathBuf::from(&home).join("VOXEL");
        std::fs::create_dir_all(&base).unwrap();

        // Clean slate for the e2e project only
        let _ = std::fs::remove_dir_all(base.join("projects").join(slug));

        let payload = CreateProjectPayload {
            storage_base: base.to_string_lossy().to_string(),
            slug: slug.to_string(),
            name: format!("{} E2E", loader),
            template: template.to_string(),
            mod_id: "dark_kingdom".to_string(),
            mod_id_class: "DarkKingdom".to_string(),
            package: "com.voxel.darkkingdom".to_string(),
            description: "E2E acceptance build".to_string(),
            license: "MIT".to_string(),
            author: "VOXEL E2E".to_string(),
            minecraft_version: "1.20.1".to_string(),
            java_release: 17,
            yarn_mappings: "1.20.1+build.10".to_string(),
            loader_version: loader_version.to_string(),
            loader_min: loader_min.to_string(),
            fabric_api_version: "0.92.12+1.20.1".to_string(),
            mc_depends: mc_depends.to_string(),
            mappings_line: "mappings \"net.fabricmc:yarn:1.20.1+build.10:v2\"".to_string(),
            loader: loader.to_string(),
            pack_format: 15,
        };

        let result = create_project(payload).expect("project creation must succeed");
        let project_dir = std::path::PathBuf::from(&result.project_path);

        // Warm the app's real cache so the first user build is fast
        let gradle_home = base.join(".gradle-cache");
        std::fs::create_dir_all(&gradle_home).unwrap();

        let gradlew = project_dir.join("gradlew");
        let output = Command::new(&gradlew)
            .arg("build")
            .arg("--console=plain")
            .current_dir(&project_dir)
            .env("GRADLE_USER_HOME", &gradle_home)
            .output()
            .expect("failed to run gradlew");

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            let tail = |s: &str| {
                s.chars().rev().take(4000).collect::<String>()
                    .chars().rev().collect::<String>()
            };
            panic!(
                "GRADLE BUILD FAILED ({loader}, exit {:?})\n--- stdout tail ---\n{}\n--- stderr tail ---\n{}",
                output.status.code(),
                tail(&stdout),
                tail(&stderr)
            );
        }

        // The compiled mod jar must exist
        let libs = project_dir.join("build/libs");
        let jars: Vec<_> = std::fs::read_dir(&libs)
            .expect("build/libs must exist after build")
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".jar") && !name.contains("sources"))
            .collect();
        assert!(!jars.is_empty(), "compiled jar missing in build/libs: {jars:?}");
        eprintln!("E2E OK ({loader}) — jar: {jars:?}");
    }

    #[test]
    #[ignore = "e2e: downloads Gradle + Loom + deps (network; ~10 min on first run)"]
    fn e2e_gradle_build_compiles_template() {
        e2e_gradle_build(
            "e2e-dark-kingdom",
            "fabric-1.20.1-mod",
            "fabric",
            "0.16.9",
            "~1.20.1",
            ">=0.16.0",
        );
    }

    #[test]
    #[ignore = "e2e: downloads ForgeGradle + Forge userdev + decompiles MC (network; ~15 min on first run)"]
    fn e2e_gradle_build_compiles_forge() {
        e2e_gradle_build(
            "e2e-forge-kingdom",
            "forge-1.20.1-mod",
            "forge",
            "47.4.10",
            "[1.20.1,1.21)",
            "[47,)",
        );
    }

    #[test]
    #[ignore = "e2e: downloads ForgeGradle + NeoForge userdev from the NeoForged maven (network)"]
    fn e2e_gradle_build_compiles_neoforge() {
        e2e_gradle_build(
            "e2e-neoforge-kingdom",
            "neoforge-1.20.1-mod",
            "neoforge",
            "47.1.104",
            "[1.20.1,1.21)",
            "[47,)",
        );
    }
}
