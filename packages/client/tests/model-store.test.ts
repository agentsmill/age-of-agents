import './_setup-localstorage'; // must precede the model-store import (settings.ts reads localStorage at init)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useModels, resolveModelLive } from '../src/model-store';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '../src/theme/models';

const CUSTOM: ModelConfig = {
  sprites: [{ match: { kind: 'pattern', pattern: 'opus' }, sprite: 'haiku' }],
  windows: [{ match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 500_000 }],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 },
};

beforeEach(() => {
  useModels.setState({ models: DEFAULT_MODEL_CONFIG, modelsLoaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('useModels store', () => {
  it('defaults to DEFAULT_MODEL_CONFIG', () => {
    expect(useModels.getState().models).toEqual(DEFAULT_MODEL_CONFIG);
  });
  it('setModels updates state and sends PUT /model-config (with session token)', async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve(new Response(url === '/session-token' ? JSON.stringify({ token: 'T' }) : '{}')),
    );
    vi.stubGlobal('fetch', f);
    useModels.getState().setModels(CUSTOM);
    expect(useModels.getState().models).toEqual(CUSTOM); // state is synchronous
    await new Promise((r) => setTimeout(r, 0)); // token fetch + async PUT are fire-and-forget
    expect(f).toHaveBeenCalledWith('/model-config', expect.objectContaining({ method: 'PUT' }));
  });
  it('resetModels restores DEFAULT', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    useModels.setState({ models: CUSTOM });
    useModels.getState().resetModels();
    expect(useModels.getState().models).toEqual(DEFAULT_MODEL_CONFIG);
  });
  it('rejected PUT does not break state (optimistic save)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))));
    useModels.getState().setModels(CUSTOM);
    await Promise.resolve();
    expect(useModels.getState().models).toEqual(CUSTOM);
  });
  it('invalid config: live state, but WITHOUT save to localStorage/PUT', () => {
    // Freshly added row with an empty pattern = temporarily invalid config.
    const invalid = {
      sprites: [{ match: { kind: 'pattern', pattern: '' }, sprite: 'opus' }],
      windows: [],
      fallback: { sprite: 'sonnet', contextWindow: 200_000 },
    } as unknown as ModelConfig;
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    const f = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', f);
    useModels.getState().setModels(invalid);
    expect(useModels.getState().models).toEqual(invalid); // live state (editor shows the row)
    expect(f).not.toHaveBeenCalled(); // do not PUT garbage
    expect(store['age-of-agents.models']).toBeUndefined(); // do not poison localStorage
  });
  it('hydrate loads config from GET', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(CUSTOM)))));
    await useModels.getState().hydrate();
    expect(useModels.getState().models.sprites[0]).toEqual(CUSTOM.sprites[0]);
    expect(useModels.getState().models.windows[0]).toEqual(CUSTOM.windows[0]);
    expect(useModels.getState().models.fallback).toEqual(CUSTOM.fallback);
    expect(useModels.getState().modelsLoaded).toBe(true);
  });
  it('hydrate upgrades older saved configs with built-in Codex presets', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(CUSTOM)))));
    await useModels.getState().hydrate();
    expect(resolveModelLive('gpt-5.5')).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.5',
      contextWindow: 258_400,
    });
    expect(resolveModelLive('gpt-5.3-codex-spark')).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.3 Codex Spark',
    });
  });
  it('hydrate ignores invalid config from server', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ sprites: [], windows: [], fallback: { sprite: 'nope', contextWindow: 1 } })))));
    await useModels.getState().hydrate();
    expect(useModels.getState().models).toEqual(DEFAULT_MODEL_CONFIG);
  });
});

describe('resolveModelLive', () => {
  it('uses current config from store', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    expect(resolveModelLive('claude-opus-4-8').sprite).toBe('opus'); // DEFAULT
    useModels.setState({ models: CUSTOM });
    expect(resolveModelLive('claude-opus-4-8').sprite).toBe('haiku'); // custom
    expect(resolveModelLive('claude-opus-4-8').contextWindow).toBe(500_000);
  });
});
