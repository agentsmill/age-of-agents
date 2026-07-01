import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  codexDateRoots,
  filterSources,
  parseCodexLookbackDays,
  parseSourceFilter,
  rootIfExists,
} from '../src/sources/config.js';
import { activeSources } from '../src/sources/index.js';
import type { AgentSource } from '../src/sources/types.js';

const source = (id: AgentSource['id']): AgentSource => ({
  id,
  roots: () => [],
  classify: () => ({ kind: 'other' }),
  parseLine: () => [],
});

describe('sources config', () => {
  it('parseSourceFilter returns undefined for empty input, meaning all sources', () => {
    expect(parseSourceFilter(undefined)).toBeUndefined();
    expect(parseSourceFilter('')).toBeUndefined();
    expect(parseSourceFilter('  ')).toBeUndefined();
  });

  it('parseSourceFilter accepts comma-separated known source ids', () => {
    expect(parseSourceFilter('codex, claude')).toEqual(new Set(['codex', 'claude']));
  });

  it('parseSourceFilter rejects unknown source ids', () => {
    expect(() => parseSourceFilter('codex,nope')).toThrow('Unknown AOA_SOURCES value: nope');
  });

  it('parseSourceFilter accepts every registered source id, including local-llm', () => {
    expect(parseSourceFilter('local-llm')).toEqual(new Set(['local-llm']));
    expect(activeSources('claude,local-llm').map((s) => s.id)).toEqual(['claude', 'local-llm']);
  });

  it('filterSources keeps only selected sources when a filter is provided', () => {
    const all = [source('claude'), source('codex'), source('opencode'), source('koda')];
    expect(filterSources(all, 'codex,koda').map((s) => s.id)).toEqual(['codex', 'koda']);
  });

  it('parseCodexLookbackDays defaults to 1 and rejects invalid values', () => {
    expect(parseCodexLookbackDays(undefined)).toBe(1);
    expect(parseCodexLookbackDays('3')).toBe(3);
    expect(() => parseCodexLookbackDays('0')).toThrow('Invalid AOA_CODEX_LOOKBACK_DAYS');
    expect(() => parseCodexLookbackDays('abc')).toThrow('Invalid AOA_CODEX_LOOKBACK_DAYS');
  });

  it('codexDateRoots returns yesterday, today, and tomorrow for default lookback', () => {
    const roots = codexDateRoots('/home/u/.codex/sessions', new Date(2026, 5, 19, 12), 1);
    expect(roots).toEqual([
      join('/home/u/.codex/sessions', '2026', '06', '18'),
      join('/home/u/.codex/sessions', '2026', '06', '19'),
      join('/home/u/.codex/sessions', '2026', '06', '20'),
    ]);
  });

  it('rootIfExists returns [] for missing directories', () => {
    expect(rootIfExists('/definitely/missing/age-of-agents-test-root')).toEqual([]);
  });

  it('rootIfExists returns [] when filesystem checks throw', async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      existsSync: () => {
        throw new Error('stat failed');
      },
      statSync: () => ({ isDirectory: () => true }),
    }));

    try {
      const { rootIfExists: mockedRootIfExists } = await import('../src/sources/config.js');
      expect(mockedRootIfExists('/throws')).toEqual([]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});

describe('activeSources', () => {
  it('uses AOA_SOURCES-style filtering over registered sources', () => {
    expect(activeSources('codex').map((s) => s.id)).toEqual(['codex']);
    expect(activeSources('claude,codex').map((s) => s.id)).toEqual(['claude', 'codex']);
  });
});
