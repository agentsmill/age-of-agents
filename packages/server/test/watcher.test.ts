import { describe, expect, it } from 'vitest';
import { isLiveAtStartup, SourceWatcher } from '../src/watcher.js';
import { DEFAULT_THRESHOLDS } from '../src/state-machine.js';
import { World } from '../src/world.js';
import type { AgentSource } from '../src/sources/types.js';

const stubSource: AgentSource = {
  id: 'claude',
  roots: () => [],
  classify: () => ({ kind: 'other' }),
  parseLine: () => [],
};

describe('isLiveAtStartup — okno wykrywania sesji przy starcie', () => {
  const now = Date.parse('2026-06-14T12:00:00.000Z');
  // Okno startowe = removeAfterMs: tworzymy bohatera tylko dla sesji, która i tak
  // by nie została od razu usunięta przez maszynę stanów (brak migotania).
  const W = DEFAULT_THRESHOLDS.removeAfterMs;

  it('sesja cicha od 20 min jest żywa przy starcie (regresja: stare 10-min okno ją gubiło)', () => {
    expect(isLiveAtStartup(now - 20 * 60_000, now, W)).toBe(true);
  });

  it('sesja cicha od 40 min (poza removeAfterMs) nie jest żywa przy starcie', () => {
    expect(isLiveAtStartup(now - 40 * 60_000, now, W)).toBe(false);
  });

  it('świeżo zapisana sesja (1 min) jest żywa', () => {
    expect(isLiveAtStartup(now - 60_000, now, W)).toBe(true);
  });
});

describe('applyExternalFacts — strike na /clear', () => {
  it('kieruje cleared do dotychczasowego bohatera w tym samym cwd, nie do nowej sesji', () => {
    const world = new World();
    const watcher = new SourceWatcher(world, stubSource);
    const cwd = '/home/lachlan/age-of-agents';

    watcher.applyExternalFacts('old-session', 'age-of-agents', [{ kind: 'meta', cwd }]);
    watcher.applyExternalFacts(
      'new-session',
      'age-of-agents',
      [
        { kind: 'meta', cwd },
        { kind: 'cleared', ts: new Date().toISOString() },
      ],
      cwd,
    );

    expect(world.getHero('old-session')?.clearedAt).toBeTypeOf('number');
    expect(world.getHero('new-session')?.clearedAt).toBeUndefined();
  });

  it('bez cwd dopasowującego inną sesję cleared trafia do nowej sesji', () => {
    const world = new World();
    const watcher = new SourceWatcher(world, stubSource);

    watcher.applyExternalFacts('solo-session', 'age-of-agents', [
      { kind: 'meta', cwd: '/home/lachlan/age-of-agents' },
      { kind: 'cleared', ts: new Date().toISOString() },
    ]);

    expect(world.getHero('solo-session')?.clearedAt).toBeTypeOf('number');
  });
});
