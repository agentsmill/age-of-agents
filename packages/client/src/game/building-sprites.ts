import { Assets, type Texture } from 'pixi.js';
import type { BuildingId } from '../theme/types';

const tex = new Map<string, Texture>();
let currentTheme = '';

/**
 * Loads building textures for a theme directly from PNG (unique URL per theme
 * -> no global Pixi cache collision by frame/image name). Missing -> fallback.
 *
 * IMPORTANT: unload the old theme, because Pixi 8 remembers assets per URL and
 * may return an old cached texture instead of loading the new one after a theme change.
 */
export async function loadBuildingSprites(themeId: string): Promise<void> {
  if (currentTheme && currentTheme !== themeId) {
    for (const id of tex.keys()) {
      try { await Assets.unload(`/assets/${currentTheme}/buildings/${id}.png`); } catch { /* ignore */ }
    }
  }
  tex.clear();
  currentTheme = themeId;
  try {
    const res = await fetch(`/assets/${themeId}/buildings/index.json`);
    if (!res.ok) {
      console.warn(`[buildings] No index.json for ${themeId} (${res.status})`);
      return;
    }
    const idx: { ids: string[] } = await res.json();
    console.log(`[buildings] Loading ${themeId}:`, idx.ids);
    for (const id of idx.ids) {
      try {
        const t = await Assets.load<Texture>(`/assets/${themeId}/buildings/${id}.png`);
        if (t) {
          tex.set(id, t);
          console.log(`[buildings]   ✓ ${id} ${t.width}x${t.height}`);
        } else {
          console.warn(`[buildings]   ✗ ${id} returned null`);
        }
      } catch (err) {
        console.warn(`[buildings]   ✗ ${id} failed:`, err);
      }
    }
  } catch (err) {
    console.warn(`[buildings] Fetch failed for ${themeId}:`, err);
  }
}

export function getBuildingSprite(id: BuildingId): Texture | null {
  return tex.get(id) ?? null;
}
