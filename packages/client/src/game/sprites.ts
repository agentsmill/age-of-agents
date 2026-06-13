import { Assets, type Spritesheet } from 'pixi.js';

const heroSheets = new Map<string, Spritesheet>();
let peonSheet: Spritesheet | null = null;

/**
 * Eager-load atlasów bohaterów danego motywu wg index.json.
 * (Faza 2 zamieni to na leniwe ładowanie per-archetyp obecny na mapie.)
 * Brak index.json / pojedynczego atlasu → cicho zostawiamy fallback placeholdera.
 */
export async function loadThemeSprites(themeId: string): Promise<void> {
  heroSheets.clear();
  peonSheet = null;
  const base = `/assets/${themeId}/heroes`;
  let index: { keys: string[] };
  try {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) return;
    index = await res.json();
  } catch {
    return;
  }
  for (const key of index.keys) {
    try {
      const sheet = await Assets.load<Spritesheet>(`${base}/${key}.json`);
      heroSheets.set(key, sheet);
    } catch {
      /* brak pojedynczego atlasu → fallback dla tego klucza */
    }
  }
}

/** Spritesheet bohatera dla klucza archetypu, albo null (→ placeholder). */
export function getHeroSheet(key: string): Spritesheet | null {
  return heroSheets.get(key) ?? null;
}

/** Spritesheet peona (Faza 1: brak → null → placeholder). */
export function getPeonSheet(): Spritesheet | null {
  return peonSheet;
}
