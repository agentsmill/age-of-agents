import { describe, it, expect, afterEach, vi } from 'vitest';
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
  it('serves /health in demo mode and returns a real port', async () => {
    running = await startServer({ port: 0, demo: true });
    expect(running.port).toBeGreaterThan(0);
    const res = await fetch(`http://localhost:${running.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, demo: true });
  });

  it('serves client index.html from webRoot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aoa-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AIOA-TEST</title>');
    running = await startServer({ port: 0, demo: true, webRoot: dir });

    const root = await fetch(`http://localhost:${running.port}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('AIOA-TEST');

    // SPA fallback: unknown routes also return index.html.
    const spa = await fetch(`http://localhost:${running.port}/jakas/trasa`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('AIOA-TEST');
  });

  it('GET /tool-mapping returns valid config', async () => {
    running = await startServer({ port: 0, demo: true });
    const res = await fetch(`http://localhost:${running.port}/tool-mapping`);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.fallback).toBe('citadel');
    expect(Array.isArray(cfg.rules)).toBe(true);
    expect(cfg.rules.length).toBeGreaterThan(0);
  });

  it('PUT /tool-mapping rejects invalid config (400)', async () => {
    running = await startServer({ port: 0, demo: true });
    const res = await fetch(`http://localhost:${running.port}/tool-mapping`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: [], fallback: 'nieistniejacy' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it('PUT /tool-mapping accepts valid config (200, echo)', async () => {
    running = await startServer({ port: 0, demo: true });
    const cfg = { rules: [{ kind: 'exact', tool: 'Edit', building: 'library' }], fallback: 'citadel' };
    const res = await fetch(`http://localhost:${running.port}/tool-mapping`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(cfg);
  });

  it('starts in real mode with only Codex source enabled', async () => {
    const prev = process.env.AOA_SOURCES;
    process.env.AOA_SOURCES = 'codex';
    try {
      running = await startServer({ port: 0, demo: false });
      const res = await fetch(`${running.url}/health`);
      expect(await res.json()).toEqual({ ok: true, demo: false });
    } finally {
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
    }
  });

  it('stops OpenCode poller on close when OpenCode source is enabled', async () => {
    const prev = process.env.AOA_SOURCES;
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    let localRunning: RunningServer | undefined;

    vi.resetModules();
    vi.doMock('../src/sources/opencode-poller.js', () => ({
      OpenCodePoller: vi.fn().mockImplementation(() => ({ start, stop })),
    }));

    process.env.AOA_SOURCES = 'opencode';
    try {
      const { startServer: startServerWithMock } = await import('../src/server.js');
      localRunning = await startServerWithMock({ port: 0, demo: false });
      await localRunning.close();
      localRunning = undefined;

      expect(start).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      await localRunning?.close();
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
      vi.doUnmock('../src/sources/opencode-poller.js');
      vi.resetModules();
    }
  });

  it('starts and stops Docker poller when Claude source is enabled', async () => {
    const prev = process.env.AOA_SOURCES;
    const watcherStart = vi.fn();
    const watcherStop = vi.fn().mockResolvedValue(undefined);
    const dockerStart = vi.fn().mockResolvedValue(undefined);
    const dockerStop = vi.fn();
    let localRunning: RunningServer | undefined;

    vi.resetModules();
    vi.doMock('../src/watcher.js', () => ({
      SourceWatcher: vi.fn().mockImplementation((_world, source) => ({
        id: source.id,
        start: watcherStart,
        stop: watcherStop,
        applyExternalFacts: vi.fn(),
      })),
    }));
    vi.doMock('../src/sources/docker-poller.js', () => ({
      DockerPoller: vi.fn().mockImplementation(() => ({ start: dockerStart, stop: dockerStop })),
    }));
    vi.doMock('../src/sources/docker-client.js', () => ({
      CliDockerClient: vi.fn(),
    }));
    vi.doMock('../src/arsenal/arsenal-poller.js', () => ({
      ArsenalPoller: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
      })),
    }));

    process.env.AOA_SOURCES = 'claude';
    try {
      const { startServer: startServerWithMock } = await import('../src/server.js');
      localRunning = await startServerWithMock({ port: 0, demo: false });
      await localRunning.close();
      localRunning = undefined;

      expect(dockerStart).toHaveBeenCalledTimes(1);
      expect(dockerStop).toHaveBeenCalledTimes(1);
    } finally {
      await localRunning?.close();
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
      vi.doUnmock('../src/watcher.js');
      vi.doUnmock('../src/sources/docker-poller.js');
      vi.doUnmock('../src/sources/docker-client.js');
      vi.doUnmock('../src/arsenal/arsenal-poller.js');
      vi.resetModules();
    }
  });

  it('does not start Docker poller when Claude source is disabled', async () => {
    const prev = process.env.AOA_SOURCES;
    const DockerPoller = vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    }));
    let localRunning: RunningServer | undefined;

    vi.resetModules();
    vi.doMock('../src/watcher.js', () => ({
      SourceWatcher: vi.fn().mockImplementation((_world, source) => ({
        id: source.id,
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        applyExternalFacts: vi.fn(),
      })),
    }));
    vi.doMock('../src/sources/docker-poller.js', () => ({ DockerPoller }));
    vi.doMock('../src/sources/docker-client.js', () => ({
      CliDockerClient: vi.fn(),
    }));
    vi.doMock('../src/arsenal/arsenal-poller.js', () => ({
      ArsenalPoller: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
      })),
    }));

    process.env.AOA_SOURCES = 'codex';
    try {
      const { startServer: startServerWithMock } = await import('../src/server.js');
      localRunning = await startServerWithMock({ port: 0, demo: false });
      await localRunning.close();
      localRunning = undefined;

      expect(DockerPoller).not.toHaveBeenCalled();
    } finally {
      await localRunning?.close();
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
      vi.doUnmock('../src/watcher.js');
      vi.doUnmock('../src/sources/docker-poller.js');
      vi.doUnmock('../src/sources/docker-client.js');
      vi.doUnmock('../src/arsenal/arsenal-poller.js');
      vi.resetModules();
    }
  });

  it('stops real-mode watchers and arsenal poller on close', async () => {
    const prev = process.env.AOA_SOURCES;
    const watcherStart = vi.fn();
    const watcherStop = vi.fn().mockResolvedValue(undefined);
    const arsenalStart = vi.fn();
    const arsenalStop = vi.fn();
    let localRunning: RunningServer | undefined;

    vi.resetModules();
    vi.doMock('../src/watcher.js', () => ({
      SourceWatcher: vi.fn().mockImplementation((_world, source) => ({
        id: source.id,
        start: watcherStart,
        stop: watcherStop,
        applyExternalFacts: vi.fn(),
      })),
    }));
    vi.doMock('../src/arsenal/arsenal-poller.js', () => ({
      ArsenalPoller: vi.fn().mockImplementation(() => ({
        start: arsenalStart,
        stop: arsenalStop,
      })),
    }));

    process.env.AOA_SOURCES = 'codex';
    try {
      const { startServer: startServerWithMock } = await import('../src/server.js');
      localRunning = await startServerWithMock({ port: 0, demo: false });
      await localRunning.close();
      localRunning = undefined;

      expect(watcherStart).toHaveBeenCalledTimes(1);
      expect(watcherStop).toHaveBeenCalledTimes(1);
      expect(arsenalStart).toHaveBeenCalledTimes(1);
      expect(arsenalStop).toHaveBeenCalledTimes(1);
    } finally {
      await localRunning?.close();
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
      vi.doUnmock('../src/watcher.js');
      vi.doUnmock('../src/arsenal/arsenal-poller.js');
      vi.resetModules();
    }
  });

  it('does not route Claude hook facts to another source when Claude is disabled', async () => {
    const prev = process.env.AOA_SOURCES;
    const applyExternalFacts = vi.fn();
    let localRunning: RunningServer | undefined;

    vi.resetModules();
    vi.doMock('../src/watcher.js', () => ({
      SourceWatcher: vi.fn().mockImplementation((_world, source) => ({
        id: source.id,
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        applyExternalFacts,
      })),
    }));
    vi.doMock('../src/arsenal/arsenal-poller.js', () => ({
      ArsenalPoller: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
      })),
    }));

    process.env.AOA_SOURCES = 'codex';
    try {
      const { startServer: startServerWithMock } = await import('../src/server.js');
      localRunning = await startServerWithMock({ port: 0, demo: false });
      const res = await fetch(`${localRunning.url}/hooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: 'session-1',
          cwd: '/tmp/project',
          hook_event_name: 'UserPromptSubmit',
          prompt: 'hello',
        }),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: 'claude source disabled' });
      expect(applyExternalFacts).not.toHaveBeenCalled();
    } finally {
      await localRunning?.close();
      if (prev === undefined) delete process.env.AOA_SOURCES;
      else process.env.AOA_SOURCES = prev;
      vi.doUnmock('../src/watcher.js');
      vi.doUnmock('../src/arsenal/arsenal-poller.js');
      vi.resetModules();
    }
  });
});
