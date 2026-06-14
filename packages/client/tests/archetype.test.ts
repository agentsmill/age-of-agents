import { describe, it, expect } from 'vitest';
import { sessionToArchetypeKey, stateToAnimation, archetypeKeyChain } from '../src/game/archetype';
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

describe('archetypeKeyChain (degradacja brakującego wariantu trybu → atlas modelu)', () => {
  it('tryb ≠ default degraduje do <model>-default, potem globalny fallback', () => {
    expect(archetypeKeyChain('opus-acceptEdits')).toEqual(['opus-acceptEdits', 'opus-default', 'sonnet-default']);
  });
  it('default → bez duplikatu <model>-default', () => {
    expect(archetypeKeyChain('haiku-default')).toEqual(['haiku-default', 'sonnet-default']);
  });
  it('globalny fallback sam dla siebie', () => {
    expect(archetypeKeyChain('sonnet-default')).toEqual(['sonnet-default']);
  });
});

describe('stateToAnimation', () => {
  it('working → work', () => expect(stateToAnimation('working', false)).toBe('work'));
  it('w ruchu → walk niezależnie od stanu', () => expect(stateToAnimation('idle', true)).toBe('walk'));
  it('returning → walk', () => expect(stateToAnimation('returning', false)).toBe('walk'));
  it('thinking → idle', () => expect(stateToAnimation('thinking', false)).toBe('idle'));
  it('error → idle', () => expect(stateToAnimation('error', false)).toBe('idle'));
});
