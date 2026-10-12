#!/usr/bin/env python3
"""Generate the premium template assets (pixel-art, hand-authored).

Deterministic asset pipeline for the mod templates' shared content:
- darksteel_sword.png  16x16 vanilla-style diagonal sword, darksteel palette
- example_item.png     16x16 "Voxel Gem" — faceted, brand cyan/violet
- icon.png             128x128 mod logo: the sword over a subtle voxel grid

The art is authored as char maps (one char = one pixel) so every sprite is
reviewable in code. Written to ALL four templates (they share assets).
"""
from PIL import Image, ImageDraw, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = [
    "fabric-1.20.1-mod",
    "forge-1.20.1-mod",
    "neoforge-1.20.1-mod",
    "neoforge-1.20.2-mod",
]
ASSET_SUBDIR = os.path.join("src", "main", "resources", "assets", "{{MOD_ID}}")

# ---------------------------------------------------------------------------
# Palettes — darksteel (blue-grey steel with a cyan glint) and the brand gem
# ---------------------------------------------------------------------------
SWORD_PALETTE = {
    ".": None,               # transparent
    "o": (10, 13, 22, 255),      # outline (near-black blue)
    "d": (29, 36, 54, 255),      # darksteel dark
    "m": (58, 70, 102, 255),    # darksteel mid
    "l": (90, 106, 148, 255),   # darksteel light
    "h": (143, 168, 216, 255),  # highlight
    "c": (126, 232, 250, 255),  # cyan glint
    "g": (22, 28, 43, 255),     # guard dark
    "G": (74, 88, 120, 255),    # guard light
    "w": (74, 59, 40, 255),     # handle wood dark
    "W": (107, 86, 56, 255),    # handle wood light
    "p": (58, 70, 102, 255),    # pommel (mid steel)
}

# 16x16 diagonal sword, vanilla layout (grip bottom-left, tip top-right)
SWORD = [
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
]

GEM_PALETTE = {
    ".": None,
    "o": (10, 13, 22, 255),        # outline
    "k": (46, 32, 82, 255),       # deep violet shadow
    "v": (107, 70, 200, 255),     # violet mid
    "V": (145, 85, 255, 255),     # brand violet
    "b": (196, 179, 255, 255),    # pale lilac highlight
    "w": (255, 255, 255, 255),    # sparkle
    "c": (126, 232, 250, 255),    # cyan core glint
}

# 16x16 faceted gem (diamond cut, isometric feel)
GEM = [
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
]


def render(map16, palette):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(map16):
        for x, ch in enumerate(row):
            color = palette.get(ch)
            if color:
                img.putpixel((x, y), color)
    return img


def upscale_nearest(img, factor):
    return img.resize((img.width * factor, img.height * factor), Image.NEAREST)


def make_icon(sword16):
    """128x128 mod logo: sword over a deep voxel-grid backdrop with a violet glow."""
    size = 128
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Backdrop: rounded-square deep panel with a soft radial glow
    panel = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(panel)
    d.rounded_rectangle([4, 4, size - 5, size - 5], radius=24, fill=(13, 17, 32, 255))
    icon.alpha_composite(panel)

    # Subtle voxel grid (brand motif): 2px nodes every 16px, low alpha
    grid = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for gx in range(16, size, 16):
        for gy in range(16, size, 16):
            gd.point((gx, gy), fill=(126, 232, 250, 26))
    icon.alpha_composite(grid)

    # Radial violet glow behind the sword
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = size // 2, size // 2
    for r in range(52, 8, -2):
        alpha = int(10 + (52 - r) * 1.6)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(145, 85, 255, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    icon.alpha_composite(glow)

    # The sword itself, 6x nearest (96px) centered
    big = upscale_nearest(sword16, 6)
    icon.alpha_composite(big, ((size - big.width) // 2, (size - big.height) // 2))

    # Inner light seam + outer border (matches the app's card language)
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle([4, 4, size - 5, size - 5], radius=24, outline=(90, 106, 148, 160), width=2)
    return icon


def main():
    root = os.path.abspath(os.path.join(HERE, "..", "src-tauri", "templates"))
    sword = render(SWORD, SWORD_PALETTE)
    gem = render(GEM, GEM_PALETTE)
    icon = make_icon(sword)

    out_dir = os.path.join("/tmp/opencode", "mod-asset-preview")
    os.makedirs(out_dir, exist_ok=True)
    sword.save(os.path.join(out_dir, "darksteel_sword.png"))
    gem.save(os.path.join(out_dir, "example_item.png"))
    icon.save(os.path.join(out_dir, "icon.png"))
    upscale_nearest(sword, 12).save(os.path.join(out_dir, "darksteel_sword_x12.png"))
    upscale_nearest(gem, 12).save(os.path.join(out_dir, "example_item_x12.png"))

    for template in TEMPLATES:
        base = os.path.join(root, template, ASSET_SUBDIR)
        sword.save(os.path.join(base, "textures", "item", "darksteel_sword.png"))
        gem.save(os.path.join(base, "textures", "item", "example_item.png"))
        icon.save(os.path.join(base, "icon.png"))
    print("assets written to", len(TEMPLATES), "templates + preview in", out_dir)


if __name__ == "__main__":
    main()
