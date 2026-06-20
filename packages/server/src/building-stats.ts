import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  resolveBuilding,
  DEFAULT_MAPPING,
  type BuildingId,
  type BuildingStatsResponse,
  type BuildingHeatmapResponse,
  type BuildingWindowStats,
  type MappingConfig,
} from '@agent-citadel/shared';
import { loadMappingConfig } from './mapping-config.js';

/**
 * Zużycie tokenów per budynek w oknach dzień/tydzień/30 dni.
 *
 * Dane historyczne NIE istnieją w pamięci (watcher widzi tylko żywe sesje),
 * więc skanujemy transkrypty ~/.claude/projects: każdej wiadomości assistant
 * przypisujemy tokeny WYJŚCIOWE do budynku narzędzia, którego użyła
 * (toolToBuilding), z podziałem równym gdy dotknęła kilku budynków. Wiadomość
 * bez narzędzia (samo rozumowanie/tekst) przypisujemy do budynku, przy którym
 * sesja AKTUALNIE pracuje (ostatnie użyte narzędzie) — inaczej Twierdza
 * (fallback) pożarłaby większość tokenów. Wynik jest cache'owany.
 *
 * WKŁAD USERA (learning): atrybucja (równy podział, rozumowanie→ostatni budynek,
 * fallback→citadel) i okna czasowe to decyzje do strojenia.
 */

const DAY = 86_400_000;
const MONTH = 30 * DAY;
const CACHE_TTL = 60_000;

interface Bucket {
  today: number;
  week: number;
  month: number;
}

export interface MsgSample {
  ts: number; // epoch ms
  output: number; // tokeny wyjściowe wiadomości
  tools: { name: string; detail?: string }[];
}

/**
 * Czyste: dodaj jedną wiadomość assistant do akumulatora (tokeny→budynek, wg czasu).
 * `fallback` = budynek dla wiadomości bez narzędzia (budynek bieżącej pracy sesji).
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
    : [fallback]; // samo rozumowanie → budynek bieżącej pracy sesji
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

async function scanFile(
  path: string,
  acc: Map<BuildingId, Bucket>,
  now: number,
  dayStart: number,
  config: MappingConfig,
): Promise<void> {
  const content = await readFile(path, 'utf8');
  let current: BuildingId = 'citadel'; // budynek bieżącej pracy sesji (ostatnie narzędzie)
  for (const line of content.split('\n')) {
    if (!line) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const sample = sampleFromRecord(rec);
    if (!sample) continue;
    if (sample.tools.length) {
      const last = sample.tools[sample.tools.length - 1];
      current = resolveBuilding(last.name, last.detail, config);
    }
    accumulateMessage(acc, sample, now, dayStart, current, config);
  }
}

export async function computeBuildingStats(
  root: string,
  now: number,
  config: MappingConfig = DEFAULT_MAPPING,
): Promise<BuildingStatsResponse> {
  const ds = new Date(now);
  ds.setHours(0, 0, 0, 0);
  const dayStart = ds.getTime();

  const acc = new Map<BuildingId, Bucket>();
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
      if (now - s.mtimeMs > MONTH) continue; // plik bez zdarzeń w oknie 30 dni
      await scanFile(path, acc, now, dayStart, config);
    } catch {
      /* pomiń nieczytelny plik */
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

// Cache: skan jest kosztowny (wiele sesji × 30 dni) → liczymy najwyżej raz/min.
let cache: { at: number; data: BuildingStatsResponse } | undefined;
let inflight: Promise<BuildingStatsResponse> | undefined;
// Licznik epok: inwalidacja go bije; przelot zapisuje cache TYLKO gdy epoka
// nie zmieniła się od jego startu. Inaczej PUT w trakcie skanu utrwaliłby wynik
// policzony STARYM configiem na cały TTL.
let epoch = 0;

/** Po edycji mapy (PUT /tool-mapping) zrzuć cache, żeby liczby nadążyły za nowym configiem. */
export function invalidateBuildingStatsCache(): void {
  cache = undefined;
  inflight = undefined; // porzuć trwający przelot — jego wynik jest już nieświeży
  heatmapCache = undefined; // mapa cieplna używa tej samej mapy narzędzie→budynek
  heatmapInflight = undefined;
  epoch++;
}

export async function getBuildingStats(
  root = join(homedir(), '.claude', 'projects'),
): Promise<BuildingStatsResponse> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL) return cache.data;
  if (inflight) return inflight;
  const startEpoch = epoch;
  inflight = loadMappingConfig()
    .then((config) => computeBuildingStats(root, now, config))
    .then((data) => {
      // Zapisz cache tylko, jeśli w międzyczasie nie unieważniono mapy.
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
