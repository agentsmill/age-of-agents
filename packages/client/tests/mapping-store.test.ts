import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMapping, resolveBuildingLive } from '../src/mapping-store';
import { DEFAULT_MAPPING, type MappingConfig } from '../src/theme/mapping';

const CUSTOM: MappingConfig = {
  rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }],
  fallback: 'citadel',
};

beforeEach(() => {
  useMapping.setState({ mapping: DEFAULT_MAPPING, mappingLoaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('useMapping store', () => {
  it('defaults to DEFAULT_MAPPING', () => {
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('setMapping updates state', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useMapping.getState().setMapping(CUSTOM);
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
  });

  it('setMapping sends PUT /tool-mapping (with session token)', async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve(new Response(url === '/session-token' ? JSON.stringify({ token: 'T' }) : '{}')),
    );
    vi.stubGlobal('fetch', f);
    useMapping.getState().setMapping(CUSTOM);
    await new Promise((r) => setTimeout(r, 0)); // token fetch + async PUT are fire-and-forget
    expect(f).toHaveBeenCalledWith('/tool-mapping', expect.objectContaining({ method: 'PUT' }));
  });

  it('setMapping saves to localStorage when available', () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useMapping.getState().setMapping(CUSTOM);
    expect(JSON.parse(store['age-of-agents.mapping'])).toEqual(CUSTOM);
  });

  it('resetMapping restores DEFAULT_MAPPING', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useMapping.setState({ mapping: CUSTOM });
    useMapping.getState().resetMapping();
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('rejected PUT does not break state or cache (optimistic save)', async () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))));
    useMapping.getState().setMapping(CUSTOM);
    await Promise.resolve(); // let the rejection propagate
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(JSON.parse(store['age-of-agents.mapping'])).toEqual(CUSTOM);
  });

  it('hydrate loads config from GET', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(CUSTOM)))));
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(useMapping.getState().mappingLoaded).toBe(true);
  });

  it('hydrate saves fetched config to localStorage cache', async () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(CUSTOM)))));
    await useMapping.getState().hydrate();
    expect(JSON.parse(store['age-of-agents.mapping'])).toEqual(CUSTOM);
  });

  it('hydrate leaves current config on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))));
    useMapping.setState({ mapping: CUSTOM });
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(useMapping.getState().mappingLoaded).toBe(true);
  });

  it('hydrate ignores invalid config from server', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ rules: [], fallback: 'nope' })))));
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });
});

describe('resolveBuildingLive', () => {
  it('uses current map from store', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    expect(resolveBuildingLive('Edit')).toBe('forge'); // DEFAULT
    useMapping.setState({ mapping: CUSTOM });
    expect(resolveBuildingLive('Edit')).toBe('library'); // custom
  });
});
