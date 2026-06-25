import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerModelRoutes } from '../src/model-routes.js';
import { invalidateModelConfigCache } from '../src/model-config.js';
import { DEFAULT_MODEL_CONFIG } from '@agent-citadel/shared';

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-modelroutes-')), 'model-config.json');
}

beforeEach(() => invalidateModelConfigCache());

const CFG = {
  sprites: [{ match: { kind: 'pattern', pattern: 'opus' }, sprite: 'opus' }],
  windows: [{ match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 500_000 }],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 },
};

describe('registerModelRoutes - persist=true', () => {
  it('PUT saves file, GET returns saved config', async () => {
    const path = tmpPath();
    const app = Fastify();
    registerModelRoutes(app, { persist: true, modelConfigPath: path });

    const put = await app.inject({ method: 'PUT', url: '/model-config', payload: CFG });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual(CFG);
    expect(existsSync(path)).toBe(true);

    const get = await app.inject({ method: 'GET', url: '/model-config' });
    expect(JSON.parse(get.body)).toEqual(CFG);
    await app.close();
  });

  it('PUT invalid config -> 400', async () => {
    const path = tmpPath();
    const app = Fastify();
    registerModelRoutes(app, { persist: true, modelConfigPath: path });
    const put = await app.inject({ method: 'PUT', url: '/model-config', payload: { sprites: [], windows: [], fallback: { sprite: 'nope', contextWindow: 1 } } });
    expect(put.statusCode).toBe(400);
    expect(JSON.parse(put.body).error).toBeTruthy();
    expect(existsSync(path)).toBe(false);
    await app.close();
  });
});

describe('registerModelRoutes - persist=false (demo)', () => {
  it('PUT validates + echoes, does not save; GET returns DEFAULT', async () => {
    const path = tmpPath();
    const app = Fastify();
    registerModelRoutes(app, { persist: false, modelConfigPath: path });

    const put = await app.inject({ method: 'PUT', url: '/model-config', payload: CFG });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual(CFG);
    expect(existsSync(path)).toBe(false);

    const get = await app.inject({ method: 'GET', url: '/model-config' });
    expect(JSON.parse(get.body)).toEqual(DEFAULT_MODEL_CONFIG);
    await app.close();
  });
});
