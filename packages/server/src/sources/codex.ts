import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import { parseCodexLookbackDays } from './config.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODEX_RUNTIME_LOOKAHEAD_DAYS = 7;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function codexDateRoot(base: string, date: Date): string {
  return join(base, String(date.getFullYear()), pad2(date.getMonth() + 1), pad2(date.getDate()));
}

/* ─────────────────────────────────────────────────────────────────
 * TUNING POINT 1: heuristic for "real prompt vs. injections".
 * Codex injects as role 'user': AGENTS.md, <environment_context>,
 * permission instructions, etc. Conservatively: only role 'user' and no
 * explicit system markers. Tune this list for your sessions.
 * ───────────────────────────────────────────────────────────────── */
export function isCodexHumanPrompt(text: string, role: string | undefined): boolean {
  if (role !== 'user') return false; // 'developer'/'system' are not human prompts
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false; // <environment_context>, <permissions…>, <INSTRUCTIONS>
  if (t.startsWith('# AGENTS.md')) return false;
  if (t.includes('<environment_context>') || t.includes('AGENTS.md instructions')) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────────
 * TUNING POINT 2: Codex tool -> canonical game name.
 * The canonical name flows into toolToBuilding (shared), so it controls which
 * building the unit walks to. This is the heart of the Codex metaphor.
 * ───────────────────────────────────────────────────────────────── */
export function codexQualifiedToolName(name: string, namespace?: string): string {
  const ns = str(namespace);
  if (!ns) return name;
  if (name.startsWith(`${ns}.`) || name.startsWith(`${ns}__`)) return name;
  if (ns.startsWith('mcp__')) {
    const base = ns.endsWith('__') ? ns.slice(0, -2) : ns;
    return `${base}__${name}`;
  }
  return `${ns}.${name}`;
}

export function codexToolToCanonical(name: string, namespace?: string): string {
  const qualifiedName = codexQualifiedToolName(name, namespace);
  switch (qualifiedName) {
    case 'shell':
    case 'local_shell':
    case 'exec':
    case 'exec_command':
    case 'functions.exec_command':
    case 'write_stdin':
    case 'functions.write_stdin':
      return 'Bash'; // kopalnia (git w argumentach → targ, jak u Claude)
    case 'apply_patch':
    case 'functions.apply_patch':
    case 'image_gen.imagegen':
      return 'Edit'; // forge
    case 'read_file':
    case 'view_image':
    case 'functions.view_image':
      return 'Read'; // biblioteka
    case 'web_search':
    case 'web.run':
    case 'search_query':
    case 'image_query':
      return 'WebSearch'; // tower
    case 'tool_search_call':
    case 'tool_search_tool':
    case 'tool_search.tool_search_tool':
    case 'list_mcp_resources':
    case 'functions.list_mcp_resources':
    case 'list_mcp_resource_templates':
    case 'functions.list_mcp_resource_templates':
      return 'ToolSearch';
    case 'read_mcp_resource':
    case 'functions.read_mcp_resource':
      return 'Read';
    case 'request_user_input':
    case 'functions.request_user_input':
      return 'AskUserQuestion';
    case 'update_plan':
    case 'update_goal':
    case 'create_goal':
    case 'get_goal':
    case 'functions.update_plan':
    case 'functions.update_goal':
    case 'functions.create_goal':
    case 'functions.get_goal':
    case 'multi_tool_use.parallel':
    case 'multi_agent_v1.spawn_agent':
      return 'Workflow';
    case 'js':
      return 'mcp__node_repl__js';
    default:
      // Codex MCP tools: 'server__tool' or 'server.tool'.
      if (qualifiedName.startsWith('mcp__')) return qualifiedName;
      if (qualifiedName.includes('__')) return `mcp__${qualifiedName}`;
      if (qualifiedName.includes('.')) return `mcp__${qualifiedName.replace(/\./g, '__')}`;
      return qualifiedName; // nieznane → twierdza (fallback w toolToBuilding)
  }
}

/** Bubble detail from function_call arguments (Claude toolDetail analog). */
function codexToolDetail(name: string, argumentsRaw: unknown): string | undefined {
  let args: any;
  if (typeof argumentsRaw === 'string') {
    try {
      args = JSON.parse(argumentsRaw);
    } catch {
      if (name === 'apply_patch' || name === 'functions.apply_patch') args = { input: argumentsRaw };
      else if (name === 'js') args = { input: argumentsRaw };
      else if (name === 'tool_search_tool') args = { query: argumentsRaw };
      else if (name === 'web_search') args = { query: argumentsRaw };
      else if (name === 'web.run') args = { search_query: [{ q: argumentsRaw }] };
      else return clip(argumentsRaw, 60);
    }
  } else if (argumentsRaw && typeof argumentsRaw === 'object') {
    args = argumentsRaw;
  } else {
    return undefined;
  }
  if (name === 'shell' || name === 'local_shell' || name === 'exec' || name === 'exec_command' || name === 'functions.exec_command') {
    const cmd = Array.isArray(args.command) ? args.command.join(' ') : str(args.command) ?? str(args.cmd);
    // skip typical 'bash -lc' wrapper to show the command essence
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'web_search') return str(args.query);
  if (name === 'web.run') {
    const q = args.search_query?.[0]?.q ?? args.image_query?.[0]?.q;
    return str(q);
  }
  if (name === 'apply_patch' || name === 'functions.apply_patch') {
    const patch = str(args.input) ?? str(args.patch) ?? '';
    const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    return m ? m[1].split('/').pop() : undefined;
  }
  if (name === 'update_plan' || name === 'functions.update_plan') {
    const first = Array.isArray(args.plan) ? args.plan[0] : undefined;
    return str(first?.step);
  }
  if (name === 'js') return clip(str(args.code) ?? str(args.input) ?? '', 60) || undefined;
  if (name === 'tool_search_tool') return str(args.query);
  return str(args.path) ?? str(args.file_path) ?? str(args.query);
}

/** Whether function_call result indicates an error (best-effort; formats differ). */
function codexOutputIsError(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as any;
    if (typeof o.exit_code === 'number') return o.exit_code !== 0;
    if (o.success === false) return true;
  }
  return false;
}

/** Extracts cumulative token usage from token_count payload (several shapes). */
function finiteToken(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function requiredToken(value: unknown): number {
  return finiteToken(value) ?? 0;
}

function optionalToken(value: unknown): number | undefined {
  const n = finiteToken(value);
  return n && n > 0 ? n : undefined;
}

function extractCodexUsage(payload: any):
  | {
      input: number;
      output: number;
      context?: number;
      contextWindow?: number;
      cachedInput?: number;
      reasoningOutput?: number;
      last?: { input: number; output: number; cachedInput?: number; reasoningOutput?: number };
    }
  | undefined {
  const info = payload?.info ?? payload;
  const total = info?.total_token_usage ?? payload?.total_token_usage ?? payload;
  if (!total || typeof total !== 'object') return undefined;

  const input = requiredToken(total.input_tokens ?? total.input);
  const output = requiredToken(total.output_tokens ?? total.output);
  if (!input && !output) return undefined;

  const lastRaw = info?.last_token_usage;
  const lastInput = lastRaw && typeof lastRaw === 'object' ? requiredToken(lastRaw.input_tokens ?? lastRaw.input) : 0;
  const lastOutput = lastRaw && typeof lastRaw === 'object' ? requiredToken(lastRaw.output_tokens ?? lastRaw.output) : 0;
  const lastCachedInput = lastRaw && typeof lastRaw === 'object' ? optionalToken(lastRaw.cached_input_tokens) : undefined;
  const lastReasoningOutput = lastRaw && typeof lastRaw === 'object' ? optionalToken(lastRaw.reasoning_output_tokens) : undefined;
  const last = lastRaw && typeof lastRaw === 'object' && (lastInput || lastOutput)
    ? {
        input: lastInput,
        output: lastOutput,
        ...(lastCachedInput !== undefined ? { cachedInput: lastCachedInput } : {}),
        ...(lastReasoningOutput !== undefined ? { reasoningOutput: lastReasoningOutput } : {}),
      }
    : undefined;
  const context = last && last.input > 0 ? last.input : undefined;
  const contextWindow = optionalToken(info?.model_context_window);
  const cachedInput = optionalToken(total.cached_input_tokens);
  const reasoningOutput = optionalToken(total.reasoning_output_tokens);

  return {
    input,
    output,
    ...(context !== undefined ? { context } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(cachedInput !== undefined ? { cachedInput } : {}),
    ...(reasoningOutput !== undefined ? { reasoningOutput } : {}),
    ...(last ? { last } : {}),
  };
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
 * Parses one Codex rollout line -> Facts. Unknown/broken record -> [].
 * Format changes between CLI versions: read defensively.
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
      if (payload) {
        if (payload.thread_source === 'subagent') {
          const agentId = str(payload.id);
          const parentSessionId = str(payload.parent_thread_id) ?? str(payload.source?.subagent?.thread_spawn?.parent_thread_id);
          if (agentId && parentSessionId) {
            facts.push({
              kind: 'subagent-meta',
              agentId,
              parentSessionId,
              description: str(payload.agent_nickname) ?? str(payload.agent_role),
            });
          }
        }
        const model = str(payload.model);
        facts.push({ kind: 'meta', cwd: str(payload.cwd), model });
      }
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
            const rawName = codexQualifiedToolName(name, str(payload.namespace));
            facts.push({
              kind: 'tool-start',
              tool: codexToolToCanonical(name, str(payload.namespace)),
              detail: codexToolDetail(rawName, payload.arguments),
              messageId: str(payload.call_id) ?? `codex-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'function_call_output':
          facts.push({ kind: 'tool-result', isError: codexOutputIsError(payload.output), ts });
          break;
        case 'custom_tool_call': {
          const name = str(payload.name);
          if (name) {
            const rawName = codexQualifiedToolName(name, str(payload.namespace));
            facts.push({
              kind: 'tool-start',
              tool: codexToolToCanonical(name, str(payload.namespace)),
              detail: codexToolDetail(rawName, payload.arguments ?? payload.input),
              messageId: str(payload.call_id) ?? `codex-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'custom_tool_call_output':
          facts.push({ kind: 'tool-result', isError: codexOutputIsError(payload.output), ts });
          break;
        case 'tool_search_call':
          facts.push({
            kind: 'tool-start',
            tool: 'ToolSearch',
            detail: str(payload.query),
            messageId: str(payload.call_id) ?? `codex-${ts}`,
            ts,
          });
          break;
        case 'tool_search_output':
          facts.push({ kind: 'tool-result', isError: false, ts });
          break;
      }
      break;
    }

    case 'event_msg': {
      if (!payload) break;
      if (payload.type === 'token_count') {
        const u = extractCodexUsage(payload);
        if (u) facts.push({ kind: 'usage-total', ...u });
      } else if (payload.type === 'task_started') {
        facts.push({ kind: 'thinking', ts });
      } else if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        facts.push({ kind: 'turn-end', ts });
      } else if (payload.type === 'turn_aborted') {
        facts.push({ kind: 'turn-aborted', ts });
      }
      break;
    }

  }

  return facts;
}

/**
 * Codex source: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl.
 * Path encodes DATE, not project; projectName comes from cwd in session_meta.
 */
export function codexSessionRoots(
  base = join(homedir(), '.codex', 'sessions'),
  now = new Date(),
  lookbackDays?: number,
  lookaheadDays = 1,
): string[] {
  const roots: string[] = [];
  const resolvedLookbackDays = lookbackDays ?? parseCodexLookbackDays();
  for (let offset = -resolvedLookbackDays; offset <= lookaheadDays; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    roots.push(codexDateRoot(base, date));
  }
  return roots;
}

export const codexSource: AgentSource = {
  id: 'codex',
  roots: () => codexSessionRoots(join(homedir(), '.codex', 'sessions'), new Date(), undefined, CODEX_RUNTIME_LOOKAHEAD_DAYS),
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
