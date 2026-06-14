import { describe, it, expect, afterEach } from 'vitest';
import { startServer, type RunningServer } from '../src/server.js';

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
});
