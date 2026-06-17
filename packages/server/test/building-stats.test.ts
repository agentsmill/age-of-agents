import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accumulateMessage, getBuildingStats, invalidateBuildingStatsCache } from '../src/building-stats.js';
import type { BuildingId, MappingConfig } from '@agent-citadel/shared';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-13T12:00:00.000Z');
const DAY_START = Date.parse('2026-06-13T00:00:00.000Z');

function acc() {
  return new Map<BuildingId, { today: number; week: number; month: number }>();
}

describe('accumulateMessage', () => {
  it('przypisuje tokeny do budynku narzędzia we wszystkich oknach (dziś)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.get('forge')).toEqual({ today: 100, week: 100, month: 100 });
  });

  it('dzieli równo gdy wiadomość dotknęła kilku budynków', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 100, tools: [{ name: 'Edit' }, { name: 'Read' }] }, NOW, DAY_START);
    expect(a.get('forge')?.month).toBe(50);
    expect(a.get('library')?.month).toBe(50);
  });

  it('Bash z git → targ (atrybucja przez detail)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 80, tools: [{ name: 'Bash', detail: 'git push origin main' }] }, NOW, DAY_START);
    expect(a.get('market')?.today).toBe(80);
    expect(a.has('mine')).toBe(false);
  });

  it('wiadomość bez narzędzia → twierdza (domyślny fallback)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 30, tools: [] }, NOW, DAY_START);
    expect(a.get('citadel')?.month).toBe(30);
  });

  it('rozumowanie (bez narzędzia) idzie do budynku bieżącej pracy gdy podano fallback', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 40, tools: [] }, NOW, DAY_START, 'forge');
    expect(a.get('forge')?.today).toBe(40);
    expect(a.has('citadel')).toBe(false);
  });

  it('10 dni temu liczy się do 30 dni, ale nie do tygodnia ani dziś', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW - 10 * DAY, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.get('forge')).toEqual({ today: 0, week: 0, month: 100 });
  });

  it('starsze niż 30 dni i zerowe tokeny są ignorowane', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW - 40 * DAY, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    accumulateMessage(a, { ts: NOW, output: 0, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.size).toBe(0);
  });

  it('honoruje customowy config (Edit→library zamiast forge)', () => {
    const cfg: MappingConfig = {
      rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }],
      fallback: 'citadel',
    };
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START, 'citadel', cfg);
    expect(a.get('library')?.month).toBe(100);
    expect(a.has('forge')).toBe(false);
  });
});

/** Korpus z jedną wiadomością assistant używającą `tool` (świeży timestamp → w oknie 30 dni). */
function rootWithTool(tool: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aoa-stats-'));
  const rec = {
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { usage: { output_tokens: 100 }, content: [{ type: 'tool_use', name: tool }] },
  };
  writeFileSync(join(dir, 'session.jsonl'), JSON.stringify(rec) + '\n');
  return dir;
}

describe('getBuildingStats — cache + inwalidacja w trakcie skanu', () => {
  it('invalidate podczas trwającego przelotu NIE utrwala nieświeżego wyniku', async () => {
    invalidateBuildingStatsCache();
    const rootEdit = rootWithTool('Edit'); // → forge
    const rootRead = rootWithTool('Read'); // → library

    // computeBuildingStats robi `await readdir`, więc synchroniczny invalidate
    // tuż po starcie wbija się PRZED rozwiązaniem przelotu (deterministyczny wyścig).
    const inflight = getBuildingStats(rootEdit);
    invalidateBuildingStatsCache();
    await inflight;

    // Gdyby przelot zapisał cache mimo inwalidacji, to wywołanie zwróciłoby stare
    // `forge` (z rootEdit). Po poprawce cache jest pusty → liczy rootRead od nowa.
    const res = await getBuildingStats(rootRead);
    expect(res.buildings.library).toBeDefined();
    expect(res.buildings.forge).toBeUndefined();

    invalidateBuildingStatsCache();
  });
});
