import { describe, it, expect } from 'vitest';
import { deriveNotification } from '../src/notifications';
import type { GameEvent, HeroSnapshot } from '@agent-citadel/shared';

const hero = (over: Partial<HeroSnapshot>): HeroSnapshot => ({
  sessionId: 's1',
  title: 'Knight',
  projectDir: '/p',
  teamColor: 0,
  state: 'working',
  tokens: { input: 0, output: 0 },
  startedAt: '2026-06-14T00:00:00Z',
  lastActivityAt: '2026-06-14T00:00:00Z',
  ...over,
});

const NOW = 1_000_000;

describe('deriveNotification', () => {
  it('alerts when hero ENTERS awaiting-input', () => {
    const prev = hero({ state: 'working' });
    const ev: GameEvent = { type: 'hero-updated', hero: hero({ state: 'awaiting-input' }) };
    const n = deriveNotification(prev, ev, NOW);
    expect(n?.reason).toBe('needs-you');
    expect(n?.kind).toBe('alert');
    expect(n?.sessionId).toBe('s1');
    expect(n?.ttl).toBe(12_000);
  });

  it('null when still awaiting-input (no edge)', () => {
    const prev = hero({ state: 'awaiting-input' });
    const ev: GameEvent = { type: 'hero-updated', hero: hero({ state: 'awaiting-input' }) };
    expect(deriveNotification(prev, ev, NOW)).toBeNull();
  });

  it('error when entering error', () => {
    const prev = hero({ state: 'working' });
    const ev: GameEvent = { type: 'hero-updated', hero: hero({ state: 'error' }) };
    expect(deriveNotification(prev, ev, NOW)?.reason).toBe('error');
  });

  it('mission completed → success; failed → null', () => {
    const base = { id: 'm1', sessionId: 's1', prompt: 'Do X', startedAt: '2026-06-14T00:00:00Z' };
    const done: GameEvent = { type: 'mission-completed', mission: { ...base, status: 'completed' } };
    const fail: GameEvent = { type: 'mission-completed', mission: { ...base, status: 'failed' } };
    expect(deriveNotification(undefined, done, NOW)?.reason).toBe('mission-done');
    expect(deriveNotification(undefined, done, NOW)?.ttl).toBe(6_000);
    expect(deriveNotification(undefined, fail, NOW)).toBeNull();
  });

  it('calm spawn -> new-session; spawn in awaiting-input -> needs-you (alert wins)', () => {
    const calm: GameEvent = { type: 'hero-spawned', hero: hero({ state: 'idle' }) };
    const busy: GameEvent = { type: 'hero-spawned', hero: hero({ state: 'awaiting-input' }) };
    expect(deriveNotification(undefined, calm, NOW)?.reason).toBe('new-session');
    expect(deriveNotification(undefined, busy, NOW)?.reason).toBe('needs-you');
  });

  it('unsupported type -> null', () => {
    const ev: GameEvent = {
      type: 'transcript-line',
      line: { sessionId: 's1', role: 'assistant', text: 'hi', ts: 'x' },
    };
    expect(deriveNotification(undefined, ev, NOW)).toBeNull();
  });
});
