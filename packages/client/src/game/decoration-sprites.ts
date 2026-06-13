import { Assets, type Spritesheet, type Texture } from 'pixi.js';
import type { DecoKind } from './decorations';

const tex = new Map<string, Texture>();

/** Ładuje tekstury dekoracji danego motywu wg index.json. Brak → brak rozsiewu. */
export async function loadDecorationSprites(themeId: string): Promise<void> {
  tex.clear();
  try {
    const res = await fetch(`/assets/${themeId}/decorations/index.json`);
    if (!res.ok) return;
    const idx: { ids: string[] } = await res.json();
    for (const id of idx.ids) {
      try {
        const sheet = await Assets.load<Spritesheet>(`/assets/${themeId}/decorations/${id}.json`);
        tex.set(id, sheet.textures[Object.keys(sheet.textures)[0]]);
      } catch {
        /* pojedynczy brak — pomijamy ten rodzaj */
      }
    }
  } catch {
    /* brak indeksu — brak dekoracji */
  }
}

export function getDecorationTexture(kind: DecoKind): Texture | null {
  return tex.get(kind) ?? null;
}
