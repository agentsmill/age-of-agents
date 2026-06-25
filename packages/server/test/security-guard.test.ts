import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSecurityGuard, verifyWsClient, isSensitiveRoute } from '../src/security/guard.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function build(token = 'secret') {
  const a = Fastify();
  registerSecurityGuard(a, { getPort: () => 8123, token });
  a.get('/health', async () => ({ ok: true }));
  a.post('/sessions/launch', async () => ({ ok: true }));
  a.put('/tool-mapping', async () => ({ ok: true }));
  await a.ready();
  return a;
}

describe('registerSecurityGuard', () => {
  it('rejects a foreign origin on any route (403)', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.com' } });
    expect(res.statusCode).toBe(403);
  });
  it('allows missing origin on a non-sensitive route', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
  it('requires the token on a sensitive route (401 without, pass with)', async () => {
    app = await build();
    const no = await app.inject({ method: 'POST', url: '/sessions/launch' });
    expect(no.statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { 'x-aoa-token': 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { 'x-aoa-token': 'secret' } });
    expect(ok.statusCode).toBe(200);
  });
  it('checks origin before token (403 wins over a good token)', async () => {
    app = await build();
    const res = await app.inject({ method: 'POST', url: '/sessions/launch', headers: { origin: 'https://evil.com', 'x-aoa-token': 'secret' } });
    expect(res.statusCode).toBe(403);
  });
  it('allows a dev-port origin with token', async () => {
    app = await build();
    const res = await app.inject({ method: 'PUT', url: '/tool-mapping', headers: { origin: 'http://localhost:5173', 'x-aoa-token': 'secret' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('isSensitiveRoute', () => {
  it('classifies state-changing and sensitive routes', () => {
    expect(isSensitiveRoute('POST', '/sessions/launch')).toBe(true);
    expect(isSensitiveRoute('POST', '/sessions/abc-123/message')).toBe(true);
    expect(isSensitiveRoute('POST', '/sessions/abc-123/stop')).toBe(true);
    expect(isSensitiveRoute('POST', '/hooks/install')).toBe(true);
    expect(isSensitiveRoute('POST', '/hooks/uninstall')).toBe(true);
    expect(isSensitiveRoute('PUT', '/model-config')).toBe(true);
    expect(isSensitiveRoute('GET', '/fs/list')).toBe(true);
  });
  it('leaves the hook channel and reads token-free', () => {
    expect(isSensitiveRoute('POST', '/hooks')).toBe(false);
    expect(isSensitiveRoute('POST', '/hooks/decide')).toBe(false);
    expect(isSensitiveRoute('GET', '/sessions')).toBe(false);
    expect(isSensitiveRoute('GET', '/session-token')).toBe(false);
    expect(isSensitiveRoute('GET', '/health')).toBe(false);
  });
});

describe('verifyWsClient', () => {
  it('requires an allowlisted origin and a matching token', () => {
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(true);
    expect(verifyWsClient({ origin: undefined, reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(true);
    expect(verifyWsClient({ origin: 'https://evil.com', reqUrl: '/ws?token=secret' }, 8123, 'secret')).toBe(false);
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws?token=wrong' }, 8123, 'secret')).toBe(false);
    expect(verifyWsClient({ origin: 'http://localhost:5173', reqUrl: '/ws' }, 8123, 'secret')).toBe(false);
  });
});
