import { Assets, type Spritesheet } from 'pixi.js';
import { archetypeKeyChain } from './archetype';

const heroSheets = new Map<string, Spritesheet>();
let peonSheet: Spritesheet | null = null;
let currentTheme = '';

/**
 * Eager-load atlasów bohaterów danego motywu wg index.json.
 * (Faza 2 zamieni to na leniwe ładowanie per-archetyp obecny na mapie.)
 * Brak index.json / pojedynczego atlasu → cicho zostawiamy fallback placeholdera.
 *
 * CRITICAL: Pixi 8's Assets cache is keyed by alias. To support theme switching
 * without cache collisions, we use theme-specific aliases (e.g. "fantasy/hero/fable"
 * vs "scifi/hero/fable"). Both can coexist in cache. We do NOT unload the old
 * theme's cache entries — leaving them is harmless and avoids the risk that
 * unloading a Spritesheet invalidates base textures still referenced by
 * AnimatedSprites that haven't been destroyed yet.
 */
export async function loadThemeSprites(themeId: string): Promise<void> {
  if (themeId === currentTheme) return; // già caricato
  heroSheets.clear();
  peonSheet = null;
  currentTheme = themeId;
  const base = `/assets/${themeId}/heroes`;
  let index: { keys: string[] };
  try {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) {
      console.warn(`[heroes] No index.json for ${themeId} (${res.status})`);
      return;
    }
    index = await res.json();
    console.log(`[heroes] Loading ${themeId}:`, index.keys);
  } catch (err) {
    console.warn(`[heroes] Fetch failed for ${themeId}:`, err);
    return;
  }
  for (const key of index.keys) {
    try {
      // Alias includes themeId to prevent cross-theme cache collisions in Pixi 8.
      const alias = `${themeId}/${key}`;
      const sheet = await Assets.load<Spritesheet>({ alias, src: `${base}/${key}.json` });
      if (sheet) {
        heroSheets.set(key, sheet);
        console.log(`[heroes]   ✓ ${key} loaded: ${Object.keys(sheet.animations).join(',')}`);
      } else {
        console.warn(`[heroes]   ✗ ${key} returned null`);
      }
    } catch (err) {
      console.warn(`[heroes]   ✗ ${key} failed:`, err);
    }
  }
}

// NOTE: Per-theme aliases prevent Pixi 8 cache collisions without explicit unload.
// Old theme entries remain in cache harmlessly. See loadThemeSprites docstring.

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
