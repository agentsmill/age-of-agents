import type { LaunchAgentRequest } from '@agent-citadel/shared';

const RECENT_KEY = 'agent-citadel.recent-dirs';

export async function launchAgent(req: LaunchAgentRequest): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  try {
    const res = await fetch('/sessions/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    rememberDir(req.cwd);
    return { ok: true, sessionId: body.sessionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

export async function stopSession(sessionId: string): Promise<void> {
  await fetch(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => {});
}

export async function sendSessionMessage(sessionId: string, text: string): Promise<void> {
  await fetch(`/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  }).catch(() => {});
}

export async function sdkAvailable(): Promise<boolean> {
  try { const r = await fetch('/sessions'); return (await r.json()).available === true; } catch { return false; }
}

export async function listDirs(dir?: string): Promise<{ dir: string; parent: string | null; entries: { name: string; path: string }[] }> {
  const r = await fetch(`/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
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
