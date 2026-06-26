import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import { opencodeSource } from './opencode.js';
import { kodaSource } from './koda.js';
import { localLlmSource } from './local-llm.js';
import { mimocodeSource } from './mimocode.js';
import { auggieSource } from './auggie.js';
import { filterSources } from './config.js';
import type { AgentSource } from './types.js';

/** All known agent sources. */
export const ALL_SOURCES: AgentSource[] = [claudeSource, codexSource, opencodeSource, kodaSource, localLlmSource, mimocodeSource, auggieSource];

export function activeSources(raw = process.env.AOA_SOURCES): AgentSource[] {
  return filterSources(ALL_SOURCES, raw);
}

/** All active agent sources for the default environment. */
export const SOURCES: AgentSource[] = activeSources();
