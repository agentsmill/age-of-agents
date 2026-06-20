import { describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLiveAtStartup } from '../src/watcher.js';
import { DEFAULT_THRESHOLDS } from '../src/state-machine.js';
import { SourceWatcher } from '../src/watcher.js';
import { World } from '../src/world.js';
import type { AgentSource } from '../src/sources/types.js';
import type { Fact } from '../src/transcript/facts.js';

const stubSource: AgentSource = {
  id: 'claude',
  roots: () => [],
  classify: () => ({ kind: 'other' }),
  parseLine: () => [],
};

const chokidarWatchSpy = vi.hoisted(() => vi.fn<typeof import('chokidar').watch>());

vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>();
  chokidarWatchSpy.mockImplementation(actual.watch);
  return { ...actual, watch: chokidarWatchSpy };
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(check()).toBe(true);
}

describe('isLiveAtStartup - session detection window at startup', () => {
  const now = Date.parse('2026-06-14T12:00:00.000Z');
  // Startup window = removeAfterMs: create a hero only for a session that would not
  // be immediately removed by the state machine anyway (no flicker).
  const W = DEFAULT_THRESHOLDS.removeAfterMs;

  it('session quiet for 20 min is live at startup (regression: old 10-min window lost it)', () => {
    expect(isLiveAtStartup(now - 20 * 60_000, now, W)).toBe(true);
  });

  it('session quiet for 40 min (outside removeAfterMs) is not live at startup', () => {
    expect(isLiveAtStartup(now - 40 * 60_000, now, W)).toBe(false);
  });

  it('freshly written session (1 min) is live', () => {
    expect(isLiveAtStartup(now - 60_000, now, W)).toBe(true);
  });
});

describe('SourceWatcher - subagents from source metadata', () => {
  it('does not create a chokidar watcher when a source has no roots', async () => {
    chokidarWatchSpy.mockClear();
    const world = new World();
    const source: AgentSource = {
      id: 'koda',
      roots: () => [],
      classify: () => ({ kind: 'other' }),
      parseLine: () => [],
    };
    const watcher = new SourceWatcher(world, source, DEFAULT_THRESHOLDS);

    try {
      expect(() => watcher.start()).not.toThrow();
      await watcher.stop();
      expect(chokidarWatchSpy).not.toHaveBeenCalled();
      expect(world.snapshot()).toEqual({ heroes: [], peons: [], missions: [], transcripts: [], arsenals: [] });
    } finally {
      chokidarWatchSpy.mockClear();
    }
  });

  it('uses polling for transcript roots to avoid native watcher exhaustion', async () => {
    chokidarWatchSpy.mockClear();
    const fakeWatcher = {
      add: vi.fn(),
      close: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
    chokidarWatchSpy.mockReturnValueOnce(fakeWatcher as unknown as ReturnType<typeof import('chokidar').watch>);
    const source: AgentSource = {
      id: 'codex',
      roots: () => ['/virtual/codex/sessions/2026/06/20'],
      classify: () => ({ kind: 'other' }),
      parseLine: () => [],
    };
    const watcher = new SourceWatcher(new World(), source, DEFAULT_THRESHOLDS);

    try {
      watcher.start();
      expect(chokidarWatchSpy).toHaveBeenCalledWith(
        ['/virtual/codex/sessions/2026/06/20'],
        expect.objectContaining({ usePolling: true, interval: 1_000 }),
      );
    } finally {
      await watcher.stop();
      chokidarWatchSpy.mockClear();
    }
  });

  it('file classified as a session can be rerouted to a peon after subagent-meta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aoa-watcher-'));
    const world = new World();
    const source: AgentSource = {
      id: 'codex',
      roots: () => [dir],
      classify: (path) => path.endsWith('.jsonl')
        ? { kind: 'session', sessionId: 'child-session', projectDir: '' }
        : { kind: 'other' },
      parseLine: (line): Fact[] => JSON.parse(line) as Fact[],
    };
    const watcher = new SourceWatcher(world, source, DEFAULT_THRESHOLDS);
    try {
      watcher.start();
      await writeFile(
        join(dir, 'rollout-child-session.jsonl'),
        [
          JSON.stringify([{ kind: 'subagent-meta', agentId: 'child-session', parentSessionId: 'parent-session', description: 'Leibniz' }]),
          JSON.stringify([{ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'c1', ts: '2026-06-19T20:14:30.000Z' }]),
        ].join('\n') + '\n',
      );

      await waitFor(() => world.snapshot().peons.length === 1);
      expect(world.snapshot().heroes).toEqual([]);
      expect(world.snapshot().peons[0]).toMatchObject({
        agentId: 'child-session',
        parentSessionId: 'parent-session',
        description: 'Leibniz',
        state: 'working',
        currentTool: 'Bash',
      });
    } finally {
      await watcher.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('large existing Codex subagent files keep peon routing after tailing from the end', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aoa-watcher-large-'));
    const file = join(dir, 'rollout-child-session.jsonl');
    const world = new World();
    const source: AgentSource = {
      id: 'codex',
      roots: () => [dir],
      classify: (path) => path.endsWith('.jsonl')
        ? { kind: 'session', sessionId: 'child-session', projectDir: '' }
        : { kind: 'other' },
      parseLine: (line): Fact[] => JSON.parse(line) as Fact[],
    };
    const watcher = new SourceWatcher(world, source, {
      ...DEFAULT_THRESHOLDS,
      removeAfterMs: 60_000,
    });
    const now = Date.now();
    try {
      await writeFile(
        file,
        JSON.stringify([{ kind: 'subagent-meta', agentId: 'child-session', parentSessionId: 'parent-session', description: 'Leibniz' }]) +
          '\n' +
          'x'.repeat(2 * 1024 * 1024 + 1) +
          '\n',
      );

      await (watcher as unknown as {
        handleFile(path: string, stats: { mtimeMs: number; size: number }, initial: boolean): Promise<void>;
      }).handleFile(file, { mtimeMs: now, size: 2 * 1024 * 1024 + 200 }, true);

      await appendFile(
        file,
        JSON.stringify([{ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'c1', ts: '2026-06-19T20:14:30.000Z' }]) + '\n',
      );
      await (watcher as unknown as {
        handleFile(path: string, stats: { mtimeMs: number; size: number }, initial: boolean): Promise<void>;
      }).handleFile(file, { mtimeMs: now, size: 2 * 1024 * 1024 + 400 }, false);

      expect(world.snapshot().heroes).toEqual([]);
      expect(world.snapshot().peons[0]).toMatchObject({
        agentId: 'child-session',
        parentSessionId: 'parent-session',
        description: 'Leibniz',
        currentTool: 'Bash',
      });
    } finally {
      await watcher.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('SourceWatcher - root refresh', () => {
  it('adds new roots during sweep without removing old ones', () => {
    const dir1 = '/virtual/aoa-watcher-root-a';
    const dir2 = '/virtual/aoa-watcher-root-b';
    const world = new World();
    let roots = [dir1];
    const source: AgentSource = {
      id: 'codex',
      roots: () => roots,
      classify: (path) => path.endsWith('.jsonl')
        ? { kind: 'session', sessionId: 'new-session', projectDir: '' }
        : { kind: 'other' },
      parseLine: (line): Fact[] => JSON.parse(line) as Fact[],
    };
    const watcher = new SourceWatcher(world, source, DEFAULT_THRESHOLDS);
    const fakeWatcher = { add: vi.fn() };
    const internals = watcher as unknown as {
      watcher: typeof fakeWatcher;
      sweep(): void;
      rootFor(path: string): string | undefined;
    };
    internals.watcher = fakeWatcher;

    roots = [dir2];
    internals.sweep();

    expect(fakeWatcher.add).toHaveBeenCalledWith([dir2]);
    expect(internals.rootFor(join(dir1, 'rollout-old-session.jsonl'))).toBe(dir1);
    expect(internals.rootFor(join(dir2, 'rollout-new-session.jsonl'))).toBe(dir2);
  });
});

describe('applyExternalFacts - /clear strike routing', () => {
  it('routes cleared to the existing hero in the same cwd, not the new session', () => {
    const world = new World();
    const watcher = new SourceWatcher(world, stubSource);
    const cwd = '/home/lachlan/age-of-agents';

    watcher.applyExternalFacts('old-session', 'age-of-agents', [{ kind: 'meta', cwd }]);
    watcher.applyExternalFacts(
      'new-session',
      'age-of-agents',
      [
        { kind: 'meta', cwd },
        { kind: 'cleared', ts: new Date().toISOString() },
      ],
      cwd,
    );

    expect(world.getHero('old-session')?.clearedAt).toBeTypeOf('number');
    expect(world.getHero('new-session')?.clearedAt).toBeUndefined();
  });

  it('routes cleared to the new session when no matching cwd is provided', () => {
    const world = new World();
    const watcher = new SourceWatcher(world, stubSource);

    watcher.applyExternalFacts('solo-session', 'age-of-agents', [
      { kind: 'meta', cwd: '/home/lachlan/age-of-agents' },
      { kind: 'cleared', ts: new Date().toISOString() },
    ]);

    expect(world.getHero('solo-session')?.clearedAt).toBeTypeOf('number');
  });
});
