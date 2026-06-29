import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Auggie source (https://augmentcode.com):
 * JSON files at ~/.augment/sessions/<uuid>.json
 *
 * Each file is a single JSON object (NOT JSONL) with:
 *   { sessionId, created, modified, chatHistory[], agentState, ... }
 *
 * chatHistory entries:
 *   { exchange: { request_message, response_text, response_nodes[] }, completed, sequenceId }
 *
 * response_nodes:
 *   { type, content, tool_use: { tool_use_id, tool_name, input_json }, thinking, token_usage }
 *
 * Because Auggie uses monolithic JSON files (not line-based), the standard
 * SourceWatcher + parseLine pattern does not apply. The AuggiePoller handles
 * full-file parsing directly. This source exists only for registration in
 * ALL_SOURCES so AOA_SOURCES filtering and UI badge resolution work.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ─────────────────────────────────────────────────────────────────
 * Auggie tool mapping -> canonical game name.
 * ───────────────────────────────────────────────────────────────── */
export function auggieToolToCanonical(name: string): string {
  switch (name) {
    case 'view':
      return 'Read';
    case 'str-replace-editor':
    case 'apply_patch':
      return 'Edit';
    case 'save-file':
      return 'Write';
    case 'launch-process':
    case 'write-process':
    case 'read-process':
    case 'kill-process':
      return 'Bash';
    case 'codebase-retrieval':
    case 'codebase_retrieval':
      return 'Grep';
    case 'web-fetch':
      return 'WebFetch';
    case 'github-api':
      return 'Git';
    case 'sub-agent-explore':
    case 'delegate_task_workspace-mcp':
      return 'Task';
    case 'add_tasks':
    case 'update_tasks':
    case 'view_tasklist':
      return 'TodoWrite';
    case 'remove-files':
      return 'Bash';
    default:
      // MCP tools: 'xxx_workspace-mcp' or 'server__tool'.
      if (name.includes('__')) return `mcp__${name}`;
      if (name.endsWith('_workspace-mcp')) return `mcp__${name.replace(/_workspace-mcp$/, '')}`;
      return name;
  }
}

/** Extract text from an Auggie response node. */
function extractNodeText(node: any): string | undefined {
  if (typeof node.content === 'string' && node.content.trim()) return clip(node.content);
  if (Array.isArray(node.content)) {
    const parts: string[] = [];
    for (const c of node.content) {
      if (typeof c === 'string') parts.push(c);
      else if (c?.text) parts.push(c.text);
    }
    if (parts.length > 0) return clip(parts.join('\n'));
  }
  return undefined;
}

/**
 * Parse an Auggie session JSON file into Facts. Called by AuggiePoller
 * with the full parsed object and a set of already-processed sequence IDs.
 */
export function parseAuggieSession(
  session: Record<string, unknown>,
  processedSeqs: Set<number>,
): { facts: Fact[]; newSeqs: number[] } {
  const facts: Fact[] = [];
  const newSeqs: number[] = [];
  const chatHistory = session.chatHistory as any[] | undefined;
  if (!Array.isArray(chatHistory)) return { facts, newSeqs };

  const created = typeof session.created === 'string' ? session.created : new Date().toISOString();

  // Emit meta fact once from top-level session data.
  facts.push({ kind: 'meta', cwd: undefined, model: undefined });

  for (const entry of chatHistory) {
    const seqId = typeof entry.sequenceId === 'number' ? entry.sequenceId : 0;
    if (processedSeqs.has(seqId)) continue;
    newSeqs.push(seqId);

    const ex = entry.exchange;
    if (!ex) continue;

    const ts = entry.finishedAt
      ? new Date(entry.finishedAt).toISOString()
      : typeof entry.completed === 'string'
        ? entry.completed
        : created;

    // User prompt.
    if (typeof ex.request_message === 'string' && ex.request_message.trim()) {
      const text = ex.request_message.trim();
      // Skip injected system/context messages.
      if (!text.startsWith('[') && !text.startsWith('<') && !text.includes('Role Reminder:')) {
        facts.push({ kind: 'prompt', text: clip(text), ts });
      }
    }

    // Assistant response text.
    if (typeof ex.response_text === 'string' && ex.response_text.trim()) {
      facts.push({ kind: 'assistant-text', text: clip(ex.response_text), ts });
    }

    // Response nodes: tool calls, thinking, token usage.
    const nodes = Array.isArray(ex.response_nodes) ? ex.response_nodes : [];
    for (const node of nodes) {
      // Thinking.
      if (node.thinking) {
        facts.push({ kind: 'thinking', ts });
      }

      // Tool use.
      const tu = node.tool_use;
      if (tu && tu.tool_name) {
        facts.push({
          kind: 'tool-start',
          tool: auggieToolToCanonical(tu.tool_name),
          detail: tu.input_json ? undefined : undefined, // input_json is a string, not worth parsing for detail
          messageId: tu.tool_use_id ?? `auggie-${ts}`,
          ts,
        });
        // If completed, emit tool-result.
        if (tu.completed_at_ms) {
          facts.push({ kind: 'tool-result', isError: false, ts });
        }
      }

      // Text content from nodes (assistant prose).
      const nodeText = extractNodeText(node);
      if (nodeText && !tu) {
        facts.push({ kind: 'assistant-text', text: nodeText, ts });
      }
    }

    // Turn end marker.
    if (entry.completed || entry.finishedAt) {
      facts.push({ kind: 'turn-end', ts });
    }
  }

  return { facts, newSeqs };
}

/** Path to Auggie sessions directory. */
export function getAuggieSessionsDir(): string {
  return join(homedir(), '.augment', 'sessions');
}

/**
 * Auggie source: registered in ALL_SOURCES for AOA_SOURCES filtering and
 * badge resolution. The actual session monitoring is handled by AuggiePoller
 * (not SourceWatcher), because Auggie uses monolithic JSON files.
 */
export const auggieSource: AgentSource = {
  id: 'auggie',
  roots: () => [], // No file watching — AuggiePoller handles it.
  depth: 0,
  classify(_path: string, _root: string): ClassifiedFile {
    return { kind: 'other' };
  },
  parseLine(_line: string): Fact[] {
    return []; // Not used — AuggiePoller parses full JSON files.
  },
};
