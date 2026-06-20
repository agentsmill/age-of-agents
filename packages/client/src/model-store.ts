import { create } from 'zustand';
import {
  resolveModel,
  DEFAULT_MODEL_CONFIG,
  upgradeModelConfig,
  validateModelConfig,
  type ModelConfig,
  type ResolvedModel,
} from './theme/models';

/**
 * Editable model-registry store. The local server is the source of truth (file),
 * but the client keeps an optimistic cache so the world reacts IMMEDIATELY:
 * setModels updates state + localStorage + background PUT. Twin of mapping-store.ts.
 */
const STORAGE_KEY = 'age-of-agents.models';

function readCache(): ModelConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_MODEL_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MODEL_CONFIG;
    const res = validateModelConfig(JSON.parse(raw));
    return res.ok ? upgradeModelConfig(res.config) : DEFAULT_MODEL_CONFIG;
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

function writeCache(config: ModelConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* quota / private mode: ignore */
  }
}

function putModels(config: ModelConfig): void {
  if (typeof fetch === 'undefined') return;
  try {
    fetch('/model-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }).catch(() => {
      /* non-blocking PUT */
    });
  } catch {
    /* synchronous fetch throw */
  }
}

interface ModelStore {
  models: ModelConfig;
  modelsLoaded: boolean;
  setModels(config: ModelConfig): void;
  resetModels(): void;
  hydrate(): Promise<void>;
}

export const useModels = create<ModelStore>((set, get) => ({
  models: readCache(),
  modelsLoaded: false,
  setModels: (config) => {
    set({ models: config }); // state always current; editor shows the live entry
    // Persist ONLY valid config. Temporarily invalid state (for example a freshly
    // added row with an empty pattern) must not reach localStorage/server, or
    // readCache would reject the WHOLE config on reload and reset to DEFAULT,
    // losing the user's other edits.
    if (validateModelConfig(config).ok) {
      writeCache(config);
      putModels(config);
    }
  },
  resetModels: () => get().setModels(DEFAULT_MODEL_CONFIG),
  hydrate: async () => {
    if (typeof fetch === 'undefined') {
      set({ modelsLoaded: true });
      return;
    }
    try {
      const res = await fetch('/model-config');
      if (res.ok) {
        const parsed: unknown = await res.json();
        const v = validateModelConfig(parsed);
        if (v.ok) {
          const upgraded = upgradeModelConfig(v.config);
          set({ models: upgraded });
          writeCache(upgraded);
        }
      }
    } catch {
      /* network failed: keep cache/DEFAULT */
    }
    set({ modelsLoaded: true });
  },
}));

/**
 * Resolver for non-React consumers (ticker in game/view.ts): reads current
 * config from the store via getState, without coupling to the React tree.
 */
export function resolveModelLive(model: string | undefined): ResolvedModel {
  return resolveModel(model, useModels.getState().models);
}
