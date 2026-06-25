import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { SERVER_PORT } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import { toolDetail } from './transcript/parser.js';

/**
 * Claude Code HTTP hooks: fast event channel (type "http" in settings.json).
 * Transcripts remain the source of truth (tokens, content); hooks provide
 * immediate animations without the watcher's ~1s delay.
 */

export const HOOK_URL = `http://localhost:${SERVER_PORT}/hooks`;
export const DECIDE_URL = `http://localhost:${SERVER_PORT}/hooks/decide`;
/** PreToolUse blocks while the panel answers; give it room (seconds). */
export const DECIDE_TIMEOUT_SEC = 600;
const BLOCKING_EVENTS = new Set(['PreToolUse']);
const HOOK_COMMAND_MARKER = 'age-of-agents-hook-shim';
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

// --- Installer: merge hook entries into ~/.claude/settings.json ---

function settingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

type HookEntry = { matcher?: string; hooks: { type: string; url?: string; command?: string; timeout?: number }[] };

async function readSettings(path = settingsPath()): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

function blockingShim(): string {
  const script = [
    `const marker=${JSON.stringify(HOOK_COMMAND_MARKER)};void marker`,
    `const url=${JSON.stringify(DECIDE_URL)}`,
    `let body=''`,
    `process.stdin.setEncoding('utf8')`,
    `process.stdin.on('data', c => { body += c })`,
    `process.stdin.on('end', async () => {`,
    `  try {`,
    `    const res = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body, signal: AbortSignal.timeout(${DECIDE_TIMEOUT_SEC * 1000 - 5000}) })`,
    `    const out = await res.json()`,
    `    if (out && out.hookSpecificOutput) process.stdout.write(JSON.stringify(out))`,
    `  } catch {}`,
    `  process.exit(0)`,
    `})`,
  ].join(';');
  return `node -e ${JSON.stringify(script)}`;
}

function fireAndForgetShim(): string {
  // Command hook shim: forwards Claude's stdin JSON when AoA is running, exits
  // cleanly when it is not. This avoids global Claude Code HTTP-hook error spam.
  const script = [
    `const marker=${JSON.stringify(HOOK_COMMAND_MARKER)}`,
    `const url=${JSON.stringify(HOOK_URL)}`,
    `let body=''`,
    `process.stdin.setEncoding('utf8')`,
    `process.stdin.on('data', c => { body += c })`,
    `process.stdin.on('end', async () => {`,
    `  void marker`,
    `  try {`,
    `    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(300) })`,
    `  } catch {}`,
    `  process.exit(0)`,
    `})`,
    `setTimeout(() => process.exit(0), 600)`,
  ].join(';');
  return `node -e ${JSON.stringify(script)}`;
}

export function buildHookEntry(event: string): HookEntry {
  const blocking = BLOCKING_EVENTS.has(event);
  const entry: HookEntry = {
    hooks: [{ type: 'command', command: blocking ? blockingShim() : fireAndForgetShim(), timeout: blocking ? DECIDE_TIMEOUT_SEC : 1 }],
  };
  if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
  return entry;
}

function isOurs(entry: HookEntry): boolean {
  return entry.hooks?.some((h) => h.type === 'http' && h.url === HOOK_URL) ?? false;
}

function isOursCommand(entry: HookEntry): boolean {
  return entry.hooks?.some(
    (h) => h.type === 'command' && (h.command?.includes(HOOK_COMMAND_MARKER) || h.command?.includes('/hooks/decide')),
  ) ?? false;
}

function isAnyOurs(entry: HookEntry): boolean {
  return isOurs(entry) || isOursCommand(entry);
}

export async function hooksInstalled(path = settingsPath()): Promise<boolean> {
  return (await hooksStatus(path)).installed;
}

export async function hooksStatus(path = settingsPath()): Promise<{ installed: boolean; needsMigration: boolean }> {
  const settings = await readSettings(path);
  let hasLegacy = false;
  let hasAny = false;
  const installed = HOOK_EVENTS.every((event) => {
    const entries: HookEntry[] = settings.hooks?.[event] ?? [];
    hasLegacy ||= entries.some(isOurs);
    hasAny ||= entries.some(isAnyOurs);
    return entries.some(isOursCommand);
  });
  const pre: HookEntry[] = settings.hooks?.PreToolUse ?? [];
  const preStale = pre.some(
    (e) => e.hooks?.some((h) => h.type === 'command' && h.command?.includes(HOOK_COMMAND_MARKER) && (h.timeout ?? 1) < 60),
  );
  return { installed, needsMigration: hasLegacy || (hasAny && !installed) || preStale };
}

/** Adds our hooks (replace any stale entries; does not touch others' entries). Creates backup. */
export async function installHooks(path = settingsPath()): Promise<void> {
  const settings = await readSettings(path);
  try {
    await copyFile(path, join(dirname(path), 'settings.json.citadel-backup'));
  } catch {
    // no file: nothing to back up
  }
  settings.hooks ??= {};
  for (const event of HOOK_EVENTS) {
    const entries: HookEntry[] = (settings.hooks[event] ??= []);
    settings.hooks[event] = entries.filter((entry) => !isAnyOurs(entry));
    settings.hooks[event].push(buildHookEntry(event));
  }
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Removes only our entries (recognized by URL or command marker). */
export async function uninstallHooks(path = settingsPath()): Promise<void> {
  const settings = await readSettings(path);
  if (!settings.hooks) return;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] as HookEntry[]).filter((entry) => !isAnyOurs(entry));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Shapes a Claude Code PreToolUse hook decision for stdout / HTTP response. */
export function decisionToHookOutput(
  decision: 'allow' | 'deny',
  reason?: string,
): { hookSpecificOutput: Record<string, unknown> } {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
}
