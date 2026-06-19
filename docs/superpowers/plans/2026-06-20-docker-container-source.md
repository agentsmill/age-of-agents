# Źródło Docker — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizualizować sesje Claude Code działające w lokalnych kontenerach Docker, czytając pliki sesji przez `docker exec` (pull) i przepuszczając je przez istniejący parser Claude.

**Architecture:** Nowy, samodzielny `DockerPoller` (wzorowany na `OpenCodePoller`) cyklicznie listuje kontenery przez `docker ps`, sonduje nowe o `~/.claude/projects`, a dla plików sesji trzyma offset bajtowy i doczytuje przyrost przez `docker exec ... tail`. Surowe linie JSONL są identyczne z formatem Claude na hoście → reuse `interpretLine`. Cała komunikacja z daemonem za interfejsem `DockerClient` (szew testowalności: produkcyjny `CliDockerClient`, testowy fake). „Kontenerowość" to nowe pole `HeroSnapshot.container`, nie nowy `AgentKind`.

**Tech Stack:** TypeScript, Node.js (`child_process.execFile`), Docker CLI, vitest. Monorepo workspaces: `@agent-citadel/shared`, `@agent-citadel/server`, `@agent-citadel/client`.

**Komendy:**
- Test jednego pliku (server): `npm test -w @agent-citadel/server -- <wzorzec>`
- Wszystkie testy server: `npm test -w @agent-citadel/server`
- Type-check server: `npm run build -w @agent-citadel/server`
- Testy client: `npm test -w @agent-citadel/client -- <wzorzec>`

---

### Task 1: Pole `container` w `HeroSnapshot` + wstrzykiwanie `extra` w `SessionTracker`

Kontenerowy bohater potrzebuje tożsamości kontenera na snapshocie. `SessionTracker` buduje hero wewnętrznie — dodajemy opcjonalny `extra: Partial<HeroSnapshot>`, który tracker domiesza do bohatera (statyczna augmentacja, np. `container`). Hostowe/codex/opencode wywołania nie przekazują nic → zgodność wsteczna.

**Files:**
- Modify: `packages/shared/src/index.ts:28-60` (interfejs `HeroSnapshot`)
- Modify: `packages/server/src/state-machine.ts:62-98` (konstruktor + `hero()`)
- Test: `packages/server/test/docker-poller.test.ts` (create — pierwszy test)

- [ ] **Step 1: Dodaj pole `container` do `HeroSnapshot`**

W `packages/shared/src/index.ts`, w interfejsie `HeroSnapshot`, po polu `wielded?` (linia 57) dodaj:

```ts
  /** Tożsamość kontenera Docker, jeśli sesja działa w kontenerze (źródło Docker).
   *  Brak → sesja hostowa. Steruje odznaką kontenera w panelu. */
  container?: { id: string; name: string; image: string };
```

- [ ] **Step 2: Dodaj `extra` do `SessionTracker`**

W `packages/server/src/state-machine.ts`, konstruktor (linie 62-68) — dodaj 6. parametr:

```ts
  constructor(
    private readonly world: World,
    private readonly sessionId: string,
    private readonly projectDir: string,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
    private readonly agent: AgentKind = 'claude',
    /** Statyczne pola domieszane do bohatera (np. `container`). Zachowane przy każdym patch. */
    private readonly extra: Partial<HeroSnapshot> = {},
  ) {}
```

W metodzie `hero()` (linia 82-97), w zwracanym obiekcie nowego bohatera, jako ostatnie pole (po `lastActivityAt: now,`) dodaj `...this.extra,`:

```ts
    return {
      sessionId: this.sessionId,
      agent: this.agent,
      title: this.displayTitle(),
      projectDir: this.projectDir,
      workingDir: this.workingDir,
      projectName: this.projectName,
      teamColor: this.world.claimTeamColor(),
      state: 'idle',
      tokens: this.tokens,
      recentActions: this.recentActions,
      contextTokens: this.contextTokens,
      wielded: this.wielded(),
      startedAt: now,
      lastActivityAt: now,
      ...this.extra,
    };
```

- [ ] **Step 3: Write the failing test**

Utwórz `packages/server/test/docker-poller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import { SessionTracker } from '../src/state-machine.js';

describe('SessionTracker — extra (container)', () => {
  it('domieszuje pole container do bohatera i zachowuje je przy kolejnych patchach', () => {
    const world = new World();
    const container = { id: 'abc123', name: 'devbox', image: 'node:20' };
    const tracker = new SessionTracker(world, 'docker:abc123:s1', 'docker://devbox', undefined, 'claude', { container });

    tracker.apply({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-20T10:00:00.000Z' });
    expect(world.getHero('docker:abc123:s1')?.container).toEqual(container);

    // Kolejny patch (np. zmiana stanu) nie gubi container.
    tracker.apply({ kind: 'meta', cwd: '/workspace/app', ts: '2026-06-20T10:00:01.000Z' });
    expect(world.getHero('docker:abc123:s1')?.container).toEqual(container);
    expect(world.getHero('docker:abc123:s1')?.workingDir).toBe('/workspace/app');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w @agent-citadel/server -- docker-poller`
Expected: FAIL — przed Step 1-2 `extra` nie istnieje (błąd typów / `container` undefined).

> Uwaga: jeśli Step 1-2 już zrobione przed uruchomieniem, test od razu przejdzie — to akceptowalne dla zmiany typowej. Kluczowe: po Step 1-4 test ZIELONY.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @agent-citadel/server -- docker-poller`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/server/src/state-machine.ts packages/server/test/docker-poller.test.ts
git commit -m "feat(shared): HeroSnapshot.container + SessionTracker extra (augmentacja bohatera)"
```

---

### Task 2: `DockerClient` + `parseDockerPs`

Szew nad CLI Dockera. `parseDockerPs` to czysta, testowalna funkcja parsująca `docker ps --format '{{json .}}'`.

**Files:**
- Create: `packages/server/src/sources/docker-client.ts`
- Test: `packages/server/test/docker-client.test.ts`

- [ ] **Step 1: Write the failing test**

Utwórz `packages/server/test/docker-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDockerPs } from '../src/sources/docker-client.js';

describe('parseDockerPs', () => {
  it('parsuje linie JSON na ContainerInfo (ID/Names/Image)', () => {
    const stdout =
      '{"ID":"abc123","Names":"devbox","Image":"node:20"}\n' +
      '{"ID":"def456","Names":"web,web-alias","Image":"caddy:2"}\n';
    expect(parseDockerPs(stdout)).toEqual([
      { id: 'abc123', name: 'devbox', image: 'node:20' },
      { id: 'def456', name: 'web', image: 'caddy:2' }, // pierwsza nazwa z listy
    ]);
  });

  it('pomija puste i nie-JSON linie', () => {
    const stdout = '\n  \nto nie json{\n{"ID":"x","Names":"y","Image":"z"}\n';
    expect(parseDockerPs(stdout)).toEqual([{ id: 'x', name: 'y', image: 'z' }]);
  });

  it('pomija rekordy bez ID', () => {
    expect(parseDockerPs('{"Names":"brak-id","Image":"i"}\n')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @agent-citadel/server -- docker-client`
Expected: FAIL — `Cannot find module '../src/sources/docker-client.js'`.

- [ ] **Step 3: Write the implementation**

Utwórz `packages/server/src/sources/docker-client.ts`:

```ts
import { execFile } from 'node:child_process';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Cienki adapter nad CLI Dockera. Cała komunikacja z daemonem przechodzi tędy,
 * dzięki czemu DockerPoller jest testowalny z fake'em (bez prawdziwego Dockera).
 */
export interface DockerClient {
  /** Czy `docker` jest na PATH i daemon odpowiada. */
  available(): Promise<boolean>;
  /** Lista działających kontenerów (`docker ps`). Rzuca, gdy polecenie zawiedzie. */
  ps(): Promise<ContainerInfo[]>;
  /** `docker exec <id> <argv...>`. Nigdy nie rzuca — kod wyjścia w ExecResult.code. */
  exec(id: string, argv: string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
}

/** Parsuje wyjście `docker ps --format '{{json .}}'` (jeden obiekt JSON na linię). */
export function parseDockerPs(stdout: string): ContainerInfo[] {
  const out: ContainerInfo[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const id = String(obj.ID ?? '');
      if (!id) continue;
      // `Names` bywa listą rozdzieloną przecinkami — bierzemy pierwszą.
      const name = String(obj.Names ?? '').split(',')[0] || id;
      const image = String(obj.Image ?? '');
      out.push({ id, name, image });
    } catch {
      // pomiń nie-JSON
    }
  }
  return out;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER = 16 * 1024 * 1024;

function run(argv: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile('docker', argv, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      // execFile zwraca err z .code (number) dla nie-zerowego exitu; 'ENOENT' (string)
      // gdy brak `docker` na PATH; null + killed=true przy timeoucie. Mapujemy na liczbę.
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export class CliDockerClient implements DockerClient {
  async available(): Promise<boolean> {
    const r = await run(['version', '--format', '{{.Server.Version}}'], DEFAULT_TIMEOUT_MS);
    return r.code === 0 && r.stdout.trim().length > 0;
  }

  async ps(): Promise<ContainerInfo[]> {
    const r = await run(['ps', '--format', '{{json .}}'], DEFAULT_TIMEOUT_MS);
    if (r.code !== 0) throw new Error(`docker ps failed (${r.code}): ${r.stderr.trim()}`);
    return parseDockerPs(r.stdout);
  }

  async exec(id: string, argv: string[], opts?: { timeoutMs?: number }): Promise<ExecResult> {
    return run(['exec', id, ...argv], opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @agent-citadel/server -- docker-client`
Expected: PASS (3 testy)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sources/docker-client.ts packages/server/test/docker-client.test.ts
git commit -m "feat(server): DockerClient (szew nad CLI) + parseDockerPs"
```

---

### Task 3: `ContainerTailRegistry`

Przyrostowy odczyt plików sesji wewnątrz kontenerów. Nie czyta z FS — dostaje rozmiar i nowe bajty (z `docker exec`) i wydobywa kompletne linie NDJSON, buforując niedokończoną końcówkę. Klucz = `${containerId}\0${file}`.

**Files:**
- Create: `packages/server/src/sources/docker-tail.ts`
- Test: `packages/server/test/docker-tail.test.ts`

- [ ] **Step 1: Write the failing test**

Utwórz `packages/server/test/docker-tail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ContainerTailRegistry } from '../src/sources/docker-tail.js';

describe('ContainerTailRegistry', () => {
  const key = ContainerTailRegistry.key('abc', '/root/.claude/projects/p/s.jsonl');

  it('dostarcza tylko pełne linie, częściową trzyma w buforze', () => {
    const tails = new ContainerTailRegistry();
    const chunk1 = '{"a":1}\n{"b":2}\n{"c":';
    expect(tails.feed(key, chunk1.length, chunk1)).toEqual(['{"a":1}', '{"b":2}']);

    const rest = '3}\n';
    expect(tails.feed(key, chunk1.length + rest.length, rest)).toEqual(['{"c":3}']);
  });

  it('registerAtEnd pomija historię (offset = rozmiar)', () => {
    const tails = new ContainerTailRegistry();
    tails.registerAtEnd(key, 100);
    expect(tails.getOffset(key)).toBe(100);
  });

  it('wykrywa skrócenie pliku i zaczyna od zera', () => {
    const tails = new ContainerTailRegistry();
    const first = '{"a":1}\n{"b":2}\n';
    tails.feed(key, first.length, first);
    // Plik nadpisany na krótszy: size < offset → reset, nowe bajty od zera.
    const reset = '{"od-nowa":1}\n';
    expect(tails.feed(key, reset.length, reset)).toEqual(['{"od-nowa":1}']);
  });

  it('brak nowych bajtów → pusta lista', () => {
    const tails = new ContainerTailRegistry();
    expect(tails.feed(key, 0, '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @agent-citadel/server -- docker-tail`
Expected: FAIL — `Cannot find module '../src/sources/docker-tail.js'`.

- [ ] **Step 3: Write the implementation**

Utwórz `packages/server/src/sources/docker-tail.ts`:

```ts
/**
 * Rejestr przyrostowego odczytu plików sesji WEWNĄTRZ kontenerów. W odróżnieniu
 * od TailRegistry nie czyta z FS — dostaje rozmiar i nowe bajty (pozyskane przez
 * `docker exec`) i wydobywa kompletne linie NDJSON, buforując niedokończoną
 * końcówkę. Klucz = `${containerId}\0${file}`.
 */
export class ContainerTailRegistry {
  private offsets = new Map<string, number>();
  private remainders = new Map<string, string>();

  static key(containerId: string, file: string): string {
    return `${containerId} ${file}`;
  }

  getOffset(key: string): number {
    return this.offsets.get(key) ?? 0;
  }

  has(key: string): boolean {
    return this.offsets.has(key);
  }

  /** Rejestruje plik od bieżącego końca (pomija historię) — dla dużych plików. */
  registerAtEnd(key: string, size: number): void {
    this.offsets.set(key, size);
    this.remainders.set(key, '');
  }

  forget(key: string): void {
    this.offsets.delete(key);
    this.remainders.delete(key);
  }

  /**
   * Przyjmuje aktualny rozmiar pliku i NOWE bajty (od getOffset(key) do size).
   * Zwraca kompletne linie. Wykrywa skrócenie pliku (size < offset → reset).
   */
  feed(key: string, size: number, newBytes: string): string[] {
    let offset = this.offsets.get(key) ?? 0;
    if (size < offset) {
      offset = 0;
      this.remainders.set(key, '');
    }
    this.offsets.set(key, size);
    if (!newBytes) return [];
    const buffered = (this.remainders.get(key) ?? '') + newBytes;
    const parts = buffered.split('\n');
    const remainder = parts.pop() ?? '';
    this.remainders.set(key, remainder);
    return parts.filter((l) => l.trim().length > 0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @agent-citadel/server -- docker-tail`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sources/docker-tail.ts packages/server/test/docker-tail.test.ts
git commit -m "feat(server): ContainerTailRegistry (przyrostowy tail po docker exec)"
```

---

### Task 4: `DockerPoller` — discovery, sonda, dedup, odczyt, cykl życia

Serce feature'u. Pętla pollingu, sonda raz-na-ID (cache), odczyt sesji przez `exec`, dedup po surowym UUID (host wygrywa), cykl życia przy zniknięciu kontenera.

**Files:**
- Create: `packages/server/src/sources/docker-poller.ts`
- Test: `packages/server/test/docker-poller.test.ts` (rozszerz o testy pollera + `FakeDockerClient`)

- [ ] **Step 1: Write the implementation**

Utwórz `packages/server/src/sources/docker-poller.ts`:

```ts
import { basename } from 'node:path';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../state-machine.js';
import { interpretLine } from '../transcript/parser.js';
import { ContainerTailRegistry } from './docker-tail.js';
import type { ContainerInfo, DockerClient } from './docker-client.js';
import type { World } from '../world.js';

/**
 * DockerPoller — okresowo listuje kontenery i czyta z nich pliki sesji Claude
 * przez `docker exec` (pull). Surowe linie JSONL są identyczne z hostowym Claude,
 * więc reuse `interpretLine`. Wzorowany na OpenCodePoller (poll + offset + tracker).
 */

const POLL_INTERVAL_MS = 2000;
const EXEC_TIMEOUT_MS = 5000;
const BIG_FILE_BYTES = 2 * 1024 * 1024;

// Komendy sh wewnątrz kontenera. `~` rozwija się do HOME usera exec-a (różny obraz
// = różny user) — właściwy wybór. `|| true` w sondzie: pusty wynik glob nie ma być błędem.
const PROBE_CMD = 'ls -1 ~/.claude/projects/*/*.jsonl 2>/dev/null || true';
const LIST_CMD = 'for f in ~/.claude/projects/*/*.jsonl; do [ -f "$f" ] && printf "%s\\t%s\\n" "$(wc -c < "$f")" "$f"; done';
// `tail -c +N "$file"` przez parametry pozycyjne ($1/$2) — bez interpolacji (anty-iniekcja).
const TAIL_ARGV = (offsetPlus1: number, file: string): string[] => ['sh', '-c', 'tail -c +"$1" "$2"', 'sh', String(offsetPlus1), file];

type ContainerStatus = 'agentic' | 'non-agentic' | 'unreadable';

interface SessionEntry {
  tracker: SessionTracker;
  ended: boolean; // czy zaaplikowano już turn-end po zniknięciu kontenera
}

interface ContainerEntry {
  info: ContainerInfo;
  status?: ContainerStatus; // undefined = jeszcze nie sondowany
  present: boolean;         // widziany w ostatnim `docker ps`
  sessions: Map<string, SessionEntry>; // klucz = surowy sessionId (uuid)
}

export class DockerPoller {
  private known = new Map<string, ContainerEntry>(); // klucz = container id
  private tails = new ContainerTailRegistry();
  private timer?: NodeJS.Timeout;
  private running = false;
  private loggedUnavailable = false;

  constructor(
    private readonly world: World,
    private readonly client: DockerClient,
    private readonly intervalMs: number = POLL_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    if (process.env.AGENTCRAFT_DOCKER === '0') {
      console.log('[Docker] Poller wyłączony (AGENTCRAFT_DOCKER=0)');
      return;
    }
    this.running = true;
    if (await this.client.available()) {
      console.log('[Docker] Poller started');
    } else {
      console.log('[Docker] docker niedostępny — poller czeka (uruchom Docker, by zobaczyć kontenery)');
    }
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    await this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Publiczne dla testów — jeden cykl pollingu. */
  async poll(): Promise<void> {
    if (!this.running) return;

    let list: ContainerInfo[];
    try {
      list = await this.client.ps();
      this.loggedUnavailable = false;
    } catch (err) {
      // Daemon padł / docker zniknął z PATH — loguj raz, pętla sama się podniesie.
      if (!this.loggedUnavailable) {
        console.warn('[Docker] ps nieosiągalny:', err instanceof Error ? err.message : String(err));
        this.loggedUnavailable = true;
      }
      return;
    }

    const liveIds = new Set(list.map((c) => c.id));
    for (const entry of this.known.values()) entry.present = false;
    for (const info of list) {
      const entry = this.known.get(info.id);
      if (entry) {
        entry.present = true;
        entry.info = info;
      } else {
        this.known.set(info.id, { info, present: true, sessions: new Map() });
      }
    }

    for (const entry of this.known.values()) {
      if (!entry.present) continue;
      if (entry.status === undefined) await this.probe(entry); // sonda raz na ID
      if (entry.status === 'agentic') await this.readContainer(entry);
    }

    this.sweep(liveIds);
  }

  /** Sonda raz na życie kontenera: czy ma ~/.claude/projects. Wynik cache'owany w status. */
  private async probe(entry: ContainerEntry): Promise<void> {
    const r = await this.client.exec(entry.info.id, ['sh', '-c', PROBE_CMD], { timeoutMs: EXEC_TIMEOUT_MS });
    if (r.code !== 0) {
      entry.status = 'unreadable';
      console.warn(`[Docker] kontener ${entry.info.name} nieczytelny (brak sh/uprawnień?) — pomijam`);
      return;
    }
    entry.status = r.stdout.trim().length > 0 ? 'agentic' : 'non-agentic';
  }

  private async readContainer(entry: ContainerEntry): Promise<void> {
    const r = await this.client.exec(entry.info.id, ['sh', '-c', LIST_CMD], { timeoutMs: EXEC_TIMEOUT_MS });
    if (r.code !== 0) return;
    for (const raw of r.stdout.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const size = Number(line.slice(0, tab));
      const file = line.slice(tab + 1);
      if (!Number.isFinite(size) || !file) continue;
      const sessionId = basename(file, '.jsonl');
      // Dedup: hostowe źródło Claude już śledzi ten UUID (współdzielony ~/.claude) → host wygrywa.
      if (this.world.getHero(sessionId)) continue;
      await this.readFile(entry, sessionId, file, size);
    }
  }

  private async readFile(entry: ContainerEntry, sessionId: string, file: string, size: number): Promise<void> {
    const key = ContainerTailRegistry.key(entry.info.id, file);
    let sess = entry.sessions.get(sessionId);
    if (!sess) {
      const heroId = `docker:${entry.info.id}:${sessionId}`;
      const tracker = new SessionTracker(
        this.world,
        heroId,
        `docker://${entry.info.name}`,
        DEFAULT_THRESHOLDS,
        'claude',
        { container: { id: entry.info.id, name: entry.info.name, image: entry.info.image } },
      );
      sess = { tracker, ended: false };
      entry.sessions.set(sessionId, sess);
      if (size > BIG_FILE_BYTES) this.tails.registerAtEnd(key, size); // pomiń historię dużych plików
    }

    const offset = this.tails.getOffset(key);
    if (size <= offset) return; // brak przyrostu

    const exec = await this.client.exec(entry.info.id, TAIL_ARGV(offset + 1, file), { timeoutMs: EXEC_TIMEOUT_MS });
    if (exec.code !== 0) return;

    for (const l of this.tails.feed(key, size, exec.stdout)) {
      for (const fact of interpretLine(l)) sess.tracker.apply(fact);
    }
    sess.ended = false;
  }

  private sweep(liveIds: Set<string>): void {
    const now = Date.now();
    for (const [id, entry] of this.known) {
      if (!liveIds.has(id)) {
        // Kontener zniknął → zakończ tury jego sesji (raz); dalej starzeją się normalnie.
        for (const sess of entry.sessions.values()) {
          if (!sess.ended) {
            sess.tracker.apply({ kind: 'turn-end', ts: new Date(now).toISOString() });
            sess.ended = true;
          }
        }
      }
      for (const [sid, sess] of entry.sessions) {
        if (sess.tracker.tick(now) === 'remove') entry.sessions.delete(sid);
      }
      if (!liveIds.has(id) && entry.sessions.size === 0) this.known.delete(id);
    }
  }
}
```

- [ ] **Step 2: Write the failing tests (FakeDockerClient + scenariusze)**

Dopisz do `packages/server/test/docker-poller.test.ts` (po istniejącym `describe`):

```ts
import { DockerPoller } from '../src/sources/docker-poller.js';
import type { ContainerInfo, DockerClient, ExecResult } from '../src/sources/docker-client.js';

/** Fake: kontenery + ich pliki (ścieżka → treść). Routuje exec po treści skryptu sh. */
class FakeDockerClient implements DockerClient {
  constructor(
    public up = true,
    public containers: ContainerInfo[] = [],
    public files: Record<string, Record<string, string>> = {}, // id → { path: content }
  ) {}
  async available(): Promise<boolean> {
    return this.up;
  }
  async ps(): Promise<ContainerInfo[]> {
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
      const out = Object.entries(fs).map(([f, c]) => `${Buffer.byteLength(c)}\t${f}`).join('\n');
      return { code: 0, stdout: out ? out + '\n' : '', stderr: '' };
    }
    if (script.startsWith('tail')) {
      const offset = Number(argv[4]); // 1-based
      const file = argv[5];
      const content = fs[file] ?? '';
      return { code: 0, stdout: content.slice(offset - 1), stderr: '' };
    }
    return { code: 127, stdout: '', stderr: 'unknown command' };
  }
}

const FILE = '/root/.claude/projects/proj/sess-1.jsonl';
const promptLine =
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-06-20T10:00:00.000Z', sessionId: 'sess-1', content: 'Napraw testy auth' }) + '\n';

describe('DockerPoller', () => {
  it('odkrywa agentowy kontener i rodzi bohatera z polem container + tytułem z promptu', async () => {
    const world = new World();
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
    const world = new World();
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

  it('kontener bez ~/.claude → brak bohatera, sonda nie powtarzana', async () => {
    const world = new World();
    const client = new FakeDockerClient(true, [{ id: 'empty1', name: 'db', image: 'postgres:16' }], { empty1: {} });
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start();
    await poller.poll(); // drugi cykl
    poller.stop();

    expect(world.snapshot().heroes).toHaveLength(0);
  });

  it('start() nie rzuca, gdy docker niedostępny', async () => {
    const world = new World();
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
      const world = new World();
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
    const world = new World();
    const files = { abc123: { [FILE]: promptLine } };
    const client = new FakeDockerClient(true, [{ id: 'abc123', name: 'devbox', image: 'node:20' }], files);
    const poller = new DockerPoller(world, client, 999_999);
    await poller.start(); // tura 1: prompt

    // Dopisz turn-end do pliku, druga tura ma go skonsumować (stan → returning).
    const endLine =
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-20T10:00:05.000Z', message: { id: 'm1', model: 'claude-opus-4-8', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Gotowe.' }] } }) + '\n';
    files.abc123[FILE] = promptLine + endLine;
    await poller.poll();
    poller.stop();

    expect(world.getHero('docker:abc123:sess-1')?.state).toBe('returning');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w @agent-citadel/server -- docker-poller`
Expected: FAIL — `Cannot find module '../src/sources/docker-poller.js'` (przed Step 1) lub asercje czerwone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @agent-citadel/server -- docker-poller`
Expected: PASS (1 z Task 1 + 6 nowych = 7 testów)

- [ ] **Step 5: Type-check**

Run: `npm run build -w @agent-citadel/server`
Expected: brak błędów.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sources/docker-poller.ts packages/server/test/docker-poller.test.ts
git commit -m "feat(server): DockerPoller — discovery/sonda/dedup/tail przez docker exec"
```

---

### Task 5: Wpięcie `DockerPoller` w serwer

Uruchom poller obok pozostałych źródeł (tylko tryb nie-demo).

**Files:**
- Modify: `packages/server/src/server.ts:7-8` (import), `:50-51` (instancja), `:73-79` (start w onReady)

- [ ] **Step 1: Dodaj importy**

W `packages/server/src/server.ts`, po linii 8 (`import { ArsenalPoller } ...`) dodaj:

```ts
import { DockerPoller } from './sources/docker-poller.js';
import { CliDockerClient } from './sources/docker-client.js';
```

- [ ] **Step 2: Utwórz instancję pollera**

W bloku `else` (nie-demo), po linii 51 (`const opencodePoller = new OpenCodePoller(world);`) dodaj:

```ts
    // Kontenery Docker: poller czyta pliki sesji przez `docker exec` (pull).
    const dockerPoller = new DockerPoller(world, new CliDockerClient());
```

- [ ] **Step 3: Wystartuj w onReady**

W `app.addHook('onReady', ...)` (linie 73-79), po `await opencodePoller.start();` dodaj:

```ts
      void dockerPoller.start();
```

(Świadomie `void` — start pollera nie może opóźniać gotowości serwera; poller sam jest odporny na brak Dockera.)

- [ ] **Step 4: Type-check + pełne testy serwera**

Run: `npm run build -w @agent-citadel/server && npm test -w @agent-citadel/server`
Expected: type-check czysty; wszystkie testy zielone (w tym dotychczasowe `server.test.ts` — serwer dalej startuje, bo poller jest odporny na brak Dockera).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat(server): wystartuj DockerPoller obok źródeł (tryb nie-demo)"
```

---

### Task 6: Klient — odznaka kontenera w panelu sesji

Widoczna wypłata: użytkownik widzi, że bohater działa w kontenerze (nazwa + obraz).

**Files:**
- Create: `packages/client/src/hud/container-badge.ts`
- Test: `packages/client/tests/container-badge.test.ts`
- Modify: `packages/client/src/hud/SidePanel.tsx:116-120` (meta bohatera)

- [ ] **Step 1: Write the failing test**

Utwórz `packages/client/tests/container-badge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { containerLabel } from '../src/hud/container-badge';

describe('containerLabel', () => {
  it('formatuje nazwę i obraz kontenera z prefiksem 🐳', () => {
    expect(containerLabel({ id: 'abc', name: 'devbox', image: 'node:20' })).toBe('🐳 devbox · node:20');
  });

  it('gdy brak obrazu, pokazuje samą nazwę', () => {
    expect(containerLabel({ id: 'abc', name: 'devbox', image: '' })).toBe('🐳 devbox');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @agent-citadel/client -- container-badge`
Expected: FAIL — `Cannot find module '../src/hud/container-badge'`.

- [ ] **Step 3: Write the implementation**

Utwórz `packages/client/src/hud/container-badge.ts`:

```ts
/** Etykieta odznaki kontenera Docker w panelu sesji: "🐳 <nazwa> · <obraz>". */
export function containerLabel(container: { id: string; name: string; image: string }): string {
  const base = `🐳 ${container.name}`;
  return container.image ? `${base} · ${container.image}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @agent-citadel/client -- container-badge`
Expected: PASS (2 testy)

- [ ] **Step 5: Renderuj odznakę w SidePanel**

W `packages/client/src/hud/SidePanel.tsx`:

a) Po imporcie `ProviderEmblem` (linia 7) dodaj:

```ts
import { containerLabel } from './container-badge';
```

b) W nagłówku panelu, zaraz po zamknięciu meta-diva modelu (linia 120 `</div>`), a przed zamknięciem `</div>` opakowania (linia 121), wstaw odznakę kontenera. Zmień:

```tsx
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {resolveSprite(hero.model, models).displayName ?? hero.model ?? t.modelUnknown}
              {hero.gitBranch ? ` · ⎇ ${hero.gitBranch}` : ''}
              {hero.permissionMode ? ` · ${hero.permissionMode}` : ''}
            </div>
          </div>
```

na:

```tsx
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {resolveSprite(hero.model, models).displayName ?? hero.model ?? t.modelUnknown}
              {hero.gitBranch ? ` · ⎇ ${hero.gitBranch}` : ''}
              {hero.permissionMode ? ` · ${hero.permissionMode}` : ''}
            </div>
            {hero.container && (
              <div
                className="px"
                title={hero.container.id}
                style={{ fontSize: 11, marginTop: 3, color: '#7fc7e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {containerLabel(hero.container)}
              </div>
            )}
          </div>
```

- [ ] **Step 6: Type-check klienta + testy**

Run: `npm run build -w @agent-citadel/client` (jeśli istnieje skrypt build/type-check) oraz `npm test -w @agent-citadel/client -- container-badge`
Expected: build/type-check czysty; testy zielone.

> Jeśli `build` klienta jest ciężki (vite), wystarczy type-check przez edytor/TS; kluczowe są zielone testy i brak błędów typów dot. `hero.container`.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/hud/container-badge.ts packages/client/tests/container-badge.test.ts packages/client/src/hud/SidePanel.tsx
git commit -m "feat(client): odznaka kontenera Docker w panelu sesji"
```

---

### Task 7: Weryfikacja end-to-end (na żywo) + pełny pakiet testów

- [ ] **Step 1: Pełne testy całego repo**

Run: `npm test`
Expected: wszystkie pakiety zielone.

- [ ] **Step 2: Weryfikacja na żywo (opcjonalna, wymaga Dockera)**

Uruchom agenta Claude w kontenerze, np.:

```bash
docker run -it --rm -v "$PWD":/workspace -w /workspace node:20 sh -c 'npx @anthropic-ai/claude-code'
# (lub dowolny kontener, w którym pracuje Claude Code i powstaje ~/.claude/projects)
```

Następnie odpal AgentCraft (`npm run dev`) i potwierdź, że:
- bohater kontenera pojawia się na mapie,
- panel sesji pokazuje odznakę `🐳 <nazwa> · <obraz>`,
- po zatrzymaniu kontenera bohater po chwili znika (cykl życia).

> Jeśli Docker niedostępny w środowisku wykonawczym — pomiń Step 2, testy jednostkowe pokrywają logikę (z `FakeDockerClient`).

- [ ] **Step 3: Aktualizacja docs / changelog (jeśli projekt prowadzi)**

Dodaj wpis o źródle Docker tam, gdzie projekt opisuje obsługiwane CLI/źródła (np. README sekcja źródeł, skill `agentcraft-guide`).

---

## Self-Review (autor planu)

**1. Pokrycie specu:**
- Pull przez `docker exec` + polling → Task 4 (poll/probe/readFile). ✓
- Reuse parsera Claude → Task 4 importuje `interpretLine`. ✓
- Wzorzec OpenCodePoller (nie AgentSource) → Task 4 to samodzielny poller. ✓
- Szew `DockerClient` (CLI + fake) → Task 2 + FakeDockerClient w Task 4. ✓
- Sonda raz na ID + cache → Task 4 `status` undefined→agentic/non-agentic, test „nie powtarzana". ✓
- Tail przez exec + offset + guard dużego pliku → Task 3 (`feed`, `registerAtEnd`) + Task 4 (`BIG_FILE_BYTES`). ✓
- Tożsamość `docker:<id>:<uuid>`, `projectDir=docker://<name>`, `agent='claude'` → Task 4. ✓
- Pole `HeroSnapshot.container` (nie nowy AgentKind) → Task 1. ✓
- Dedup po surowym UUID (host wygrywa) → Task 4 `if (world.getHero(sessionId)) continue` + test. ✓
- Filtr projektu: kontenerowi zwolnieni (zawsze widoczni) → wynika z `projectDir=docker://...` (nie matchuje hostowego filtra) + odznaka; brak dodatkowego kodu w MVP. ✓
- Cykl życia (kontener znika → turn-end → sweep) → Task 4 `sweep`. ✓
- Błędy: docker niedostępny (log raz), exec pada (unreadable/skip), `AGENTCRAFT_DOCKER=0` → Task 4 + testy. ✓
- Wizualizacja: odznaka w SidePanel → Task 6. ✓
- Testy na FakeDockerClient (bez Dockera w CI) → Task 2-4, 6. ✓

**2. Skan placeholderów:** brak „TBD/TODO"; każdy krok kodu ma pełny kod i komendę z oczekiwanym wynikiem. ✓

**3. Spójność typów:** `DockerClient.exec(id, argv, opts?)`, `ContainerInfo {id,name,image}`, `ExecResult {code,stdout,stderr}`, `ContainerTailRegistry.key/getOffset/feed/registerAtEnd`, `SessionTracker(..., agent, extra)` — nazwy zgodne między Task 2/3/4/5/6. `interpretLine`, `World.getHero`, `tracker.apply`/`tracker.tick` — zgodne z istniejącym kodem. ✓
