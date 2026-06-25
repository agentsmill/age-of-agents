import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { WS_PATH } from '@agent-citadel/shared';
import { startServer } from '../src/server.js';

beforeAll(() => { process.env.AOA_SOURCES = 'claude'; });
let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-ws-')), 'session-token'); }
const wsUrl = (base: string, q = '') => `${base.replace('http', 'ws')}${WS_PATH}${q}`;

/** Resolves 'open'|'error' for a socket so we can assert accept/reject. */
function outcome(ws: WebSocket): Promise<'open' | 'error'> {
  return new Promise((resolve) => {
    ws.on('open', () => resolve('open'));
    ws.on('error', () => resolve('error'));
  });
}

describe('WebSocket security', () => {
  it('accepts a connection with a valid token', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url, `?token=${server.token}`));
    expect(await outcome(ws)).toBe('open');
    ws.close();
  });
  it('rejects a connection without a token', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url));
    expect(await outcome(ws)).toBe('error');
  });
  it('rejects a connection from a foreign origin', async () => {
    server = await startServer({ port: 0, demo: true, tokenPath: tokenPath() });
    const ws = new WebSocket(wsUrl(server.url, `?token=${server.token}`), { origin: 'https://evil.com' });
    expect(await outcome(ws)).toBe('error');
  });
});
