import { create } from 'zustand';
import {
  resolveBuilding,
  DEFAULT_MAPPING,
  validateMapping,
  type MappingConfig,
  type BuildingId,
} from './theme/mapping';

/**
 * Store edytowalnej mapy narzędzie→budynek. Lokalny serwer jest źródłem prawdy
 * (plik na dysku), ale klient trzyma optymistyczny cache, by świat reagował na
 * zmianę NATYCHMIAST: `setMapping` ustawia stan + zapis localStorage + PUT w tle.
 *
 * Wszystkie dotknięcia `localStorage`/`fetch` są strażowane `typeof` — moduł
 * importuje się i działa też w środowisku node (testy, brak DOM).
 */

const STORAGE_KEY = 'age-of-agents.mapping';

function readCache(): MappingConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_MAPPING;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MAPPING;
    const res = validateMapping(JSON.parse(raw));
    return res.ok ? res.config : DEFAULT_MAPPING;
  } catch {
    return DEFAULT_MAPPING;
  }
}

function writeCache(config: MappingConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* quota / prywatny tryb → ignoruj, serwer i tak ma źródło prawdy */
  }
}

function putMapping(config: MappingConfig): void {
  if (typeof fetch === 'undefined') return;
  try {
    fetch('/tool-mapping', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }).catch(() => {
      /* PUT nieblokujący — błąd nie psuje UI (stan i cache już ustawione) */
    });
  } catch {
    /* gdyby fetch rzucił synchronicznie (np. zła baza URL w teście) */
  }
}

interface MappingStore {
  mapping: MappingConfig;
  /** Czy serwer odpowiedział na początkowy GET (do ewentualnego „ładowanie…"). */
  mappingLoaded: boolean;
  setMapping(config: MappingConfig): void;
  resetMapping(): void;
  hydrate(): Promise<void>;
}

export const useMapping = create<MappingStore>((set, get) => ({
  mapping: readCache(),
  mappingLoaded: false,
  setMapping: (config) => {
    set({ mapping: config });
    writeCache(config);
    putMapping(config); // optymistycznie: zapis na serwer w tle
  },
  resetMapping: () => get().setMapping(DEFAULT_MAPPING),
  hydrate: async () => {
    if (typeof fetch === 'undefined') {
      set({ mappingLoaded: true });
      return;
    }
    try {
      const res = await fetch('/tool-mapping');
      if (res.ok) {
        const parsed: unknown = await res.json();
        const v = validateMapping(parsed);
        if (v.ok) {
          set({ mapping: v.config });
          writeCache(v.config);
        }
      }
    } catch {
      /* sieć padła → zostaje cache/DEFAULT */
    }
    set({ mappingLoaded: true });
  },
}));

/**
 * Resolver dla konsumentów spoza Reacta (ticker w game/view.ts): czyta aktualną
 * mapę ze store przez getState — bez couplingu z drzewem React (jak useWorld).
 */
export function resolveBuildingLive(tool: string | undefined, detail?: string): BuildingId {
  return resolveBuilding(tool, detail, useMapping.getState().mapping);
}
