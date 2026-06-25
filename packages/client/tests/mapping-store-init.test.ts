import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_MAPPING } from '../src/theme/mapping';

/**
 * Store initialization from localStorage cache (readCache) - a key promise of spec
 * 4.3: "the world renders correctly before fetch returns". Testable only by
 * setting localStorage BEFORE module import (readCache runs during create()),
 * hence vi.resetModules + dynamic import. Isolated in a separate file to avoid
 * polluting the useMapping singleton in other tests.
 */

afterEach(() => {
  vi.resetModules();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function fakeStorage(initial: Record<string, string>) {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

describe('useMapping init with localStorage cache', () => {
  it('initializes mapping from valid cache', async () => {
    const custom = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'age-of-agents.mapping': JSON.stringify(custom),
    });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(custom);
  });

  it('broken cache -> DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'age-of-agents.mapping': '{ broken' });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('invalid config in cache -> DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'age-of-agents.mapping': JSON.stringify({ rules: [], fallback: 'nope' }),
    });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('missing cache -> DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({});
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });
});
