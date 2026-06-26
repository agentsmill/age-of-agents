import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import { opencodeSource } from './opencode.js';
import { kodaSource } from './koda.js';
import { localLlmSource } from './local-llm.js';
import { kimiSource } from './kimi.js';
import { filterSources } from './config.js';
import type { AgentSource } from './types.js';

export const ALL_SOURCES: AgentSource[] = [
  claudeSource, codexSource, opencodeSource, kodaSource,
  kimiSource,
  localLlmSource,
];

export function activeSources(raw = process.env.AOA_SOURCES): AgentSource[] {
  return filterSources(ALL_SOURCES, raw);
}

export const SOURCES: AgentSource[] = activeSources();
