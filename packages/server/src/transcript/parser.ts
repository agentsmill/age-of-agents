import { basename } from 'node:path';
import type { Fact } from './facts.js';

/** Shortens text for bubbles/panel. */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isClearCommand(text: string): boolean {
  return /<command-name>\s*\/clear\s*<\/command-name>/i.test(text);
}

/**
 * Whether text is a HUMAN PROMPT, not a synthetic Claude Code turn.
 * The transcript mixes real prompts with interruptions, blocks such as
 * <system-reminder>/<command-*>/<local-command-*>, "Caveat:...", and skill
 * injections ("Base directory for this skill:..."). Without this filter they
 * pollute missions and hero names.
 *
 * USER CONTRIBUTION (learning): this is a heuristic; tune the rejection list for your sessions.
 * It is intentionally CONSERVATIVE: rejects only explicit system markers, and
 * treats markdown ("# Task:...") and short messages ("yes deploy") as real prompts.
 */
export function isHumanPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false; // <system-reminder>, <command-name>, <local-command-stdout>…
  if (t.startsWith('[Request interrupted')) return false;
  if (t.startsWith('Caveat:')) return false;
  if (t.startsWith('Base directory for this skill:')) return false;
  if (t.includes('<system-reminder>') || t.includes('<command-name>')) return false;
  return true;
}

/** Extracts a short work description from tool input (for the bubble over the unit). */
export function toolDetail(tool: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  switch (tool) {
    case 'Bash':
      return str(input.description) ?? str(input.command)?.slice(0, 60);
    case 'Task':
    case 'Agent':
      return str(input.description);
    case 'WebSearch':
      return str(input.query);
    case 'WebFetch':
      return str(input.url);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return str(input.file_path) ? basename(input.file_path as string) : undefined;
    case 'Grep':
    case 'Glob':
      return str(input.pattern);
    default:
      return undefined;
  }
}

/**
 * Parses one transcript JSONL line into a list of Facts.
 * Unknown/broken records -> empty list (format changes between CLI versions, so
 * read everything defensively).
 */
export function interpretLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];

  const ts: string = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
  const facts: Fact[] = [];

  switch (record.type) {
    case 'queue-operation':
      if (record.operation === 'enqueue' && typeof record.content === 'string' && isHumanPrompt(record.content)) {
        facts.push({ kind: 'prompt', text: clip(record.content), ts });
      }
      break;

    // Only EXPLICIT session titles (assigned by CLI) name the hero. 'last-prompt'
    // is intentionally skipped: name from last prompt jumped every turn; state-machine
    // derives the name (first real prompt -> project -> UUID).
    case 'custom-title':
      if (typeof record.customTitle === 'string') facts.push({ kind: 'title', title: record.customTitle });
      break;
    case 'ai-title':
      if (typeof record.aiTitle === 'string') facts.push({ kind: 'title', title: record.aiTitle });
      break;

    case 'permission-mode':
      if (typeof record.permissionMode === 'string') {
        facts.push({ kind: 'meta', permissionMode: record.permissionMode });
      }
      break;

    case 'assistant': {
      const message = record.message;
      if (!message || typeof message !== 'object') break;
      const messageId: string = typeof message.id === 'string' ? message.id : record.uuid ?? '';

      facts.push({
        kind: 'meta',
        model: typeof message.model === 'string' ? message.model : undefined,
        gitBranch: typeof record.gitBranch === 'string' ? record.gitBranch : undefined,
        cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
      });

      if (
        typeof record.attributionSkill === 'string' ||
        typeof record.attributionPlugin === 'string' ||
        typeof record.attributionMcpServer === 'string'
      ) {
        facts.push({
          kind: 'attribution',
          skill: typeof record.attributionSkill === 'string' ? record.attributionSkill : undefined,
          plugin: typeof record.attributionPlugin === 'string' ? record.attributionPlugin : undefined,
          mcpServer: typeof record.attributionMcpServer === 'string' ? record.attributionMcpServer : undefined,
        });
      }

      const usage = message.usage;
      if (usage && typeof usage === 'object') {
        facts.push({
          kind: 'usage',
          messageId,
          input: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0),
          output: Number(usage.output_tokens ?? 0),
          context:
            Number(usage.input_tokens ?? 0) +
            Number(usage.cache_read_input_tokens ?? 0) +
            Number(usage.cache_creation_input_tokens ?? 0),
        });
      }

      const blocks: any[] = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'thinking') facts.push({ kind: 'thinking', ts });
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          facts.push({ kind: 'assistant-text', text: clip(block.text), ts });
        }
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          facts.push({
            kind: 'tool-start',
            tool: block.name,
            detail: toolDetail(block.name, block.input),
            messageId,
            ts,
          });
        }
      }

      if (message.stop_reason === 'end_turn') facts.push({ kind: 'turn-end', ts });
      break;
    }

    case 'user': {
      const meta: Fact = {
        kind: 'meta',
        gitBranch: typeof record.gitBranch === 'string' ? record.gitBranch : undefined,
        permissionMode: typeof record.permissionMode === 'string' ? record.permissionMode : undefined,
        cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
      };
      if (meta.gitBranch || meta.permissionMode || meta.cwd) facts.push(meta);

      const content = record.message?.content;
      if (typeof content === 'string') {
        if (isClearCommand(content)) facts.push({ kind: 'cleared', ts });
        else if (isHumanPrompt(content)) facts.push({ kind: 'prompt', text: clip(content), ts });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            facts.push({ kind: 'tool-result', isError: block.is_error === true, ts });
          }
          if (block?.type === 'text' && typeof block.text === 'string') {
            if (isClearCommand(block.text)) facts.push({ kind: 'cleared', ts });
            else if (isHumanPrompt(block.text)) facts.push({ kind: 'prompt', text: clip(block.text), ts });
          }
        }
      }
      break;
    }

    default:
      break;
  }

  return facts;
}
