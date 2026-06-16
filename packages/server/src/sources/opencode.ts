import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Źródło OpenCode: ~/.local/share/opencode/opencode.db (SQLite)
 * OpenCode przechowuje sesje w bazie danych, nie w plikach JSONL.
 * Używamy pollingu SQL zamiast file watching.
 */

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/* ─────────────────────────────────────────────────────────────────
 * Mapowanie narzędzi OpenCode → nazwa kanoniczna gry
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
      // Narzędzia MCP: 'serwer__narzędzie' albo 'serwer.narzędzie'
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

/** Detal do dymka z argumentów tool (analog toolDetail Claude). */
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

/** Parsuje dane part z OpenCode → Fakty. */
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
        
        // Jeśli tool zakończony, dodaj tool-result
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
      // Plik załączony - nie generuje fakty narzędzia
      break;
    }
    
    case 'patch': {
      // Patch - zazwyczaj po edycie
      facts.push({ kind: 'turn-end', ts });
      break;
    }
    
    case 'compaction': {
      // Sesja skompaktowana - koniec tury
      facts.push({ kind: 'turn-end', ts });
      break;
    }
  }
  
  return facts;
}

/** Parsuje wiadomość użytkownika z OpenCode → Fakty. */
export function interpretOpencodeMessage(data: Record<string, unknown>, ts: string): Fact[] {
  const facts: Fact[] = [];
  
  // Sprawdź czy to wiadomość użytkownika (ma części typu 'text' z promptem)
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

/** Ekstrahuje metadane z sesji OpenCode. */
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

/** Ścieżka do bazy danych OpenCode. */
export function getOpencodeDbPath(): string {
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Źródło OpenCode - kompatybilne z AgentSource, ale używane
 * tylko dla parseLine (nie dla file watching - bo OpenCode używa SQLite).
 */
export const opencodeSource: AgentSource = {
  id: 'opencode',
  roots: () => [], // Nie używamy file watching dla OpenCode
  depth: 0,
  classify(_path: string, _root: string): ClassifiedFile {
    return { kind: 'other' }; // OpenCode nie używa classify
  },
  parseLine(line: string): Fact[] {
    try {
      const data = JSON.parse(line);
      const ts = new Date().toISOString();
      
      // Sprawdź czy to part czy message
      if (data.type && typeof data.type === 'string') {
        return interpretOpencodePart(data, ts);
      }
      
      return [];
    } catch {
      return [];
    }
  },
};
