import { describe, expect, it } from 'vitest';
import { SPRITE_IDS, resolveSprite, resolveModel, DEFAULT_MODEL_CONFIG } from '@agent-citadel/shared';

describe('sprite roster', () => {
  it('includes the four new sprite families', () => {
    expect(SPRITE_IDS).toEqual(expect.arrayContaining(['local', 'golem', 'familiar', 'oracle']));
  });

  it('maps local model families to the dedicated local sprite', () => {
    expect(resolveSprite('llama3.2:latest', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('qwen3:8b', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('mistral:7b', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('SpeakLeash/bielik-11b-v3.0-instruct', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
  });

  it('keeps Claude families on their own sprites', () => {
    expect(resolveSprite('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
    expect(resolveSprite('claude-sonnet-4-6', DEFAULT_MODEL_CONFIG).sprite).toBe('sonnet');
  });

  it('preserves local family display names (re-point is sprite-only)', () => {
    expect(resolveModel('llama3.2:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('Llama');
  });
});
