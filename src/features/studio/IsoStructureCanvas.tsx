/**
 * Isometric structure preview — every block of the generated .nbt drawn as
 * a shaded cube in true isometric projection, brand-toned backdrop.
 * What you see is the exact block list the structure file contains.
 */

import { useEffect, useRef } from "react";
import { colorForBlock, type StructureBlock } from "@/services/assets/structureService";

interface Props {
  blocks: StructureBlock[];
  size: [number, number, number];
  className?: string;
}

const TW = 26; // tile half-width (px)
const TH = 13; // tile half-height (px)
const BH = 18; // cube body height (px)

function shade(hex: string, factor: number): string {
  const v = hex.replace("#", "");
  const r = Math.min(255, Math.round(parseInt(v.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(v.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(v.slice(4, 6), 16) * factor));
  return `rgb(${r},${g},${b})`;
}

export function IsoStructureCanvas({ blocks, size, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Brand backdrop: deep panel with a faint voxel grid
    ctx.fillStyle = "#0b0e18";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(126,232,250,0.05)";
    for (let gx = 14; gx < w; gx += 26) {
      for (let gy = 14; gy < h; gy += 26) {
        ctx.fillRect(gx, gy, 1.5, 1.5);
      }
    }

    if (blocks.length === 0) return;

    // Center the structure on the canvas
    const [sx, , sz] = size;
    const centerOffsetX = (sx - sz) * (TW / 2);
    const originX = w / 2 - centerOffsetX;
    const baseY = h / 2 + ((sx + sz) * TH) / 2 - 10;

    const iso = (x: number, y: number, z: number): [number, number] => [
      originX + (x - z) * (TW / 2),
      baseY - y * BH - (x + z) * (TH / 2),
    ];

    const cube = (x: number, y: number, z: number, color: string) => {
      const [px, py] = iso(x, y + 1, z); // top vertex anchor

      // top face (diamond)
      ctx.fillStyle = shade(color, 1.12);
      ctx.beginPath();
      ctx.moveTo(px, py - TH);
      ctx.lineTo(px + TW / 2, py);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px - TW / 2, py);
      ctx.closePath();
      ctx.fill();

      // left face
      ctx.fillStyle = shade(color, 0.72);
      ctx.beginPath();
      ctx.moveTo(px - TW / 2, py);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px, py + TH + BH);
      ctx.lineTo(px - TW / 2, py + BH);
      ctx.closePath();
      ctx.fill();

      // right face
      ctx.fillStyle = shade(color, 0.5);
      ctx.beginPath();
      ctx.moveTo(px + TW / 2, py);
      ctx.lineTo(px, py + TH);
      ctx.lineTo(px, py + TH + BH);
      ctx.lineTo(px + TW / 2, py + BH);
      ctx.closePath();
      ctx.fill();

      // crisp edges
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    };

    // Painter's order: bottom-up, back-to-front (x+z asc)
    const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x + a.z - (b.x + b.z));
    for (const b of sorted) {
      if (b.block === "minecraft:air") continue;
      cube(b.x, b.y, b.z, colorForBlock(b.block));
    }
  }, [blocks, size]);

  return <canvas ref={ref} className={className} style={{ width: "100%", height: "100%" }} />;
}
