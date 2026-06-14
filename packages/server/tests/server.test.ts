import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let running: RunningServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('startServer', () => {
  it('serwuje /health w trybie demo i zwraca realny port', async () => {
    running = await startServer({ port: 0, demo: true });
    expect(running.port).toBeGreaterThan(0);
    const res = await fetch(`http://localhost:${running.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, demo: true });
  });

  it('serwuje index.html klienta z webRoot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aioa-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AIOA-TEST</title>');
    running = await startServer({ port: 0, demo: true, webRoot: dir });

    const root = await fetch(`http://localhost:${running.port}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('AIOA-TEST');

    // SPA fallback: nieznana trasa też zwraca index.html.
    const spa = await fetch(`http://localhost:${running.port}/jakas/trasa`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('AIOA-TEST');
  });
});
