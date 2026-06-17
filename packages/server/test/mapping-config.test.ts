import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMappingConfig, saveMappingConfig, invalidateMappingCache } from '../src/mapping-config.js';
import { DEFAULT_MAPPING, type MappingConfig } from '@agent-citadel/shared';

function tmpPath(name = 'tool-mapping.json'): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-map-')), name);
}

beforeEach(() => invalidateMappingCache());

describe('loadMappingConfig', () => {
  it('brak pliku → DEFAULT_MAPPING', async () => {
    expect(await loadMappingConfig(tmpPath())).toEqual(DEFAULT_MAPPING);
  });

  it('poprawny plik → wczytany config', async () => {
    const p = tmpPath();
    const custom: MappingConfig = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    writeFileSync(p, JSON.stringify(custom));
    expect(await loadMappingConfig(p)).toEqual(custom);
  });

  it('uszkodzony JSON → DEFAULT_MAPPING', async () => {
    const p = tmpPath();
    writeFileSync(p, '{ to nie json');
    expect(await loadMappingConfig(p)).toEqual(DEFAULT_MAPPING);
  });

  it('niepoprawny config (zły building) → DEFAULT_MAPPING', async () => {
    const p = tmpPath();
    writeFileSync(p, JSON.stringify({ rules: [{ kind: 'exact', tool: 'Edit', building: 'nope' }], fallback: 'citadel' }));
    expect(await loadMappingConfig(p)).toEqual(DEFAULT_MAPPING);
  });
});

describe('saveMappingConfig', () => {
  it('tworzy brakujący katalog i zapisuje plik', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'aoa-map-')), 'nested', 'tool-mapping.json');
    const custom: MappingConfig = { rules: [{ kind: 'prefix', prefix: 'mcp__', building: 'guild' }], fallback: 'citadel' };
    const saved = await saveMappingConfig(custom, p);
    expect(saved).toEqual(custom);
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual(custom);
  });

  it('po zapisie load zwraca nowy config', async () => {
    const p = tmpPath();
    const custom: MappingConfig = { rules: [{ kind: 'exact', tool: 'Read', building: 'forge' }], fallback: 'citadel' };
    await saveMappingConfig(custom, p);
    expect(await loadMappingConfig(p)).toEqual(custom);
  });

  it('odrzuca niepoprawny config', async () => {
    await expect(saveMappingConfig({ rules: [], fallback: 'nope' } as unknown as MappingConfig, tmpPath())).rejects.toThrow();
  });
});
