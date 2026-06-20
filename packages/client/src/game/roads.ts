import type { ThemeDef } from '../theme/types';

/**
 * Road geometry: ONE source of truth for rendering (placeholders.drawRoads) and
 * for rasterizing the dirt band (terrain-map: dirt along roads). This keeps the
 * drawn road aligned with the ground texture beneath it (the dirt mask is a
 * capsule around the axis, so sharp turns/ends can differ by 1-2 tiles).
 *
 * A road is a deterministic arc (quadratic Bezier) between two graph nodes, with
 * hashed bowing and wavy width. No Math.random, so the world is identical across sessions.
 */

/** Point on the road axis in grid space + local half-width (tiles). */
export interface RoadPoint {
  gx: number;
  gy: number;
  hw: number;
}

const BASE_HW = 0.5; // base road half-width (tiles)
const JUNCTION_BONUS = 0.5; // extra width near nodes (squares/intersections)
const WOBBLE_HW = 0.12; // organic width wobble amplitude
const MAX_BOW = 1.5; // max arc bow at the middle (tiles)

function hash01(a: number, b: number, seed: number): number {
  let h = (a * 374761393 + b * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const signed = (a: number, b: number, seed: number) => hash01(a, b, seed) * 2 - 1;

function resolveNode(theme: ThemeDef, id: string): { gx: number; gy: number } | undefined {
  if (id.startsWith('door:')) return theme.buildings.find((b) => `door:${b.id}` === id)?.door;
  return theme.crossroads.find((c) => c.id === id);
}

/**
 * Deterministic arc between two nodes + width profile.
 * Bezier PASSES through endpoints (t=0, t=1), so roads meet exactly at nodes;
 * intersection continuity is preserved despite bowing.
 */
export function roadCurve(ax: number, ay: number, bx: number, by: number, seed: number): RoadPoint[] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // unit normal to the segment
  const ny = dx / len;
  // bow proportional to length, with stable hashed sign and amplitude
  const bow = signed(Math.round(ax * 8 + bx), Math.round(ay * 8 + by), seed * 131 + 7) * Math.min(MAX_BOW, len * 0.16);
  const cx = (ax + bx) / 2 + nx * bow; // punkt kontrolny Béziera
  const cy = (ay + by) / 2 + ny * bow;
  const wobFreq = 2 + Math.floor(hash01(seed, Math.round(len), 53) * 3); // 2..4 width waves
  const wobPhase = hash01(seed, 99, 17) * Math.PI * 2;
  const steps = Math.max(8, Math.round(len * 2));
  const pts: RoadPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * ax + 2 * mt * t * cx + t * t * bx;
    const y = mt * mt * ay + 2 * mt * t * cy + t * t * by;
    const junction = Math.abs(Math.cos(Math.PI * t)); // 1 at nodes, 0 in the middle
    const wobble = WOBBLE_HW * Math.sin(t * Math.PI * wobFreq + wobPhase);
    pts.push({ gx: x, gy: y, hw: BASE_HW + JUNCTION_BONUS * junction + wobble });
  }
  return pts;
}

/** Curves for all theme roads: one polyline per graph edge (theme.edges). */
export function themeRoadCurves(theme: ThemeDef): RoadPoint[][] {
  const out: RoadPoint[][] = [];
  theme.edges.forEach(([aId, bId], i) => {
    const a = resolveNode(theme, aId);
    const b = resolveNode(theme, bId);
    if (a && b) out.push(roadCurve(a.gx, a.gy, b.gx, b.gy, i + 1));
  });
  return out;
}

/** Whether point (px,py) in grid space lies on any road (inside the band). */
export function pointOnRoad(curves: RoadPoint[][], px: number, py: number): boolean {
  for (const c of curves) {
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      const sx = b.gx - a.gx;
      const sy = b.gy - a.gy;
      const len2 = sx * sx + sy * sy || 1;
      let t = ((px - a.gx) * sx + (py - a.gy) * sy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.gx + t * sx;
      const cy = a.gy + t * sy;
      const hw = a.hw + (b.hw - a.hw) * t;
      if (Math.hypot(px - cx, py - cy) < hw) return true;
    }
  }
  return false;
}
