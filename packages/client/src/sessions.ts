import type { LaunchAgentRequest } from '@agent-citadel/shared';
import { apiFetch } from './api';

const RECENT_KEY = 'agent-citadel.recent-dirs';

export async function launchAgent(req: LaunchAgentRequest): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  try {
    const res = await apiFetch('/sessions/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    rememberDir(req.cwd);
    return { ok: true, sessionId: body.sessionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

export async function stopSession(sessionId: string): Promise<void> {
  await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => {});
}

export async function sendSessionMessage(sessionId: string, text: string): Promise<void> {
  await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  }).catch(() => {});
}

export async function sdkAvailable(): Promise<boolean> {
  try { const r = await fetch('/sessions'); return (await r.json()).available === true; } catch { return false; }
}

/** SDK install + auth status for the launch dialog. `authConfigured` is false when
 *  the server has no CLAUDE_CODE_OAUTH_TOKEN / API key — launches would 401. */
export async function sessionsStatus(): Promise<{ available: boolean; authConfigured: boolean }> {
  try {
    const r = await fetch('/sessions');
    const j = await r.json();
    return { available: j.available === true, authConfigured: j.authConfigured === true };
  } catch {
    return { available: false, authConfigured: false };
  }
}

export async function listDirs(dir?: string): Promise<{ dir: string; parent: string | null; entries: { name: string; path: string }[] }> {
  const r = await apiFetch(`/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
  if (!r.ok) throw new Error('cannot list');
  return r.json();
}

export function recentDirs(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function rememberDir(dir: string): void {
  const next = [dir, ...recentDirs().filter((d) => d !== dir)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
