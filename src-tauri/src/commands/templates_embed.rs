//! Embedded project templates.
//!
//! Template files are compiled INTO the binary (include_bytes!) — creation
//! never depends on external paths, resource bundling or the filesystem
//! layout of the dev machine. Paths may contain `{{TOKENS}}` which are
//! rendered per-project (both directory names and file names).

/// (template-relative path, raw bytes)
pub struct EmbeddedFile {
    pub path: &'static str,
    pub bytes: &'static [u8],
}

pub const FABRIC_1201_TEMPLATE: &[EmbeddedFile] = &[
    EmbeddedFile {
        path: ".gitignore",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.gitignore"),
    },
    EmbeddedFile {
        path: ".voxel/ai-memory.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/ai-memory.md"),
    },
    EmbeddedFile {
        path: ".voxel/architecture.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/architecture.md"),
    },
    EmbeddedFile {
        path: ".voxel/asset-index.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/asset-index.json"),
    },
    EmbeddedFile {
        path: ".voxel/decisions.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/decisions.md"),
    },
    EmbeddedFile {
        path: ".voxel/gameplay-bible.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/gameplay-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/lore-bible.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/lore-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/project-spec.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/project-spec.json"),
    },
    EmbeddedFile {
        path: ".voxel/style-bible.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/.voxel/style-bible.md"),
    },
    EmbeddedFile {
        path: "build.gradle",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/build.gradle"),
    },
    EmbeddedFile {
        path: "gradle.properties",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/gradle.properties"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.jar",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/gradle/wrapper/gradle-wrapper.jar"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.properties",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/gradle/wrapper/gradle-wrapper.properties"),
    },
    EmbeddedFile {
        path: "gradlew",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/gradlew"),
    },
    EmbeddedFile {
        path: "gradlew.bat",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/gradlew.bat"),
    },
    EmbeddedFile {
        path: "LICENSE",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/LICENSE"),
    },
    EmbeddedFile {
        path: "README.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/README.md"),
    },
    EmbeddedFile {
        path: "settings.gradle",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/settings.gradle"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/ModItems.java",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/ModItems.java"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/icon.png",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/icon.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/lang/en_us.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/lang/en_us.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png"),
    },
    EmbeddedFile {
        path: "CHANGELOG.md",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/CHANGELOG.md"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/advancements/root.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/advancements/root.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/fabric.mod.json",
        bytes: include_bytes!("../../templates/fabric-1.20.1-mod/src/main/resources/fabric.mod.json"),
    },
];

pub const FORGE_1201_TEMPLATE: &[EmbeddedFile] = &[
    EmbeddedFile {
        path: ".gitignore",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.gitignore"),
    },
    EmbeddedFile {
        path: ".voxel/ai-memory.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/ai-memory.md"),
    },
    EmbeddedFile {
        path: ".voxel/architecture.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/architecture.md"),
    },
    EmbeddedFile {
        path: ".voxel/asset-index.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/asset-index.json"),
    },
    EmbeddedFile {
        path: ".voxel/decisions.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/decisions.md"),
    },
    EmbeddedFile {
        path: ".voxel/gameplay-bible.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/gameplay-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/lore-bible.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/lore-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/project-spec.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/project-spec.json"),
    },
    EmbeddedFile {
        path: ".voxel/style-bible.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/.voxel/style-bible.md"),
    },
    EmbeddedFile {
        path: "CHANGELOG.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/CHANGELOG.md"),
    },
    EmbeddedFile {
        path: "LICENSE",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/LICENSE"),
    },
    EmbeddedFile {
        path: "README.md",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/README.md"),
    },
    EmbeddedFile {
        path: "build.gradle",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/build.gradle"),
    },
    EmbeddedFile {
        path: "gradle.properties",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/gradle.properties"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.jar",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/gradle/wrapper/gradle-wrapper.jar"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.properties",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/gradle/wrapper/gradle-wrapper.properties"),
    },
    EmbeddedFile {
        path: "gradlew",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/gradlew"),
    },
    EmbeddedFile {
        path: "gradlew.bat",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/gradlew.bat"),
    },
    EmbeddedFile {
        path: "settings.gradle",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/settings.gradle"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/ModItems.java",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/ModItems.java"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java"),
    },
    EmbeddedFile {
        path: "src/main/resources/META-INF/mods.toml",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/META-INF/mods.toml"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/darksteel_sword.png",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/example_item.png",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/example_item.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/icon.png",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/icon.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/lang/en_us.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/lang/en_us.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/advancements/root.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/advancements/root.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/recipes/root.json",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/recipes/root.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/pack.mcmeta",
        bytes: include_bytes!("../../templates/forge-1.20.1-mod/src/main/resources/pack.mcmeta"),
    },
];

pub const NEOFORGE_1201_TEMPLATE: &[EmbeddedFile] = &[
    EmbeddedFile {
        path: ".gitignore",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.gitignore"),
    },
    EmbeddedFile {
        path: ".voxel/ai-memory.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/ai-memory.md"),
    },
    EmbeddedFile {
        path: ".voxel/architecture.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/architecture.md"),
    },
    EmbeddedFile {
        path: ".voxel/asset-index.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/asset-index.json"),
    },
    EmbeddedFile {
        path: ".voxel/decisions.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/decisions.md"),
    },
    EmbeddedFile {
        path: ".voxel/gameplay-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/gameplay-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/lore-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/lore-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/project-spec.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/project-spec.json"),
    },
    EmbeddedFile {
        path: ".voxel/style-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/.voxel/style-bible.md"),
    },
    EmbeddedFile {
        path: "CHANGELOG.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/CHANGELOG.md"),
    },
    EmbeddedFile {
        path: "LICENSE",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/LICENSE"),
    },
    EmbeddedFile {
        path: "README.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/README.md"),
    },
    EmbeddedFile {
        path: "build.gradle",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/build.gradle"),
    },
    EmbeddedFile {
        path: "gradle.properties",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/gradle.properties"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.jar",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/gradle/wrapper/gradle-wrapper.jar"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.properties",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/gradle/wrapper/gradle-wrapper.properties"),
    },
    EmbeddedFile {
        path: "gradlew",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/gradlew"),
    },
    EmbeddedFile {
        path: "gradlew.bat",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/gradlew.bat"),
    },
    EmbeddedFile {
        path: "settings.gradle",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/settings.gradle"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/ModItems.java",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/ModItems.java"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java"),
    },
    EmbeddedFile {
        path: "src/main/resources/META-INF/mods.toml",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/META-INF/mods.toml"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/darksteel_sword.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/example_item.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/example_item.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/icon.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/icon.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/lang/en_us.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/lang/en_us.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/advancements/root.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/advancements/root.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/recipes/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/data/{{MOD_ID}}/recipes/root.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/data/{{MOD_ID}}/recipes/root.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/pack.mcmeta",
        bytes: include_bytes!("../../templates/neoforge-1.20.1-mod/src/main/resources/pack.mcmeta"),
    },
];

pub const NEOFORGE_1202_TEMPLATE: &[EmbeddedFile] = &[
    EmbeddedFile {
        path: ".gitignore",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.gitignore"),
    },
    EmbeddedFile {
        path: ".voxel/ai-memory.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/ai-memory.md"),
    },
    EmbeddedFile {
        path: ".voxel/architecture.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/architecture.md"),
    },
    EmbeddedFile {
        path: ".voxel/asset-index.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/asset-index.json"),
    },
    EmbeddedFile {
        path: ".voxel/decisions.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/decisions.md"),
    },
    EmbeddedFile {
        path: ".voxel/gameplay-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/gameplay-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/lore-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/lore-bible.md"),
    },
    EmbeddedFile {
        path: ".voxel/project-spec.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/project-spec.json"),
    },
    EmbeddedFile {
        path: ".voxel/style-bible.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/.voxel/style-bible.md"),
    },
    EmbeddedFile {
        path: "CHANGELOG.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/CHANGELOG.md"),
    },
    EmbeddedFile {
        path: "LICENSE",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/LICENSE"),
    },
    EmbeddedFile {
        path: "README.md",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/README.md"),
    },
    EmbeddedFile {
        path: "build.gradle",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/build.gradle"),
    },
    EmbeddedFile {
        path: "gradle-wrapper.jar",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradle-wrapper.jar"),
    },
    EmbeddedFile {
        path: "gradle-wrapper.properties",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradle-wrapper.properties"),
    },
    EmbeddedFile {
        path: "gradle.properties",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradle.properties"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.jar",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradle/wrapper/gradle-wrapper.jar"),
    },
    EmbeddedFile {
        path: "gradle/wrapper/gradle-wrapper.properties",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradle/wrapper/gradle-wrapper.properties"),
    },
    EmbeddedFile {
        path: "gradlew",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradlew"),
    },
    EmbeddedFile {
        path: "gradlew.bat",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/gradlew.bat"),
    },
    EmbeddedFile {
        path: "settings.gradle",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/settings.gradle"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/ModItems.java",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/java/{{PACKAGE_PATH}}/ModItems.java"),
    },
    EmbeddedFile {
        path: "src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/java/{{PACKAGE_PATH}}/{{MOD_ID_CLASS}}.java"),
    },
    EmbeddedFile {
        path: "src/main/resources/META-INF/mods.toml",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/META-INF/mods.toml"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/icon.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/assets/{{MOD_ID}}/icon.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/assets/{{MOD_ID}}/models/item/darksteel_sword.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/assets/{{MOD_ID}}/models/item/example_item.json"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/darksteel_sword.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/assets/{{MOD_ID}}/textures/item/example_item.png"),
    },
    EmbeddedFile {
        path: "src/main/resources/pack.mcmeta",
        bytes: include_bytes!("../../templates/neoforge-1.20.2-mod/src/main/resources/pack.mcmeta"),
    },
];

/// Template id -> embedded file set. Fabric, Forge and both NeoForge
/// eras register here and inherit all safety machinery.
pub fn template_files(template_id: &str) -> Result<&'static [EmbeddedFile], String> {
    match template_id {
        "fabric-1.20.1-mod" => Ok(FABRIC_1201_TEMPLATE),
        "forge-1.20.1-mod" => Ok(FORGE_1201_TEMPLATE),
        "neoforge-1.20.1-mod" => Ok(NEOFORGE_1201_TEMPLATE),
        "neoforge-1.20.2-mod" => Ok(NEOFORGE_1202_TEMPLATE),
        other => Err(format!("Unknown template \"{other}\"")),
    }
}