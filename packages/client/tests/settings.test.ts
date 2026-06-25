import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * settings.ts czyta localStorage przy create(), więc — jak w mapping-store-init —
 * shimujemy localStorage PRZED dynamicznym importem modułu.
 */
afterEach(() => {
  vi.resetModules();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

function fakeStorage(initial: Record<string, string> = {}) {
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

describe('useSettings — missionsCollapsed', () => {
  it('domyślnie rozwinięty, gdy brak klucza', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    expect(useSettings.getState().missionsCollapsed).toBe(false);
  });

  it('czyta zwinięty stan z localStorage ("1")', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'agent-citadel.missions-collapsed': '1' });
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    expect(useSettings.getState().missionsCollapsed).toBe(true);
  });

  it('setMissionsCollapsed zapisuje i utrwala stan', async () => {
    const ls = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    useSettings.getState().setMissionsCollapsed(true);
    expect(useSettings.getState().missionsCollapsed).toBe(true);
    expect(ls.getItem('agent-citadel.missions-collapsed')).toBe('1');
  });
});

describe('useSettings — flipped', () => {
  it('domyślnie nie odwraca miasta, gdy brak klucza', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    expect(useSettings.getState().flipped).toBe(false);
  });

  it('czyta odwrócony stan z localStorage ("1")', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'agent-citadel.flip': '1' });
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    expect(useSettings.getState().flipped).toBe(true);
  });

  it('setFlipped zapisuje i utrwala stan', async () => {
    const ls = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    vi.resetModules();
    const { useSettings } = await import('../src/settings');
    useSettings.getState().setFlipped(true);
    expect(useSettings.getState().flipped).toBe(true);
    expect(ls.getItem('agent-citadel.flip')).toBe('1');
  });
});
