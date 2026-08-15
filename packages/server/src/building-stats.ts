import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  completedBuildingForTheme,
  recoveryBuildingForTheme,
  resolveBuilding,
  DEFAULT_MAPPING,
  type BuildingId,
  type BuildingStatsResponse,
  type BuildingHeatmapResponse,
  type BuildingWindowStats,
  type MappingConfig,
} from '@agent-citadel/shared';
import { loadMappingConfig } from './mapping-config.js';
import { codexQualifiedToolName, codexToolToCanonical } from './sources/codex.js';

/**
 * Token usage per building for day/week/30-day windows.
 *
 * Historical data does NOT exist in memory (watcher sees only live sessions), so
 * scan transcripts under ~/.claude/projects and ~/.codex/sessions: assign each
 * assistant message's OUTPUT tokens to the building of the tool it used, split
 * evenly when it touched multiple buildings. A message without a tool (reasoning/
 * text only) is assigned to the building where the session is CURRENTLY working
 * (last used tool); otherwise Citadel (fallback) would swallow most tokens. The
 * result is cached.
 *
 * USER CONTRIBUTION (learning): attribution (even split, reasoning->last building,
 * fallback→citadel) i okna czasowe to decyzje do strojenia.
 */

const DAY = 86_400_000;
const MONTH = 30 * DAY;
const CACHE_TTL = 60_000;
const DEFAULT_STATS_ROOTS = [
  join(homedir(), '.claude', 'projects'),
  join(homedir(), '.codex', 'sessions'),
];

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

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
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

/** Wyciąga próbkę z rekordu assistant (lub null gdy nieistotny). */
export function sampleFromRecord(rec: any): MsgSample | undefined {
  if (rec?.type !== 'assistant' || !rec.message) return undefined;
  const ts = Date.parse(rec.timestamp);
  if (!ts) return undefined;
  const output = Number(rec.message.usage?.output_tokens ?? 0);
  if (output <= 0) return undefined;
  const blocks: any[] = Array.isArray(rec.message.content) ? rec.message.content : [];
  const tools = blocks
    .filter((b) => b?.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({
      name: b.name as string,
      detail: b.name === 'Bash' && typeof b.input?.command === 'string' ? (b.input.command as string) : undefined,
    }));
  return { ts, output, tools };
}

function parseCodexArgs(name: string, raw: unknown): any | undefined {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      if (name === 'apply_patch' || name === 'functions.apply_patch') return { input: raw };
      return { input: raw };
    }
  }
  return raw && typeof raw === 'object' ? raw : undefined;
}

function codexToolDetail(name: string, raw: unknown): string | undefined {
  const args = parseCodexArgs(name, raw);
  if (!args) return undefined;

  if (
    name === 'shell' ||
    name === 'local_shell' ||
    name === 'exec' ||
    name === 'exec_command' ||
    name === 'functions.exec_command'
  ) {
    const cmd = Array.isArray(args.command) ? args.command.join(' ') : str(args.command) ?? str(args.cmd);
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }

  if (name === 'apply_patch' || name === 'functions.apply_patch') {
    const patch = str(args.input) ?? str(args.patch) ?? '';
    const match = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    return match ? match[1].split('/').pop() : undefined;
  }

  if (name === 'web.run') {
    const q = args.search_query?.[0]?.q ?? args.image_query?.[0]?.q;
    return str(q);
  }

  return str(args.path) ?? str(args.file_path) ?? str(args.query);
}

function codexToolFromRecord(rec: any): { ts: number; name: string; detail?: string } | undefined {
  if (rec?.type !== 'response_item') return undefined;
  const ts = Date.parse(rec.timestamp);
  if (!ts) return undefined;
  const payload = rec.payload;
  if (!payload || typeof payload !== 'object') return undefined;

  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    const rawName = str(payload.name);
    if (!rawName) return undefined;
    const qualifiedName = codexQualifiedToolName(rawName, str(payload.namespace));
    return {
      ts,
      name: codexToolToCanonical(rawName, str(payload.namespace)),
      detail: codexToolDetail(qualifiedName, payload.arguments ?? payload.input),
    };
  }

  if (payload.type === 'tool_search_call') {
    return { ts, name: 'ToolSearch', detail: str(payload.query) };
  }

  return undefined;
}

function codexOutputTotalFromRecord(rec: any): { ts: number; outputTotal: number } | undefined {
  if (rec?.type !== 'event_msg') return undefined;
  const ts = Date.parse(rec.timestamp);
  if (!ts) return undefined;
  const payload = rec.payload;
  if (!payload || typeof payload !== 'object' || payload.type !== 'token_count') return undefined;

  const info = payload.info ?? payload;
  const total = info.total_token_usage ?? payload.total_token_usage ?? payload;
  if (!total || typeof total !== 'object') return undefined;
  const outputTotal = Number(total.output_tokens ?? total.output ?? 0);
  return Number.isFinite(outputTotal) ? { ts, outputTotal } : undefined;
}

function codexTurnEndFromRecord(rec: any): boolean {
  if (rec?.type !== 'event_msg') return false;
  const payload = rec.payload;
  return payload?.type === 'task_complete' || payload?.type === 'turn_complete';
}

function codexTurnAbortedFromRecord(rec: any): boolean {
  if (rec?.type !== 'event_msg') return false;
  const payload = rec.payload;
  return payload?.type === 'turn_aborted';
}

function completedBuildingsForAllThemes(): BuildingId[] {
  return [...new Set([completedBuildingForTheme('fantasy'), completedBuildingForTheme('scifi')])];
}

function recoveryBuildingsForAllThemes(): BuildingId[] {
  return [...new Set([recoveryBuildingForTheme('fantasy'), recoveryBuildingForTheme('scifi')])];
}

async function scanFile(
  path: string,
  acc: Map<BuildingId, Bucket>,
  now: number,
  dayStart: number,
  config: MappingConfig,
): Promise<void> {
  const content = await readFile(path, 'utf8');
  let current: BuildingId[] = ['citadel']; // current session work building(s)
  let codexOutputTotal = 0;
  let pendingCodexOutput: { ts: number; output: number; buildings: BuildingId[] } | undefined;

  const flushPendingCodexOutput = (overrideBuildings?: BuildingId[]): void => {
    if (!pendingCodexOutput) return;
    const buildings = overrideBuildings ?? pendingCodexOutput.buildings;
    for (const building of buildings) {
      accumulateMessage(
        acc,
        { ts: pendingCodexOutput.ts, output: pendingCodexOutput.output, tools: [] },
        now,
        dayStart,
        building,
        config,
      );
    }
    pendingCodexOutput = undefined;
  };

  for (const line of content.split('\n')) {
    if (!line) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (codexTurnEndFromRecord(rec)) {
      current = completedBuildingsForAllThemes();
      flushPendingCodexOutput(current);
      continue;
    }
    if (codexTurnAbortedFromRecord(rec)) {
      current = recoveryBuildingsForAllThemes();
      flushPendingCodexOutput(current);
      continue;
    }

    const codexTool = codexToolFromRecord(rec);
    if (codexTool) {
      flushPendingCodexOutput();
      current = [resolveBuilding(codexTool.name, codexTool.detail, config)];
      continue;
    }

    const codexUsage = codexOutputTotalFromRecord(rec);
    if (codexUsage) {
      const delta = codexUsage.outputTotal - codexOutputTotal;
      codexOutputTotal = codexUsage.outputTotal;
      if (delta > 0) {
        flushPendingCodexOutput();
        pendingCodexOutput = { ts: codexUsage.ts, output: delta, buildings: current };
      }
      continue;
    }

    const sample = sampleFromRecord(rec);
    if (!sample) continue;
    flushPendingCodexOutput();
    if (sample.tools.length) {
      const last = sample.tools[sample.tools.length - 1];
      current = [resolveBuilding(last.name, last.detail, config)];
    }
    accumulateMessage(acc, sample, now, dayStart, current[0] ?? 'citadel', config);
  }
  flushPendingCodexOutput();
}

async function scanRoot(
  root: string,
  acc: Map<BuildingId, Bucket>,
  now: number,
  dayStart: number,
  config: MappingConfig,
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
      await scanFile(path, acc, now, dayStart, config);
    } catch {
      /* skip unreadable file */
    }
  }
}

export async function computeBuildingStatsForRoots(
  roots: string[],
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
): Promise<BuildingStatsResponse> {
  const ds = new Date(now);
  ds.setHours(0, 0, 0, 0);
  const dayStart = ds.getTime();

  const acc = new Map<BuildingId, Bucket>();
  for (const root of roots) {
    await scanRoot(root, acc, now, dayStart, config);
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

export async function computeBuildingStats(
  root: string,
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
): Promise<BuildingStatsResponse> {
  return computeBuildingStatsForRoots([root], now, config);
}

// Cache: scan is expensive (many sessions x 30 days), so compute at most once/min.
let cache: { at: number; data: BuildingStatsResponse } | undefined;
let inflight: Promise<BuildingStatsResponse> | undefined;
// Epoch counter: invalidation bumps it; a pass writes cache ONLY when the epoch
// has not changed since it started. Otherwise PUT during a scan would cache a
// result computed with the OLD config for the entire TTL.
let epoch = 0;

/** After map edit (PUT /tool-mapping), drop cache so numbers catch up with the new config. */
export function invalidateBuildingStatsCache(): void {
  cache = undefined;
  inflight = undefined; // porzuć trwający przelot — jego wynik jest już nieświeży
  heatmapCache = undefined; // mapa cieplna używa tej samej mapy narzędzie→budynek
  heatmapInflight = undefined;
  epoch++;
}

export async function getBuildingStats(
  root: string | string[] = DEFAULT_STATS_ROOTS,
): Promise<BuildingStatsResponse> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL) return cache.data;
  if (inflight) return inflight;
  const startEpoch = epoch;
  const roots = Array.isArray(root) ? root : [root];
  inflight = loadMappingConfig()
    .then((config) => computeBuildingStatsForRoots(roots, now, config))
    .then((data) => {
      // Save cache only if the map was not invalidated in the meantime.
      if (epoch === startEpoch) {
        cache = { at: Date.now(), data };
        inflight = undefined;
      }
      return data;
    })
    .catch((err) => {
      if (epoch === startEpoch) inflight = undefined;
      throw err;
    });
  return inflight;
}

// ─── Mapa cieplna „rytmu dnia" (#6) — ten sam skan, oś GODZINY zamiast okien ───

/**
 * Sumy tokenów wyjściowych per budynek × godzina doby (0..23). Ta sama atrybucja
 * co statystyki (narzędzia→budynek równym podziałem, rozumowanie→bieżący budynek),
 * ale grupowana po `getHours()` znacznika czasu wiadomości. Własny skan (krótki,
 * cache'owany), by nie zmieniać przetestowanego computeBuildingStats.
 */
export async function computeBuildingHeatmap(
  root: string,
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
): Promise<BuildingHeatmapResponse> {
  const acc = new Map<BuildingId, number[]>();
  const add = (b: BuildingId, hour: number, v: number): void => {
    const arr = acc.get(b) ?? new Array<number>(24).fill(0);
    arr[hour] += v;
    acc.set(b, arr);
  };

  let entries: string[] = [];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return { updatedAt: new Date(now).toISOString(), buildings: {} };
  }

  for (const rel of entries) {
    if (!rel.endsWith('.jsonl')) continue;
    const path = join(root, rel);
    try {
      const s = await stat(path);
      if (now - s.mtimeMs > MONTH) continue;
      const content = await readFile(path, 'utf8');
      let current: BuildingId = 'citadel'; // budynek bieżącej pracy (ostatnie narzędzie)
      for (const line of content.split('\n')) {
        if (!line) continue;
        let rec: unknown;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        const sample = sampleFromRecord(rec);
        if (!sample) continue;
        const age = now - sample.ts;
        if (age < 0 || age > MONTH) continue;
        if (sample.tools.length) {
          const last = sample.tools[sample.tools.length - 1];
          current = resolveBuilding(last.name, last.detail, config);
        }
        const buildings = sample.tools.length
          ? [...new Set(sample.tools.map((t) => resolveBuilding(t.name, t.detail, config)))]
          : [current];
        const share = sample.output / buildings.length;
        const hour = new Date(sample.ts).getHours();
        for (const b of buildings) add(b, hour, share);
      }
    } catch {
      /* pomiń nieczytelny plik */
    }
  }

  const buildings: BuildingHeatmapResponse['buildings'] = {};
  for (const [b, arr] of acc) buildings[b] = arr.map((v) => Math.round(v));
  return { updatedAt: new Date(now).toISOString(), buildings };
}

let heatmapCache: { at: number; data: BuildingHeatmapResponse } | undefined;
let heatmapInflight: Promise<BuildingHeatmapResponse> | undefined;

export async function getBuildingHeatmap(
  root = join(homedir(), '.claude', 'projects'),
): Promise<BuildingHeatmapResponse> {
  const now = Date.now();
  if (heatmapCache && now - heatmapCache.at < CACHE_TTL) return heatmapCache.data;
  if (heatmapInflight) return heatmapInflight;
  const startEpoch = epoch;
  heatmapInflight = loadMappingConfig()
    .then((config) => computeBuildingHeatmap(root, now, config))
    .then((data) => {
      if (epoch === startEpoch) {
        heatmapCache = { at: Date.now(), data };
        heatmapInflight = undefined;
      }
      return data;
    })
    .catch((err) => {
      if (epoch === startEpoch) heatmapInflight = undefined;
      throw err;
    });
  return heatmapInflight;
}
