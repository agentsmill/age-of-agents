import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerFsRoutes } from '../src/fs-routes.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
async function build() { const a = Fastify(); registerFsRoutes(a); await a.ready(); return a; }
afterEach(async () => { await app?.close(); app = undefined; });

describe('GET /fs/list', () => {
  it('lists subdirectories only', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    mkdirSync(join(base, 'sub-a')); mkdirSync(join(base, 'sub-b')); writeFileSync(join(base, 'file.txt'), 'x');
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(base)}` });
    const body = res.json();
    expect(body.dir).toBe(base);
    expect(body.entries.map((e: { name: string }) => e.name).sort()).toEqual(['sub-a', 'sub-b']);
  });
  it('missing dir -> 400', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/fs/list?dir=/no/such/path/xyz' });
    expect(res.statusCode).toBe(400);
  });
});
