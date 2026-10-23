import { describe, expect, it } from "vitest";
import { classifyAsset, inspectPng } from "./assetLab";

function realPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((b, i) => (bytes[i] = b));
  // chunk length 13 (bytes 8..11), "IHDR" (12..15)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  // width 16..19, height 20..23 — big-endian
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

describe("Asset Lab — validated image import (real PNG header inspection)", () => {
  it("reads the real dimensions from a valid PNG header", () => {
    const header = inspectPng(realPngHeader(16, 16));
    expect(header.ok).toBe(true);
    expect(header.width).toBe(16);
    expect(header.height).toBe(16);

    const header32 = inspectPng(realPngHeader(32, 64));
    expect(header32.ok).toBe(true);
    expect(header32.width).toBe(32);
    expect(header32.height).toBe(64);
  });

  it("refuses non-PNG bytes and truncated files", () => {
    expect(inspectPng(new Uint8Array([1, 2, 3])).ok).toBe(false);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(inspectPng(jpeg).ok).toBe(false);
    expect(inspectPng(jpeg).reason).toContain("Not a PNG");
  });
});

describe("Asset Lab — classification", () => {
  it("classifies workspace files by their real folders", () => {
    expect(classifyAsset("projects/dark/src/main/resources/assets/dk/textures/item/sword.png")).toBe("texture");
    expect(classifyAsset("projects/dark/src/main/resources/assets/dk/models/item/sword.json")).toBe("model");
    expect(classifyAsset("projects/dark/src/main/resources/assets/dk/lang/en_us.json")).toBe("lang");
    expect(classifyAsset("projects/dark/src/main/resources/data/dk/recipes/sword.json")).toBe("recipe");
    expect(classifyAsset("projects/dark/src/main/resources/data/dk/structures/tower.nbt")).toBe("structure");
    expect(classifyAsset("projects/dark/src/main/resources/data/dk/advancements/root.json")).toBe("advancement");
    expect(classifyAsset("shaderpacks/my-pack/shaders/composite.fsh")).toBe("shader");
    expect(classifyAsset("projects/dark/build/libs/mod.jar")).toBe("other");
  });
});
