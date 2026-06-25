import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import type { ThemeDef } from '../theme/types';
import { buildTerrainMap, terrainSampler, biomeEdges } from './terrain-map';
import { isoFillRange, type WorldRect } from './iso-fill';

const tiles = new Map<string, Texture>(); // TerrainId -> tekstura diamentu
let loaded = false;
let currentTheme = '';

// Biome seam softening (look, easy to tune). 0 disables the effect.
const FEATHER_ALPHA = 0.45; // neighbor texture overlay opacity
const FEATHER_SCALE = 0.7; // overlay size relative to tile
const FEATHER_OFFSET = 0.28; // overlay shift toward neighbor (fraction of tile)
const BOUNDARY_SHADE = 0.94; // subtle outline: boundary cell slightly darker

/** Deterministyczny tint jitter (±5%) jak dotychczas — rozbija jednolite pola. */
function jitter01(gx: number, gy: number): number {
  const j = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
  return 0.95 + (j % 100) / 1000; // 0.95–1.05
}
function grayTint(factor: number): number {
  const v = Math.max(0, Math.min(255, Math.round(255 * factor)));
  return (v << 16) | (v << 8) | v;
}

/** Loads isometric terrain tiles (one diamond per TerrainId). Missing -> drawTerrain fallback. */
export async function loadIsoTiles(themeId: string): Promise<void> {
  // Evict old previous-theme tiles from the Pixi cache; otherwise Pixi may
  // return the old texture after a theme change and never load the new one.
  if (currentTheme && currentTheme !== themeId) {
    for (const id of tiles.keys()) {
      try { await Assets.unload(`/assets/${currentTheme}/tilemap-iso/${id}.png`); } catch { /* ignore */ }
    }
  }
  tiles.clear();
  loaded = false;
  currentTheme = themeId;
  try {
    const res = await fetch(`/assets/${themeId}/tilemap-iso/index.json`);
    if (!res.ok) {
      console.warn(`[tilemap-iso] No index.json for ${themeId} (${res.status})`);
      return;
    }
    const idx: { ids: string[] } = await res.json();
    console.log(`[tilemap-iso] Loading ${themeId}:`, idx.ids);
    for (const id of idx.ids) {
      try {
        const t = await Assets.load<Texture>(`/assets/${themeId}/tilemap-iso/${id}.png`);
        if (t) {
          tiles.set(id, t);
          console.log(`[tilemap-iso]   ✓ ${id} ${t.width}x${t.height}`);
        } else {
          console.warn(`[tilemap-iso]   ✗ ${id} returned null`);
        }
      } catch (err) {
        console.warn(`[tilemap-iso]   ✗ ${id} failed:`, err);
      }
    }
    loaded = tiles.size > 0;
    console.log(`[tilemap-iso] ${themeId} loaded:`, tiles.size, 'tiles');
  } catch (err) {
    console.warn(`[tilemap-iso] Fetch failed for ${themeId}:`, err);
  }
}

export function hasIsoTiles(): boolean {
  return loaded;
}

/**
 * Teren izometryczny: per-cel diament (Sprite), anchor (0.5,0.5) w toScreen(gx,gy).
 * Drawn in depth order (gx+gy), so a tile's thin back side does not overlap the
 * front. Flat background layer (unsorted), added below unitLayer in view.ts.
 *
 * Texture cooperation (Task 2): where two biomes meet, the cell gets (a) a light
 * outline (darkening) and (b) "feather", a neighbor texture overlay shifted
 * toward the shared edge. This is a procedural stand-in for transition tiles
 * (for example water edge) without generating new assets. Tint jitter (+/-5%)
 * stays as before.
 */
export function buildIsoTilemap(theme: ThemeDef, worldRect?: WorldRect): Container {
  const root = new Container();
  const map = buildTerrainMap(theme); // gameplay grid (feather + outline only here)
  const sample = terrainSampler(theme); // "wild land" biome outside the grid
  const { w, h } = theme.grid;

  // Tile dimensions from projection (toScreen(1,0) relative to toScreen(0,0) = (tileW/2, tileH/2)).
  const p00 = theme.projection.toScreen(0, 0);
  const p10 = theme.projection.toScreen(1, 0);
  const tileW = (p10.x - p00.x) * 2;
  const tileH = (p10.y - p00.y) * 2;

  // Cell range: the whole world rectangle (diamond-shaped index range) or,
  // without a rectangle, the gameplay grid itself (old behavior).
  const cells: { gx: number; gy: number }[] = [];
  if (worldRect) {
    const r = isoFillRange(tileW, tileH, worldRect);
    for (let gy = r.gyMin; gy <= r.gyMax; gy++) for (let gx = r.gxMin; gx <= r.gxMax; gx++) cells.push({ gx, gy });
  } else {
    for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) cells.push({ gx, gy });
  }
  cells.sort((a, b) => a.gx + a.gy - (b.gx + b.gy)); // back -> front

  for (const { gx, gy } of cells) {
    const p = theme.projection.toScreen(gx, gy);
    // Culling: skip cells whose diamond does not touch the world rectangle
    // (isoFillRange gives a diamond circumscribed around the rectangle -> about 2x excess without this).
    if (worldRect) {
      if (p.x + tileW / 2 < worldRect.minX || p.x - tileW / 2 > worldRect.maxX) continue;
      if (p.y + tileH / 2 < worldRect.minY || p.y - tileH / 2 > worldRect.maxY) continue;
    }
    const inGrid = gx >= 0 && gy >= 0 && gx < w && gy < h;
    const tex = tiles.get(inGrid ? map[gy][gx] : sample(gx, gy));
    if (!tex) continue;
    const j = jitter01(gx, gy);
    const edges = inGrid ? biomeEdges(map, gx, gy) : []; // feather/kontur tylko w obszarze gry

    const s = new Sprite(tex);
    s.anchor.set(0.5, 0.5);
    s.scale.set(theme.tile / tex.width); // 32px diamond -> tile width (tileW=64)
    s.position.set(p.x, p.y);
    s.tint = grayTint(j * (edges.length ? BOUNDARY_SHADE : 1));
    root.addChild(s);

    // feather: overlay each different neighbor's texture, biased toward its edge
    if (FEATHER_ALPHA > 0) {
      for (const e of edges) {
        const ntex = tiles.get(e.biome);
        if (!ntex) continue;
        const np = theme.projection.toScreen(gx + e.dgx, gy + e.dgy);
        const f = new Sprite(ntex);
        f.anchor.set(0.5, 0.5);
        f.scale.set((theme.tile / ntex.width) * FEATHER_SCALE);
        f.position.set(p.x + (np.x - p.x) * FEATHER_OFFSET, p.y + (np.y - p.y) * FEATHER_OFFSET);
        f.alpha = FEATHER_ALPHA;
        f.tint = grayTint(j);
        root.addChild(f);
      }
    }
  }
  return root;
}
