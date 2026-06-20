import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * OpenCode source: ~/.local/share/opencode/opencode.db (SQLite)
 * OpenCode przechowuje sesje w bazie danych, nie w plikach JSONL.
 * Use SQL polling instead of file watching.
 */

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/* ─────────────────────────────────────────────────────────────────
 * OpenCode tool mapping -> canonical game name.
 * ───────────────────────────────────────────────────────────────── */
export function opencodeToolToCanonical(name: string): string {
  switch (name) {
    case 'bash':
    case 'shell':
      return 'Bash';
    case 'read':
    case 'read_file':
    case 'view':
      return 'Read';
    case 'edit':
    case 'edit_file':
    case 'apply_patch':
      return 'Edit';
    case 'write':
    case 'write_file':
      return 'Write';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Grep';
    case 'websearch':
    case 'web_search':
      return 'WebSearch';
    case 'webfetch':
    case 'web_fetch':
      return 'WebFetch';
    case 'task':
      return 'Task';
    case 'skill':
      return 'skill';
    case 'todowrite':
    case 'todo':
      return 'todo';
    default:
      // MCP tools: 'server__tool' or 'server.tool'.
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

/** Bubble detail from tool arguments (Claude toolDetail analog). */
function opencodeToolDetail(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  
  if (name === 'bash' || name === 'shell') {
    const cmd = Array.isArray(input.command) ? input.command.join(' ') : str(input.command);
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'read' || name === 'read_file' || name === 'view') {
    return str(input.filePath) ?? str(input.path);
  }
  if (name === 'edit' || name === 'edit_file' || name === 'apply_patch') {
    return str(input.filePath) ?? str(input.path);
  }
  if (name === 'write' || name === 'write_file') {
    return str(input.filePath) ?? str(input.path);
  }
  if (name === 'websearch' || name === 'web_search') {
    return str(input.query);
  }
  if (name === 'webfetch' || name === 'web_fetch') {
    return str(input.url);
  }
  if (name === 'glob') {
    return str(input.pattern);
  }
  if (name === 'grep') {
    return str(input.pattern) ?? str(input.query);
  }
  if (name === 'task') {
    return str(input.description) ?? str(input.prompt);
  }
  return str(input.description) ?? str(input.prompt) ?? str(input.filePath) ?? str(input.path);
}

/** Parses OpenCode part data -> Facts. */
export function interpretOpencodePart(data: Record<string, unknown>, ts: string): Fact[] {
  const facts: Fact[] = [];
  const type = str(data.type);
  
  switch (type) {
    case 'text': {
      const text = str(data.text);
      if (text) {
        facts.push({ kind: 'assistant-text', text: clip(text), ts });
      }
      break;
    }
    
    case 'reasoning': {
      facts.push({ kind: 'thinking', ts });
      const text = str(data.text);
      if (text) {
        facts.push({ kind: 'assistant-text', text: clip(text), ts });
      }
      break;
    }
    
    case 'tool': {
      const toolName = str(data.tool);
      const state = data.state as Record<string, unknown> | undefined;
      const callID = str(data.callID) ?? `opencode-${ts}`;
      
      if (toolName) {
        const input = state?.input as Record<string, unknown> | undefined;
        facts.push({
          kind: 'tool-start',
          tool: opencodeToolToCanonical(toolName),
          detail: opencodeToolDetail(toolName, input),
          messageId: callID,
          ts,
        });
        
        // If tool finished, add tool-result.
        const status = str(state?.status);
        if (status === 'completed' || status === 'error') {
          facts.push({ kind: 'tool-result', isError: status === 'error', ts });
        }
      }
      break;
    }
    
    case 'step-start': {
      facts.push({ kind: 'thinking', ts });
      break;
    }
    
    case 'step-finish': {
      facts.push({ kind: 'turn-end', ts });
      break;
    }
    
    case 'file': {
      // Attached file: does not generate a tool fact.
      break;
    }
    
    case 'patch': {
      // Patch - zazwyczaj po edycie
      facts.push({ kind: 'turn-end', ts });
      break;
    }
    
    case 'compaction': {
      // Session compacted: end of turn.
      facts.push({ kind: 'turn-end', ts });
      break;
    }
  }
  
  return facts;
}

/** Parses OpenCode user message -> Facts. */
export function interpretOpencodeMessage(data: Record<string, unknown>, ts: string): Fact[] {
  const facts: Fact[] = [];
  
  // Check whether this is a user message (has 'text' parts with prompt).
  const parts = data.parts as Array<Record<string, unknown>> | undefined;
  if (parts) {
    for (const part of parts) {
      if (part.type === 'text') {
        const text = str(part.text);
        if (text && !text.startsWith('<') && !text.startsWith('# AGENTS')) {
          facts.push({ kind: 'prompt', text: clip(text), ts });
        }
      }
    }
  }
  
  return facts;
}

/** Extracts metadata from an OpenCode session. */
export function extractOpencodeMeta(sessionRow: Record<string, unknown>): { model?: string; cwd?: string; gitBranch?: string } {
  const modelData = sessionRow.model as string | undefined;
  let model: string | undefined;
  if (modelData) {
    try {
      const parsed = JSON.parse(modelData);
      model = str(parsed.id) ?? str(parsed.providerID);
    } catch {
      model = modelData;
    }
  }
  
  return {
    model,
    cwd: str(sessionRow.directory),
    gitBranch: undefined, // OpenCode nie przechowuje brancha w session
  };
}

/** Path to OpenCode database. */
export function getOpencodeDbPath(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * OpenCode source: compatible with AgentSource, but used only for parseLine
 * (not file watching, because OpenCode uses SQLite).
 */
export const opencodeSource: AgentSource = {
  id: 'opencode',
  roots: () => [], // No file watching for OpenCode.
  depth: 0,
  classify(_path: string, _root: string): ClassifiedFile {
    return { kind: 'other' }; // OpenCode does not use classify.
  },
  parseLine(line: string): Fact[] {
    try {
      const data = JSON.parse(line);
      const ts = new Date().toISOString();
      
      // Check whether this is part or message.
      if (data.type && typeof data.type === 'string') {
        return interpretOpencodePart(data, ts);
      }
      
      return [];
    } catch {
      return [];
    }
  },
};
