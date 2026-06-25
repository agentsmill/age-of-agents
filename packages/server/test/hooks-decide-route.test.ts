import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { WS_PATH, type GameEvent, type PendingQuestion } from '@agent-citadel/shared';
import { startServer } from '../src/server.js';

// Limit watchers to keep the real-mode server light in tests.
beforeAll(() => { process.env.AOA_SOURCES = 'claude'; });

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function policyFile(enabled: boolean): string {
  const p = join(mkdtempSync(join(tmpdir(), 'aoa-pol-')), 'permission-policy.json');
  writeFileSync(p, JSON.stringify({ enabled, rules: [] }));
  return p;
}

describe('/hooks/decide', () => {
  it('disabled policy -> {} (defer)', async () => {
    server = await startServer({ port: 0, demo: false, policyPath: policyFile(false) });
    const res = await fetch(`${server.url}/hooks/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm' } }),
    });
    expect(await res.json()).toEqual({});
  });

  it('enabled + WS answer allow -> allow decision', async () => {
    server = await startServer({ port: 0, demo: false, policyPath: policyFile(true) });
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}${WS_PATH}?token=${server.token}`);
    const pending = new Promise<PendingQuestion>((resolve) => {
      ws.on('message', (data) => {
        const ev = JSON.parse(String(data)) as GameEvent;
        if (ev.type === 'pending-question') resolve(ev.question);
      });
    });
    await new Promise((r) => ws.on('open', r));

    const decide = fetch(`${server.url}/hooks/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm' } }),
    });

    const q = await pending;
    ws.send(JSON.stringify({ type: 'answer', payload: { id: q.id, decision: { type: 'allow' } } }));

    const out = await (await decide).json();
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
    ws.close();
  }, 10000);
});
