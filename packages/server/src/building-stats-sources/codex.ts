import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexQualifiedToolName, codexToolToCanonical } from '../sources/codex.js';
import type { BuildingStatsEvent, BuildingStatsSource } from './types.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
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

function codexToolFromRecord(rec: any): BuildingStatsEvent | undefined {
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
      kind: 'tool',
      ts,
      tool: codexToolToCanonical(rawName, str(payload.namespace)),
      detail: codexToolDetail(qualifiedName, payload.arguments ?? payload.input),
    };
  }

  if (payload.type === 'tool_search_call') {
    return { kind: 'tool', ts, tool: 'ToolSearch', detail: str(payload.query) };
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

function codexTurnEndFromRecord(rec: any): BuildingStatsEvent | undefined {
  if (rec?.type !== 'event_msg') return undefined;
  const payload = rec.payload;
  return payload?.type === 'task_complete' || payload?.type === 'turn_complete'
    ? { kind: 'turn-end', ts: Date.parse(rec.timestamp) || 0 }
    : undefined;
}

function codexTurnAbortedFromRecord(rec: any): BuildingStatsEvent | undefined {
  if (rec?.type !== 'event_msg') return undefined;
  const payload = rec.payload;
  return payload?.type === 'turn_aborted' ? { kind: 'turn-aborted', ts: Date.parse(rec.timestamp) || 0 } : undefined;
}

function createCodexExtractor(): (line: string) => BuildingStatsEvent[] {
  let outputTotal = 0;

  return (line: string): BuildingStatsEvent[] => {
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      return [];
    }

    const turnEnd = codexTurnEndFromRecord(rec);
    if (turnEnd) return [turnEnd];

    const turnAborted = codexTurnAbortedFromRecord(rec);
    if (turnAborted) return [turnAborted];

    const tool = codexToolFromRecord(rec);
    if (tool) return [tool];

    const usage = codexOutputTotalFromRecord(rec);
    if (!usage) return [];

    const delta = usage.outputTotal - outputTotal;
    outputTotal = usage.outputTotal;
    return delta > 0 ? [{ kind: 'output', ts: usage.ts, output: delta }] : [];
  };
}

export const codexBuildingStatsSource: BuildingStatsSource = {
  id: 'codex',
  roots: () => [join(homedir(), '.codex', 'sessions')],
  createExtractor: createCodexExtractor,
};
