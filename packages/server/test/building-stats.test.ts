import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accumulateMessage,
  computeBuildingStats,
  computeBuildingStatsForSources,
  getBuildingStats,
  invalidateBuildingStatsCache,
} from '../src/building-stats.js';
import type { BuildingId, MappingConfig } from '@agent-citadel/shared';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-13T12:00:00.000Z');
const DAY_START = Date.parse('2026-06-13T00:00:00.000Z');

function acc() {
  return new Map<BuildingId, { today: number; week: number; month: number }>();
}

describe('accumulateMessage', () => {
  it('assigns tokens to the tool building in all windows (today)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.get('forge')).toEqual({ today: 100, week: 100, month: 100 });
  });

  it('splits evenly when a message touched multiple buildings', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 100, tools: [{ name: 'Edit' }, { name: 'Read' }] }, NOW, DAY_START);
    expect(a.get('forge')?.month).toBe(50);
    expect(a.get('library')?.month).toBe(50);
  });

  it('Bash with git -> market (attribution by detail)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 80, tools: [{ name: 'Bash', detail: 'git push origin main' }] }, NOW, DAY_START);
    expect(a.get('market')?.today).toBe(80);
    expect(a.has('mine')).toBe(false);
  });

  it('message without a tool -> citadel (default fallback)', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 30, tools: [] }, NOW, DAY_START);
    expect(a.get('citadel')?.month).toBe(30);
  });

  it('reasoning (without a tool) goes to the current work building when fallback is provided', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW, output: 40, tools: [] }, NOW, DAY_START, 'forge');
    expect(a.get('forge')?.today).toBe(40);
    expect(a.has('citadel')).toBe(false);
  });

  it('10 days ago counts toward 30 days, but not week or today', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW - 10 * DAY, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.get('forge')).toEqual({ today: 0, week: 0, month: 100 });
  });

  it('older than 30 days and zero-token messages are ignored', () => {
    const a = acc();
    accumulateMessage(a, { ts: NOW - 40 * DAY, output: 100, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    accumulateMessage(a, { ts: NOW, output: 0, tools: [{ name: 'Edit' }] }, NOW, DAY_START);
    expect(a.size).toBe(0);
  });

  it('honors custom config (Edit->library instead of forge)', () => {
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

/** Corpus with one assistant message using `tool` (fresh timestamp -> in the 30-day window). */
function rootWithTool(tool: string, timestamp = new Date().toISOString()): string {
  const dir = mkdtempSync(join(tmpdir(), 'aoa-stats-'));
  const rec = {
    type: 'assistant',
    timestamp,
    message: { usage: { output_tokens: 100 }, content: [{ type: 'tool_use', name: tool }] },
  };
  writeFileSync(join(dir, 'session.jsonl'), JSON.stringify(rec) + '\n');
  return dir;
}

function rootWithCodexRecords(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'aoa-codex-stats-'));
  writeFileSync(
    join(dir, 'rollout-2026-06-20T12-00-00-019ee492-d59e-7813-8277-dc58a1bb2c1e.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  return dir;
}

describe('computeBuildingStats - Codex rollout records', () => {
  it('attributes Codex token_count output deltas to the latest Codex tool building', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'response_item',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch',
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } },
        },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine?.today).toBe(40);
    expect(res.buildings.forge?.today).toBe(50);
  });

  it('extracts detail from split namespaced Codex tool records for custom attribution', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          namespace: 'web',
          name: 'run',
          arguments: JSON.stringify({ search_query: [{ q: 'rust async' }] }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
    ]);
    const config: MappingConfig = {
      rules: [
        { kind: 'detail', tool: 'WebSearch', pattern: 'rust async', building: 'market' },
        { kind: 'exact', tool: 'WebSearch', building: 'tower' },
      ],
      fallback: 'citadel',
    };

    const res = await computeBuildingStats(root, NOW + 2000, config);
    expect(res.buildings.market?.today).toBe(40);
    expect(res.buildings.tower).toBeUndefined();
  });

  it('does not create Codex output deltas from compacted token_count repeats', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      { type: 'compacted', timestamp: new Date(NOW + 1000).toISOString(), payload: { window_id: 1 } },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine?.today).toBe(40);
  });

  it('credits Codex task completion to theme resting buildings', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: { type: 'task_complete' },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } },
        },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.garden?.today).toBe(90);
    expect(res.buildings.hydroponics?.today).toBe(90);
  });

  it('credits a final Codex token_count before task completion to theme resting buildings', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: { type: 'task_complete' },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.garden?.today).toBe(40);
    expect(res.buildings.hydroponics?.today).toBe(40);
  });

  it('credits a final Codex token_count before task completion even when completion timestamp is missing', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'task_complete' },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.garden?.today).toBe(40);
    expect(res.buildings.hydroponics?.today).toBe(40);
  });

  it('credits Codex aborted turns to theme recovery buildings', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: { type: 'turn_aborted' },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } },
        },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.shrine?.today).toBe(90);
    expect(res.buildings.medbay?.today).toBe(90);
  });

  it('credits a final Codex token_count before turn abort to theme recovery buildings', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: { type: 'turn_aborted' },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.shrine?.today).toBe(40);
    expect(res.buildings.medbay?.today).toBe(40);
  });

  it('credits a final Codex token_count before turn abort even when abort timestamp is missing', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'turn_aborted' },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine).toBeUndefined();
    expect(res.buildings.shrine?.today).toBe(40);
    expect(res.buildings.medbay?.today).toBe(40);
  });
});

describe('getBuildingStats - cache + invalidation during scan', () => {
  it('computes mixed stats through source adapters without importing Codex parser helpers', async () => {
    invalidateBuildingStatsCache();
    const claudeRoot = rootWithTool('Read', new Date(NOW).toISOString());
    const codexRoot = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
    ]);

    const res = await computeBuildingStatsForSources(
      [
        { id: 'claude', roots: () => [claudeRoot] },
        { id: 'codex', roots: () => [codexRoot] },
      ],
      NOW + 2000,
    );

    expect(res.buildings.library?.today).toBe(100);
    expect(res.buildings.mine?.today).toBe(40);
    const source = readFileSync(new URL('../src/building-stats.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/sources\/codex\.js['"]/);
  });

  it('merges stats from explicit Claude and Codex roots', async () => {
    invalidateBuildingStatsCache();
    const claudeRoot = rootWithTool('Read'); // -> library
    const ts = Date.now() - 2000;
    const codexRoot = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(ts).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(ts).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'response_item',
        timestamp: new Date(ts + 1000).toISOString(),
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch',
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(ts + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } },
        },
      },
    ]);
    const res = await getBuildingStats([claudeRoot, codexRoot]);
    expect(res.buildings.library?.month).toBe(100);
    expect(res.buildings.mine?.month).toBe(40);
    expect(res.buildings.forge?.month).toBe(50);

    invalidateBuildingStatsCache();
  });

  it('invalidate during an in-flight scan does NOT persist a stale result', async () => {
    invalidateBuildingStatsCache();
    const rootEdit = rootWithTool('Edit'); // -> forge
    const rootRead = rootWithTool('Read'); // -> library

    // computeBuildingStats does `await readdir`, so synchronous invalidate
    // right after startup lands BEFORE the scan resolves (deterministic race).
    const inflight = getBuildingStats(rootEdit);
    invalidateBuildingStatsCache();
    await inflight;

    // If the scan saved cache despite invalidation, this call would return the stale
    // `forge` (from rootEdit). After the fix, cache is empty -> rootRead is recalculated.
    const res = await getBuildingStats(rootRead);
    expect(res.buildings.library).toBeDefined();
    expect(res.buildings.forge).toBeUndefined();

    invalidateBuildingStatsCache();
  });
});
