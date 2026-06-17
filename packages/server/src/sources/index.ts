import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import { opencodeSource } from './opencode.js';
import { kodaSource } from './koda.js';
import { localLlmSource } from './local-llm.js';
import type { AgentSource } from './types.js';

/** Wszystkie aktywne źródła agentów. */
export const SOURCES: AgentSource[] = [claudeSource, codexSource, opencodeSource, kodaSource, localLlmSource];
