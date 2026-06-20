import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ─────────────────────────────────────────────────────────────────
 * PUNKT DOSTROJENIA 1 — heurystyka „prawdziwy prompt vs. wstrzyknięcia".
 * Codex wstrzykuje jako rolę 'user': AGENTS.md, <environment_context>,
 * instrukcje permissions itp. Konserwatywnie: tylko rola 'user' i bez
 * jawnych markerów systemowych. Dostrój listę pod swoje sesje.
 * ───────────────────────────────────────────────────────────────── */
export function isCodexHumanPrompt(text: string, role: string | undefined): boolean {
  if (role !== 'user') return false; // 'developer'/'system' to nie prompty człowieka
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false; // <environment_context>, <permissions…>, <INSTRUCTIONS>
  if (t.startsWith('# AGENTS.md')) return false;
  if (t.includes('<environment_context>') || t.includes('AGENTS.md instructions')) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────────
 * PUNKT DOSTROJENIA 2 — narzędzie Codeksa → nazwa kanoniczna gry.
 * Nazwa kanoniczna trafia do toolToBuilding (shared), więc steruje tym,
 * do którego budynku maszeruje jednostka. To serce metafory dla Codeksa.
 * ───────────────────────────────────────────────────────────────── */
export function codexToolToCanonical(name: string): string {
  switch (name) {
    case 'shell':
    case 'local_shell':
    case 'exec':
      return 'Bash'; // kopalnia (git w argumentach → targ, jak u Claude)
    case 'apply_patch':
      return 'Edit'; // kuźnia
    case 'read_file':
    case 'view_image':
      return 'Read'; // biblioteka
    case 'web_search':
      return 'WebSearch'; // wieża
    case 'update_plan':
      return 'update_plan'; // brak mapowania → twierdza
    default:
      // Narzędzia MCP Codeksa: 'serwer__narzędzie' albo 'serwer.narzędzie'.
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name; // nieznane → twierdza (fallback w toolToBuilding)
  }
}

/** Detal do dymka z argumentów function_call (analog toolDetail Claude). */
function codexToolDetail(name: string, argumentsRaw: unknown): string | undefined {
  let args: any;
  if (typeof argumentsRaw === 'string') {
    try {
      args = JSON.parse(argumentsRaw);
    } catch {
      return clip(argumentsRaw, 60);
    }
  } else if (argumentsRaw && typeof argumentsRaw === 'object') {
    args = argumentsRaw;
  } else {
    return undefined;
  }
  if (name === 'shell' || name === 'local_shell' || name === 'exec') {
    const cmd = Array.isArray(args.command) ? args.command.join(' ') : str(args.command);
    // pomiń typowy wrapper 'bash -lc' aby pokazać sedno komendy
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'web_search') return str(args.query);
  if (name === 'apply_patch') {
    const patch = str(args.input) ?? '';
    const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    return m ? m[1].split('/').pop() : undefined;
  }
  return str(args.path) ?? str(args.file_path);
}

/** Czy wynik function_call wskazuje błąd (best-effort — formaty się różnią). */
function codexOutputIsError(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as any;
    if (typeof o.exit_code === 'number') return o.exit_code !== 0;
    if (o.success === false) return true;
  }
  return false;
}

const positiveNumber = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Wyciąga użycie tokenów z payloadu token_count (kilka kształtów). */
function extractCodexUsage(payload: any): { input: number; output: number; context?: number; contextWindow?: number } | undefined {
  const info = payload?.info && typeof payload.info === 'object' ? payload.info : payload;
  const u = info?.total_token_usage ?? payload?.total_token_usage ?? payload;
  if (!u || typeof u !== 'object') return undefined;
  const input = Number(u.input_tokens ?? u.input ?? 0);
  const output = Number(u.output_tokens ?? u.output ?? 0);
  if (!input && !output) return undefined;

  const last = info?.last_token_usage;
  const context = last && typeof last === 'object'
    ? positiveNumber(last.total_tokens) ??
      positiveNumber(
        Number(last.input_tokens ?? last.input ?? 0) +
        Number(last.output_tokens ?? last.output ?? 0) +
        Number(last.reasoning_output_tokens ?? 0),
      )
    : undefined;
  const contextWindow = positiveNumber(info?.model_context_window ?? payload?.model_context_window);
  return { input, output, ...(context ? { context } : {}), ...(contextWindow ? { contextWindow } : {}) };
}

function handleMessage(payload: any, ts: string, facts: Fact[]): void {
  const role = typeof payload.role === 'string' ? payload.role : undefined;
  const blocks: any[] = Array.isArray(payload.content) ? payload.content : [];
  for (const b of blocks) {
    const text = typeof b?.text === 'string' ? b.text : '';
    if (!text) continue;
    if (b.type === 'input_text' && isCodexHumanPrompt(text, role)) {
      facts.push({ kind: 'prompt', text: clip(text), ts });
    } else if (b.type === 'output_text' && role === 'assistant' && text.trim()) {
      facts.push({ kind: 'assistant-text', text: clip(text), ts });
    }
  }
}

/**
 * Parsuje jedną linię rolloutu Codeksa → Fakty. Nieznany/uszkodzony rekord → [].
 * Format zmienia się między wersjami CLI — czytamy defensywnie.
 */
export function interpretCodexLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];
  const ts: string = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : undefined;
  const facts: Fact[] = [];

  switch (record.type) {
    case 'session_meta':
      if (payload) facts.push({ kind: 'meta', cwd: str(payload.cwd), model: str(payload.model) ?? str(payload.model_provider) });
      break;

    case 'turn_context': {
      if (payload) {
        const cwd = str(payload.cwd);
        const model = str(payload.model);
        if (cwd || model) facts.push({ kind: 'meta', cwd, model });
      }
      break;
    }

    case 'response_item': {
      if (!payload) break;
      switch (payload.type) {
        case 'message':
          handleMessage(payload, ts, facts);
          break;
        case 'reasoning':
          facts.push({ kind: 'thinking', ts });
          break;
        case 'function_call': {
          const name = str(payload.name);
          if (name) {
            facts.push({
              kind: 'tool-start',
              tool: codexToolToCanonical(name),
              detail: codexToolDetail(name, payload.arguments),
              messageId: str(payload.call_id) ?? `codex-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'function_call_output':
          facts.push({ kind: 'tool-result', isError: codexOutputIsError(payload.output), ts });
          break;
      }
      break;
    }

    case 'event_msg': {
      if (!payload) break;
      if (payload.type === 'token_count') {
        const u = extractCodexUsage(payload);
        if (u) facts.push({ kind: 'usage-total', ...u });
      } else if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        facts.push({ kind: 'turn-end', ts });
      }
      break;
    }
  }

  return facts;
}

/**
 * Źródło Codex: ~/.codex/sessions/RRRR/MM/DD/rollout-<ts>-<uuid>.jsonl.
 * Ścieżka koduje DATĘ, nie projekt — projectName bierze się z cwd w session_meta.
 */
export const codexSource: AgentSource = {
  id: 'codex',
  roots: () => [join(homedir(), '.codex', 'sessions')],
  depth: 6,
  classify(path: string): ClassifiedFile {
    const file = path.split('/').pop() ?? '';
    if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) return { kind: 'other' };
    const m = file.match(UUID_RE);
    if (!m) return { kind: 'other' };
    return { kind: 'session', sessionId: m[0], projectDir: '' };
  },
  parseLine: interpretCodexLine,
};
