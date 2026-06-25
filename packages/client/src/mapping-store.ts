import { create } from 'zustand';
import {
  resolveBuilding,
  DEFAULT_MAPPING,
  validateMapping,
  type MappingConfig,
  type BuildingId,
} from './theme/mapping';
import { apiFetch } from './api';

/**
 * Editable tool->building map store. The local server is the source of truth
 * (file on disk), but the client keeps an optimistic cache so the world reacts
 * to changes IMMEDIATELY: `setMapping` updates state + localStorage + background PUT.
 *
 * All `localStorage`/`fetch` touches are guarded with `typeof`; the module also
 * imports and works in node environments (tests, no DOM).
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
    /* quota / private mode: ignore; the server is still the source of truth */
  }
}

function putMapping(config: MappingConfig): void {
  if (typeof fetch === 'undefined') return;
  try {
    apiFetch('/tool-mapping', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }).catch(() => {
      /* non-blocking PUT: failure does not break UI (state and cache are already set) */
    });
  } catch {
    /* if fetch throws synchronously (for example a bad base URL in a test) */
  }
}

interface MappingStore {
  mapping: MappingConfig;
  /** Whether the server answered the initial GET (for possible "loading..."). */
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
    putMapping(config); // optimistic: save to server in the background
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
      /* network failed: keep cache/DEFAULT */
    }
    set({ mappingLoaded: true });
  },
}));

/**
 * Resolver for non-React consumers (ticker in game/view.ts): reads the current
 * map from the store via getState, without coupling to the React tree (like useWorld).
 */
export function resolveBuildingLive(tool: string | undefined, detail?: string): BuildingId {
  return resolveBuilding(tool, detail, useMapping.getState().mapping);
}
