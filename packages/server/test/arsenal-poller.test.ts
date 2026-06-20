import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameEvent, HeroSnapshot } from '@agent-citadel/shared';
import { World } from '../src/world.js';
import { ArsenalPoller } from '../src/arsenal/arsenal-poller.js';

function hero(over: Partial<HeroSnapshot>): HeroSnapshot {
  return {
    sessionId: 's1', title: 't', projectDir: 'PD', workingDir: over.workingDir,
    teamColor: 0, state: 'idle', tokens: { input: 0, output: 0 },
    startedAt: '', lastActivityAt: '', ...over,
  } as HeroSnapshot;
}

describe('ArsenalPoller.refreshOnce', () => {
  it('emits arsenal-updated with effective arsenal; second unchanged run = no emission', async () => {
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
    await fs.mkdir(path.join(wd, '.claude'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ command: 'bd prime' }] }] },
    }));

    const world = new World();
    world.upsertHero(hero({ sessionId: 's1', projectDir: 'PD', workingDir: wd, projectName: 'proj' }));

    const events: GameEvent[] = [];
    world.onEvent((e) => { if (e.type === 'arsenal-updated') events.push(e); });

    const poller = new ArsenalPoller(world, os.tmpdir() /* homeDir override */);
    await poller.refreshOnce();
    await poller.refreshOnce();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('arsenal-updated');
    if (events[0].type === 'arsenal-updated') {
      expect(events[0].arsenal.projectDir).toBe('PD');
      expect(events[0].arsenal.hooks).toContainEqual({ event: 'SessionStart', command: 'bd prime', origin: 'project' });
    }
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('zapisuje arsenał w stanie świata (snapshot dla nowego klienta podłączonego po skanie)', async () => {
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-snap-'));
    await fs.mkdir(path.join(wd, '.claude'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ command: 'bd prime' }] }] },
    }));

    const world = new World();
    world.upsertHero(hero({ sessionId: 's1', projectDir: 'PD', workingDir: wd, projectName: 'proj' }));

    const poller = new ArsenalPoller(world, os.tmpdir());
    await poller.refreshOnce();

    // Klient, który podłączy się TERAZ (po skanie), dostaje arsenał ze snapshotu.
    const arsenals = world.snapshot().arsenals;
    expect(arsenals.map((a) => a.projectDir)).toContain('PD');

    await fs.rm(wd, { recursive: true, force: true });
  });
});
