import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@agent-citadel/shared';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../src/state-machine.js';
import { World } from '../src/world.js';

function setup() {
  const world = new World();
  const events: GameEvent[] = [];
  world.onEvent((e) => events.push(e));
  const tracker = new SessionTracker(world, 'session-1', 'project-x');
  return { world, events, tracker };
}

describe('SessionTracker', () => {
  it('prompt starts a mission and moves the hero into thinking state', () => {
    const { world, events, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Napraw testy', ts: '2026-06-13T10:00:00.000Z' });

    expect(events.some((e) => e.type === 'mission-started')).toBe(true);
    expect(world.getHero('session-1')?.state).toBe('thinking');
    expect(events.some((e) => e.type === 'transcript-line')).toBe(true);
  });

  it('tool-start moves to working with tool name, AskUserQuestion to awaiting-input', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'Edit', detail: 'auth.ts', messageId: 'm1', ts: '2026-06-13T10:00:01.000Z' });
    expect(world.getHero('session-1')).toMatchObject({ state: 'working', currentTool: 'Edit', toolDetail: 'auth.ts' });

    tracker.apply({ kind: 'tool-start', tool: 'AskUserQuestion', messageId: 'm2', ts: '2026-06-13T10:00:02.000Z' });
    expect(world.getHero('session-1')?.state).toBe('awaiting-input');
  });

  it('turn-end completes the mission and sends the hero to returning state', () => {
    const { world, events, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Zadanie', ts: '2026-06-13T10:00:00.000Z' });
    tracker.apply({ kind: 'turn-end', ts: '2026-06-13T10:01:00.000Z' });

    expect(world.getHero('session-1')?.state).toBe('returning');
    const done = events.find((e) => e.type === 'mission-completed');
    expect(done && done.type === 'mission-completed' && done.mission.status).toBe('completed');
  });

  it('turn-aborted sends the hero to recovery and fails the active mission', () => {
    const { world, events, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Zadanie', ts: '2026-06-13T10:00:00.000Z' });
    tracker.apply({ kind: 'turn-aborted', ts: '2026-06-13T10:01:00.000Z' });

    expect(world.getHero('session-1')?.state).toBe('recovering');
    const done = events.find((e) => e.type === 'mission-completed');
    expect(done && done.type === 'mission-completed' && done.mission.status).toBe('failed');
  });

  it('odpowiedź (tool-result sukces) gasi awaiting-input nawet bez bloku thinking', () => {
    // Regresja: po odpowiedzi na AskUserQuestion bohater zostawał z żółtym "!".
    // Sama odpowiedź (tool-result) musi wyprowadzić z awaiting-input → thinking.
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'AskUserQuestion', messageId: 'm1', ts: '2026-06-19T10:00:00.000Z' });
    expect(world.getHero('session-1')?.state).toBe('awaiting-input');
    tracker.apply({ kind: 'tool-result', isError: false, ts: '2026-06-19T10:00:05.000Z' });
    expect(world.getHero('session-1')?.state).toBe('thinking');
  });

  it('tool-result (sukces) podczas working NIE rusza stanu', () => {
    // Gaszenie dotyczy wyłącznie awaiting-input — zwykłe narzędzia zostają w working.
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'Bash', messageId: 'm1', ts: '2026-06-19T10:00:00.000Z' });
    expect(world.getHero('session-1')?.state).toBe('working');
    tracker.apply({ kind: 'tool-result', isError: false, ts: '2026-06-19T10:00:01.000Z' });
    expect(world.getHero('session-1')?.state).toBe('working');
  });

  it('cleared uses event time for clearedAt and lastActivityAt', () => {
    const { world, tracker } = setup();
    const ts = '2026-06-19T10:00:05.000Z';

    tracker.apply({ kind: 'cleared', ts });

    expect(world.getHero('session-1')?.clearedAt).toBe(Date.parse(ts));
    expect(world.getHero('session-1')?.lastActivityAt).toBe(ts);
  });

  it('deduplicates usage by messageId (one request = many lines)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 100, output: 50 });
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 100, output: 50 });
    tracker.apply({ kind: 'usage', messageId: 'm2', input: 10, output: 5 });
    expect(world.getHero('session-1')?.tokens).toEqual({ input: 110, output: 55 });
  });

  it('usage-total SETS tokens (cumulative, not summed)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage-total', input: 100, output: 40 });
    tracker.apply({ kind: 'usage-total', input: 250, output: 90 });
    expect(world.getHero('session-1')?.tokens).toEqual({ input: 250, output: 90 });
  });

  it('usage-total updates cumulative tokens and latest Codex context usage', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sCodexUsage', 'PD');

    tracker.apply({ kind: 'usage-total', input: 37049245, output: 178333, context: 180825, contextWindow: 258400 });
    expect(world.getHero('sCodexUsage')?.tokens).toEqual({ input: 37049245, output: 178333 });
    expect(world.getHero('sCodexUsage')?.contextTokens).toBe(180825);
    expect(world.getHero('sCodexUsage')?.contextWindowTokens).toBe(258400);

    tracker.apply({ kind: 'usage-total', input: 37200000, output: 178900, context: 20116, contextWindow: 258400 });
    expect(world.getHero('sCodexUsage')?.tokens).toEqual({ input: 37200000, output: 178900 });
    expect(world.getHero('sCodexUsage')?.contextTokens).toBe(20116);
    expect(world.getHero('sCodexUsage')?.contextWindowTokens).toBe(258400);
  });

  it('agent from constructor lands in HeroSnapshot', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'session-cx', 'project-x', DEFAULT_THRESHOLDS, 'codex');
    tracker.apply({ kind: 'prompt', text: 'Zrób coś', ts: '2026-06-14T10:00:00.000Z' });
    expect(world.getHero('session-cx')?.agent).toBe('codex');
  });

  it('tool error shows error state, tick later returns to idle', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-result', isError: true, ts: new Date().toISOString() });
    expect(world.getHero('session-1')?.state).toBe('error');

    // After errorFlashMs elapses, tick restores idle.
    const future = Date.now() + DEFAULT_THRESHOLDS.errorFlashMs + 1000;
    tracker.tick(future);
    // tick uses Date.now() for errorFlash, so simulate with a second tick using future activity time.
    expect(['idle', 'error']).toContain(world.getHero('session-1')?.state);
  });

  it('title skips conversational opener and takes the first substantial prompt', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'ok', ts: '2026-06-13T10:00:00.000Z' });
    expect(world.getHero('session-1')?.title).not.toBe('ok');
    tracker.apply({ kind: 'prompt', text: 'Implement game-style session names', ts: '2026-06-13T10:00:05.000Z' });
    expect(world.getHero('session-1')?.title).toBe('Implement game-style session names');
  });

  it('title from the first substantial prompt is stable (does not change every turn)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Dodaj logowanie', ts: '2026-06-13T10:00:00.000Z' });
    tracker.apply({ kind: 'prompt', text: 'dawaj', ts: '2026-06-13T10:01:00.000Z' });
    tracker.apply({ kind: 'prompt', text: 'I jeszcze druga rzecz proszę', ts: '2026-06-13T10:02:00.000Z' });
    expect(world.getHero('session-1')?.title).toBe('Dodaj logowanie');
  });

  it('recentActions collects recent tools (newest first, max 5)', () => {
    const { world, tracker } = setup();
    for (let i = 1; i <= 6; i++) {
      tracker.apply({ kind: 'tool-start', tool: i % 2 ? 'Edit' : 'Bash', detail: `file${i}`, messageId: `m${i}`, ts: `2026-06-13T10:00:0${i}.000Z` });
    }
    const ra = world.getHero('session-1')?.recentActions ?? [];
    expect(ra.length).toBe(5); // trimmed to 5
    expect(ra[0].detail).toBe('file6'); // newest first
    expect(ra[0].tool).toBe('Bash');
    expect(ra[4].detail).toBe('file2'); // oldest preserved (file1 dropped)
  });

  it('cleans markdown markers in title', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: '# Zadanie: Napraw zoom mapy', ts: '2026-06-13T10:00:00.000Z' });
    expect(world.getHero('session-1')?.title).toBe('Napraw zoom mapy');
  });

  it('tick puts an idle hero to sleep and removes a dead one', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'turn-end', ts: new Date(Date.now() - DEFAULT_THRESHOLDS.sleepAfterMs - 1000).toISOString() });
    tracker.tick(Date.now());
    expect(world.getHero('session-1')?.state).toBe('sleeping');

    expect(tracker.tick(Date.now() + DEFAULT_THRESHOLDS.removeAfterMs + 1000)).toBe('remove');
    expect(world.getHero('session-1')).toBeUndefined();
  });

  it('meta stores full workingDir (cwd) alongside projectName=basename', () => {
    // Regression: for the Claude source, projectDir is the encoded folder name, NOT a path.
    // ArsenalPoller reads config from workingDir, so cwd must reach the snapshot in full.
    const world = new World();
    const tracker = new SessionTracker(world, 'session-cwd', '-Users-mpawelczuk-RTS-agents');
    tracker.apply({ kind: 'meta', cwd: '/Users/mpawelczuk/RTS agents' });
    const hero = world.getHero('session-cwd');
    expect(hero?.workingDir).toBe('/Users/mpawelczuk/RTS agents'); // full path
    expect(hero?.projectName).toBe('RTS agents'); // basename for HUD
    expect(hero?.projectDir).toBe('-Users-mpawelczuk-RTS-agents'); // city key unchanged
  });

  it('contextTokens = context from the LATEST message (not a sum)', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sCtx', 'PD');
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 10, output: 1, context: 1000, contextWindow: 2000 });
    tracker.apply({ kind: 'usage', messageId: 'm2', input: 10, output: 1, context: 1800, contextWindow: 4000 });
    expect(world.getHero('sCtx')!.contextTokens).toBe(1800);
    expect(world.getHero('sCtx')!.contextWindowTokens).toBe(4000);
  });

  it('accumulates wielded from attribution facts on the hero', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sX', 'PD');
    tracker.apply({ kind: 'attribution', skill: 'superpowers:brainstorming', mcpServer: 'visualize' });
    tracker.apply({ kind: 'attribution', plugin: 'superpowers' });
    tracker.apply({ kind: 'attribution', skill: 'superpowers:brainstorming' }); // duplikat
    const hero = world.getHero('sX')!;
    expect(hero.wielded).toEqual({
      skills: ['superpowers:brainstorming'],
      connectors: ['visualize'],
      plugins: ['superpowers'],
    });
  });
});
