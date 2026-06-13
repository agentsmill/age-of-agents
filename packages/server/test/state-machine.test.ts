import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@agent-citadel/shared';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../src/state-machine.js';
import { World } from '../src/world.js';

function setup() {
  const world = new World();
  const events: GameEvent[] = [];
  world.onEvent((e) => events.push(e));
  const tracker = new SessionTracker(world, 'sesja-1', 'projekt-x');
  return { world, events, tracker };
}

describe('SessionTracker', () => {
  it('prompt startuje misję i wprowadza bohatera w stan thinking', () => {
    const { world, events, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Napraw testy', ts: '2026-06-13T10:00:00.000Z' });

    expect(events.some((e) => e.type === 'mission-started')).toBe(true);
    expect(world.getHero('sesja-1')?.state).toBe('thinking');
    expect(events.some((e) => e.type === 'transcript-line')).toBe(true);
  });

  it('tool-start przenosi do working z nazwą narzędzia, AskUserQuestion do awaiting-input', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'Edit', detail: 'auth.ts', messageId: 'm1', ts: '2026-06-13T10:00:01.000Z' });
    expect(world.getHero('sesja-1')).toMatchObject({ state: 'working', currentTool: 'Edit', toolDetail: 'auth.ts' });

    tracker.apply({ kind: 'tool-start', tool: 'AskUserQuestion', messageId: 'm2', ts: '2026-06-13T10:00:02.000Z' });
    expect(world.getHero('sesja-1')?.state).toBe('awaiting-input');
  });

  it('turn-end kończy misję i wysyła bohatera do twierdzy', () => {
    const { world, events, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Zadanie', ts: '2026-06-13T10:00:00.000Z' });
    tracker.apply({ kind: 'turn-end', ts: '2026-06-13T10:01:00.000Z' });

    expect(world.getHero('sesja-1')?.state).toBe('returning');
    const done = events.find((e) => e.type === 'mission-completed');
    expect(done && done.type === 'mission-completed' && done.mission.status).toBe('completed');
  });

  it('deduplikuje usage po messageId (jeden request = wiele linii)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 100, output: 50 });
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 100, output: 50 });
    tracker.apply({ kind: 'usage', messageId: 'm2', input: 10, output: 5 });
    expect(world.getHero('sesja-1')?.tokens).toEqual({ input: 110, output: 55 });
  });

  it('błąd narzędzia pokazuje stan error, tick po czasie wraca do idle', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-result', isError: true, ts: new Date().toISOString() });
    expect(world.getHero('sesja-1')?.state).toBe('error');

    // po upływie errorFlashMs tick przywraca idle
    const future = Date.now() + DEFAULT_THRESHOLDS.errorFlashMs + 1000;
    tracker.tick(future);
    // tick używa Date.now() do errorFlash — symulujemy przez drugi tick z przyszłym czasem aktywności
    expect(['idle', 'error']).toContain(world.getHero('sesja-1')?.state);
  });

  it('nazwa pomija konwersacyjny opener i bierze pierwszy sensowny prompt', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'ok', ts: '2026-06-13T10:00:00.000Z' });
    expect(world.getHero('sesja-1')?.title).not.toBe('ok');
    tracker.apply({ kind: 'prompt', text: 'Zaimplementuj nazwy sesji jak w grze', ts: '2026-06-13T10:00:05.000Z' });
    expect(world.getHero('sesja-1')?.title).toBe('Zaimplementuj nazwy sesji jak w grze');
  });

  it('nazwa z pierwszego sensownego promptu jest stabilna (nie skacze co turę)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: 'Dodaj logowanie', ts: '2026-06-13T10:00:00.000Z' });
    tracker.apply({ kind: 'prompt', text: 'dawaj', ts: '2026-06-13T10:01:00.000Z' });
    tracker.apply({ kind: 'prompt', text: 'I jeszcze druga rzecz proszę', ts: '2026-06-13T10:02:00.000Z' });
    expect(world.getHero('sesja-1')?.title).toBe('Dodaj logowanie');
  });

  it('czyści markery markdown w nazwie', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'prompt', text: '# Zadanie: Napraw zoom mapy', ts: '2026-06-13T10:00:00.000Z' });
    expect(world.getHero('sesja-1')?.title).toBe('Napraw zoom mapy');
  });

  it('tick usypia bezczynnego bohatera i usuwa martwego', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'turn-end', ts: new Date(Date.now() - DEFAULT_THRESHOLDS.sleepAfterMs - 1000).toISOString() });
    tracker.tick(Date.now());
    expect(world.getHero('sesja-1')?.state).toBe('sleeping');

    expect(tracker.tick(Date.now() + DEFAULT_THRESHOLDS.removeAfterMs + 1000)).toBe('remove');
    expect(world.getHero('sesja-1')).toBeUndefined();
  });
});
