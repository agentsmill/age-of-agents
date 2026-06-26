import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { Fact } from '../transcript/facts.js';
import { rootIfExists } from './config.js';
import type { AgentSource, ClassifiedFile } from './types.js';

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/* ── Tool → canonical game name ── */
export function kimiToolToCanonical(name: string): string {
  switch (name) {
    case 'Bash': case 'bash': case 'shell': return 'Bash';
    case 'Read': case 'ReadFile': case 'read': case 'read_file': return 'Read';
    case 'Edit': case 'EditFile': case 'edit': case 'edit_file': return 'Edit';
    case 'Write': case 'WriteFile': case 'write': case 'write_file': return 'Write';
    case 'Glob': case 'glob': return 'Glob';
    case 'Grep': case 'grep': return 'Grep';
    case 'WebSearch': case 'web_search': case 'websearch': return 'WebSearch';
    case 'WebFetch': case 'web_fetch': case 'webfetch': return 'WebFetch';
    case 'Task': case 'task': return 'Task';
    case 'TodoWrite': case 'todo': return 'TodoWrite';
    case 'Skill': case 'skill': return 'skill';
    case 'Agent': case 'agent': return 'Agent';
    case 'AskUserQuestion': case 'ask_user_question': return 'AskUserQuestion';
    case 'EnterPlanMode': case 'enter_plan_mode': return 'EnterPlanMode';
    case 'ExitPlanMode': case 'exit_plan_mode': return 'ExitPlanMode';
    case 'CreateGoal': case 'create_goal': return 'CreateGoal';
    case 'GetGoal': case 'get_goal': return 'GetGoal';
    case 'UpdateGoal': case 'update_goal': return 'UpdateGoal';
    case 'SetGoalBudget': case 'set_goal_budget': return 'SetGoalBudget';
    case 'CronCreate': case 'cron_create': return 'CronCreate';
    case 'CronList': case 'cron_list': return 'CronList';
    case 'CronDelete': case 'cron_delete': return 'CronDelete';
    case 'TaskList': case 'task_list': return 'TaskList';
    case 'TaskOutput': case 'task_output': return 'TaskOutput';
    case 'TaskStop': case 'task_stop': return 'TaskStop';
    case 'FetchURL': case 'fetch_url': return 'FetchURL';
    case 'ReadMediaFile': case 'read_media_file': return 'ReadMediaFile';
    case 'mcp__*': return 'mcp__*';
    default:
      if (name.startsWith('mcp__')) return name;
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

function kimiToolDetail(name: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, unknown>;

  if (name === 'Bash' || name === 'bash' || name === 'shell') {
    const cmd = Array.isArray(a.command) ? a.command.join(' ') : str(a.command);
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'Read' || name === 'ReadFile' || name === 'read' || name === 'read_file')
    return str(a.path) ?? str(a.file_path) ?? str(a.filePath);
  if (name === 'Edit' || name === 'EditFile' || name === 'edit' || name === 'edit_file')
    return str(a.path) ?? str(a.file_path) ?? str(a.filePath);
  if (name === 'Write' || name === 'WriteFile' || name === 'write' || name === 'write_file')
    return str(a.path) ?? str(a.file_path) ?? str(a.filePath);
  if (name === 'WebSearch' || name === 'web_search' || name === 'websearch')
    return str(a.query);
  if (name === 'WebFetch' || name === 'web_fetch' || name === 'webfetch')
    return str(a.url);
  if (name === 'Glob' || name === 'glob') return str(a.pattern);
  if (name === 'Grep' || name === 'grep') return str(a.pattern) ?? str(a.query);
  if (name === 'Task' || name === 'task') return str(a.description) ?? str(a.prompt);
  if (name === 'Agent' || name === 'agent') return str(a.description) ?? str(a.prompt) ?? str(a.subagent_type);
  if (name === 'FetchURL' || name === 'fetch_url') return str(a.url);
  if (name === 'AskUserQuestion' || name === 'ask_user_question') return str(a.question);
  return str(a.description) ?? str(a.prompt) ?? str(a.path) ?? str(a.file_path) ?? str(a.filePath) ?? str(a.url) ?? str(a.query);
}

function kimiOutputIsError(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (typeof o.exit_code === 'number') return o.exit_code !== 0;
    if (o.success === false) return true;
    if (o.error) return true;
  }
  if (typeof output === 'string') return output.toLowerCase().startsWith('error:');
  return false;
}

/* ── session_index.jsonl cache ── */
let sessionIndexCache: Map<string, string> | null = null;
let sessionIndexMtime = 0;

function loadSessionIndex(): Map<string, string> {
  const path = join(homedir(), '.kimi-code', 'session_index.jsonl');
  try {
    const st = statSync(path);
    if (sessionIndexCache && st.mtimeMs <= sessionIndexMtime) return sessionIndexCache;
    const raw = readFileSync(path, 'utf-8');
    const map = new Map<string, string>();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.sessionId && r.workDir) map.set(r.sessionId, r.workDir);
      } catch {}
    }
    sessionIndexCache = map;
    sessionIndexMtime = st.mtimeMs;
    return map;
  } catch {
    return sessionIndexCache ?? new Map();
  }
}

/* ── state.json cache ── */
const stateCache = new Map<string, { title?: string }>();

function readStateJson(sessionDir: string) {
  try {
    const raw = readFileSync(join(sessionDir, 'state.json'), 'utf-8');
    const d = JSON.parse(raw);
    return { title: str(d.title) };
  } catch { return {}; }
}

function getSessionMeta(sessionDir: string) {
  if (!stateCache.has(sessionDir)) stateCache.set(sessionDir, readStateJson(sessionDir));
  return stateCache.get(sessionDir)!;
}

/* ── Parse one Kimi wire.jsonl line ── */
export function interpretKimiLine(line: string): Fact[] {
  let record: any;
  try { record = JSON.parse(line); } catch { return []; }
  if (!record || typeof record !== 'object') return [];

  const type = str(record.type);
  const ts = new Date(record.time ?? Date.now()).toISOString();
  const facts: Fact[] = [];

  switch (type) {
    case 'metadata':
    case 'tools.set_active_tools':
      break;

    case 'config.update': {
      const model = str(record.modelAlias);
      if (model) facts.push({ kind: 'meta', model, ts });
      break;
    }

    case 'turn.prompt': {
      const input = record.input;
      if (Array.isArray(input)) {
        for (const part of input) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            const t = part.text.trim();
            if (t && !t.startsWith('<') && !t.startsWith('# AGENTS'))
              facts.push({ kind: 'prompt', text: clip(t), ts });
          }
        }
      } else if (typeof input === 'string') {
        const t = input.trim();
        if (t && !t.startsWith('<') && !t.startsWith('# AGENTS'))
          facts.push({ kind: 'prompt', text: clip(t), ts });
      }
      break;
    }

    case 'context.append_message': {
      const msg = record.message;
      if (!msg) break;
      const role = str(msg.role);
      const content = msg.content;
      if (!Array.isArray(content)) break;

      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text' && typeof part.text === 'string') {
          const t = part.text.trim();
          if (!t) continue;
          if (role === 'user' && !t.startsWith('<') && !t.startsWith('# AGENTS')) {
            facts.push({ kind: 'prompt', text: clip(t), ts });
          } else if (role === 'assistant') {
            facts.push({ kind: 'assistant-text', text: clip(t), ts });
          }
        }
      }
      break;
    }

    case 'context.append_loop_event': {
      const event = record.event;
      if (!event || typeof event !== 'object') break;
      const eventType = str(event.type);

      switch (eventType) {
        case 'step.begin':
          facts.push({ kind: 'thinking', ts });
          break;
        case 'step.end':
        case 'turn.end':
        case 'compaction':
          facts.push({ kind: 'turn-end', ts });
          break;
        case 'thinking':
          facts.push({ kind: 'thinking', ts });
          break;
        case 'text': {
          const text = str(event.text);
          if (text) facts.push({ kind: 'assistant-text', text: clip(text), ts });
          break;
        }
        case 'tool_call': {
          const name = str(event.name);
          if (name) {
            facts.push({
              kind: 'tool-start',
              tool: kimiToolToCanonical(name),
              detail: kimiToolDetail(name, event.arguments),
              messageId: str(event.call_id) ?? `kimi-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'tool_result': {
          facts.push({ kind: 'tool-result', isError: kimiOutputIsError(event.result), ts });
          break;
        }
        case 'approval_request': {
          facts.push({ kind: 'awaiting', ts });
          break;
        }
        case 'subagent_spawn': {
          const agentId = str(event.agent_id);
          if (agentId) {
            facts.push({
              kind: 'subagent-meta',
              agentId,
              parentSessionId: str(event.parent_tool_call_id) ?? 'unknown',
              description: str(event.description),
            });
          }
          break;
        }
      }
      break;
    }

    case 'usage.record': {
      const u = record.usage;
      if (u && typeof u === 'object') {
        const input = Number(u.input) || 0;
        const output = Number(u.output) || 0;
        const cachedInput = Number(u.cached_input) || undefined;
        const context = Number(u.context) || undefined;
        const contextWindow = Number(u.context_window) || undefined;
        if (input || output) {
          facts.push({
            kind: 'usage-total',
            input,
            output,
            ...(cachedInput && cachedInput > 0 ? { cachedInput } : {}),
            ...(context && context > 0 ? { context } : {}),
            ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
          });
        }
      }
      break;
    }

    case 'permission.record_approval_result': {
      const approved = record.approved === true;
      facts.push({ kind: 'tool-result', isError: !approved, ts });
      break;
    }
  }

  return facts;
}

/* ── Kimi source ── */
export const kimiSource: AgentSource = {
  id: 'kimi',
  roots: () => rootIfExists(join(homedir(), '.kimi-code', 'sessions')),
  depth: 6,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    const parts = rel.split(sep);
    if (parts.length !== 5 || parts[2] !== 'agents' || !parts[4].endsWith('.jsonl'))
      return { kind: 'other' };

    const sessionId = parts[1];
    const agentDir = parts[3];
    const sessionDir = join(root, parts[0], sessionId);

    if (agentDir === 'main') {
      const index = loadSessionIndex();
      const workDir = index.get(sessionId);
      const meta = getSessionMeta(sessionDir);
      return {
        kind: 'session',
        sessionId,
        projectDir: workDir ?? meta.title ?? parts[0],
      };
    }

    return { kind: 'subagent', agentId: agentDir, parentSessionId: sessionId };
  },
  parseLine: interpretKimiLine,
};
