import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('apiFetch', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the token once and attaches it to requests', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
      calls.push({ url, headers });
      if (url === '/session-token') return new Response(JSON.stringify({ token: 'T123' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fakeFetch);
    const { apiFetch } = await import('../src/api');

    await apiFetch('/sessions/launch', { method: 'POST' });
    await apiFetch('/tool-mapping', { method: 'PUT' });

    const tokenCalls = calls.filter((c) => c.url === '/session-token');
    expect(tokenCalls).toHaveLength(1); // cached after first fetch
    const launch = calls.find((c) => c.url === '/sessions/launch');
    expect(launch?.headers['x-aoa-token']).toBe('T123');
  });
});
