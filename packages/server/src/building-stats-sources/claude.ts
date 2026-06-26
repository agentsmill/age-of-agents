import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BuildingStatsEvent, BuildingStatsSource, BuildingStatsTool } from './types.js';

function extractClaudeRecord(line: string): BuildingStatsEvent[] {
  let rec: any;
  try {
    rec = JSON.parse(line);
  } catch {
    return [];
  }

  if (rec?.type !== 'assistant' || !rec.message) return [];
  const ts = Date.parse(rec.timestamp);
  if (!ts) return [];

  const output = Number(rec.message.usage?.output_tokens ?? 0);
  if (output <= 0) return [];

  const blocks: any[] = Array.isArray(rec.message.content) ? rec.message.content : [];
  const tools: BuildingStatsTool[] = blocks
    .filter((b) => b?.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({
      tool: b.name as string,
      detail: b.name === 'Bash' && typeof b.input?.command === 'string' ? (b.input.command as string) : undefined,
    }));

  return [{ kind: 'output', ts, output, tools }];
}

export const claudeBuildingStatsSource: BuildingStatsSource = {
  id: 'claude',
  roots: () => [join(homedir(), '.claude', 'projects')],
  createExtractor: () => extractClaudeRecord,
};
