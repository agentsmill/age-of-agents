import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_MAPPING } from '../src/theme/mapping';

/**
 * Inicjalizacja store z cache localStorage (readCache) — kluczowa obietnica spec
 * 4.3: „świat renderuje poprawnie zanim wróci fetch". Testowalne tylko przez
 * ustawienie localStorage PRZED importem modułu (readCache biegnie przy create()),
 * stąd vi.resetModules + dynamiczny import. Izolowane w osobnym pliku, by nie
 * zaśmiecić singletona useMapping w pozostałych testach.
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

describe('useMapping init z cache localStorage', () => {
  it('inicjalizuje mapping z poprawnego cache', async () => {
    const custom = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'age-of-agents.mapping': JSON.stringify(custom),
    });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(custom);
  });

  it('uszkodzony cache → DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'age-of-agents.mapping': '{ zepsuty' });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('niepoprawny config w cache → DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      'age-of-agents.mapping': JSON.stringify({ rules: [], fallback: 'nope' }),
    });
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });

  it('brak cache → DEFAULT_MAPPING', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({});
    vi.resetModules();
    const { useMapping } = await import('../src/mapping-store');
    expect(useMapping.getState().mapping).toEqual(DEFAULT_MAPPING);
  });
});
