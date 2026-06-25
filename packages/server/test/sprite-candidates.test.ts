import { describe, expect, it } from 'vitest';
import {
  resolveSpriteCandidates,
  pickSprite,
  DEFAULT_MODEL_CONFIG,
  type ModelConfig,
} from '@agent-citadel/shared';

const MULTI: ModelConfig = {
  sprites: [
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local' },
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'golem' },
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local' }, // duplicate sprite
  ],
  windows: [],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 },
};

describe('resolveSpriteCandidates', () => {
  it('returns all matching sprites in order, de-duplicated', () => {
    expect(resolveSpriteCandidates('llama3.2:latest', MULTI)).toEqual(['local', 'golem']);
  });

  it('falls back when nothing matches', () => {
    expect(resolveSpriteCandidates('nope-xyz', MULTI)).toEqual(['sonnet']);
  });

  it('falls back when model is undefined', () => {
    expect(resolveSpriteCandidates(undefined, MULTI)).toEqual(['sonnet']);
  });

  it('single match returns one candidate (default config)', () => {
    expect(resolveSpriteCandidates('claude-opus-4-8', DEFAULT_MODEL_CONFIG)).toEqual(['opus']);
  });
});

describe('pickSprite', () => {
  it('returns the only candidate without calling rng', () => {
    let called = false;
    const rng = () => { called = true; return 0; };
    expect(pickSprite(['golem'], rng)).toBe('golem');
    expect(called).toBe(false);
  });

  it('picks the first when rng is 0', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0)).toBe('local');
  });

  it('picks the last when rng approaches 1', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0.999)).toBe('oracle');
  });

  it('picks the middle for a mid rng', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0.5)).toBe('golem');
  });
});
