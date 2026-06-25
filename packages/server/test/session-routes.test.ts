import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionRoutes } from '../src/session-routes.js';
import { LiveSessionRegistry } from '../src/sdk/sessions.js';
import { FakeSdkRunner } from '../src/sdk/fake-runner.js';

let app: Awaited<ReturnType<typeof Fastify>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function build() {
  app = Fastify();
  const sessions = new LiveSessionRegistry(new FakeSdkRunner());
  registerSessionRoutes(app, { sessions });
  await app.ready();
  return { app, sessions };
}

describe('session routes', () => {
  it('POST /sessions/launch validates and launches', async () => {
    const { app } = await build();
    const ok = await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '/p', prompt: 'do x', permissionMode: 'default' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sessionId).toBe('fake-session-1');
    const bad = await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '', prompt: '' } });
    expect(bad.statusCode).toBe(400);
  });
  it('message + stop route to the registry', async () => {
    const { app } = await build();
    await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '/p', prompt: 'x', permissionMode: 'default' } });
    const msg = await app.inject({ method: 'POST', url: '/sessions/fake-session-1/message', payload: { text: 'more' } });
    expect(msg.statusCode).toBe(200);
    const stop = await app.inject({ method: 'POST', url: '/sessions/fake-session-1/stop' });
    expect(stop.statusCode).toBe(200);
    const stopMissing = await app.inject({ method: 'POST', url: '/sessions/nope/stop' });
    expect(stopMissing.statusCode).toBe(404);
  });
});
