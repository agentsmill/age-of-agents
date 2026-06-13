import { Assets, type Texture } from 'pixi.js';
import type { BuildingId } from '../theme/types';

const tex = new Map<string, Texture>();

/**
 * Ładuje tekstury budynków danego motywu wprost z PNG (unikalny URL per motyw
 * → brak globalnej kolizji cache Pixi po nazwie klatki/obrazu). Brak → fallback.
 */
export async function loadBuildingSprites(themeId: string): Promise<void> {
  tex.clear();
  try {
    const res = await fetch(`/assets/${themeId}/buildings/index.json`);
    if (!res.ok) return;
    const idx: { ids: string[] } = await res.json();
    for (const id of idx.ids) {
      try {
        tex.set(id, await Assets.load<Texture>(`/assets/${themeId}/buildings/${id}.png`));
      } catch {
        /* pojedynczy brak → fallback dla tego budynku */
      }
    }
  } catch {
    /* brak indeksu → placeholdery */
  }
}

export function getBuildingSprite(id: BuildingId): Texture | null {
  return tex.get(id) ?? null;
}
