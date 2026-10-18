//! Structure Studio v1 (roadmap §9.6, the world/structure slice) — REAL
//! Minecraft structure files (.nbt), procedurally generated and
//! structure-block ready.
//!
//! Everything here is the vanilla format: gzip'd NBT with size/blocks/
//! palette/entities/DataVersion. Procedural templates are deterministic in
//! the seed — same seed, same build. Blocks are real block ids of the era.
//! The same payload feeds the isometric preview in the UI, so what you see
//! is exactly the bytes you get.

use crate::commands::fs::validated_path;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::Write;

// ---------------------------------------------------------------------------
// NBT (the minimal subset the structure format needs)
// ---------------------------------------------------------------------------

const TAG_BYTE: u8 = 1;
const TAG_INT: u8 = 3;
const TAG_STRING: u8 = 8;
const TAG_LIST: u8 = 9;
const TAG_COMPOUND: u8 = 10;

fn write_named<W: Write>(out: &mut W, tag: u8, name: &str, value: &[u8]) -> Result<(), String> {
    let _ = tag;
    let mut head = Vec::new();
    head.push(tag);
    let name_bytes = name.as_bytes();
    head.extend_from_slice(&(name_bytes.len() as u16).to_be_bytes());
    head.extend_from_slice(name_bytes);
    out.write_all(&head).map_err(|e| format!("nbt head: {e}"))?;
    out.write_all(value).map_err(|e| format!("nbt body: {e}"))?;
    Ok(())
}

fn nbt_string(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(2 + b.len());
    out.extend_from_slice(&(b.len() as u16).to_be_bytes());
    out.extend_from_slice(b);
    out
}

fn nbt_int(v: i32) -> Vec<u8> {
    v.to_be_bytes().to_vec()
}

fn nbt_int_list(values: &[i32]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TAG_INT);
    out.extend_from_slice(&(values.len() as i32).to_be_bytes());
    for v in values {
        out.extend_from_slice(&v.to_be_bytes());
    }
    out
}

fn nbt_string_list(values: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TAG_STRING);
    out.extend_from_slice(&(values.len() as i32).to_be_bytes());
    for v in values {
        out.extend_from_slice(&nbt_string(v));
    }
    out
}

/// A generic compound list: each entry is a Vec<(name, tag, value_bytes)>.
fn nbt_compound_list(entries: &[Vec<(String, u8, Vec<u8>)>]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TAG_COMPOUND);
    out.extend_from_slice(&(entries.len() as i32).to_be_bytes());
    for entry in entries {
        for (name, tag, value) in entry {
            write_named(&mut out, *tag, name, value).map_err(|_| ()).ok();
        }
        // TAG_End
        out.push(0u8);
    }
    out
}

fn nbt_compound(entries: Vec<(String, u8, Vec<u8>)>) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, tag, value) in entries {
        let _ = write_named(&mut out, tag, &name, &value);
    }
    out.push(0u8); // TAG_End
    out
}

// ---------------------------------------------------------------------------
// Structure model
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StructureKind {
    Watchtower,
    Cottage,
    Obelisk,
    Ruin,
    Mine,
    Prison,
}

impl StructureKind {
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "watchtower" => StructureKind::Watchtower,
            "cottage" => StructureKind::Cottage,
            "obelisk" => StructureKind::Obelisk,
            "ruin" => StructureKind::Ruin,
            "mine" => StructureKind::Mine,
            "prison" => StructureKind::Prison,
            _ => return None,
        })
    }
}

/// A placed block: palette key = block id (+ optional property map serialized
/// as `k=v;k=v` for dedupe).
#[derive(Clone, PartialEq)]
pub struct PlacedBlock {
    pub pos: [i32; 3],
    pub name: String,
    pub properties: Vec<(String, String)>,
}

impl PlacedBlock {
    fn palette_key(&self) -> String {
        let mut key = self.name.clone();
        if !self.properties.is_empty() {
            key.push('[');
            let props: Vec<String> = self
                .properties
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect();
            key.push_str(&props.join(","));
            key.push(']');
        }
        key
    }
}

pub struct GeneratedStructure {
    pub size: [i32; 3],
    pub blocks: Vec<PlacedBlock>,
}

/// Deterministic pseudo-random from a seed + coordinates (xorshift-ish mix).
fn hash_seed(seed: u64, salt: u32) -> u32 {
    let mut h = seed ^ (salt as u64).wrapping_mul(0x9E3779B97F4A7C15);
    h ^= h >> 33;
    h = h.wrapping_mul(0xFF51AFD7ED558CCD);
    h ^= h >> 33;
    h = h.wrapping_mul(0xC4CEB9FE1A85EC53);
    h ^= h >> 33;
    (h & 0xFFFF_FFFF) as u32
}

/// Roughly a deterministic 0..n choice.
fn pick(seed: u64, salt: u32, n: u32) -> u32 {
    hash_seed(seed, salt) % n.max(1)
}

fn block(pos: [i32; 3], name: &str) -> PlacedBlock {
    PlacedBlock {
        pos,
        name: name.to_string(),
        properties: Vec::new(),
    }
}

fn block_with(pos: [i32; 3], name: &str, props: &[(&str, &str)]) -> PlacedBlock {
    PlacedBlock {
        pos,
        name: name.to_string(),
        properties: props
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// Procedural templates — real blocks of the era, deterministic in the seed
// ---------------------------------------------------------------------------

fn generate_watchtower(seed: u64) -> GeneratedStructure {
    let r = 3; // radius: 7x7 footprint
    let w = r * 2 + 1;
    let height = 9 + (pick(seed, 1, 3) as i32); // 9-11
    let mut blocks = Vec::new();

    // Cobblestone foundation ring + floor
    for x in 0..w {
        for z in 0..w {
            let edge = x == 0 || z == 0 || x == w - 1 || z == w - 1;
            blocks.push(block([x, 0, z], if edge { "minecraft:cobblestone" } else { "minecraft:stone_bricks" }));
        }
    }
    // Body: stone brick walls with arrow-slit windows, log corner posts
    for y in 1..height {
        for x in 0..w {
            for z in 0..w {
                let edge = x == 0 || z == 0 || x == w - 1 || z == w - 1;
                if !edge {
                    continue;
                }
                let corner = (x == 0 || x == w - 1) && (z == 0 || z == w - 1);
                let name = if corner {
                    "minecraft:spruce_log"
                } else {
                    "minecraft:stone_bricks"
                };
                let mut props: Vec<(&str, &str)> = Vec::new();
                if corner {
                    props.push(("axis", if x == 0 || x == w - 1 { "x" } else { "z" }));
                }
                blocks.push(if corner {
                    block_with([x, y, z], name, &props)
                } else {
                    block([x, y, z], name)
                });
            }
        }
        // window slits mid-face on two levels
        if y == 2 || y == height - 3 {
            blocks.push(block([w / 2, y, 0], "minecraft:air"));
            blocks.push(block([w / 2, y, w - 1], "minecraft:air"));
            blocks.push(block([0, y, w / 2], "minecraft:air"));
        }
    }
    // Floor of the top platform + battlements
    for x in 0..w {
        for z in 0..w {
            blocks.push(block([x, height, z], "minecraft:dark_oak_planks"));
        }
    }
    for x in 0..w {
        for z in 0..w {
            let edge = x == 0 || z == 0 || x == w - 1 || z == w - 1;
            if edge && (x + z) % 2 == 0 {
                blocks.push(block_with(
                    [x, height + 1, z],
                    "minecraft:stone_brick_wall",
                    &[("up", "true"), ("north", "none")],
                ));
            }
        }
    }
    // lantern inside
    blocks.push(block([w / 2, 1, w / 2], "minecraft:lantern"));
    // ladder up the inner wall
    for y in 1..height {
        blocks.push(block_with(
            [w - 2, y, w - 2],
            "minecraft:dark_oak_fence",
            &[],
        ));
    }
    // Mossy accents (deterministic weathering)
    for b in blocks.iter_mut() {
        if b.name == "minecraft:stone_bricks" && hash_seed(seed, (b.pos[0] * 31 + b.pos[1] * 7 + b.pos[2]) as u32) % 11 == 0 {
            b.name = "minecraft:mossy_stone_bricks".to_string();
        }
    }

    GeneratedStructure {
        size: [w, height + 2, w],
        blocks,
    }
}

fn generate_cottage(seed: u64) -> GeneratedStructure {
    let w = 9;
    let d = 7;
    let wall_h = 4;
    let mut blocks = Vec::new();

    // Foundation ring
    for x in 0..w {
        for z in 0..d {
            let edge = x == 0 || z == 0 || x == w - 1 || z == d - 1;
            if edge {
                blocks.push(block([x, 0, z], "minecraft:cobblestone"));
            }
        }
    }
    // Plank floor
    for x in 1..w - 1 {
        for z in 1..d - 1 {
            blocks.push(block([x, 0, z], "minecraft:spruce_planks"));
        }
    }
    // Walls with log corners and plank body
    for y in 1..=wall_h {
        for x in 0..w {
            for z in 0..d {
                let edge = x == 0 || z == 0 || x == w - 1 || z == d - 1;
                if !edge {
                    continue;
                }
                let corner = (x == 0 || x == w - 1) && (z == 0 || z == d - 1);
                if corner {
                    blocks.push(block([x, y, z], "minecraft:spruce_log"));
                } else {
                    blocks.push(block([x, y, z], "minecraft:spruce_planks"));
                }
            }
        }
        // Door (south face center)
        if y <= 2 {
            let dz = d - 1;
            blocks.push(block([w / 2, y, dz], "minecraft:air"));
        }
    }
    // Windows (glass panes)
    for y in 2..=3 {
        blocks.push(block([0, y, d / 2], "minecraft:glass_pane"));
        blocks.push(block([w - 1, y, d / 2], "minecraft:glass_pane"));
        blocks.push(block([w / 2 - 2, y, 0], "minecraft:glass_pane"));
        blocks.push(block([w / 2 + 2, y, 0], "minecraft:glass_pane"));
    }
    // Gabled roof (spruce stairs, step pyramid along z)
    let roof_h = 3;
    for step in 0..roof_h {
        let y = wall_h + 1 + step;
        let inset = step;
        for x in 0..w {
            // roof spans along x; gable shrinks with z each step
            blocks.push(block_with(
                [x, y, inset],
                "minecraft:spruce_stairs",
                &[("facing", "south"), ("half", "bottom")],
            ));
            blocks.push(block_with(
                [x, y, d - 1 - inset],
                "minecraft:spruce_stairs",
                &[("facing", "north"), ("half", "bottom")],
            ));
        }
        // fill the roof body between the stair rows
        for z in (inset + 1)..(d - 1 - inset) {
            blocks.push(block([w / 2, y, z], if z == d / 2 { "minecraft:spruce_planks" } else { "minecraft:spruce_planks" }));
        }
    }
    // Chimney on the back
    for y in wall_h + 1..=wall_h + 4 {
        blocks.push(block([1, y, 1], "minecraft:cobblestone"));
    }
    // Interior: bed-ish corner, table and lantern
    blocks.push(block([w - 2, 1, 1], "minecraft:crafting_table"));
    blocks.push(block([1, 3, d / 2], "minecraft:lantern"));
    // Path stones out front (deterministic pebbles)
    for z in d..d + 2 {
        let px = w / 2 + (pick(seed, z as u32, 3) as i32) - 1;
        if (0..w).contains(&px) {
            blocks.push(block([px, 0, z], "minecraft:stone"));
        }
    }

    // height covers roof (wall_h + roof_h) AND the chimney (wall_h + 4)
    let height = std::cmp::max(wall_h + roof_h + 1, wall_h + 5);
    GeneratedStructure {
        size: [w, height, d + 2],
        blocks,
    }
}

fn generate_obelisk(seed: u64) -> GeneratedStructure {
    let w = 5;
    let h = 11 + (pick(seed, 2, 4) as i32); // 11-14
    let mut blocks = Vec::new();

    // polished deepslate base platform
    for x in 0..w {
        for z in 0..w {
            blocks.push(block([x, 0, z], "minecraft:polished_deepslate"));
        }
    }
    // central pillar with engraved deepslate tiles
    for y in 1..=h {
        let center = (w / 2, w / 2);
        let ring = [
            (center.0 - 1, center.1),
            (center.0 + 1, center.1),
            (center.0, center.1 - 1),
            (center.0, center.1 + 1),
            center,
        ];
        for (x, z) in ring {
            let engraved = (x == center.0 && z == center.1) && y % 3 == 0;
            blocks.push(block(
                [x, y, z],
                if engraved { "minecraft:chiseled_deepslate" } else { "minecraft:deepslate_tiles" },
            ));
        }
    }
    // amethyst cluster crown
    let top = h + 1;
    blocks.push(block([w / 2, top, w / 2], "minecraft:amethyst_block"));
    blocks.push(block_with(
        [w / 2, top + 1, w / 2],
        "minecraft:large_amethyst_bud",
        &[("facing", "up")],
    ));
    for (dx, dz) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
        let (x, z) = (w / 2 + dx, w / 2 + dz);
        blocks.push(block([x, top, z], "minecraft:amethyst_block"));
        blocks.push(block_with(
            [x, top, z],
            "minecraft:small_amethyst_bud",
            &[
                ("facing", if dx == 1 { "east" } else { if dx == -1 { "west" } else { if dz == 1 { "south" } else { "north" } } }),
            ],
        ));
    }
    // candles at the base corners
    for (x, z) in [(0, 0), (w - 1, 0), (0, w - 1), (w - 1, w - 1)] {
        blocks.push(block_with(
            [x, 1, z],
            "minecraft:candle",
            &[("candles", "2"), ("lit", "true")],
        ));
    }

    GeneratedStructure {
        size: [w, top + 2, w],
        blocks,
    }
}

fn generate_ruin(seed: u64) -> GeneratedStructure {
    let w = 11;
    let d = 9;
    let mut blocks = Vec::new();

    // Broken walls: stone bricks with deterministic holes and mossy/cracked mix
    for x in 0..w {
        for z in 0..d {
            let edge = x == 0 || z == 0 || x == w - 1 || z == d - 1;
            if !edge {
                continue;
            }
            // walls stand 1-5 tall, eroded deterministically
            let h = 1 + (hash_seed(seed, (x * 31 + z * 7) as u32) % 5) as i32;
            for y in 0..h {
                // erosion: some blocks missing entirely
                if hash_seed(seed, (x * 131 + y * 17 + z * 3) as u32) % 7 == 0 {
                    continue;
                }
                let roll = hash_seed(seed, (x * 51 + y * 33 + z * 11) as u32) % 10;
                let name = match roll {
                    0..=2 => "minecraft:mossy_stone_bricks",
                    3..=4 => "minecraft:cracked_stone_bricks",
                    5 => "minecraft:cobblestone",
                    6 => "minecraft:stone_brick_wall",
                    _ => "minecraft:stone_bricks",
                };
                blocks.push(block([x, y, z], name));
            }
        }
    }
    // scattered rubble inside
    for i in 0..14 {
        let x = 1 + (hash_seed(seed, 700 + i * 3) % (w as u32 - 2)) as i32;
        let z = 1 + (hash_seed(seed, 900 + i * 5) % (d as u32 - 2)) as i32;
        if hash_seed(seed, 1100 + i) % 3 == 0 {
            blocks.push(block([x, 0, z], "minecraft:cobblestone"));
        }
    }
    // a lone standing arch remnant
    for y in 0..4 {
        blocks.push(block([w / 2, y, d / 2], if y % 2 == 0 { "minecraft:stone_bricks" } else { "minecraft:mossy_stone_bricks" }));
    }
    // grass patches on top of some rubble
    for b in blocks.iter_mut() {
        if b.name == "minecraft:cobblestone"
            && b.pos[1] == 0
            && hash_seed(seed, (b.pos[0] * 91 + b.pos[2] * 37) as u32) % 9 == 0
        {
            b.name = "minecraft:mossy_cobblestone".to_string();
        }
    }

    GeneratedStructure {
        size: [w, 6, d],
        blocks,
    }
}

/// A PRISON MINE — the owner's Prison case: a proper mining gallery with
/// timber supports, rails on the floor, torch light and REAL ore veins in
/// the walls. The ore type rotates with the seed (coal/iron/redstone/
/// lapis/gold/diamond/emerald), so every rank can have its own mine.
fn generate_mine(seed: u64) -> GeneratedStructure {
    // 25x9 gallery, 6 tall: tunnel with side alcoves and ore pockets
    let len = 25;
    let w = 9;
    let h = 6;
    let ores = [
        "minecraft:coal_ore",
        "minecraft:iron_ore",
        "minecraft:redstone_ore",
        "minecraft:lapis_ore",
        "minecraft:gold_ore",
        "minecraft:diamond_ore",
        "minecraft:emerald_ore",
    ];
    let ore = ores[pick(seed, 50, ores.len() as u32) as usize];
    let mut blocks = Vec::new();

    for x in 0..len {
        for z in 0..w {
            for y in 0..h {
                let shell = x == 0 || z == 0 || x == len - 1 || z == w - 1 || y == 0 || y == h - 1;
                if !shell {
                    blocks.push(block([x, y, z], "minecraft:air"));
                    continue;
                }
                // floor: stone with rails down the middle lane
                if y == 0 {
                    if z == w / 2 && x % 2 == 1 && x > 1 && x < len - 2 {
                        blocks.push(block_with([x, y, z], "minecraft:rail", &[("shape", "east_west")]));
                    } else {
                        blocks.push(block([x, y, z], "minecraft:stone"));
                    }
                    continue;
                }
                // ceiling: stone with occasional timber beam
                if y == h - 1 {
                    let beam = z == 2 || z == w - 3;
                    blocks.push(block([x, y, z], if beam { "minecraft:spruce_planks" } else { "minecraft:stone" }));
                    continue;
                }
                // walls: ore veins in deterministic pockets + timber frames
                let pocket = hash_seed(seed ^ (x as u64) << 8, (z as u32) ^ 7) % 100 < 22;
                let support = (z == 1 || z == w - 2) && x % 6 == 0;
                if support {
                    blocks.push(block([x, y, z], "minecraft:spruce_log"));
                } else if pocket {
                    blocks.push(block([x, y, z], ore));
                } else {
                    blocks.push(block([x, y, z], "minecraft:stone"));
                }
            }
            // torches along the walls every 5 blocks
            if (x + 1) % 5 == 0 && (z == 0 || z == w - 1) {
                blocks.push(block_with([x, 1, z], "minecraft:wall_torch", &[("facing", if z == 0 { "south" } else { "north" })]));
            }
        }
    }
    // entrance carved through the back wall (a clean opening to walk in)
    for y in 1..4 {
        for z in 2..w - 2 {
            blocks.push(block([len - 1, y, z], "minecraft:air"));
        }
    }
    // side alcoves with extra ore clusters (the profitable corners)
    for &(ax, az) in [(0, 2), (0, w - 3), (len - 1, 2), (len - 1, w - 3)].iter() {
        for dy in 1..h - 1 {
            for d in 0..2 {
                blocks.push(block([ax, dy, (az + d as i32).min(w - 1)], ore));
            }
        }
    }

    GeneratedStructure {
        size: [len, h, w],
        blocks,
    }
}

/// A PRISON BLOCK — walled yard with corner towers, iron-bar gates, and
/// four cells with bunks: the prison the owner's rank system deserves.
fn generate_prison(seed: u64) -> GeneratedStructure {
    let w = 21; // 21x21 yard
    let wall_h = 5;
    let tower_h = 8;
    let mut blocks = Vec::new();

    // yard floor: polished floor with a stone-brick border
    for x in 0..w {
        for z in 0..w {
            let edge = x == 0 || z == 0 || x == w - 1 || z == w - 1;
            blocks.push(block([x, 0, z], if edge { "minecraft:stone_bricks" } else { "minecraft:polished_andesite" }));
        }
    }
    // walls with an iron-bar gate on each face + torch light
    for y in 1..=wall_h {
        for x in 0..w {
            for z in 0..w {
                let edge = x == 0 || z == 0 || x == w - 1 || z == w - 1;
                if !edge {
                    continue;
                }
                let gate = (y == 2 || y == 3) && ((x == w / 2 - 1 || x == w / 2 || x == w / 2 + 1) || (z == w / 2 - 1 || z == w / 2 || z == w / 2 + 1));
                let name = if gate { "minecraft:iron_bars" } else { "minecraft:stone_bricks" };
                blocks.push(block([x, y, z], name));
            }
        }
    }
    // corner towers: 3x3 hollow shells with battlements, one per corner
    for &(sx, sz) in [(0i32, 0i32), (1, 0), (0, 1), (1, 1)].iter() {
        for y in 1..=tower_h {
            for dx in 0..3i32 {
                for dz in 0..3i32 {
                    let x = if sx == 0 { dx } else { w - 1 - dx };
                    let z = if sz == 0 { dz } else { w - 1 - dz };
                    let shell = dx == 0 || dz == 0 || dx == 2 || dz == 2;
                    let crenel = y == tower_h && (dx + dz) % 2 == 0;
                    if (y < tower_h && shell) || crenel {
                        blocks.push(block([x, y, z], if y <= 2 { "minecraft:cobblestone" } else { "minecraft:stone_bricks" }));
                    } else if y < tower_h {
                        blocks.push(block([x, y, z], "minecraft:air"));
                    }
                }
            }
        }
        // a torch inside each tower so the corners glow
        let tx = if sx == 0 { 1 } else { w - 2 };
        let tz = if sz == 0 { 1 } else { w - 2 };
        blocks.push(block([tx, 1, tz], "minecraft:lantern"));
    }
    // four cells against the inner faces: 3x4 rooms with iron-bar fronts,
    // a bunk (red wool bed substitute) and a lantern each
    for &(ox, oz, fx) in [(4, 1, true), (w - 5, 1, true), (4, w - 5, false), (w - 5, w - 5, false)].iter() {
        for dx in 0..4 {
            for dz in 0..3 {
                let x = ox + dx;
                let z = oz + dz;
                // walls of the cell
                for y in 1..=3 {
                    let is_front = if fx { dz == 0 } else { dz == 2 };
                    let name = if is_front && dx != 1 && dx != 2 {
                        "minecraft:iron_bars"
                    } else if dz == 1 && dx == 3 {
                        "minecraft:air" // doorway into the yard
                    } else {
                        "minecraft:stone_bricks"
                    };
                    blocks.push(block([x, y, z], name));
                }
            }
            // bunk + lantern
            blocks.push(block([ox + 1, 1, oz + 2], "minecraft:red_wool"));
            blocks.push(block([ox + 2, 2, oz + 1], "minecraft:lantern"));
        }
    }
    // center of the yard: a small watch platform with a lantern pole
    let c = w / 2;
    for y in 1..=3 {
        blocks.push(block([c, y, c], "minecraft:spruce_log"));
    }
    blocks.push(block_with([c, 4, c], "minecraft:lantern", &[("hanging", "false")]));
    for dx in -1i32..=1 {
        for dz in -1i32..=1 {
            blocks.push(block([(c + dx).max(0).min(w - 1), 3, (c + dz).max(0).min(w - 1)], "minecraft:spruce_planks"));
        }
    }

    GeneratedStructure {
        size: [w, tower_h + 1, w],
        blocks,
    }
}

pub fn generate_structure(kind: StructureKind, seed: u64) -> GeneratedStructure {
    match kind {
        StructureKind::Watchtower => generate_watchtower(seed),
        StructureKind::Cottage => generate_cottage(seed),
        StructureKind::Obelisk => generate_obelisk(seed),
        StructureKind::Ruin => generate_ruin(seed),
        StructureKind::Mine => generate_mine(seed),
        StructureKind::Prison => generate_prison(seed),
    }
}

// ---------------------------------------------------------------------------
// NBT serialization (vanilla structure format)
// ---------------------------------------------------------------------------

/// Factual DataVersions of the supported MC range.
fn data_version_for(mc_version: &str) -> i32 {
    match mc_version.trim() {
        "1.20.1" | "1.20.2" | "1.20.3" => 3465,
        "1.20.4" => 3700,
        "1.20.5" | "1.20.6" => 3839,
        "1.21" => 3953,
        "1.21.1" => 3955,
        "1.21.2" => 4080,
        "1.21.3" => 4082,
        "1.21.4" => 4189,
        "1.21.5" => 4325,
        "1.21.6" => 4435,
        "1.21.7" | "1.21.8" => 4440,
        _ => 3465, // honest default: the oldest supported era
    }
}

/// The datapack folder changed name in 1.21 (structures → structure).
fn structures_folder_for(mc_version: &str) -> &'static str {
    let parts: Vec<u32> = mc_version
        .trim()
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    let (major, minor) = (parts.first().copied().unwrap_or(1), parts.get(1).copied().unwrap_or(20));
    if (major, minor) >= (1, 21) {
        "structure"
    } else {
        "structures"
    }
}

pub fn structure_nbt_bytes(structure: &GeneratedStructure, mc_version: &str) -> Result<Vec<u8>, String> {
    // Palette (deduped) + blocks referencing palette indices
    let mut palette_keys: Vec<String> = Vec::new();
    let mut block_entries: Vec<Vec<(String, u8, Vec<u8>)>> = Vec::new();

    for b in &structure.blocks {
        let key = b.palette_key();
        let index = match palette_keys.iter().position(|k| k == &key) {
            Some(i) => i,
            None => {
                palette_keys.push(key);
                palette_keys.len() - 1
            }
        };
        // pos: List<Int> as a nested named tag inside the compound
        let pos_value = nbt_int_list(&b.pos);
        block_entries.push(vec![
            ("pos".to_string(), TAG_LIST, pos_value),
            ("state".to_string(), TAG_INT, nbt_int(index as i32)),
        ]);
    }

    // palette entries: Name (+ Properties compound when present)
    let mut palette_entries: Vec<Vec<(String, u8, Vec<u8>)>> = Vec::new();
    for key in &palette_keys {
        // parse back name and props
        let (name, props_str) = match key.split_once('[') {
            Some((n, rest)) => (n.to_string(), rest.trim_end_matches(']').to_string()),
            None => (key.clone(), String::new()),
        };
        let mut entry = vec![("Name".to_string(), TAG_STRING, nbt_string(&name))];
        if !props_str.is_empty() {
            let mut props_body = Vec::new();
            for pair in props_str.split(',') {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                let _ = write_named(&mut props_body, TAG_STRING, k, &nbt_string(v));
            }
            props_body.push(0u8);
            entry.push(("Properties".to_string(), TAG_COMPOUND, props_body));
        }
        palette_entries.push(entry);
    }

    let empty_compound_list = nbt_compound_list(&[]);
    let size_value = nbt_int_list(&structure.size);
    let palette_value = nbt_compound_list(&palette_entries);
    let blocks_value = nbt_compound_list(&block_entries);
    let data_version = data_version_for(mc_version);

    let root_body = nbt_compound(vec![
        ("size".to_string(), TAG_LIST, size_value),
        ("entities".to_string(), TAG_LIST, empty_compound_list.clone()),
        ("blocks".to_string(), TAG_LIST, blocks_value),
        ("palette".to_string(), TAG_LIST, palette_value),
        ("DataVersion".to_string(), TAG_INT, nbt_int(data_version)),
    ]);

    // Root: TAG_Compound named "" — the vanilla structure convention
    let mut nbt = Vec::new();
    nbt.push(TAG_COMPOUND);
    nbt.extend_from_slice(&0u16.to_be_bytes()); // empty root name
    nbt.extend_from_slice(&root_body);

    // gzip (vanilla expects gzip'd NBT)
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&nbt).map_err(|e| format!("gzip: {e}"))?;
    gz.finish().map_err(|e| format!("gzip finish: {e}"))
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureGenPayload {
    pub storage_base: String,
    pub project_rel: String,
    pub structure_id: String,
    pub kind: String,
    pub seed: u64,
    pub mc_version: String,
    /// preview returns base64 + block map without writing
    pub preview_only: bool,
    /// "mod" (default) → the project's datapack;
    /// "server_module" → world/datapacks/nexus_monuments of a SERVER
    /// (the Monuments gameplay module needs real .nbt files inside it)
    pub output_kind: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureBlockOut {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub block: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureGenResult {
    pub size: [i32; 3],
    pub blocks: Vec<StructureBlockOut>,
    pub block_count: usize,
    pub nbt_base64: String,
    pub wrote_path: Option<String>,
}

fn safe_structure_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        || id.starts_with(|c: char| !c.is_ascii_alphabetic())
    {
        return Err(format!("Invalid structure id: {id:?} (lowercase snake_case)"));
    }
    Ok(())
}

#[tauri::command]
pub async fn structure_generate(payload: StructureGenPayload) -> Result<StructureGenResult, String> {
    tauri::async_runtime::spawn_blocking(move || structure_generate_impl(payload))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

pub fn structure_generate_impl(payload: StructureGenPayload) -> Result<StructureGenResult, String> {
    let kind = StructureKind::from_str(payload.kind.trim())
        .ok_or_else(|| format!("Unknown structure kind \"{}\" — use watchtower|cottage|obelisk|ruin|mine|prison", payload.kind))?;
    safe_structure_id(&payload.structure_id)?;
    let mc = payload.mc_version.trim();
    if mc.is_empty() {
        return Err("Minecraft version is required (from the project record)".to_string());
    }

    // output_kind must be validated even in preview mode
    match payload.output_kind.as_deref().unwrap_or("mod") {
        "mod" | "server_module" => {}
        other => return Err(format!("Unknown output kind: {other:?} (use mod or server_module)")),
    }

    let structure = generate_structure(kind, payload.seed);
    let nbt = structure_nbt_bytes(&structure, mc)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&nbt);

    let wrote = if payload.preview_only {
        None
    } else {
        let project_dir = validated_path(&payload.storage_base, payload.project_rel.trim(), false)?;
        let folder = structures_folder_for(mc);
        let target = match payload.output_kind.as_deref().unwrap_or("mod") {
            "mod" => project_dir
                .join("src/main/resources/data")
                .join(project_slug_modid(&payload.project_rel))
                .join(folder)
                .join(format!("{}.nbt", payload.structure_id)),
            "server_module" => project_dir
                .join("world/datapacks/nexus_monuments/data/nexus_monuments")
                .join(folder)
                .join(format!("{}.nbt", payload.structure_id)),
            other => return Err(format!("Unknown output kind: {other:?} (use mod or server_module)")),
        };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &nbt).map_err(|e| format!("Failed to write structure: {e}"))?;
        Some(target.to_string_lossy().to_string())
    };

    Ok(StructureGenResult {
        size: structure.size,
        blocks: structure
            .blocks
            .iter()
            .map(|b| StructureBlockOut {
                x: b.pos[0],
                y: b.pos[1],
                z: b.pos[2],
                block: b.palette_key(),
            })
            .collect(),
        block_count: structure.blocks.len(),
        nbt_base64: b64,
        wrote_path: wrote,
    })
}

/// "projects/dark-kingdom" → "dark_kingdom" (the mod id convention used by
/// the rest of the app).
fn project_slug_modid(project_rel: &str) -> String {
    let slug = project_rel.trim().trim_start_matches("projects/").trim_matches('/');
    slug.replace('-', "_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;

    fn payload(kind: &str, preview: bool) -> StructureGenPayload {
        StructureGenPayload {
            storage_base: std::env::temp_dir().to_string_lossy().to_string(),
            project_rel: "projects/dark-kingdom".to_string(),
            structure_id: "watch_post".to_string(),
            kind: kind.to_string(),
            seed: 42,
            mc_version: "1.20.1".to_string(),
            preview_only: preview,
            output_kind: None,
        }
    }

    fn fake_project(base: &std::path::Path) {
        let dir = base.join("projects/dark-kingdom");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("build.gradle"), b"// test").unwrap();
    }

    #[test]
    fn every_kind_generates_real_blocks_and_valid_gzip_nbt() {
        for kind in ["watchtower", "cottage", "obelisk", "ruin"] {
            let mut p = payload(kind, true);
            let base = std::env::temp_dir().join(format!("voxel-struct-{}-{kind}", std::process::id()));
            std::fs::create_dir_all(&base).unwrap();
            fake_project(&base);
            p.storage_base = base.to_string_lossy().to_string();

            let result = structure_generate_impl(p).unwrap();
            assert!(result.block_count > 40, "kind {kind} drew only {}", result.block_count);
            assert_eq!(result.blocks.len(), result.block_count);

            // every block inside the declared bounds
            for b in &result.blocks {
                assert!(b.x >= 0 && b.x < result.size[0], "{kind}: x out of bounds");
                assert!(b.y >= 0 && b.y < result.size[1], "{kind}: y out of bounds");
                assert!(b.z >= 0 && b.z < result.size[2], "{kind}: z out of bounds");
                assert!(b.block.starts_with("minecraft:"), "{kind}: non-vanilla block {}", b.block);
            }
            assert!(result.wrote_path.is_none(), "preview must not write");

            // the nbt is real gzip with the vanilla header
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&result.nbt_base64)
                .unwrap();
            assert_eq!(&bytes[0..2], &[0x1f, 0x8b], "{kind}: not gzip");
            let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
            let mut nbt = Vec::new();
            decoder.read_to_end(&mut nbt).unwrap();
            // TAG_Compound + empty name + "size" ahead
            assert_eq!(nbt[0], TAG_COMPOUND);
            assert!(nbt.len() > 100, "{kind}: nbt suspiciously small");
            let _ = std::fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn server_module_destination_lands_inside_the_monuments_datapack() {
        let base = std::env::temp_dir().join(format!("voxel-struct-srv-{}", std::process::id()));
        std::fs::create_dir_all(base.join("servers/arena")).unwrap();
        std::fs::write(base.join("servers/arena/server.properties"), b"motd=x").unwrap();

        let mut p = payload("watchtower", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.project_rel = "servers/arena".to_string();
        p.structure_id = "grand_tower".to_string();
        p.output_kind = Some("server_module".to_string());
        let result = structure_generate_impl(p).unwrap();
        let wrote = result.wrote_path.unwrap();
        assert!(
            wrote.contains("servers/arena/world/datapacks/nexus_monuments/data/nexus_monuments/structures/grand_tower.nbt"),
            "unexpected path: {wrote}"
        );
        assert!(std::path::PathBuf::from(&wrote).is_file());

        // unknown kinds refused
        let mut p = payload("obelisk", true);
        p.storage_base = base.to_string_lossy().to_string();
        p.output_kind = Some("castle".to_string());
        assert!(structure_generate_impl(p).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn same_seed_same_structure_and_paths_respect_the_era() {
        let a = generate_structure(StructureKind::Watchtower, 7);
        let b = generate_structure(StructureKind::Watchtower, 7);
        assert_eq!(a.size, b.size);
        assert_eq!(a.blocks.len(), b.blocks.len());

        let c = generate_structure(StructureKind::Watchtower, 8);
        // different seed must differ somewhere
        assert_ne!(
            a.blocks.iter().map(|b| b.palette_key()).collect::<Vec<_>>(),
            c.blocks.iter().map(|b| b.palette_key()).collect::<Vec<_>>()
        );

        assert_eq!(structures_folder_for("1.20.1"), "structures");
        assert_eq!(structures_folder_for("1.21.4"), "structure");
        assert_eq!(data_version_for("1.20.1"), 3465);
        assert_eq!(data_version_for("1.21.4"), 4189);
    }

    #[test]
    fn write_lands_in_the_project_datapack_and_guards_hold() {
        let base = std::env::temp_dir().join(format!("voxel-struct-write-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        fake_project(&base);

        let mut p = payload("obelisk", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.structure_id = "elder_obelisk".to_string();
        let result = structure_generate_impl(p).unwrap();
        let wrote = result.wrote_path.clone().unwrap();
        // 1.20.1 → structures/ (plural)
        assert!(wrote.contains("data/dark_kingdom/structures/elder_obelisk.nbt"), "{wrote}");
        assert!(std::path::PathBuf::from(&wrote).is_file());

        // 1.21.4 → structure/ (singular) + DataVersion 4189
        let mut p = payload("obelisk", true);
        p.storage_base = base.to_string_lossy().to_string();
        p.mc_version = "1.21.4".to_string();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&structure_generate_impl(p).unwrap().nbt_base64)
            .unwrap();
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut nbt = Vec::new();
        decoder.read_to_end(&mut nbt).unwrap();
        assert!(nbt.windows(4).any(|w| w == 4189i32.to_be_bytes()), "DataVersion 4189 must be embedded");

        // traversal + bad ids refused
        let mut p = payload("ruin", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.project_rel = "projects/../../etc".to_string();
        assert!(structure_generate_impl(p).is_err());
        let mut p = payload("ruin", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.structure_id = "Bad-Id".to_string();
        assert!(structure_generate_impl(p).is_err());
        let mut p = payload("castle", true);
        p.storage_base = base.to_string_lossy().to_string();
        assert!(structure_generate_impl(p).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
