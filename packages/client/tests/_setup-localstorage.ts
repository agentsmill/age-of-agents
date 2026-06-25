// Side-effect-only helper: polyfill `localStorage` for the node test env (the
// client has no jsdom). Some modules read localStorage during module init
// (e.g. settings.ts at create()), so importing them — even transitively, like
// model-store.ts -> settings.ts — throws before any test runs. Import this
// FIRST (above the module under test) so the global exists at import time.
// ES import declarations are hoisted, so an inline assignment in the test file
// would run too late; a leading side-effect import is evaluated in order.
//
// NB: Node 22+ ships a built-in `localStorage` (experimental Web Storage), so it
// is *defined* but non-functional without a backing file — getItem throws. Guard
// on a working getItem, not on `undefined`, and override the broken built-in.
const current = (globalThis as { localStorage?: { getItem?: unknown } }).localStorage;
if (typeof current?.getItem !== 'function') {
  const store: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}
