import { describe, expect, it } from 'vitest';
import type { HeroSnapshot } from '@agent-citadel/shared';
import { aggregateWielded, bareName } from '../src/hud/arsenal-select';

function hero(over: Partial<HeroSnapshot>): HeroSnapshot {
  return { sessionId: 's', title: 't', projectDir: 'PD', teamColor: 0, state: 'idle', tokens: { input: 0, output: 0 }, startedAt: '', lastActivityAt: '', ...over } as HeroSnapshot;
}

describe('aggregateWielded', () => {
  it('combines wielded heroes for a city and normalizes skill names', () => {
    const heroes = {
      a: hero({ sessionId: 'a', projectDir: 'PD', wielded: { skills: ['superpowers:brainstorming'], connectors: ['visualize'], plugins: ['superpowers'] } }),
      b: hero({ sessionId: 'b', projectDir: 'PD', wielded: { skills: ['code-review'], connectors: [], plugins: [] } }),
      c: hero({ sessionId: 'c', projectDir: 'OTHER', wielded: { skills: ['x'], connectors: [], plugins: [] } }),
    };
    const w = aggregateWielded(heroes, 'PD');
    expect(new Set(w.skills)).toEqual(new Set(['brainstorming', 'code-review']));
    expect(w.connectors).toEqual(['visualize']);
  });

  it('bareName cuts plugin namespace', () => {
    expect(bareName('superpowers:brainstorming')).toBe('brainstorming');
    expect(bareName('plain')).toBe('plain');
  });
});
