import { describe, expect, it, vi } from 'vitest';
import type { HeroSnapshot, ProjectArsenal } from '@agent-citadel/shared';
import { World } from '../src/world.js';

function arsenal(projectDir: string): ProjectArsenal {
  return {
    projectDir, projectName: 'proj', activeSessions: 1,
    skills: [], connectors: [], hooks: [], agents: [], refreshedAt: 1,
  };
}

function hero(): HeroSnapshot {
  return {
    sessionId: 's1',
    title: 'Test',
    projectDir: '/x',
    teamColor: 0,
    state: 'working',
    tokens: { input: 0, output: 0 },
    startedAt: '2026-06-14T10:00:00.000Z',
    lastActivityAt: '2026-06-14T10:00:00.000Z',
  };
}

describe('World.emit - resilience to failing listeners', () => {
  it('throwing listener (for example broken socket.send) does not propagate error or block others', () => {
    const world = new World();
    const received: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First listener fails, mirroring a WS broadcast to a dead socket.
    world.onEvent(() => {
      throw new Error('boom');
    });
    // Second listener still must receive the event.
    world.onEvent((e) => {
      received.push(e.type);
    });

    // World mutation must not throw outward (otherwise it kills sweep/process).
    expect(() => world.upsertHero(hero())).not.toThrow();
    // Second listener still ran despite the first one's failure.
    expect(received).toContain('hero-spawned');
    // Error was reported, not silently swallowed.
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('stores recent transcript lines in snapshots', () => {
    const world = new World();
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 's1',
        role: 'user',
        text: 'Fix Codex support',
        ts: '2026-06-20T12:00:00.000Z',
      },
    });
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 's1',
        role: 'assistant',
        text: 'I will inspect the parser',
        ts: '2026-06-20T12:00:01.000Z',
      },
    });

    expect(world.snapshot().transcripts).toEqual([
      { sessionId: 's1', role: 'user', text: 'Fix Codex support', ts: '2026-06-20T12:00:00.000Z' },
      { sessionId: 's1', role: 'assistant', text: 'I will inspect the parser', ts: '2026-06-20T12:00:01.000Z' },
    ]);
  });

  it('isolates snapshot transcript arrays from external mutation', () => {
    const world = new World();
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 's1',
        role: 'user',
        text: 'Original',
        ts: '2026-06-20T12:00:00.000Z',
      },
    });

    world.snapshot().transcripts.push({
      sessionId: 's1',
      role: 'assistant',
      text: 'Injected',
      ts: '2026-06-20T12:00:01.000Z',
    });

    expect(world.snapshot().transcripts).toEqual([
      { sessionId: 's1', role: 'user', text: 'Original', ts: '2026-06-20T12:00:00.000Z' },
    ]);
  });

  it('retains recent transcript lines per session', () => {
    const world = new World();
    for (let i = 0; i < 201; i++) {
      world.emitTranscriptLine({
        type: 'transcript-line',
        line: {
          sessionId: 'noisy',
          role: 'assistant',
          text: `Noisy ${i}`,
          ts: `2026-06-20T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
        },
      });
    }
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 'quiet',
        role: 'user',
        text: 'Still here',
        ts: '2026-06-20T12:01:00.000Z',
      },
    });
    for (let i = 201; i < 401; i++) {
      world.emitTranscriptLine({
        type: 'transcript-line',
        line: {
          sessionId: 'noisy',
          role: 'assistant',
          text: `Noisy ${i}`,
          ts: `2026-06-20T12:01:${String(i % 60).padStart(2, '0')}.000Z`,
        },
      });
    }

    const transcripts = world.snapshot().transcripts;
    const noisyLines = transcripts.filter((line) => line.sessionId === 'noisy');

    expect(noisyLines).toHaveLength(200);
    expect(noisyLines[0]?.text).toBe('Noisy 201');
    expect(noisyLines.at(-1)?.text).toBe('Noisy 400');
    expect(transcripts).toContainEqual({
      sessionId: 'quiet',
      role: 'user',
      text: 'Still here',
      ts: '2026-06-20T12:01:00.000Z',
    });
  });
});

describe('World — arsenał jako stan świata (replay dla nowych klientów)', () => {
  it('setArsenal włącza arsenał do snapshotu i emituje arsenal-updated', () => {
    const world = new World();
    const received: string[] = [];
    world.onEvent((e) => received.push(e.type));

    const a = arsenal('PD');
    world.setArsenal(a);

    // Nowy klient czyta arsenał ze snapshotu — bez czekania na zmianę fingerprintu.
    expect(world.snapshot().arsenals).toContainEqual(a);
    // Podłączeni klienci nadal dostają emit na żywo.
    expect(received).toContain('arsenal-updated');
  });

  it('setArsenal nadpisuje arsenał tego samego projektu (klucz: projectDir)', () => {
    const world = new World();
    world.setArsenal(arsenal('PD'));
    world.setArsenal({ ...arsenal('PD'), activeSessions: 3 });

    const arsenals = world.snapshot().arsenals;
    expect(arsenals.filter((x) => x.projectDir === 'PD')).toHaveLength(1);
    expect(arsenals[0].activeSessions).toBe(3);
  });
});
