import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelConfig, saveModelConfig, invalidateModelConfigCache } from '../src/model-config.js';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '@agent-citadel/shared';

function tmpPath(name = 'model-config.json'): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-model-')), name);
}

beforeEach(() => invalidateModelConfigCache());

const CUSTOM: ModelConfig = {
  sprites: [{ match: { kind: 'pattern', pattern: 'opus' }, sprite: 'opus' }],
  windows: [{ match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 500_000 }],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 },
};

describe('loadModelConfig', () => {
  it('missing file -> DEFAULT', async () => {
    expect(await loadModelConfig(tmpPath())).toEqual(DEFAULT_MODEL_CONFIG);
  });
  it('valid file -> loaded config', async () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify(CUSTOM));
    const loaded = await loadModelConfig(p);
    expect(loaded.sprites[0]).toEqual(CUSTOM.sprites[0]);
    expect(loaded.windows[0]).toEqual(CUSTOM.windows[0]);
    expect(loaded.fallback).toEqual(CUSTOM.fallback);
  });
  it('valid old file is upgraded with missing built-in presets', async () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify(CUSTOM));
    const loaded = await loadModelConfig(p);
    expect(loaded.sprites).toEqual(expect.arrayContaining([
      expect.objectContaining({ match: { kind: 'exact', id: 'gpt-5.5' }, displayName: 'GPT-5.5' }),
      expect.objectContaining({ match: { kind: 'pattern', pattern: 'gpt-5.3-codex-spark' }, displayName: 'GPT-5.3 Codex Spark' }),
    ]));
    expect(loaded.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ match: { kind: 'exact', id: 'gpt-5.5' }, contextWindow: 258_400 }),
    ]));
  });
  it('broken JSON -> DEFAULT', async () => {
    const p = tmpPath();
    writeFileSync(p, '{ nie json');
    expect(await loadModelConfig(p)).toEqual(DEFAULT_MODEL_CONFIG);
  });
  it('invalid config (bad sprite) -> DEFAULT', async () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ sprites: [{ match: { kind: 'pattern', pattern: 'x' }, sprite: 'nope' }], windows: [], fallback: { sprite: 'sonnet', contextWindow: 1 } }));
    expect(await loadModelConfig(p)).toEqual(DEFAULT_MODEL_CONFIG);
  });
});

describe('saveModelConfig', () => {
  it('creates directory, saves, load returns new config', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'aoa-model-')), 'nested', 'model-config.json');
    const saved = await saveModelConfig(CUSTOM, p);
    expect(saved).toMatchObject(CUSTOM);
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toMatchObject(CUSTOM);
    const loaded = await loadModelConfig(p);
    expect(loaded.sprites[0]).toEqual(CUSTOM.sprites[0]);
    expect(loaded.windows[0]).toEqual(CUSTOM.windows[0]);
  });
  it('rejects invalid config', async () => {
    await expect(saveModelConfig({ sprites: [], windows: [], fallback: { sprite: 'nope', contextWindow: 1 } } as unknown as ModelConfig, tmpPath())).rejects.toThrow();
  });
});
