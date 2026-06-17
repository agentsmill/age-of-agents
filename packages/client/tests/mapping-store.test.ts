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
  it('domyślnie DEFAULT_MAPPING', () => {
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('setMapping aktualizuje stan', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useMapping.getState().setMapping(CUSTOM);
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
  });

  it('setMapping wysyła PUT /tool-mapping', () => {
    const f = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', f);
    useMapping.getState().setMapping(CUSTOM);
    expect(f).toHaveBeenCalledWith('/tool-mapping', expect.objectContaining({ method: 'PUT' }));
  });

  it('setMapping zapisuje do localStorage gdy dostępny', () => {
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

  it('resetMapping przywraca DEFAULT_MAPPING', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useMapping.setState({ mapping: CUSTOM });
    useMapping.getState().resetMapping();
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('odrzucony PUT nie psuje stanu ani cache (optymistyczny zapis)', async () => {
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
    await Promise.resolve(); // pozwól odrzuceniu się rozejść
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(JSON.parse(store['age-of-agents.mapping'])).toEqual(CUSTOM);
  });

  it('hydrate wczytuje config z GET', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(CUSTOM)))));
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(useMapping.getState().mappingLoaded).toBe(true);
  });

  it('hydrate zapisuje pobrany config do cache localStorage', async () => {
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

  it('hydrate przy błędzie sieci zostawia obecny config', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))));
    useMapping.setState({ mapping: CUSTOM });
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(CUSTOM);
    expect(useMapping.getState().mappingLoaded).toBe(true);
  });

  it('hydrate ignoruje niepoprawny config z serwera', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ rules: [], fallback: 'nope' })))));
    await useMapping.getState().hydrate();
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });
});

describe('resolveBuildingLive', () => {
  it('używa aktualnej mapy ze store', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    expect(resolveBuildingLive('Edit')).toBe('forge'); // DEFAULT
    useMapping.setState({ mapping: CUSTOM });
    expect(resolveBuildingLive('Edit')).toBe('library'); // custom
  });
});
