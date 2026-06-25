import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerFsRoutes } from '../src/fs-routes.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
async function build(allowedRoot: string) { const a = Fastify(); registerFsRoutes(a, { allowedRoot }); await a.ready(); return a; }
afterEach(async () => { await app?.close(); app = undefined; });

describe('GET /fs/list', () => {
  it('lists subdirectories only, within the allowed root', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    mkdirSync(join(base, 'sub-a')); mkdirSync(join(base, 'sub-b')); writeFileSync(join(base, 'file.txt'), 'x');
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(base)}` });
    const body = res.json();
    expect(body.dir).toBe(base);
    expect(body.entries.map((e: { name: string }) => e.name).sort()).toEqual(['sub-a', 'sub-b']);
  });
  it('missing dir within root -> 400', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(join(base, 'nope'))}` });
    expect(res.statusCode).toBe(400);
  });
  it('dir outside the allowed root -> 400', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    app = await build(base);
    const res = await app.inject({ method: 'GET', url: '/fs/list?dir=/etc' });
    expect(res.statusCode).toBe(400);
  });
});
