import { describe, it, expect } from 'vitest';
import { sessionToArchetypeKey, stateToAnimation } from '../src/game/archetype';
import type { HeroSnapshot } from '@agent-citadel/shared';

const hero = (model?: string, permissionMode?: string): HeroSnapshot => ({
  sessionId: 's', title: 't', projectDir: '/p', teamColor: 0, state: 'idle',
  tokens: { input: 0, output: 0 }, startedAt: '', lastActivityAt: '',
  model, permissionMode,
});

describe('sessionToArchetypeKey', () => {
  it('czyste model+mode → "<model>-<mode>"', () => {
    expect(sessionToArchetypeKey(hero('opus', 'plan'))).toBe('opus-plan');
  });
  it('brak model → fallback', () => {
    expect(sessionToArchetypeKey(hero(undefined, 'plan'))).toBe('sonnet-default');
  });
  it('brak mode → tryb default', () => {
    expect(sessionToArchetypeKey(hero('haiku', undefined))).toBe('haiku-default');
  });
  it('nieznany model → fallback', () => {
    expect(sessionToArchetypeKey(hero('gpt-5', 'default'))).toBe('sonnet-default');
  });
  it('pełne id modelu (substring) → "<model>-<mode>"', () => {
    expect(sessionToArchetypeKey(hero('claude-opus-4-8[1m]', 'acceptEdits'))).toBe('opus-acceptEdits');
  });
});

describe('stateToAnimation', () => {
  it('working → work', () => expect(stateToAnimation('working', false)).toBe('work'));
  it('w ruchu → walk niezależnie od stanu', () => expect(stateToAnimation('idle', true)).toBe('walk'));
  it('returning → walk', () => expect(stateToAnimation('returning', false)).toBe('walk'));
  it('thinking → idle', () => expect(stateToAnimation('thinking', false)).toBe('idle'));
  it('error → idle', () => expect(stateToAnimation('error', false)).toBe('idle'));
});
