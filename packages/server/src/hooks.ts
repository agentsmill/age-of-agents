import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { SERVER_PORT } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import { toolDetail } from './transcript/parser.js';

/**
 * Hooki HTTP Claude Code — szybki kanał zdarzeń (typ "http" w settings.json).
 * Transkrypty pozostają źródłem prawdy (tokeny, treści); hooki dają
 * natychmiastowe animacje bez ~1 s opóźnienia watchera.
 */

export const HOOK_URL = `http://localhost:${SERVER_PORT}/hooks`;
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'] as const;
const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

export interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  model?: string;
  permission_mode?: string;
  message?: string;
  source?: string;
}

/**
 * Notification odpala się DWOMA torami: realną prośbą o akcję ("Claude needs your
 * permission to use Bash") oraz ciszą ~60 s po zakończonej turze ("Claude is waiting
 * for your input"). Tylko ten pierwszy to pytanie do usera — drugi NIE ma podbijać
 * spoczywającego bohatera w wieczny alarm "!". Wzorzec celowo wąski; nieznane
 * komunikaty traktujemy zachowawczo jako alarm (zwracamy false).
 */
function isIdleWaitingNotice(message: string | undefined): boolean {
  return typeof message === 'string' && /waiting for (your )?input/i.test(message);
}

export function translateHook(payload: HookPayload): { sessionId: string; projectDir: string; cwd?: string; facts: Fact[] } | null {
  const sessionId = payload.session_id;
  if (!sessionId) return null;
  const projectDir = payload.cwd ? basename(payload.cwd) : 'nieznany';
  const ts = new Date().toISOString();
  const facts: Fact[] = [];

  switch (payload.hook_event_name) {
    case 'SessionStart':
      facts.push({ kind: 'meta', model: payload.model, permissionMode: payload.permission_mode, cwd: payload.cwd });
      if (payload.source === 'clear') facts.push({ kind: 'cleared', ts });
      break;
    case 'UserPromptSubmit':
      if (payload.prompt) facts.push({ kind: 'prompt', text: payload.prompt.slice(0, 240), ts });
      break;
    case 'PreToolUse':
      if (payload.tool_name) {
        facts.push({
          kind: 'tool-start',
          tool: payload.tool_name,
          detail: toolDetail(payload.tool_name, payload.tool_input),
          messageId: `hook-${ts}`,
          ts,
        });
      }
      break;
    case 'PostToolUse':
      facts.push({ kind: 'thinking', ts });
      break;
    case 'Notification':
      if (!isIdleWaitingNotice(payload.message)) facts.push({ kind: 'awaiting', ts });
      break;
    case 'Stop':
      facts.push({ kind: 'turn-end', ts });
      break;
    default:
      return null;
  }

  return facts.length > 0 ? { sessionId, projectDir, cwd: payload.cwd, facts } : null;
}

// --- Instalator: merge wpisów hooków do ~/.claude/settings.json ---

function settingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

type HookEntry = { matcher?: string; hooks: { type: string; url?: string; timeout?: number }[] };

async function readSettings(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function isOurs(entry: HookEntry): boolean {
  return entry.hooks?.some((h) => h.type === 'http' && h.url === HOOK_URL) ?? false;
}

export async function hooksInstalled(): Promise<boolean> {
  const settings = await readSettings();
  return HOOK_EVENTS.every((event) => {
    const entries: HookEntry[] = settings.hooks?.[event] ?? [];
    return entries.some(isOurs);
  });
}

/** Dopisuje nasze hooki (merge — cudzych wpisów nie rusza). Robi backup. */
export async function installHooks(): Promise<void> {
  const path = settingsPath();
  const settings = await readSettings();
  try {
    await copyFile(path, join(dirname(path), 'settings.json.citadel-backup'));
  } catch {
    // brak pliku — nie ma czego backupować
  }
  settings.hooks ??= {};
  for (const event of HOOK_EVENTS) {
    const entries: HookEntry[] = (settings.hooks[event] ??= []);
    if (entries.some(isOurs)) continue;
    const entry: HookEntry = { hooks: [{ type: 'http', url: HOOK_URL, timeout: 5 }] };
    if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
    entries.push(entry);
  }
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Usuwa wyłącznie nasze wpisy (rozpoznawane po URL). */
export async function uninstallHooks(): Promise<void> {
  const settings = await readSettings();
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] as HookEntry[]).filter((entry) => !isOurs(entry));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
