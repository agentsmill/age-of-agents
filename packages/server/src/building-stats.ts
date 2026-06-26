import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  completedBuildingForTheme,
  recoveryBuildingForTheme,
  resolveBuilding,
  DEFAULT_MAPPING,
  type BuildingId,
  type BuildingStatsResponse,
  type BuildingWindowStats,
  type MappingConfig,
} from '@agent-citadel/shared';
import { loadMappingConfig } from './mapping-config.js';
import {
  DEFAULT_BUILDING_STATS_SOURCES,
  type BuildingStatsSource,
  type BuildingStatsTool,
} from './building-stats-sources/index.js';

type BuildingStatsSourceInput = BuildingStatsSource | Pick<BuildingStatsSource, 'id' | 'roots'>;
type StatsThemeId = 'fantasy' | 'scifi';

/**
 * Token usage per building for day/week/30-day windows.
 *
 * Historical data does NOT exist in memory (watcher sees only live sessions), so
 * scan source adapters: assign each OUTPUT token sample to the building of the
 * tool it used, split evenly when it touched multiple buildings. A sample
 * without a tool is assigned to the building where the session is CURRENTLY
 * working (last used tool); otherwise Citadel (fallback) would swallow most
 * tokens. The result is cached.
 *
 * USER CONTRIBUTION (learning): attribution (even split, reasoning->last building,
 * fallback→citadel) i okna czasowe to decyzje do strojenia.
 */

const DAY = 86_400_000;
const MONTH = 30 * DAY;
const CACHE_TTL = 60_000;

export function normalizeStatsTheme(themeId: string | undefined): StatsThemeId {
  return themeId === 'scifi' ? 'scifi' : 'fantasy';
}

interface Bucket {
  today: number;
  week: number;
  month: number;
}

export interface MsgSample {
  ts: number; // epoch ms
  output: number; // message output tokens
  tools: { name: string; detail?: string }[];
}

/**
 * Pure: add one assistant message to the accumulator (tokens->building, by time).
 * `fallback` = building for a message without a tool (current session work building).
 */
export function accumulateMessage(
  acc: Map<BuildingId, Bucket>,
  msg: MsgSample,
  now: number,
  dayStart: number,
  fallback: BuildingId = 'citadel',
  config: MappingConfig = DEFAULT_MAPPING,
): void {
  if (msg.output <= 0) return;
  const age = now - msg.ts;
  if (age < 0 || age > MONTH) return; // poza oknem 30 dni

  const buildings = msg.tools.length
    ? [...new Set(msg.tools.map((t) => resolveBuilding(t.name, t.detail, config)))]
    : [fallback]; // reasoning only -> current session work building
  const share = msg.output / buildings.length;

  for (const b of buildings) {
    const cur = acc.get(b) ?? { today: 0, week: 0, month: 0 };
    cur.month += share;
    if (age <= 7 * DAY) cur.week += share;
    if (msg.ts >= dayStart) cur.today += share;
    acc.set(b, cur);
  }
}

function resolveStatsSource(input: BuildingStatsSourceInput): BuildingStatsSource {
  if ('createExtractor' in input && typeof input.createExtractor === 'function') return input;
  const source = DEFAULT_BUILDING_STATS_SOURCES.find((candidate) => candidate.id === input.id);
  if (!source) throw new Error(`Unknown building stats source: ${input.id}`);
  return { ...source, roots: input.roots };
}

function completedBuildingsForTheme(themeId: string): BuildingId[] {
  return [completedBuildingForTheme(themeId)];
}

function recoveryBuildingsForTheme(themeId: string): BuildingId[] {
  return [recoveryBuildingForTheme(themeId)];
}

async function scanFile(
  source: BuildingStatsSource,
  path: string,
  acc: Map<BuildingId, Bucket>,
  now: number,
  dayStart: number,
  config: MappingConfig,
  themeId: string,
): Promise<void> {
  const content = await readFile(path, 'utf8');
  const extract = source.createExtractor();
  let current: BuildingId[] = ['citadel']; // current session work building(s)
  let pendingOutput: { ts: number; output: number; buildings: BuildingId[] } | undefined;

  const flushPendingOutput = (overrideBuildings?: BuildingId[]): void => {
    if (!pendingOutput) return;
    const buildings = overrideBuildings ?? pendingOutput.buildings;
    for (const building of buildings) {
      accumulateMessage(
        acc,
        { ts: pendingOutput.ts, output: pendingOutput.output, tools: [] },
        now,
        dayStart,
        building,
        config,
      );
    }
    pendingOutput = undefined;
  };

  const recordOutput = (ts: number, output: number, tools?: BuildingStatsTool[]): void => {
    if (tools?.length) {
      flushPendingOutput();
      const msgTools = tools.map((tool) => ({ name: tool.tool, detail: tool.detail }));
      const last = msgTools[msgTools.length - 1];
      current = [resolveBuilding(last.name, last.detail, config)];
      accumulateMessage(acc, { ts, output, tools: msgTools }, now, dayStart, current[0] ?? 'citadel', config);
      return;
    }

    flushPendingOutput();
    pendingOutput = { ts, output, buildings: current };
  };

  for (const line of content.split('\n')) {
    if (!line) continue;
    for (const event of extract(line)) {
      switch (event.kind) {
        case 'tool':
          flushPendingOutput();
          current = [resolveBuilding(event.tool, event.detail, config)];
          break;
        case 'output':
          recordOutput(event.ts, event.output, event.tools);
          break;
        case 'turn-end':
          flushPendingOutput();
          current = completedBuildingsForTheme(themeId);
          break;
        case 'turn-aborted':
          flushPendingOutput();
          current = recoveryBuildingsForTheme(themeId);
          break;
      }
    }
  }
  flushPendingOutput();
}

async function scanRoot(
  source: BuildingStatsSource,
  root: string,
  acc: Map<BuildingId, Bucket>,
  now: number,
  dayStart: number,
  config: MappingConfig,
  themeId: string,
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return;
  }

  for (const rel of entries) {
    if (!rel.endsWith('.jsonl')) continue;
    const path = join(root, rel);
    try {
      const s = await stat(path);
      if (now - s.mtimeMs > MONTH) continue; // file has no events in the 30-day window
      await scanFile(source, path, acc, now, dayStart, config, themeId);
    } catch {
      /* skip unreadable file */
    }
  }
}

export async function computeBuildingStatsForSources(
  sources: BuildingStatsSourceInput[],
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
  themeId = 'fantasy',
): Promise<BuildingStatsResponse> {
  const normalizedTheme = normalizeStatsTheme(themeId);
  const ds = new Date(now);
  ds.setHours(0, 0, 0, 0);
  const dayStart = ds.getTime();

  const acc = new Map<BuildingId, Bucket>();
  for (const input of sources) {
    const source = resolveStatsSource(input);
    for (const root of source.roots()) {
      await scanRoot(source, root, acc, now, dayStart, config, normalizedTheme);
    }
  }

  const buildings: BuildingStatsResponse['buildings'] = {};
  for (const [b, v] of acc) {
    buildings[b] = {
      today: Math.round(v.today),
      week: Math.round(v.week),
      month: Math.round(v.month),
    } satisfies BuildingWindowStats;
  }
  return { updatedAt: new Date(now).toISOString(), buildings };
}

export async function computeBuildingStatsForRoots(
  roots: string[],
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
  themeId = 'fantasy',
): Promise<BuildingStatsResponse> {
  const sourceRoots = [...roots];
  return computeBuildingStatsForSources(
    DEFAULT_BUILDING_STATS_SOURCES.map((source) => ({ ...source, roots: () => sourceRoots })),
    now,
    config,
    themeId,
  );
}

export async function computeBuildingStats(
  root: string,
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
  themeId = 'fantasy',
): Promise<BuildingStatsResponse> {
  return computeBuildingStatsForRoots([root], now, config, themeId);
}

// Cache: scan is expensive (many sessions x 30 days), so compute at most once/min.
let cache = new Map<string, { at: number; data: BuildingStatsResponse }>();
let inflight = new Map<string, Promise<BuildingStatsResponse>>();
// Epoch counter: invalidation bumps it; a pass writes cache ONLY when the epoch
// has not changed since it started. Otherwise PUT during a scan would cache a
// result computed with the OLD config for the entire TTL.
let epoch = 0;

/** After map edit (PUT /tool-mapping), drop cache so numbers catch up with the new config. */
export function invalidateBuildingStatsCache(): void {
  cache.clear();
  inflight.clear(); // abandon in-flight passes; their results are already stale
  epoch++;
}

export async function getBuildingStats(
  root?: string | string[],
  themeId = 'fantasy',
): Promise<BuildingStatsResponse> {
  const now = Date.now();
  const normalizedTheme = normalizeStatsTheme(themeId);
  const rootKey = root === undefined ? '<default>' : Array.isArray(root) ? root.join('\0') : root;
  const key = `${normalizedTheme}\0${rootKey}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL) return cached.data;
  const currentInflight = inflight.get(key);
  if (currentInflight) return currentInflight;
  const startEpoch = epoch;
  const sources = root === undefined
    ? DEFAULT_BUILDING_STATS_SOURCES
    : DEFAULT_BUILDING_STATS_SOURCES.map((source) => ({
        ...source,
        roots: () => (Array.isArray(root) ? root : [root]),
      }));
  const promise = loadMappingConfig()
    .then((config) => computeBuildingStatsForSources(sources, now, config, normalizedTheme))
    .then((data) => {
      // Save cache only if the map was not invalidated in the meantime.
      if (epoch === startEpoch) {
        cache.set(key, { at: Date.now(), data });
        if (inflight.get(key) === promise) inflight.delete(key);
      }
      return data;
    })
    .catch((err) => {
      if (epoch === startEpoch && inflight.get(key) === promise) inflight.delete(key);
      throw err;
    });
  inflight.set(key, promise);
  return promise;
}
