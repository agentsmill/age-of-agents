import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, HeroSnapshot, MissionSnapshot, PeonSnapshot, TranscriptLine } from '@agent-citadel/shared';
import { SessionTracker } from '../src/state-machine.js';
import { DockerPoller } from '../src/sources/docker-poller.js';
import type { ContainerInfo, DockerClient, ExecResult } from '../src/sources/docker-client.js';
import type { World } from '../src/world.js';

class FakeWorld {
  private heroes = new Map<string, HeroSnapshot>();
  private missions = new Map<string, MissionSnapshot>();
  private transcripts = new Map<string, TranscriptLine[]>();
  private nextTeamColor = 0;

  claimTeamColor(): number {
    return this.nextTeamColor++;
  }

  upsertHero(hero: HeroSnapshot): void {
    this.heroes.set(hero.sessionId, hero);
  }

  getHero(sessionId: string): HeroSnapshot | undefined {
    return this.heroes.get(sessionId);
  }

  removeHero(sessionId: string): void {
    this.heroes.delete(sessionId);
  }

  snapshot() {
    return {
      heroes: [...this.heroes.values()],
      peons: [],
      missions: [...this.missions.values()],
      transcripts: [...this.transcripts.values()].flatMap((lines) => lines),
    };
  }

  startMission(mission: MissionSnapshot): void {
    this.missions.set(mission.id, mission);
  }

  completeMission(id: string, status: 'completed' | 'failed', completedAt: string): void {
    const mission = this.missions.get(id);
    if (!mission) return;
    this.missions.set(id, { ...mission, status, completedAt });
  }

  emitTranscriptLine(line: GameEvent & { type: 'transcript-line' }): void {
    const lines = this.transcripts.get(line.line.sessionId) ?? [];
    this.transcripts.set(line.line.sessionId, [...lines, line.line]);
  }

  upsertPeon(_peon: PeonSnapshot): void {}

  completePeon(_agentId: string): void {}
}

function makeWorld(): World {
  return new FakeWorld() as unknown as World;
}

describe('SessionTracker — extra (container)', () => {
  it('domieszuje pole container do bohatera i zachowuje je przy kolejnych patchach', () => {
    const world = makeWorld();
    const container = { id: 'abc123', name: 'devbox', image: 'node:20' };
    const tracker = new SessionTracker(world, 'docker:abc123:s1', 'docker://devbox', undefined, 'claude', { container });

    tracker.apply({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-20T10:00:00.000Z' });
    expect(world.getHero('docker:abc123:s1')?.container).toEqual(container);

    // Kolejny patch (np. zmiana stanu) nie gubi container.
    tracker.apply({ kind: 'meta', cwd: '/workspace/app', ts: '2026-06-20T10:00:01.000Z' });
    expect(world.getHero('docker:abc123:s1')?.container).toEqual(container);
    expect(world.getHero('docker:abc123:s1')?.workingDir).toBe('/workspace/app');
  });

  it('nie pozwala extra nadpisać pól zarządzanych przez tracker', () => {
    const world = makeWorld();
    const container = { id: 'abc123', name: 'devbox', image: 'node:20' };
    const tracker = new SessionTracker(
      world,
      'docker:abc123:s1',
      'docker://devbox',
      undefined,
      'claude',
      {
        container,
        sessionId: 'spoofed',
        state: 'error',
        tokens: { input: 999, output: 999 },
      } as unknown as { container: typeof container },
    );

    tracker.apply({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-20T10:00:00.000Z' });

    expect(world.getHero('docker:abc123:s1')).toMatchObject({
      sessionId: 'docker:abc123:s1',
      state: 'thinking',
      tokens: { input: 0, output: 0 },
      container,
    });
    expect(world.getHero('spoofed')).toBeUndefined();
  });
});

/**
 * Fake: kontenery + ich pliki (ścieżka → treść). Routuje exec po treści skryptu sh.
 * `tailContent` (opcjonalne) to „prawdziwy" stan pliku w chwili `tail` — gdy różni się
 * od `files` (które mierzy `wc -c`), symuluje wzrost pliku między `wc` a `tail`.
 */
class FakeDockerClient implements DockerClient {
  psCalls = 0;
  tailCalls: Array<{ id: string; offset: number; file: string; maxBytes: number }> = [];

  constructor(
    public up = true,
    public containers: ContainerInfo[] = [],
    public files: Record<string, Record<string, string>> = {}, // id → { path: content } (mierzone przez LIST)
    public tailContent: Record<string, Record<string, string>> = {}, // id → { path: content } (zwracane przez tail)
  ) {}
  async available(): Promise<boolean> {
    return this.up;
  }
  async ps(): Promise<ContainerInfo[]> {
    this.psCalls++;
    if (!this.up) throw new Error('docker daemon not running');
    return this.containers;
  }
  async exec(id: string, argv: string[]): Promise<ExecResult> {
    const script = argv[2] ?? '';
    const fs = this.files[id] ?? {};
    if (script.includes('ls -1')) {
      const list = Object.keys(fs).join('\n');
      return { code: 0, stdout: list ? list + '\n' : '', stderr: '' };
    }
    if (script.startsWith('for f in')) {
      const out = Object.entries(fs)
        .map(([f, c]) => `${Buffer.byteLength(c)}\t${f}`)
        .join('\n');
      return { code: 0, stdout: out ? out + '\n' : '', stderr: '' };
    }
    if (script.startsWith('tail')) {
      const offset = Number(argv[4]); // 1-based
      const file = argv[5];
      const maxBytes = Number(argv[6]); // limit head -c
      this.tailCalls.push({ id, offset, file, maxBytes });
      const src = (this.tailContent[id] ?? this.files[id] ?? {})[file] ?? fs[file] ?? '';
      const start = offset - 1;
      return { code: 0, stdout: src.slice(start, start + maxBytes), stderr: '' };
    }
    return { code: 127, stdout: '', stderr: 'unknown command' };
  }
}

class DeferredAvailableDockerClient extends FakeDockerClient {
  private resolveAvailable!: (value: boolean) => void;
  readonly availablePromise = new Promise<boolean>((resolve) => {
    this.resolveAvailable = resolve;
  });

  override async available(): Promise<boolean> {
    return this.availablePromise;
  }

  resolveAvailableAs(value: boolean): void {
    this.resolveAvailable(value);
  }
}

const FILE = '/root/.claude/projects/proj/sess-1.jsonl';
const promptLine =
  JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    timestamp: '2026-06-20T10:00:00.000Z',
    sessionId: 'sess-1',
    content: 'Napraw testy auth',
  }) + '\n';
const endLine =
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-06-20T10:00:05.000Z',
    message: { id: 'm1', model: 'claude-opus-4-8', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Gotowe.' }] },
  }) + '\n';

describe('DockerPoller', () => {
  // Fixtury mają stałe timestampy, a sweep() pollera ewikuje bohaterów względem
  // realnego Date.now() (removeAfterMs = 30 min). Bez zamrożenia zegara testy byłyby
  // „time-bombą": zielone w dniu commita, czerwone po 30 min od czasu fixture'ów.
  // Zamrażamy czas tuż po najpóźniejszym fixturze (10:00:05) → ewikcja deterministyczna.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T10:00:10.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('odkrywa agentowy kontener i rodzi bohatera z polem container + tytułem z promptu', async () => {
    const world = makeWorld();
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
      abc123: { [FILE]: promptLine },
    });
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    poller.stop();

    const hero = world.getHero('docker:abc123:sess-1');
    expect(hero).toBeDefined();
    expect(hero?.container).toEqual({ id: 'abc123', name: 'devbox', image: 'node:20' });
    expect(hero?.title).toBe('Napraw testy auth');
    expect(hero?.projectDir).toBe('docker://devbox');
  });

  it('dedup: gdy host już śledzi ten UUID, nie rodzi kontenerowego bohatera', async () => {
    const world = makeWorld();
    // Host-bohater pod surowym UUID (jak źródło Claude na hoście).
    const host = new SessionTracker(world, 'sess-1', '/host/proj', undefined, 'claude');
    host.apply({ kind: 'prompt', text: 'Hostowy', ts: '2026-06-20T09:00:00.000Z' });

    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
      abc123: { [FILE]: promptLine },
    });
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    poller.stop();

    expect(world.getHero('docker:abc123:sess-1')).toBeUndefined(); // pominięty
    expect(world.getHero('sess-1')).toBeDefined(); // host zostaje
  });

  it('kontener bez ~/.claude → brak bohatera', async () => {
    const world = makeWorld();
    const client = new FakeDockerClient(true, [{ id: 'empty1', name: 'db', image: 'postgres:16' }], { empty1: {} });
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    await poller.poll(); // drugi cykl
    poller.stop();

    expect(world.snapshot().heroes).toHaveLength(0);
  });

  it('start() nie rzuca, gdy docker niedostępny', async () => {
    const world = makeWorld();
    const client = new FakeDockerClient(false);
    const poller = new DockerPoller(world, client, 999_999);
    await expect(poller.start()).resolves.toBeUndefined();
    poller.stop();
    expect(world.snapshot().heroes).toHaveLength(0);
  });

  it('AGENTCRAFT_DOCKER=0 → start() jest no-opem', async () => {
    const prev = process.env.AGENTCRAFT_DOCKER;
    process.env.AGENTCRAFT_DOCKER = '0';
    try {
      const world = makeWorld();
      const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
        abc123: { [FILE]: promptLine },
      });
      const poller = new DockerPoller(world, client, 999_999);
      await poller.start();
      poller.stop();
      expect(world.snapshot().heroes).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.AGENTCRAFT_DOCKER;
      else process.env.AGENTCRAFT_DOCKER = prev;
    }
  });

  it('przyrostowy odczyt: druga tura doczytuje nowe linie', async () => {
    const world = makeWorld();
    const files = { abc123: { [FILE]: promptLine } };
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], files);
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start(); // tura 1: prompt
    expect(world.getHero('docker:abc123:sess-1')?.state).toBe('thinking');

    // Plik urósł o turn-end; druga tura ma go skonsumować (stan → returning).
    files.abc123[FILE] = promptLine + endLine;
    await poller.poll();
    poller.stop();

    expect(world.getHero('docker:abc123:sess-1')?.state).toBe('returning');
  });

  it('okno wzrostu: tail ograniczony do zmierzonego rozmiaru — nie czyta przedwcześnie bajtów ponad wc -c', async () => {
    const world = makeWorld();
    // LIST/wc widzi tylko promptLine; ale „prawdziwy" plik (tail) ma już promptLine+endLine
    // (urósł między wc a tail). Cap `head -c` musi przyciąć do rozmiaru promptLine.
    const client = new FakeDockerClient(
      true,
      [{ id: 'abc123', name: 'devbox', image: 'node:20' }],
      { abc123: { [FILE]: promptLine } }, // wc -c → rozmiar promptLine
      { abc123: { [FILE]: promptLine + endLine } }, // tail widzi więcej (wzrost)
    );
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    poller.stop();

    // Gdyby tail nie był ograniczony, endLine zostałby skonsumowany → 'returning'.
    // Z capem widzimy tylko promptLine → 'thinking'.
    expect(world.getHero('docker:abc123:sess-1')?.state).toBe('thinking');
  });

  it('re-sondaż: kontener nieagentowy, który później dostaje sesję, zostaje wykryty', async () => {
    const world = makeWorld();
    const files: Record<string, Record<string, string>> = { abc123: {} }; // start: pusto → non-agentic
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], files);
    const poller = new DockerPoller(world, client, 999_999, 1); // re-sonduj co 1 cykl
    await poller.start(); // cykl 1: non-agentic
    expect(world.getHero('docker:abc123:sess-1')).toBeUndefined();

    files.abc123[FILE] = promptLine; // agent wstał później
    await poller.poll(); // cykl 2: re-sondaż → agentic → odczyt
    poller.stop();

    expect(world.getHero('docker:abc123:sess-1')).toBeDefined();
  });

  it('dedup: usuwa kontenerowego dubla, gdy hostowy bohater pojawia się później', async () => {
    const world = makeWorld();
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
      abc123: { [FILE]: promptLine },
    });
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    expect(world.getHero('docker:abc123:sess-1')).toBeDefined();

    const host = new SessionTracker(world, 'sess-1', '/host/proj', undefined, 'claude');
    host.apply({ kind: 'prompt', text: 'Hostowy', ts: '2026-06-20T10:00:01.000Z' });
    await poller.poll();
    poller.stop();

    expect(world.getHero('sess-1')).toBeDefined();
    expect(world.getHero('docker:abc123:sess-1')).toBeUndefined();
  });

  it('stop podczas opóźnionego available() nie zostawia timera ani nie odpytuje ps', async () => {
    const client = new DeferredAvailableDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
      abc123: { [FILE]: promptLine },
    });
    const poller = new DockerPoller(makeWorld(), client, 100);

    const start = poller.start();
    poller.stop();
    client.resolveAvailableAs(true);
    await start;
    expect((poller as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();

    await vi.advanceTimersByTimeAsync(500);
    expect(client.psCalls).toBe(0);
  });

  it('resetuje offset i czyta od początku po skróceniu pliku kontenera', async () => {
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], {
      abc123: { [FILE]: promptLine + endLine },
    });
    const poller = new DockerPoller(makeWorld(), client, 999_999);
    await poller.start();
    expect(client.tailCalls.at(-1)).toMatchObject({ offset: 1, maxBytes: Buffer.byteLength(promptLine + endLine) });

    client.files.abc123[FILE] = promptLine;
    await poller.poll();
    poller.stop();

    expect(client.tailCalls.at(-1)).toMatchObject({ offset: 1, maxBytes: Buffer.byteLength(promptLine) });
  });
});
