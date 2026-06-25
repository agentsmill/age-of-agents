import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMappingRoutes } from '../src/mapping-routes.js';
import { invalidateMappingCache } from '../src/mapping-config.js';
import { DEFAULT_MAPPING } from '@agent-citadel/shared';

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-routes-')), 'tool-mapping.json');
}

beforeEach(() => invalidateMappingCache());

const CFG = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };

describe('registerMappingRoutes - persist=true (real server)', () => {
  it('PUT saves file, GET returns saved config, onSaved called', async () => {
    const path = tmpPath();
    let saved = 0;
    const app = Fastify();
    registerMappingRoutes(app, { persist: true, mappingPath: path, onSaved: () => saved++ });

    const put = await app.inject({ method: 'PUT', url: '/tool-mapping', payload: CFG });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual(CFG);
    expect(saved).toBe(1);
    expect(existsSync(path)).toBe(true);

    const get = await app.inject({ method: 'GET', url: '/tool-mapping' });
    expect(JSON.parse(get.body)).toEqual(CFG);
    await app.close();
  });

  it('PUT invalid config -> 400, no onSaved', async () => {
    const path = tmpPath();
    let saved = 0;
    const app = Fastify();
    registerMappingRoutes(app, { persist: true, mappingPath: path, onSaved: () => saved++ });

    const put = await app.inject({ method: 'PUT', url: '/tool-mapping', payload: { rules: [], fallback: 'nope' } });
    expect(put.statusCode).toBe(400);
    expect(JSON.parse(put.body).error).toBeTruthy();
    expect(saved).toBe(0);
    expect(existsSync(path)).toBe(false);
    await app.close();
  });
});

describe('registerMappingRoutes - persist=false (demo)', () => {
  it('PUT validates + echoes, does NOT save; GET returns DEFAULT', async () => {
    const path = tmpPath();
    const app = Fastify();
    registerMappingRoutes(app, { persist: false, mappingPath: path });

    const put = await app.inject({ method: 'PUT', url: '/tool-mapping', payload: CFG });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toEqual(CFG);
    expect(existsSync(path)).toBe(false); // demo does not touch disk

    const get = await app.inject({ method: 'GET', url: '/tool-mapping' });
    expect(JSON.parse(get.body)).toEqual(DEFAULT_MAPPING);
    await app.close();
  });
});
