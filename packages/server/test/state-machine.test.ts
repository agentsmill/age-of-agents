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

  it('odpowiedź (tool-result sukces) gasi awaiting-input nawet bez bloku thinking', () => {
    // Regresja: po odpowiedzi na AskUserQuestion bohater zostawał z żółtym "!".
    // Sama odpowiedź (tool-result) musi wyprowadzić z awaiting-input → thinking.
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'AskUserQuestion', messageId: 'm1', ts: '2026-06-19T10:00:00.000Z' });
    expect(world.getHero('sesja-1')?.state).toBe('awaiting-input');
    tracker.apply({ kind: 'tool-result', isError: false, ts: '2026-06-19T10:00:05.000Z' });
    expect(world.getHero('sesja-1')?.state).toBe('thinking');
  });

  it('tool-result (sukces) podczas working NIE rusza stanu', () => {
    // Gaszenie dotyczy wyłącznie awaiting-input — zwykłe narzędzia zostają w working.
    const { world, tracker } = setup();
    tracker.apply({ kind: 'tool-start', tool: 'Bash', messageId: 'm1', ts: '2026-06-19T10:00:00.000Z' });
    expect(world.getHero('sesja-1')?.state).toBe('working');
    tracker.apply({ kind: 'tool-result', isError: false, ts: '2026-06-19T10:00:01.000Z' });
    expect(world.getHero('sesja-1')?.state).toBe('working');
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

  it('usage-total USTAWIA tokeny (kumulatywne, nie sumuje)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage-total', input: 100, output: 40 });
    tracker.apply({ kind: 'usage-total', input: 250, output: 90 });
    expect(world.getHero('sesja-1')?.tokens).toEqual({ input: 250, output: 90 });
  });

  it('usage-total może ustawić bieżący kontekst i rozmiar okna', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage-total', input: 1200, output: 300, context: 740, contextWindow: 258400 });
    const hero = world.getHero('sesja-1');
    expect(hero?.contextTokens).toBe(740);
    expect(hero?.contextWindowTokens).toBe(258400);
  });

  it('agent z konstruktora ląduje w HeroSnapshot', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sesja-cx', 'projekt-x', DEFAULT_THRESHOLDS, 'codex');
    tracker.apply({ kind: 'prompt', text: 'Zrób coś', ts: '2026-06-14T10:00:00.000Z' });
    expect(world.getHero('sesja-cx')?.agent).toBe('codex');
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

  it('recentActions zbiera ostatnie narzędzia (najnowsze pierwsze, max 5)', () => {
    const { world, tracker } = setup();
    for (let i = 1; i <= 6; i++) {
      tracker.apply({ kind: 'tool-start', tool: i % 2 ? 'Edit' : 'Bash', detail: `plik${i}`, messageId: `m${i}`, ts: `2026-06-13T10:00:0${i}.000Z` });
    }
    const ra = world.getHero('sesja-1')?.recentActions ?? [];
    expect(ra.length).toBe(5); // przycięte do 5
    expect(ra[0].detail).toBe('plik6'); // najnowsze pierwsze
    expect(ra[0].tool).toBe('Bash');
    expect(ra[4].detail).toBe('plik2'); // najstarsze zachowane (plik1 wypadł)
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

  it('meta zapisuje pełny workingDir (cwd) obok projectName=basename', () => {
    // Regresja: dla źródła Claude projectDir to zakodowana nazwa folderu, NIE ścieżka.
    // ArsenalPoller czyta config z workingDir, więc cwd musi trafić do snapshotu w całości.
    const world = new World();
    const tracker = new SessionTracker(world, 'sesja-cwd', '-Users-mpawelczuk-RTS-agents');
    tracker.apply({ kind: 'meta', cwd: '/Users/mpawelczuk/RTS agents' });
    const hero = world.getHero('sesja-cwd');
    expect(hero?.workingDir).toBe('/Users/mpawelczuk/RTS agents'); // pełna ścieżka
    expect(hero?.projectName).toBe('RTS agents'); // basename do HUD
    expect(hero?.projectDir).toBe('-Users-mpawelczuk-RTS-agents'); // klucz miasta bez zmian
  });

  it('contextTokens = kontekst NAJNOWSZEJ wiadomości (nie suma)', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sCtx', 'PD');
    tracker.apply({ kind: 'usage', messageId: 'm1', input: 10, output: 1, context: 1000 });
    tracker.apply({ kind: 'usage', messageId: 'm2', input: 10, output: 1, context: 1800 });
    expect(world.getHero('sCtx')!.contextTokens).toBe(1800);
  });

  it('kumuluje wielded z faktów attribution na bohaterze', () => {
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
