import { describe, it, expect } from 'vitest';
import { sessionToArchetypeKey, stateToAnimation, archetypeKeyChain } from '../src/game/archetype';
import type { HeroSnapshot } from '@agent-citadel/shared';

describe('sessionToArchetypeKey - sprite override', () => {
  const base = { permissionMode: 'default' } as HeroSnapshot;
  it('spriteOverride wins over guessing from name', () => {
    expect(sessionToArchetypeKey({ ...base, model: 'llama3.1:8b' }, 'haiku')).toBe('haiku-default');
  });
  it('without override - old substring logic', () => {
    expect(sessionToArchetypeKey({ ...base, model: 'claude-opus-4-8[1m]' })).toBe('opus-default');
  });
});

const hero = (model?: string, permissionMode?: string): HeroSnapshot => ({
  sessionId: 's', title: 't', projectDir: '/p', teamColor: 0, state: 'idle',
  tokens: { input: 0, output: 0 }, startedAt: '', lastActivityAt: '',
  model, permissionMode,
});

describe('sessionToArchetypeKey', () => {
  it('clean model+mode -> "<model>-<mode>"', () => {
    expect(sessionToArchetypeKey(hero('opus', 'plan'))).toBe('opus-plan');
  });
  it('missing model -> fallback', () => {
    expect(sessionToArchetypeKey(hero(undefined, 'plan'))).toBe('sonnet-default');
  });
  it('missing mode -> default mode', () => {
    expect(sessionToArchetypeKey(hero('haiku', undefined))).toBe('haiku-default');
  });
  it('unknown model -> fallback', () => {
    expect(sessionToArchetypeKey(hero('gpt-5', 'default'))).toBe('sonnet-default');
  });
  it('full model id (substring) -> "<model>-<mode>"', () => {
    expect(sessionToArchetypeKey(hero('claude-opus-4-8[1m]', 'acceptEdits'))).toBe('opus-acceptEdits');
  });
});

describe('archetypeKeyChain (degradation of missing mode variant -> model atlas)', () => {
  it('mode != default degrades to <model>-default, then global fallback', () => {
    expect(archetypeKeyChain('opus-acceptEdits')).toEqual(['opus-acceptEdits', 'opus-default', 'sonnet-default']);
  });
  it('default -> without duplicate <model>-default', () => {
    expect(archetypeKeyChain('haiku-default')).toEqual(['haiku-default', 'sonnet-default']);
  });
  it('global fallback alone for itself', () => {
    expect(archetypeKeyChain('sonnet-default')).toEqual(['sonnet-default']);
  });
});

describe('stateToAnimation', () => {
  it('working → work', () => expect(stateToAnimation('working', false)).toBe('work'));
  it('moving -> walk regardless of state', () => expect(stateToAnimation('idle', true)).toBe('walk'));
  it('returning → walk', () => expect(stateToAnimation('returning', false)).toBe('walk'));
  it('thinking → idle', () => expect(stateToAnimation('thinking', false)).toBe('idle'));
  it('error → idle', () => expect(stateToAnimation('error', false)).toBe('idle'));
});
