import { Assets, type Texture } from 'pixi.js';
import type { DecoKind } from './decorations';

const tex = new Map<string, Texture>();

/** Ładuje tekstury dekoracji wprost z PNG (unikalny URL per motyw → brak kolizji cache). */
export async function loadDecorationSprites(themeId: string): Promise<void> {
  tex.clear();
  try {
    const res = await fetch(`/assets/${themeId}/decorations/index.json`);
    if (!res.ok) return;
    const idx: { ids: string[] } = await res.json();
    for (const id of idx.ids) {
      try {
        tex.set(id, await Assets.load<Texture>(`/assets/${themeId}/decorations/${id}.png`));
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
