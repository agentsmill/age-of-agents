import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  resolveSprite,
  resolveContextWindow,
  validateModelConfig,
  DEFAULT_MODEL_CONFIG,
  type ModelConfig,
} from '../src/theme/models';

describe('resolveContextWindow (DEFAULT)', () => {
  it('opus → 200k, opus[1m] → 1M (tag bije bazowy)', () => {
    expect(resolveContextWindow('claude-opus-4-8', DEFAULT_MODEL_CONFIG)).toBe(200_000);
    expect(resolveContextWindow('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG)).toBe(1_000_000);
  });
  it('nieznany / brak modelu → fallback', () => {
    expect(resolveContextWindow('llama3.1:8b', DEFAULT_MODEL_CONFIG)).toBe(200_000);
    expect(resolveContextWindow(undefined, DEFAULT_MODEL_CONFIG)).toBe(200_000);
  });
});

describe('resolveSprite (DEFAULT)', () => {
  it('tożsamość stała niezależnie od [1m]', () => {
    expect(resolveSprite('claude-opus-4-8', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
    expect(resolveSprite('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
  });
  it('nieznany model → fallback sprite', () => {
    expect(resolveSprite('llama3.1:8b', DEFAULT_MODEL_CONFIG).sprite).toBe('sonnet');
  });
  it('zwraca nazwę wyświetlaną', () => {
    expect(resolveSprite('claude-sonnet-4-6', DEFAULT_MODEL_CONFIG).displayName).toBe('Sonnet 4.6');
  });
});

describe('resolveModel — dwie osie naraz', () => {
  it('opus[1m]: sprite opus + okno 1M', () => {
    const r = resolveModel('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG);
    expect(r.sprite).toBe('opus');
    expect(r.contextWindow).toBe(1_000_000);
  });
});

describe('matching — pierwsze trafienie + case-insensitive', () => {
  it('exact i pattern, niezależnie od wielkości liter', () => {
    const cfg: ModelConfig = {
      sprites: [{ match: { kind: 'exact', id: 'my-model' }, sprite: 'haiku' }],
      windows: [{ match: { kind: 'pattern', pattern: 'MY' }, contextWindow: 333 }],
      fallback: { sprite: 'sonnet', contextWindow: 200_000 },
    };
    expect(resolveSprite('My-Model', cfg).sprite).toBe('haiku');
    expect(resolveContextWindow('xx-my-yy', cfg)).toBe(333);
  });
});

describe('validateModelConfig', () => {
  it('akceptuje DEFAULT', () => {
    expect(validateModelConfig(DEFAULT_MODEL_CONFIG).ok).toBe(true);
  });
  it('odrzuca zły sprite', () => {
    expect(validateModelConfig({ sprites: [{ match: { kind: 'pattern', pattern: 'x' }, sprite: 'nope' }], windows: [], fallback: { sprite: 'sonnet', contextWindow: 1 } }).ok).toBe(false);
  });
  it('odrzuca okno <= 0', () => {
    expect(validateModelConfig({ sprites: [], windows: [{ match: { kind: 'pattern', pattern: 'x' }, contextWindow: 0 }], fallback: { sprite: 'sonnet', contextWindow: 200_000 } }).ok).toBe(false);
  });
  it('odrzuca zły fallback', () => {
    expect(validateModelConfig({ sprites: [], windows: [], fallback: { sprite: 'nope', contextWindow: 1 } }).ok).toBe(false);
  });
  it('usuwa nadmiarowe pola', () => {
    const res = validateModelConfig({ sprites: [{ match: { kind: 'pattern', pattern: 'x' }, sprite: 'opus', evil: 1 }], windows: [], fallback: { sprite: 'sonnet', contextWindow: 200_000 } });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.config.sprites[0] as Record<string, unknown>).evil).toBeUndefined();
  });
});
