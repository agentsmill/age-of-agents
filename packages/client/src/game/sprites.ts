import { Assets, type Spritesheet } from 'pixi.js';
import { archetypeKeyChain } from './archetype';

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

/**
 * Spritesheet bohatera dla klucza archetypu. Degraduje brakujący wariant trybu do
 * atlasu `<model>-default` (a potem globalnego fallbacku), więc bohater w trybie ≠
 * default dostaje sprite SWOJEGO modelu zamiast placeholdera. null → placeholder.
 */
export function getHeroSheet(key: string): Spritesheet | null {
  for (const k of archetypeKeyChain(key)) {
    const sheet = heroSheets.get(k);
    if (sheet) return sheet;
  }
  return null;
}

/** Spritesheet peona (Faza 1: brak → null → placeholder). */
export function getPeonSheet(): Spritesheet | null {
  return peonSheet;
}
