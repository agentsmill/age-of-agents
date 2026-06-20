import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSource, SourceId } from './types.js';

const SOURCE_IDS: Record<SourceId, true> = {
  claude: true,
  codex: true,
  opencode: true,
  koda: true,
};
const SOURCE_ID_SET: ReadonlySet<string> = new Set(Object.keys(SOURCE_IDS));

export function parseSourceFilter(raw: string | undefined): Set<SourceId> | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  const out = new Set<SourceId>();
  for (const part of text.split(',')) {
    const id = part.trim();
    if (!SOURCE_ID_SET.has(id)) throw new Error(`Unknown AOA_SOURCES value: ${id}`);
    out.add(id as SourceId);
  }
  return out;
}

export function filterSources(sources: AgentSource[], raw = process.env.AOA_SOURCES): AgentSource[] {
  const filter = parseSourceFilter(raw);
  if (!filter) return sources;
  return sources.filter((source) => filter.has(source.id));
}

export function parseCodexLookbackDays(raw = process.env.AOA_CODEX_LOOKBACK_DAYS): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error(`Invalid AOA_CODEX_LOOKBACK_DAYS: ${raw}`);
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateRoot(base: string, date: Date): string {
  return join(
    base,
    String(date.getFullYear()),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  );
}

export function codexDateRoots(base: string, now = new Date(), lookbackDays = parseCodexLookbackDays()): string[] {
  const roots: string[] = [];
  for (let offset = -lookbackDays; offset <= 1; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    roots.push(localDateRoot(base, date));
  }
  return roots;
}

export function rootIfExists(path: string): string[] {
  try {
    return existsSync(path) && statSync(path).isDirectory() ? [path] : [];
  } catch {
    return [];
  }
}
