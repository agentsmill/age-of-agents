import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; delete process.env.AOA_ALLOW_REMOTE; });
function tokenPath() { return join(mkdtempSync(join(tmpdir(), 'aoa-bind-')), 'session-token'); }

describe('non-loopback bind safeguard', () => {
  it('refuses a non-loopback host by default', async () => {
    await expect(startServer({ port: 0, demo: true, host: '0.0.0.0', tokenPath: tokenPath() }))
      .rejects.toThrow(/non-loopback/i);
  });
  it('allows it with AOA_ALLOW_REMOTE=1', async () => {
    process.env.AOA_ALLOW_REMOTE = '1';
    server = await startServer({ port: 0, demo: true, host: '0.0.0.0', tokenPath: tokenPath() });
    expect(server.port).toBeGreaterThan(0);
  });
  it('allows loopback without the flag', async () => {
    server = await startServer({ port: 0, demo: true, host: '127.0.0.1', tokenPath: tokenPath() });
    expect(server.port).toBeGreaterThan(0);
  });
});
