import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import { rootIfExists } from './config.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Koda source (https://openadapter.dev/):
 * ~/.koda/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
 *
 * Koda is an open-source AI coding agent built on openadapter.dev.
 * Format: each JSONL line has type='session'|'model_change'|'message'|...
 * Messages: {type:'message', message:{role, content:[{type,text|name,arguments,id,output}]}}
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/* ─────────────────────────────────────────────────────────────────
 * Koda tool mapping -> canonical game name.
 * ───────────────────────────────────────────────────────────────── */
export function kodaToolToCanonical(name: string): string {
  switch (name) {
    case 'bash':
    case 'shell':
    case 'terminal_monitor_start_process':
    case 'terminal_monitor_get_output':
    case 'terminal_monitor_list_processes':
      return 'Bash';
    case 'read':
    case 'read_file':
    case 'view':
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
    case 'web_scrape':
    case 'webfetch':
    case 'web_fetch':
      return 'WebFetch';
    case 'task':
    case 'agent':
      return 'Task';
    case 'todo':
    case 'todowrite':
      return 'TodoWrite';
    case 'skill':
      return 'skill';
    default:
      // MCP tools: 'server__tool' or 'server.tool'.
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

/** Bubble detail from tool arguments. */
function kodaToolDetail(name: string, args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  
  if (name === 'bash' || name === 'shell') {
    const cmd = Array.isArray(args.command) ? args.command.join(' ') : str(args.command);
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'read' || name === 'read_file' || name === 'view') {
    return str(args.filePath) ?? str(args.path) ?? str(args.file_path);
  }
  if (name === 'edit' || name === 'edit_file') {
    return str(args.filePath) ?? str(args.path) ?? str(args.file_path);
  }
  if (name === 'write' || name === 'write_file') {
    return str(args.filePath) ?? str(args.path) ?? str(args.file_path);
  }
  if (name === 'web_search' || name === 'websearch') {
    return str(args.query);
  }
  if (name === 'web_scrape' || name === 'webfetch') {
    return str(args.url);
  }
  if (name === 'glob') {
    return str(args.pattern);
  }
  if (name === 'grep') {
    return str(args.pattern) ?? str(args.query);
  }
  if (name === 'task' || name === 'agent') {
    return str(args.description) ?? str(args.prompt);
  }
  return str(args.description) ?? str(args.prompt) ?? str(args.filePath) ?? str(args.path);
}

/** Whether toolCall result indicates an error. */
function kodaOutputIsError(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as any;
    if (typeof o.exit_code === 'number') return o.exit_code !== 0;
    if (o.success === false) return true;
    if (o.error) return true;
  }
  if (typeof output === 'string') {
    return output.toLowerCase().startsWith('error:');
  }
  return false;
}

/** Extracts text from message content block. */
function extractText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const c of content) {
    if (c?.type === 'text' && typeof c.text === 'string') {
      parts.push(c.text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** Checks whether text is a human prompt (not injected). */
export function isKodaHumanPrompt(text: string, role: string | undefined): boolean {
  if (role !== 'user') return false;
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false;
  if (t.startsWith('# AGENTS.md')) return false;
  if (t.includes('<environment_context>')) return false;
  if (t.includes('AGENTS.md instructions')) return false;
  return true;
}

/** Parses one Koda message -> Facts. */
function handleMessage(record: any, facts: Fact[]): void {
  const msg = record.message;
  if (!msg) return;
  
  const role = str(msg.role);
  const ts = str(record.timestamp) ?? new Date().toISOString();
  const content = msg.content;
  
  if (!Array.isArray(content)) return;
  
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const blockType = str(block.type);
    
    if (blockType === 'text') {
      const text = str(block.text);
      if (!text) continue;
      
      if (isKodaHumanPrompt(text, role)) {
        facts.push({ kind: 'prompt', text: clip(text), ts });
      } else if (role === 'assistant' && text.trim()) {
        facts.push({ kind: 'assistant-text', text: clip(text), ts });
      }
    } else if (blockType === 'thinking') {
      facts.push({ kind: 'thinking', ts });
    } else if (blockType === 'toolCall') {
      const name = str(block.name);
      if (name) {
        const callId = str(block.id) ?? `koda-${ts}`;
        const args = block.arguments;
        facts.push({
          kind: 'tool-start',
          tool: kodaToolToCanonical(name),
          detail: kodaToolDetail(name, args as Record<string, unknown>),
          messageId: callId,
          ts,
        });
      }
    } else if (blockType === 'toolResult') {
      const output = (block as any).output ?? (block as any).result;
      facts.push({ kind: 'tool-result', isError: kodaOutputIsError(output), ts });
    }
  }
}

/**
 * Parses one Koda JSONL line -> Facts. Unknown/broken record -> [].
 */
export function interpretKodaLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];
  
  const facts: Fact[] = [];
  
  switch (record.type) {
    case 'session': {
      // First line - session metadata.
      const cwd = str(record.cwd);
      const id = str(record.id);
      facts.push({
        kind: 'meta',
        cwd,
        model: str(record.model) ?? (cwd ? basename(cwd) : undefined),
      });
      // Title: try from initial prompt when available.
      if (record.title) {
        facts.push({ kind: 'title', title: str(record.title) ?? '' });
      }
      break;
    }
    
    case 'model_change': {
      const provider = str(record.provider);
      const modelId = str(record.modelId);
      if (provider || modelId) {
        const model = modelId ? `${provider}/${modelId}` : provider;
        facts.push({ kind: 'meta', model });
      }
      break;
    }
    
    case 'message': {
      handleMessage(record, facts);
      break;
    }
    
    case 'turn_complete':
    case 'task_complete': {
      facts.push({ kind: 'turn-end', ts: str(record.timestamp) ?? new Date().toISOString() });
      break;
    }
  }
  
  return facts;
}

/** Decodes Koda session directory path (e.g. "--C--Users-pietr--progetti-age-of-agents--") to Windows path. */
function decodeKodaDir(encoded: string): string {
  // Format: --C--Users-pietr--progetti-age-of-agents--
  // First 2 hyphens are "//C:/" - on Windows this is the drive.
  // Generally: each "--" pair is a separator.
  // "C--" at the start is "C:/".
  // Remove trailing "--".
  let s = encoded.replace(/^--/, '').replace(/--$/, '');
  // Pierwszy segment "C" to litera dysku
  const firstSep = s.indexOf('--');
  if (firstSep > 0) {
    const drive = s.slice(0, firstSep);
    const rest = s.slice(firstSep + 2);
    return `${drive}:\\${rest.replace(/--/g, '\\')}`;
  }
  return s;
}

/**
 * Koda source: ~/.koda/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
 */
export const kodaSource: AgentSource = {
  id: 'koda',
  roots: () => rootIfExists(join(homedir(), '.koda', 'agent', 'sessions')),
  depth: 4,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    const parts = rel.split(sep);
    // parts[0] = encoded working directory
    // parts[1] = session file <ts>_<uuid>.jsonl
    if (parts.length !== 2) return { kind: 'other' };
    const file = parts[1];
    if (!file.endsWith('.jsonl')) return { kind: 'other' };
    const m = file.match(UUID_RE);
    if (!m) return { kind: 'other' };
    
    // Dekoduj cwd z nazwy katalogu
    const projectDir = decodeKodaDir(parts[0]);
    
    return {
      kind: 'session',
      sessionId: m[0],
      projectDir,
    };
  },
  parseLine: interpretKodaLine,
};
