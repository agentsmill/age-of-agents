import { describe, it, expect } from 'vitest';
import {
  groupBySprite,
  addSpriteModel,
  removeSpriteRule,
  renameSprite,
  setFallbackSprite,
} from '../src/hud/model-sprite-edit';
import { validateModelConfig, DEFAULT_MODEL_CONFIG, SPRITE_IDS, type ModelConfig } from '../src/theme/models';

const empty: ModelConfig = { sprites: [], windows: [], fallback: { sprite: 'sonnet', contextWindow: 200_000 } };
const valid = (c: ModelConfig) => validateModelConfig(c).ok;

describe('groupBySprite', () => {
  it('grupuje DEFAULT po sprite: wszystkie SPRITE_IDS, nazwa + indeksy', () => {
    const g = groupBySprite(DEFAULT_MODEL_CONFIG);
    expect(Object.keys(g).sort()).toEqual([...SPRITE_IDS].sort());
    expect(g.opus.name).toBe('Opus 4.8');
    expect(g.opus.rules.length).toBeGreaterThanOrEqual(1);
    expect(typeof g.opus.rules[0].index).toBe('number');
  });
  it('spirit bez reguł → pusta lista, brak nazwy', () => {
    expect(groupBySprite(empty).opus).toEqual({ rules: [] });
  });
});

describe('addSpriteModel', () => {
  it('dopisuje regułę pattern z nazwą', () => {
    const next = addSpriteModel(empty, 'opus', 'gpt-5', 'Opus 4.8');
    expect(next.sprites).toEqual([
      { match: { kind: 'pattern', pattern: 'gpt-5' }, sprite: 'opus', displayName: 'Opus 4.8' },
    ]);
    expect(valid(next)).toBe(true);
  });
  it('pomija pusty pattern', () => {
    expect(addSpriteModel(empty, 'opus', '   ').sprites.length).toBe(0);
  });
  it('nazwa whitespace → bez displayName (spójnie z renameSprite)', () => {
    expect(addSpriteModel(empty, 'opus', 'gpt-5', '   ').sprites[0].displayName).toBeUndefined();
  });
});

describe('removeSpriteRule', () => {
  it('usuwa właściwy indeks', () => {
    const next = removeSpriteRule(DEFAULT_MODEL_CONFIG, 0);
    expect(next.sprites.length).toBe(DEFAULT_MODEL_CONFIG.sprites.length - 1);
    expect(valid(next)).toBe(true);
  });
});

describe('renameSprite', () => {
  it('ustawia displayName na wszystkich regułach spirita', () => {
    const cfg = addSpriteModel(addSpriteModel(empty, 'opus', 'opus'), 'opus', 'gpt');
    const next = renameSprite(cfg, 'opus', 'Big Brain');
    expect(next.sprites.every((r) => r.displayName === 'Big Brain')).toBe(true);
    expect(valid(next)).toBe(true);
  });
  it('pusta nazwa → undefined', () => {
    const next = renameSprite(DEFAULT_MODEL_CONFIG, 'opus', '   ');
    expect(next.sprites.find((r) => r.sprite === 'opus')?.displayName).toBeUndefined();
    expect(valid(next)).toBe(true);
  });
});

describe('setFallbackSprite', () => {
  it('zmienia fallback.sprite', () => {
    const next = setFallbackSprite(DEFAULT_MODEL_CONFIG, 'haiku');
    expect(next.fallback.sprite).toBe('haiku');
    expect(valid(next)).toBe(true);
  });
});
