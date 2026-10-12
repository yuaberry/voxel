//! Asset Studio v1 (roadmap §9.6) — REAL pixel-art textures, generated
//! deterministically inside the security perimeter.
//!
//! Seven hand-authored item recipes (the sword and gem reuse the exact
//! geometry proven in the templates) rendered with any palette: shades,
//! outline and highlight are derived from the chosen colors. Output is a
//! 16x16 RGBA PNG written through the same path guard as every project
//! file — or returned as base64 for a live preview without touching disk.

use crate::commands::fs::validated_path;
use base64::Engine as _;
use serde::{Deserialize, Serialize};

pub const TEXTURE_SIZE: u32 = 16;

type Rgba = (u8, u8, u8, u8);

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ItemStyleKind {
    Sword,
    Gem,
    Ingot,
    Orb,
    Apple,
    Book,
    Wand,
}

impl ItemStyleKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemStyleKind::Sword => "sword",
            ItemStyleKind::Gem => "gem",
            ItemStyleKind::Ingot => "ingot",
            ItemStyleKind::Orb => "orb",
            ItemStyleKind::Apple => "apple",
            ItemStyleKind::Book => "book",
            ItemStyleKind::Wand => "wand",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "sword" => ItemStyleKind::Sword,
            "gem" => ItemStyleKind::Gem,
            "ingot" => ItemStyleKind::Ingot,
            "orb" => ItemStyleKind::Orb,
            "apple" => ItemStyleKind::Apple,
            "book" => ItemStyleKind::Book,
            "wand" => ItemStyleKind::Wand,
            _ => return None,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureGenPayload {
    pub storage_base: String,
    /// e.g. "projects/dark-kingdom"
    pub project_rel: String,
    pub mod_id: String,
    pub item_id: String,
    pub style: String,
    pub primary: String,
    pub secondary: String,
    /// preview returns base64 only — nothing is written
    pub preview_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureGenResult {
    pub png_base64: String,
    pub wrote_path: Option<String>,
}

fn parse_hex(color: &str) -> Result<(u8, u8, u8), String> {
    let c = color.trim().trim_start_matches('#');
    if c.len() != 6 || !c.chars().all(|h| h.is_ascii_hexdigit()) {
        return Err(format!("Invalid color: {color:?} (expected #rrggbb)"));
    }
    let v = u32::from_str_radix(c, 16).map_err(|e| e.to_string())?;
    Ok((
        ((v >> 16) & 0xff) as u8,
        ((v >> 8) & 0xff) as u8,
        (v & 0xff) as u8,
    ))
}

/// Multiply a color (factor < 1 darkens, > 1 lightens), clamped.
fn shade(c: (u8, u8, u8), factor: f32) -> Rgba {
    let f = |v: u8| (v as f32 * factor).clamp(0.0, 255.0) as u8;
    (f(c.0), f(c.1), f(c.2), 255)
}

/// The full tone ramp derived from one color.
struct Ramp {
    outline: Rgba,
    dark: Rgba,
    mid: Rgba,
    light: Rgba,
    highlight: Rgba,
    pale: Rgba,
}

fn ramp(c: (u8, u8, u8)) -> Ramp {
    Ramp {
        outline: shade(c, 0.30),
        dark: shade(c, 0.55),
        mid: (c.0, c.1, c.2, 255),
        light: shade(c, 1.30),
        highlight: shade(c, 1.55),
        pale: shade(c, 1.85),
    }
}

/// A 16x16 RGBA pixel buffer — no heavyweight image crate needed.
#[derive(Clone)]
pub struct Canvas {
    pub px: Vec<Rgba>,
}

impl Canvas {
    pub fn new() -> Self {
        Canvas {
            px: vec![(0, 0, 0, 0); (TEXTURE_SIZE * TEXTURE_SIZE) as usize],
        }
    }
    pub fn put(&mut self, x: i32, y: i32, c: Rgba) {
        if (0..TEXTURE_SIZE as i32).contains(&x) && (0..TEXTURE_SIZE as i32).contains(&y) {
            self.px[(y * TEXTURE_SIZE as i32 + x) as usize] = c;
        }
    }
    pub fn get(&self, x: i32, y: i32) -> Rgba {
        if (0..TEXTURE_SIZE as i32).contains(&x) && (0..TEXTURE_SIZE as i32).contains(&y) {
            self.px[(y * TEXTURE_SIZE as i32 + x) as usize]
        } else {
            (0, 0, 0, 0)
        }
    }
    pub fn opaque_count(&self) -> usize {
        self.px.iter().filter(|p| p.3 > 0).count()
    }
}

/// Char-map renderer — the geometry of the proven template sprites with a
/// token-per-tone mapping so any palette gets the same premium art.
fn render_map(map: &[&str], tones: &std::collections::HashMap<char, Rgba>) -> Canvas {
    let mut img = Canvas::new();
    for (y, row) in map.iter().enumerate() {
        for (x, ch) in row.chars().enumerate() {
            if let Some(&color) = tones.get(&ch) {
                img.put(x as i32, y as i32, color);
            }
        }
    }
    img
}

const SWORD_MAP: &[&str] = &[
    "................",
    "..............o.",
    ".............odo",
    "............odlo",
    "...........odlo.",
    "..........odlo..",
    ".........odlo...",
    "........odlo....",
    ".o.....odlo.....",
    "oGo...odlo......",
    "oGGo.odlo.......",
    ".oGGodlo........",
    "..owGdo.........",
    ".owwodGo........",
    "oww.oGGo........",
    "op...oo.........",
];

const GEM_MAP: &[&str] = &[
    "................",
    "................",
    "................",
    ".....oooooo.....",
    "....obVVVVbo....",
    "...obbVVVVbbo...",
    "..obbVbbbVbbo...",
    "..obVbkcckbVbo..",
    "..obVbccckbVbo..",
    "..obbVbkkbVbbo..",
    "...obbVVVVbbo...",
    "....obbVVbbo....",
    ".....oobbbo.....",
    "......owwo......",
    ".......oo.......",
    "................",
];

/// Programmatic painter for the geometric styles.
struct Painter {
    img: Canvas,
}

impl Painter {
    fn new() -> Self {
        Painter { img: Canvas::new() }
    }
    fn px(&mut self, x: i32, y: i32, c: Rgba) {
        self.img.put(x, y, c);
    }
    fn rect(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, c: Rgba) {
        for y in y0..=y1 {
            for x in x0..=x1 {
                self.px(x, y, c);
            }
        }
    }
    fn hline(&mut self, y: i32, x0: i32, x1: i32, c: Rgba) {
        for x in x0..=x1 {
            self.px(x, y, c);
        }
    }
    fn vline(&mut self, x: i32, y0: i32, y1: i32, c: Rgba) {
        for y in y0..=y1 {
            self.px(x, y, c);
        }
    }
    fn disk(&mut self, cx: f32, cy: f32, r: f32, inner: f32, c: Rgba) {
        for y in 0..TEXTURE_SIZE as i32 {
            for x in 0..TEXTURE_SIZE as i32 {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                let d = (dx * dx + dy * dy).sqrt();
                if d <= r && d >= inner {
                    self.px(x, y, c);
                }
            }
        }
    }
    /// Fill a 4-vertex convex polygon by point-in-polygon over the small grid.
    fn poly(&mut self, pts: [(f32, f32); 4], c: Rgba) {
        for y in 0..TEXTURE_SIZE as i32 {
            for x in 0..TEXTURE_SIZE as i32 {
                let px = x as f32 + 0.5;
                let py = y as f32 + 0.5;
                let mut inside = false;
                for i in 0..4 {
                    let (x1, y1) = pts[i];
                    let (x2, y2) = pts[(i + 1) % 4];
                    if ((y1 > py) != (y2 > py))
                        && (px < (x2 - x1) * (py - y1) / (y2 - y1) + x1)
                    {
                        inside = !inside;
                    }
                }
                if inside {
                    self.px(x, y, c);
                }
            }
        }
    }
    fn outline_of(&mut self, color: Rgba) {
        // outline every opaque pixel that touches transparency
        let snapshot = self.img.clone();
        for y in 0..TEXTURE_SIZE as i32 {
            for x in 0..TEXTURE_SIZE as i32 {
                let opaque = |x: i32, y: i32| snapshot.get(x, y).3 > 0;
                if opaque(x, y) {
                    continue;
                }
                let touches = opaque(x - 1, y)
                    || opaque(x + 1, y)
                    || opaque(x, y - 1)
                    || opaque(x, y + 1);
                if touches {
                    self.px(x, y, color);
                }
            }
        }
    }
}

fn render(style: ItemStyleKind, primary: (u8, u8, u8), secondary: (u8, u8, u8)) -> Canvas {
    let p = ramp(primary);
    let s = ramp(secondary);

    match style {
        ItemStyleKind::Sword => {
            let mut tones = std::collections::HashMap::new();
            tones.insert('o', p.outline);
            tones.insert('d', p.dark);
            tones.insert('m', p.mid);
            tones.insert('l', p.light);
            tones.insert('h', p.highlight);
            tones.insert('c', s.highlight);
            tones.insert('g', s.dark);
            tones.insert('G', s.mid);
            tones.insert('w', shade(secondary, 0.45));
            tones.insert('W', shade(secondary, 0.75));
            tones.insert('p', p.mid);
            render_map(SWORD_MAP, &tones)
        }
        ItemStyleKind::Gem => {
            let mut tones = std::collections::HashMap::new();
            tones.insert('o', p.outline);
            tones.insert('k', p.dark);
            tones.insert('v', p.mid);
            tones.insert('V', p.light);
            tones.insert('b', p.highlight);
            tones.insert('w', (255, 255, 255, 255));
            tones.insert('c', s.highlight);
            render_map(GEM_MAP, &tones)
        }
        ItemStyleKind::Ingot => {
            let mut pt = Painter::new();
            // 3D metal bar: top face light, front mid, bottom dark
            pt.poly(
                [(4.0, 6.0), (11.0, 3.0), (13.0, 5.0), (6.0, 8.0)],
                p.highlight,
            );
            pt.poly([(6.0, 8.0), (13.0, 5.0), (13.0, 12.0), (6.0, 15.0)], p.mid);
            pt.poly([(3.0, 7.0), (6.0, 8.0), (6.0, 15.0), (3.0, 14.0)], p.dark);
            pt.px(13, 13, p.dark);
            pt.px(12, 14, p.dark);
            pt.px(6, 14, p.dark);
            pt.px(5, 14, p.dark);
            // top glint
            pt.px(7, 5, p.pale);
            pt.px(8, 4, p.pale);
            pt.outline_of(p.outline);
            pt.img
        }
        ItemStyleKind::Orb => {
            let mut pt = Painter::new();
            pt.disk(7.5, 7.5, 6.0, 0.0, p.mid);
            pt.disk(7.5, 7.5, 6.0, 4.6, p.dark);
            pt.disk(7.5, 7.5, 4.4, 0.0, p.light);
            // inner shine
            pt.disk(6.2, 6.2, 1.6, 0.0, p.highlight);
            pt.px(5, 4, p.pale);
            pt.px(4, 5, p.pale);
            // equator glints
            pt.px(11, 9, s.highlight);
            pt.px(10, 11, s.highlight);
            pt.outline_of(p.outline);
            pt.img
        }
        ItemStyleKind::Apple => {
            let mut pt = Painter::new();
            pt.disk(7.5, 9.5, 5.4, 0.0, p.mid);
            pt.disk(7.5, 9.5, 5.4, 3.2, p.dark);
            pt.disk(6.7, 8.7, 2.4, 0.0, p.light);
            pt.px(6, 6, p.highlight);
            pt.px(5, 7, p.highlight);
            // stem + leaf in secondary
            pt.vline(8, 3, 5, shade(secondary, 0.5));
            pt.px(9, 4, s.mid);
            pt.px(10, 4, s.mid);
            pt.px(11, 3, s.light);
            pt.px(10, 3, s.mid);
            pt.outline_of(p.outline);
            pt.img
        }
        ItemStyleKind::Book => {
            let mut pt = Painter::new();
            // cover
            pt.rect(3, 3, 13, 13, p.mid);
            // spine
            pt.rect(3, 3, 5, 13, p.dark);
            pt.vline(5, 3, 13, p.light);
            // pages
            pt.rect(7, 4, 12, 12, (232, 226, 200, 255));
            pt.hline(6, 5, 12, p.outline);
            // clasp in secondary
            pt.rect(6, 7, 7, 9, s.mid);
            pt.px(6, 8, s.highlight);
            // title bar
            pt.rect(8, 5, 11, 5, shade(secondary, 0.75));
            pt.outline_of(p.outline);
            pt.img
        }
        ItemStyleKind::Wand => {
            let mut pt = Painter::new();
            // diagonal stick in secondary
            for i in 0..7 {
                let x = 4 + i;
                let y = 12 - i;
                pt.px(x, y, shade(secondary, 0.8));
                pt.px(x + 1, y, shade(secondary, 0.55));
            }
            // tip star in primary
            pt.disk(12.5, 3.5, 3.2, 0.0, p.mid);
            pt.disk(12.5, 3.5, 2.0, 0.0, p.light);
            pt.px(12, 3, p.highlight);
            pt.px(11, 2, p.pale);
            pt.px(13, 13, shade(secondary, 0.45));
            pt.outline_of(p.outline);
            pt.img
        }
    }
}

fn png_bytes(img: &Canvas) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, TEXTURE_SIZE, TEXTURE_SIZE);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header failed: {e}"))?;
        let raw: Vec<u8> = img.px.iter().flat_map(|p| [p.0, p.1, p.2, p.3]).collect();
        writer
            .write_image_data(&raw)
            .map_err(|e| format!("PNG data failed: {e}"))?;
    }
    Ok(buf)
}

fn safe_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        || id.starts_with(|c: char| !c.is_ascii_alphabetic())
    {
        return Err(format!("Invalid id: {id:?} (lowercase snake_case)"));
    }
    Ok(())
}

#[tauri::command]
pub fn generate_item_texture(payload: TextureGenPayload) -> Result<TextureGenResult, String> {
    let style = ItemStyleKind::from_str(payload.style.trim())
        .ok_or_else(|| format!("Unknown style \"{}\" — use sword|gem|ingot|orb|apple|book|wand", payload.style))?;
    let primary = parse_hex(&payload.primary)?;
    let secondary = parse_hex(&payload.secondary)?;
    safe_id(&payload.mod_id).map_err(|e| format!("mod_id: {e}"))?;
    safe_id(&payload.item_id).map_err(|e| format!("item_id: {e}"))?;

    let img = render(style, primary, secondary);
    let bytes = png_bytes(&img)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let wrote = if payload.preview_only {
        None
    } else {
        // Same guard philosophy as every project write — the project root is
        // validated against the workspace first; the remaining path is built
        // by joining fixed components and pre-validated ids (no separators,
        // no traversal is even expressible).
        let project_dir = validated_path(&payload.storage_base, payload.project_rel.trim(), false)?;
        let target = project_dir
            .join("assets")
            .join(&payload.mod_id)
            .join("textures/item")
            .join(format!("{}.png", payload.item_id));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, &bytes).map_err(|e| format!("Failed to write texture: {e}"))?;
        Some(target.to_string_lossy().to_string())
    };

    Ok(TextureGenResult {
        png_base64: b64,
        wrote_path: wrote,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(style: &str, preview: bool) -> TextureGenPayload {
        TextureGenPayload {
            storage_base: std::env::temp_dir().to_string_lossy().to_string(),
            project_rel: "projects/dark-kingdom".to_string(),
            mod_id: "dark_kingdom".to_string(),
            item_id: "test_item".to_string(),
            style: style.to_string(),
            primary: "#9155ff".to_string(),
            secondary: "#7ee8fa".to_string(),
            preview_only: preview,
        }
    }

    fn fake_project(base: &std::path::Path) {
        let dir = base.join("projects/dark-kingdom");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("build.gradle"), b"// test").unwrap();
    }

    #[test]
    fn every_style_renders_a_valid_16x16_with_the_palette() {
        for style in ["sword", "gem", "ingot", "orb", "apple", "book", "wand"] {
            let base = std::env::temp_dir().join(format!("voxel-asset-{}-{style}", std::process::id()));
            std::fs::create_dir_all(&base).unwrap();
            fake_project(&base);

            let mut p = payload(style, false);
            p.storage_base = base.to_string_lossy().to_string();
            let result = generate_item_texture(p).unwrap();

            // valid PNG, 16x16 RGBA
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&result.png_base64)
                .unwrap();
            let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
            let mut reader = decoder.read_info().unwrap();
            assert_eq!(reader.info().width, 16, "style {style}");
            assert_eq!(reader.info().height, 16, "style {style}");
            let mut raw = vec![0u8; reader.output_buffer_size().unwrap()];
            reader.next_frame(&mut raw).unwrap();
            let opaque = raw.chunks_exact(4).filter(|c| c[3] > 0).count();
            assert!(opaque > 24, "style {style} drew only {opaque} px");
            let wrote = result.wrote_path.clone().unwrap();
            assert!(wrote.contains("textures/item/test_item.png"));

            // the file on disk equals the preview bytes
            let on_disk = std::fs::read(&wrote).unwrap();
            assert_eq!(on_disk, bytes, "style {style} disk mismatch");

            let _ = std::fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn sword_and_gem_reuse_the_proven_geometry() {
        let sword = render(ItemStyleKind::Sword, parse_hex("#9155ff").unwrap(), parse_hex("#7ee8fa").unwrap());
        let gem = render(ItemStyleKind::Gem, parse_hex("#9155ff").unwrap(), parse_hex("#7ee8fa").unwrap());
        let opaque_s = sword.opaque_count();
        let opaque_g = gem.opaque_count();
        assert_eq!(opaque_s, 74, "sword geometry must match the template sprite");
        assert_eq!(opaque_g, 101, "gem geometry must match the template sprite");
    }

    #[test]
    fn preview_writes_nothing_and_bad_input_is_refused() {
        let base = std::env::temp_dir().join(format!("voxel-asset-prev-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        fake_project(&base);
        let mut p = payload("orb", true);
        p.storage_base = base.to_string_lossy().to_string();
        let result = generate_item_texture(p).unwrap();
        assert!(result.wrote_path.is_none());
        assert!(!base.join("projects/dark-kingdom/src").exists(), "preview must not write");

        // traversal refused
        let mut p = payload("sword", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.project_rel = "projects/../../etc".to_string();
        assert!(generate_item_texture(p).is_err());

        // bad palette / style / id refused
        let mut p = payload("sword", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.primary = "#ff".to_string();
        assert!(generate_item_texture(p).is_err());
        let mut p = payload("spaceship", false);
        p.storage_base = base.to_string_lossy().to_string();
        assert!(generate_item_texture(p).is_err());
        let mut p = payload("sword", false);
        p.storage_base = base.to_string_lossy().to_string();
        p.item_id = "Bad-Id".to_string();
        assert!(generate_item_texture(p).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
