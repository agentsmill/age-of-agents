import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  resolveSprite,
  resolveContextWindow,
  validateModelConfig,
  DEFAULT_MODEL_CONFIG,
  upgradeModelConfig,
  type ModelConfig,
} from '../src/theme/models';

describe('resolveContextWindow (DEFAULT)', () => {
  it('real Claude windows: opus/sonnet/fable = 1M, haiku = 200k', () => {
    expect(resolveContextWindow('claude-opus-4-8', DEFAULT_MODEL_CONFIG)).toBe(1_000_000);
    expect(resolveContextWindow('claude-sonnet-4-6', DEFAULT_MODEL_CONFIG)).toBe(1_000_000);
    expect(resolveContextWindow('claude-fable-5', DEFAULT_MODEL_CONFIG)).toBe(1_000_000);
    expect(resolveContextWindow('claude-haiku-4-5', DEFAULT_MODEL_CONFIG)).toBe(200_000);
  });
  it('tag [1m] forces 1M over a 200k base (haiku[1m])', () => {
    expect(resolveContextWindow('claude-haiku-4-5[1m]', DEFAULT_MODEL_CONFIG)).toBe(1_000_000);
  });
  it('unknown / missing model -> fallback 200k', () => {
    expect(resolveContextWindow('llama3.1:8b', DEFAULT_MODEL_CONFIG)).toBe(200_000);
    expect(resolveContextWindow(undefined, DEFAULT_MODEL_CONFIG)).toBe(200_000);
  });
});

describe('resolveSprite (DEFAULT)', () => {
  it('identity is stable regardless of [1m]', () => {
    expect(resolveSprite('claude-opus-4-8', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
    expect(resolveSprite('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
  });
  it('unknown model -> fallback sprite', () => {
    // NB: llama/qwen/etc. now map to the dedicated 'local' sprite, so use a
    // genuinely unrecognized id to exercise the fallback.
    expect(resolveSprite('nope-xyz', DEFAULT_MODEL_CONFIG).sprite).toBe('sonnet');
  });
  it('returns display name', () => {
    expect(resolveSprite('claude-sonnet-4-6', DEFAULT_MODEL_CONFIG).displayName).toBe('Sonnet 4.6');
  });
});

describe('resolveModel - two axes at once', () => {
  it('opus[1m]: sprite opus + okno 1M', () => {
    const r = resolveModel('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG);
    expect(r.sprite).toBe('opus');
    expect(r.contextWindow).toBe(1_000_000);
  });

  it('Codex/OpenAI model names resolve to non-Claude display names', () => {
    expect(resolveModel('gpt-5.5', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.5',
      contextWindow: 258_400,
    });
    expect(resolveModel('gpt-5.4-codex', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.4 Codex',
      contextWindow: 258_400,
    });
    expect(resolveModel('gpt-5.4-mini', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'haiku',
      displayName: 'GPT-5.4 Mini',
      contextWindow: 258_400,
    });
  });
});

describe('matching - first hit + case-insensitive', () => {
  it('exact and pattern, case-insensitive', () => {
    const cfg: ModelConfig = {
      sprites: [{ match: { kind: 'exact', id: 'my-model' }, sprite: 'haiku' }],
      windows: [{ match: { kind: 'pattern', pattern: 'MY' }, contextWindow: 333 }],
      fallback: { sprite: 'sonnet', contextWindow: 200_000 },
    };
    expect(resolveSprite('My-Model', cfg).sprite).toBe('haiku');
    expect(resolveContextWindow('xx-my-yy', cfg)).toBe(333);
  });
});

describe('upgradeModelConfig', () => {
  it('adds missing built-in Codex presets to older saved configs', () => {
    const oldConfig: ModelConfig = {
      sprites: [
        { match: { kind: 'pattern', pattern: 'opus' }, sprite: 'opus', displayName: 'Opus 4.8' },
        { match: { kind: 'pattern', pattern: 'sonnet' }, sprite: 'sonnet', displayName: 'Sonnet 4.6' },
      ],
      windows: [
        { match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 1_000_000 },
        { match: { kind: 'pattern', pattern: 'sonnet' }, contextWindow: 1_000_000 },
      ],
      fallback: { sprite: 'sonnet', contextWindow: 200_000 },
    };

    const upgraded = upgradeModelConfig(oldConfig);
    expect(resolveModel('gpt-5.5', upgraded)).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.5',
      contextWindow: 258_400,
    });
    expect(upgraded.sprites[0]).toEqual(oldConfig.sprites[0]);
    expect(upgraded.windows[0]).toEqual(oldConfig.windows[0]);
  });

  it('does not duplicate existing user rules', () => {
    const upgraded = upgradeModelConfig(DEFAULT_MODEL_CONFIG);
    expect(upgraded.sprites).toHaveLength(DEFAULT_MODEL_CONFIG.sprites.length);
    expect(upgraded.windows).toHaveLength(DEFAULT_MODEL_CONFIG.windows.length);
  });
});

describe('validateModelConfig', () => {
  it('accepts DEFAULT', () => {
    expect(validateModelConfig(DEFAULT_MODEL_CONFIG).ok).toBe(true);
  });
  it('rejects bad sprite', () => {
    expect(validateModelConfig({ sprites: [{ match: { kind: 'pattern', pattern: 'x' }, sprite: 'nope' }], windows: [], fallback: { sprite: 'sonnet', contextWindow: 1 } }).ok).toBe(false);
  });
  it('rejects window <= 0', () => {
    expect(validateModelConfig({ sprites: [], windows: [{ match: { kind: 'pattern', pattern: 'x' }, contextWindow: 0 }], fallback: { sprite: 'sonnet', contextWindow: 200_000 } }).ok).toBe(false);
  });
  it('rejects bad fallback', () => {
    expect(validateModelConfig({ sprites: [], windows: [], fallback: { sprite: 'nope', contextWindow: 1 } }).ok).toBe(false);
  });
  it('removes extra fields', () => {
    const res = validateModelConfig({ sprites: [{ match: { kind: 'pattern', pattern: 'x' }, sprite: 'opus', evil: 1 }], windows: [], fallback: { sprite: 'sonnet', contextWindow: 200_000 } });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.config.sprites[0] as Record<string, unknown>).evil).toBeUndefined();
  });
});
