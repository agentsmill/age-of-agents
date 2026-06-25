import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

beforeAll(() => { process.env.AOA_SOURCES = 'claude'; });
let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-srv-')), 'session-token'); }

describe('HTTP security wiring', () => {
  it('serves the token to a same-origin (no-origin) caller', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const res = await fetch(`${server.url}/session-token`);
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe(server.token);
  });
  it('rejects /session-token for a foreign origin (403)', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const res = await fetch(`${server.url}/session-token`, { headers: { origin: 'https://evil.com' } });
    expect(res.status).toBe(403);
  });
  it('blocks a sensitive POST without the token (401), allows it with', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const no = await fetch(`${server.url}/sessions/launch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/p', prompt: 'x', permissionMode: 'default' }),
    });
    expect(no.status).toBe(401);
    const ok = await fetch(`${server.url}/sessions/launch`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-aoa-token': server.token },
      body: JSON.stringify({ cwd: '/p', prompt: 'x', permissionMode: 'default' }),
    });
    expect(ok.status).toBe(200);
  });
});
