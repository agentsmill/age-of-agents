import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Source "local-llm": any agent speaking OpenAI-compatible chat-completions
 * (Ollama, llama.cpp, vLLM, oMLX) captured through one of the bundled logging
 * proxies (proxy/ollama-logger.ts, proxy/openai-logger.ts). The proxy writes a
 * JSONL transcript to ~/.age-of-agents/local-llm/sessions/<uuid>.jsonl, which
 * this source reads exactly like the claude/codex/opencode/koda sources.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function localLlmSessionsDir(): string {
  return process.env.LOCAL_LLM_SESSIONS_DIR ?? join(homedir(), '.age-of-agents', 'local-llm', 'sessions');
}

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** OpenAI/Ollama function-call name → canonical game tool name. */
export function localLlmToolToCanonical(name: string): string {
  switch (name.toLowerCase()) {
    case 'bash':
    case 'shell':
    case 'exec':
      return 'Bash';
    case 'read':
    case 'read_file':
      return 'Read';
    case 'edit':
    case 'edit_file':
      return 'Edit';
    case 'write':
    case 'write_file':
      return 'Write';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Grep';
    case 'web_search':
    case 'websearch':
      return 'WebSearch';
    case 'web_fetch':
    case 'webfetch':
      return 'WebFetch';
    case 'task':
    case 'agent':
      return 'Task';
    case 'todo':
    case 'todowrite':
      return 'TodoWrite';
    default:
      if (name.startsWith('mcp__')) return name;
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

function toolCallDetail(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const generic = str(args.command) ?? str(args.path) ?? str(args.file_path) ?? str(args.query) ?? str(args.pattern);
  return generic ? clip(generic, 60) : undefined;
}

function parseToolArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return undefined;
}

function handleMessage(record: any, ts: string, facts: Fact[]): void {
  const role = str(record.role);
  const content = typeof record.content === 'string' ? record.content : undefined;

  if (role === 'user' && content) {
    facts.push({ kind: 'prompt', text: clip(content), ts });
  } else if (role === 'assistant' && content) {
    facts.push({ kind: 'assistant-text', text: clip(content), ts });
  } else if (role === 'tool') {
    const isError = typeof content === 'string' && /error/i.test(content.slice(0, 32));
    facts.push({ kind: 'tool-result', isError, ts });
  }

  const toolCalls: any[] = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  for (const call of toolCalls) {
    const name = str(call?.function?.name) ?? str(call?.name);
    if (!name) continue;
    facts.push({
      kind: 'tool-start',
      tool: localLlmToolToCanonical(name),
      detail: toolCallDetail(parseToolArgs(call?.function?.arguments ?? call?.arguments)),
      messageId: str(call?.id) ?? `local-llm-${ts}`,
      ts,
    });
  }
}

/** Parse one JSONL line written by a logging proxy → Facts. Pure; never throws. */
export function interpretLocalLlmLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];

  const ts: string = str(record.ts) ?? new Date().toISOString();
  const facts: Fact[] = [];

  switch (record.type) {
    case 'session': {
      facts.push({ kind: 'meta', cwd: str(record.cwd), model: str(record.model) });
      // Carry the real context window (from Ollama /api/show) so the hero's
      // context bar is correct before any WindowRule exists in the registry.
      if (typeof record.contextWindow === 'number' && record.contextWindow > 0) {
        facts.push({ kind: 'usage', messageId: `local-llm-window-${ts}`, input: 0, output: 0, contextWindow: record.contextWindow });
      }
      break;
    }
    case 'message':
      handleMessage(record, ts, facts);
      break;
    case 'usage':
      if (typeof record.input === 'number' || typeof record.output === 'number') {
        facts.push({ kind: 'usage-total', input: Number(record.input ?? 0), output: Number(record.output ?? 0) });
      }
      break;
    case 'turn_complete':
      facts.push({ kind: 'turn-end', ts });
      break;
  }

  return facts;
}

/** Source local-llm: ~/.age-of-agents/local-llm/sessions/<uuid>.jsonl, one file per session. */
export const localLlmSource: AgentSource = {
  id: 'local-llm',
  roots: () => [localLlmSessionsDir()],
  depth: 1,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    if (rel.includes('/')) return { kind: 'other' };
    if (!rel.endsWith('.jsonl')) return { kind: 'other' };
    const m = rel.match(UUID_RE);
    if (!m) return { kind: 'other' };
    return { kind: 'session', sessionId: m[0], projectDir: '' };
  },
  parseLine: interpretLocalLlmLine,
};
