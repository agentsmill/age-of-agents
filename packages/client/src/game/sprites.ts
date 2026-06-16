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
 * WAŻNE: Pixi 8 ma Assets.cache interna z URL → zasób. Przy zmianie tematu
 * musimy unloadować klucze starego tematu, bo Pixi pamięta je po URL i mógłby
 * odpowiedzieć starą wersją (albo po prostu zwrócić undefined dla nowego
 * tematu, jeśli parsowanie w spritesheet.load się wywaliło wcześniej).
 */
export async function loadThemeSprites(themeId: string): Promise<void> {
  // Najpierw wyrzuć z cache Pixi wszystko co dotyczy starego tematu.
  if (currentTheme && currentTheme !== themeId) {
    await unloadTheme(currentTheme);
  }
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
      const sheet = await Assets.load<Spritesheet>({ alias: `${themeId}/hero/${key}`, src: `${base}/${key}.json` });
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

/** Wymusza usunięcie assetów starego tematu z cache Pixi. */
async function unloadTheme(themeId: string): Promise<void> {
  const bases = [
    `/assets/${themeId}/heroes`,
    `/assets/${themeId}/buildings`,
    `/assets/${themeId}/decorations`,
    `/assets/${themeId}/tilemap-iso`,
    `/assets/${themeId}/tilemap`,
  ];
  for (const base of bases) {
    try {
      // indeksów nie da się unloadować (nie są w cache Pixi), tylko assety
      const idx = await fetch(`${base}/index.json`);
      if (!idx.ok) continue;
      const data = await idx.json();
      const items: string[] = data.keys ?? data.ids ?? [];
      for (const k of items) {
        const url = `${base}/${k}.${themeId === 'tilemap' || themeId === 'tilemap-iso' ? 'png' : 'json'}`;
        try { await Assets.unload(url); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  // Aliasy bohaterów
  for (const key of heroSheets.keys()) {
    try { await Assets.unload(`${themeId}/hero/${key}`); } catch { /* ignore */ }
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
