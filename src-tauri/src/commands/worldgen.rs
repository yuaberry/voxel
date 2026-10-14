//! World Studio v1 (roadmap §9.6, the world slice) — REAL custom
//! dimensions as datapack files inside the project's mod jar.
//!
//! A dimension is two JSONs in the datapack: dimension_type (the physics of
//! the realm) and dimension (how it generates). Both are written with
//! era-factual schemas — the supported range is 1.20.1-1.21.1 (the schema
//! changed in 1.21.2+; refusing is more honest than shipping something
//! that might not load).
//!
//! Four presets, each a real place you can /locate or travel to in-game.

use crate::commands::fs::validated_path;
use serde_json::json;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum WorldPreset {
    EternalRealm,
    Depths,
    EmberWastes,
    VoidSanctum,
}

impl WorldPreset {
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "eternal_realm" => WorldPreset::EternalRealm,
            "depths" => WorldPreset::Depths,
            "ember_wastes" => WorldPreset::EmberWastes,
            "void_sanctum" => WorldPreset::VoidSanctum,
            _ => return None,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionGenPayload {
    pub storage_base: String,
    pub project_rel: String,
    pub dimension_id: String,
    pub preset: String,
    pub mc_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionGenResult {
    pub dimension_type_path: String,
    pub dimension_path: String,
    pub traits: Vec<String>,
}

fn safe_dimension_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        || id.starts_with(|c: char| !c.is_ascii_alphabetic())
    {
        return Err(format!("Invalid dimension id: {id:?} (lowercase snake_case)"));
    }
    Ok(())
}

/// The dimension schema is era-stable for 1.20.1-1.21.1.
fn supported_version(mc: &str) -> Result<(), String> {
    let parts: Vec<u32> = mc
        .trim()
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    let (major, minor, patch) = (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    );
    let at_least_1201 = (major, minor, patch) >= (1, 20, 1);
    let before_1212 = (major, minor, patch) < (1, 21, 2);
    if !at_least_1201 {
        return Err(format!(
            "Custom dimensions need Minecraft 1.20.1+ (got {mc})"
        ));
    }
    if !before_1212 {
        return Err(
            "The dimension datapack schema changed in 1.21.2+ — this generator covers 1.20.1-1.21.1 honestly".to_string(),
        );
    }
    Ok(())
}

/// The physics of the realm (data/<ns>/dimension_type/<id>.json).
fn dimension_type_json(preset: WorldPreset, mod_id: &str, dimension_id: &str) -> serde_json::Value {
    let (ambient, fixed_time, has_skylight, has_ceiling, ultrawarm, bed_works, anchor_works, effects, height, min_y) = match preset {
        // Eternal dusk: sky above, never quite night, safe beds
        WorldPreset::EternalRealm => (0.5, Some(13000), true, false, false, true, false, "minecraft:overworld", 384, -64),
        // Underground expanse: no sky, always midnight
        WorldPreset::Depths => (0.1, Some(18000), false, true, false, false, false, "minecraft:overworld", 384, -64),
        // Nether-like furnace: ultrawarm, anchors instead of beds
        WorldPreset::EmberWastes => (0.1, Some(18000), false, true, true, false, true, "minecraft:nether", 256, 0),
        // The void: a 256-tall canvas on flat nothing
        WorldPreset::VoidSanctum => (0.6, None, true, false, false, true, false, "minecraft:overworld", 256, 0),
    };
    json!({
        "ultrawarm": ultrawarm,
        "natural": preset != WorldPreset::EmberWastes,
        "coordinate_scale": if preset == WorldPreset::EmberWastes { 8.0 } else { 1.0 },
        "has_skylight": has_skylight,
        "has_ceiling": has_ceiling,
        "ambient_light": ambient,
        "fixed_time": fixed_time,
        "monster_spawn_light_level": {
            "type": "minecraft:uniform",
            "value": { "min_inclusive": 0, "max_inclusive": 7 }
        },
        "monster_spawn_block_light_limit": 0,
        "piglin_safe": preset == WorldPreset::EmberWastes,
        "bed_works": bed_works,
        "respawn_anchor_works": anchor_works,
        "has_raids": preset == WorldPreset::EternalRealm,
        "logical_height": height,
        "min_y": min_y,
        "height": height,
        "infiniburn": if preset == WorldPreset::EmberWastes { "#minecraft:infiniburn_nether" } else { "#minecraft:infiniburn_overworld" },
        "effects": effects,
        "custom_name": { "translate": format!("dimension.{mod_id}.{dimension_id}") }
    })
}

/// How the realm generates (data/<ns>/dimension/<id>.json).
fn dimension_json(preset: WorldPreset, mod_id: &str, dimension_id: &str) -> serde_json::Value {
    let generator = match preset {
        WorldPreset::VoidSanctum => json!({
            "type": "minecraft:flat",
            "settings": {
                "layers": [],
                "biome": "minecraft:plains"
            }
        }),
        WorldPreset::EmberWastes => json!({
            "type": "minecraft:noise",
            "settings": "minecraft:nether",
            "biome_source": {
                "type": "minecraft:multi_noise",
                "preset": "minecraft:nether"
            }
        }),
        _ => json!({
            "type": "minecraft:noise",
            "settings": "minecraft:overworld",
            "biome_source": {
                "type": "minecraft:multi_noise",
                "preset": "minecraft:overworld"
            }
        }),
    };
    json!({
        "type": format!("{mod_id}:{dimension_id}"),
        "generator": generator
    })
}

fn traits_for(preset: WorldPreset) -> Vec<String> {
    match preset {
        WorldPreset::EternalRealm => vec![
            "sky above · eternal dusk (fixed 13:00)".into(),
            "beds work · raids can happen".into(),
            "384 tall (−64 → 320), overworld biomes".into(),
        ],
        WorldPreset::Depths => vec![
            "roofed underground · always midnight".into(),
            "no beds — bring a respawn plan".into(),
            "384 tall (−64 → 320), overworld biomes".into(),
        ],
        WorldPreset::EmberWastes => vec![
            "ultrawarm · 8× coordinates (nether-like)".into(),
            "respawn anchors work · piglin-safe".into(),
            "256 tall, nether biomes and generator".into(),
        ],
        WorldPreset::VoidSanctum => vec![
            "flat void canvas · zero layers".into(),
            "skylight, beds work · 256 tall (0 → 256)".into(),
            "build from nothing — plains biome light".into(),
        ],
    }
}

#[tauri::command]
pub fn worldgen_create_dimension(payload: DimensionGenPayload) -> Result<DimensionGenResult, String> {
    let preset = WorldPreset::from_str(payload.preset.trim())
        .ok_or_else(|| format!("Unknown world preset \"{}\" — use eternal_realm|depths|ember_wastes|void_sanctum", payload.preset))?;
    safe_dimension_id(&payload.dimension_id)?;
    supported_version(&payload.mc_version)?;

    let mod_id = payload
        .project_rel
        .trim()
        .trim_start_matches("projects/")
        .trim_matches('/')
        .replace('-', "_");
    safe_dimension_id(&mod_id).map_err(|e| format!("mod id from project: {e}"))?;

    let project_dir = validated_path(&payload.storage_base, payload.project_rel.trim(), false)?;
    let data_dir = project_dir.join("src/main/resources/data").join(&mod_id);

    let type_path = data_dir.join("dimension_type").join(format!("{}.json", payload.dimension_id));
    let dim_path = data_dir.join("dimension").join(format!("{}.json", payload.dimension_id));

    for target in [&type_path, &dim_path] {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
    }

    let type_json = dimension_type_json(preset, &mod_id, &payload.dimension_id);
    let dim_json = dimension_json(preset, &mod_id, &payload.dimension_id);

    // Pretty JSON, valid by construction — the same bytes the game reads
    std::fs::write(&type_path, serde_json::to_vec_pretty(&type_json).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write dimension_type: {e}"))?;
    std::fs::write(&dim_path, serde_json::to_vec_pretty(&dim_json).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write dimension: {e}"))?;

    Ok(DimensionGenResult {
        dimension_type_path: type_path.to_string_lossy().to_string(),
        dimension_path: dim_path.to_string_lossy().to_string(),
        traits: traits_for(preset),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(preset: &str, mc: &str) -> DimensionGenPayload {
        DimensionGenPayload {
            storage_base: std::env::temp_dir().to_string_lossy().to_string(),
            project_rel: "projects/dark-kingdom".to_string(),
            dimension_id: "dark_realm".to_string(),
            preset: preset.to_string(),
            mc_version: mc.to_string(),
        }
    }

    fn fake_project(base: &std::path::Path) {
        let dir = base.join("projects/dark-kingdom");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("build.gradle"), b"// test").unwrap();
    }

    #[test]
    fn every_preset_writes_valid_pair_into_the_datapack() {
        for preset in ["eternal_realm", "depths", "ember_wastes", "void_sanctum"] {
            let base = std::env::temp_dir().join(format!("voxel-dim-{}-{preset}", std::process::id()));
            std::fs::create_dir_all(&base).unwrap();
            fake_project(&base);

            let mut p = payload(preset, "1.20.1");
            p.storage_base = base.to_string_lossy().to_string();
            let result = worldgen_create_dimension(p).unwrap();

            assert!(result.dimension_type_path.contains("data/dark_kingdom/dimension_type/dark_realm.json"));
            assert!(result.dimension_path.contains("data/dark_kingdom/dimension/dark_realm.json"));
            assert!(!result.traits.is_empty());

            let type_json: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&result.dimension_type_path).unwrap()).unwrap();
            let dim_json: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&result.dimension_path).unwrap()).unwrap();

            // dimension references OUR dimension_type in the mod namespace
            assert_eq!(dim_json["type"], "dark_kingdom:dark_realm");
            assert!(type_json["height"].as_i64().unwrap() > 0);

            // preset physics hold
            match preset {
                "eternal_realm" => {
                    assert_eq!(type_json["fixed_time"], 13000);
                    assert_eq!(type_json["ambient_light"], 0.5);
                    assert_eq!(type_json["has_skylight"], true);
                }
                "depths" => {
                    assert_eq!(type_json["has_ceiling"], true);
                    assert_eq!(type_json["bed_works"], false);
                }
                "ember_wastes" => {
                    assert_eq!(type_json["ultrawarm"], true);
                    assert_eq!(type_json["respawn_anchor_works"], true);
                    assert_eq!(type_json["effects"], "minecraft:nether");
                    assert_eq!(dim_json["generator"]["settings"], "minecraft:nether");
                }
                "void_sanctum" => {
                    assert_eq!(dim_json["generator"]["type"], "minecraft:flat");
                    assert_eq!(type_json["height"], 256);
                }
                _ => unreachable!(),
            }
            let _ = std::fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn refuses_out_of_range_versions_and_bad_ids() {
        let base = std::env::temp_dir().join(format!("voxel-dim-guard-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        fake_project(&base);

        let mut p = payload("depths", "1.19.4");
        p.storage_base = base.to_string_lossy().to_string();
        assert!(worldgen_create_dimension(p).is_err());

        let mut p = payload("depths", "1.21.4");
        p.storage_base = base.to_string_lossy().to_string();
        assert!(worldgen_create_dimension(p).is_err(), "1.21.2+ schema is honestly not claimed");

        let mut p = payload("castle", "1.20.1");
        p.storage_base = base.to_string_lossy().to_string();
        assert!(worldgen_create_dimension(p).is_err());

        let mut p = payload("depths", "1.20.1");
        p.storage_base = base.to_string_lossy().to_string();
        p.dimension_id = "Bad-Id".to_string();
        assert!(worldgen_create_dimension(p).is_err());

        let mut p = payload("depths", "1.20.1");
        p.storage_base = base.to_string_lossy().to_string();
        p.project_rel = "projects/../../etc".to_string();
        assert!(worldgen_create_dimension(p).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
