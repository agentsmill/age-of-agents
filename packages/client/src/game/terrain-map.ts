import type { ThemeDef } from '../theme/types';
import { themeRoadCurves, pointOnRoad } from './roads';

export type TerrainId = 'grass' | 'dirt' | 'water' | 'rock';
export const TERRAINS: readonly TerrainId[] = ['grass', 'dirt', 'water', 'rock'];

/** Deterministic lattice-node hash -> [0,1). No Math.random. */
function hash01(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth value noise at point (x,y) for a given frequency. */
function valueNoise(x: number, y: number, freq: number, seed: number): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const top = lerp(hash01(x0, y0, seed), hash01(x0 + 1, y0, seed), tx);
  const bot = lerp(hash01(x0, y0 + 1, seed), hash01(x0 + 1, y0 + 1, seed), tx);
  return lerp(top, bot, ty);
}

/** Dwie oktawy → organiczne plamy z nieregularnym brzegiem. */
function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, 0.16, seed) * 0.65 + valueNoise(x, y, 0.34, seed + 9973) * 0.35;
}

const WATER_BELOW = 0.25; // low noise depressions -> ponds
const ROCK_ABOVE = 0.78; // high ridges -> rock patches

/**
 * Biome sampler for ANY cell (including negative/excess indices). Closed over
 * road curves (computed once). Rules as in buildTerrainMap: water = noise
 * depressions; rock = ridges with a 1-cell grass buffer from water; dirt = paths
 * along roads (outside road layout there is no dirt -> natural land); grass =
 * base. Used to render "wild land" outside the gameplay grid.
 */
export function terrainSampler(theme: ThemeDef): (gx: number, gy: number) => TerrainId {
  const curves = themeRoadCurves(theme);
  const isWater = (gx: number, gy: number) => fbm(gx, gy, 1) < WATER_BELOW;
  return (gx, gy) => {
    if (isWater(gx, gy)) return 'water';
    if (fbm(gx, gy, 7) > ROCK_ABOVE) {
      const nearWater =
        isWater(gx - 1, gy) || isWater(gx + 1, gy) || isWater(gx, gy - 1) || isWater(gx, gy + 1);
      if (!nearWater) return 'rock';
    }
    if (pointOnRoad(curves, gx + 0.5, gy + 0.5)) return 'dirt';
    return 'grass';
  };
}

/**
 * Procedural, aesthetic biome map (deterministic) for the gameplay grid.
 * grass = base; water = coherent ponds (value-noise); rock = patches with a
 * grass buffer from water (no water-rock seams -> clean Wang autotiling); dirt =
 * paths along roads (theme.edges), only on grass. Same rules as terrainSampler
 * (single source of truth for biomes).
 */
export function buildTerrainMap(theme: ThemeDef): TerrainId[][] {
  const { w, h } = theme.grid;
  const sample = terrainSampler(theme);
  return Array.from({ length: h }, (_, gy) => Array.from({ length: w }, (_, gx) => sample(gx, gy)));
}

/** Iso neighbor with a different biome (one of 4 diamond edges), for feather/AO in iso terrain. */
export interface BiomeEdge {
  dgx: number;
  dgy: number;
  biome: TerrainId;
}

const ISO_NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Edges of cell (gx,gy) touching a DIFFERENT biome. In isometry, the diamond's
 * 4 sides map to cardinal grid neighbors. Used for softening biome seams
 * (neighbor texture overlay + outline darkening).
 */
export function biomeEdges(map: TerrainId[][], gx: number, gy: number): BiomeEdge[] {
  const h = map.length;
  const w = map[0].length;
  const self = map[gy][gx];
  const out: BiomeEdge[] = [];
  for (const [dgx, dgy] of ISO_NEIGHBORS) {
    const nx = gx + dgx;
    const ny = gy + dgy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const nb = map[ny][nx];
    if (nb !== self) out.push({ dgx, dgy, biome: nb });
  }
  return out;
}
