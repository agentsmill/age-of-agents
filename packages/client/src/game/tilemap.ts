import '@pixi/tilemap';
import { CompositeTilemap } from '@pixi/tilemap';
import { Assets, Container, type Spritesheet } from 'pixi.js';
import type { ThemeDef } from '../theme/types';
import { buildTerrainMap, type TerrainId } from './terrain-map';
import { cornerMask, frameForMask } from './autotile';

const sheets = new Map<string, Spritesheet>(); // pair -> sheet
let tilePx = 32;

/** Transition pairs and their "upper" terrain, in priority order (later = higher). */
const PAIRS: { pair: string; upper: TerrainId }[] = [
  { pair: 'water', upper: 'water' },
  { pair: 'dirt', upper: 'dirt' },
  { pair: 'rock', upper: 'rock' },
];

export async function loadTilemaps(themeId: string): Promise<void> {
  sheets.clear();
  try {
    const idx = await (await fetch(`/assets/${themeId}/tilemap/index.json`)).json();
    tilePx = idx.tile ?? 32;
    for (const pair of idx.pairs as string[]) {
      try {
        sheets.set(pair, await Assets.load<Spritesheet>(`/assets/${themeId}/tilemap/${pair}.json`));
      } catch {
        /* single missing pair: skip it */
      }
    }
  } catch {
    /* no tilesets -> drawTerrain fallback in view.ts */
  }
}

export function hasTilemaps(): boolean {
  return sheets.size > 0;
}

/**
 * Builds the terrain layer: full-screen grass base + one dual-grid layer per
 * pair. Tile scale = theme.tile / tilePx. The layer is a flat background,
 * added to worldLayer BEFORE unitLayer, and never enters depth-sort.
 */
export function buildTilemap(theme: ThemeDef): Container {
  const root = new Container();
  const map = buildTerrainMap(theme);
  const scale = theme.tile / tilePx;
  const inBounds = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < theme.grid.w && gy < theme.grid.h;
  const isUpperFor = (upper: TerrainId) => (gx: number, gy: number) => inBounds(gx, gy) && map[gy][gx] === upper;

  // Grass base underneath (each render tile uses frame t_0 from any pair).
  const baseSheet = sheets.get('dirt') ?? sheets.values().next().value;
  if (baseSheet) {
    const baseLayer = new CompositeTilemap();
    baseLayer.scale.set(scale);
    const tex = baseSheet.textures['t_0'];
    if (tex) {
      for (let dy = 0; dy <= theme.grid.h; dy++)
        for (let dx = 0; dx <= theme.grid.w; dx++)
          baseLayer.tile(tex, dx * tilePx - tilePx / 2, dy * tilePx - tilePx / 2);
    }
    root.addChild(baseLayer);
  }

  // Transition layers by priority.
  for (const { pair, upper } of PAIRS) {
    const sheet = sheets.get(pair);
    if (!sheet) continue;
    const layer = new CompositeTilemap();
    layer.scale.set(scale);
    const isUpper = isUpperFor(upper);
    for (let dy = 0; dy <= theme.grid.h; dy++) {
      for (let dx = 0; dx <= theme.grid.w; dx++) {
        const mask = cornerMask(dx, dy, isUpper);
        if (mask === 0) continue; // base only
        const tex = sheet.textures[`t_${frameForMask(mask)}`];
        if (tex) layer.tile(tex, dx * tilePx - tilePx / 2, dy * tilePx - tilePx / 2);
      }
    }
    root.addChild(layer);
  }
  return root;
}
