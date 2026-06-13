import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import type { ThemeDef } from '../theme/types';
import { buildTerrainMap } from './terrain-map';

const tiles = new Map<string, Texture>(); // TerrainId -> tekstura diamentu
let loaded = false;

/** Ładuje kafle izometryczne terenu (jeden diament per TerrainId). Brak → drawTerrain fallback. */
export async function loadIsoTiles(themeId: string): Promise<void> {
  tiles.clear();
  loaded = false;
  try {
    const res = await fetch(`/assets/${themeId}/tilemap-iso/index.json`);
    if (!res.ok) return;
    const idx: { ids: string[] } = await res.json();
    for (const id of idx.ids) {
      try {
        tiles.set(id, await Assets.load<Texture>(`/assets/${themeId}/tilemap-iso/${id}.png`));
      } catch {
        /* pojedynczy brak — pomijamy */
      }
    }
    loaded = tiles.size > 0;
  } catch {
    /* brak indeksu — fallback */
  }
}

export function hasIsoTiles(): boolean {
  return loaded;
}

/**
 * Teren izometryczny: per-cel diament (Sprite), anchor (0.5,0.5) w toScreen(gx,gy).
 * Rysowane w kolejności głębokości (gx+gy), by cienki bok kafla z tyłu nie nachodził
 * na przód. Płaska warstwa tła (niesortowana) — dodawana pod unitLayer w view.ts.
 * Delikatny deterministyczny tint jitter (±5%) rozbija jednolite pola.
 */
export function buildIsoTilemap(theme: ThemeDef): Container {
  const root = new Container();
  const map = buildTerrainMap(theme);
  const { w, h } = theme.grid;
  const cells: { gx: number; gy: number }[] = [];
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) cells.push({ gx, gy });
  cells.sort((a, b) => a.gx + a.gy - (b.gx + b.gy)); // tył → przód

  for (const { gx, gy } of cells) {
    const tex = tiles.get(map[gy][gx]);
    if (!tex) continue;
    const s = new Sprite(tex);
    s.anchor.set(0.5, 0.5);
    s.scale.set(theme.tile / tex.width); // diament 32px → szerokość kafla (tileW=64)
    const p = theme.projection.toScreen(gx, gy);
    s.position.set(p.x, p.y);
    const j = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
    const v = Math.min(255, Math.round(255 * (0.95 + (j % 100) / 1000))); // 0.95–1.05
    s.tint = (v << 16) | (v << 8) | v;
    root.addChild(s);
  }
  return root;
}
