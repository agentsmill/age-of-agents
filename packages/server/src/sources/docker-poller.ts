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
// Co ile cykli ponownie sondujemy kontener oznaczony jako „nieagentowy". Typowy
// workflow to „kontener wstaje pierwszy, `claude` startuje w nim chwilę później" —
// bez re-sondażu nigdy byśmy go nie zobaczyli. 15 cykli * 2 s ≈ 30 s.
const REPROBE_EVERY_POLLS = 15;

// Komendy sh wewnątrz kontenera. `~` rozwija się do HOME usera exec-a (różny obraz
// = różny user) — właściwy wybór. `|| true` w sondzie: pusty wynik glob nie ma być błędem.
const PROBE_CMD = 'ls -1 ~/.claude/projects/*/*.jsonl 2>/dev/null || true';
const LIST_CMD =
  'for f in ~/.claude/projects/*/*.jsonl; do [ -f "$f" ] && printf "%s\\t%s\\n" "$(wc -c < "$f")" "$f"; done';
// `tail -c +N | head -c M` przez parametry pozycyjne ($1/$2/$3) — bez interpolacji
// (anty-iniekcja). `head -c M` ogranicza odczyt do ZMIERZONEGO rozmiaru: plik rosnie
// między `wc -c` a `tail`, a `tail -c +N` bez granicy doczytalby az do biezacego EOF
// → bajty ponad rozmiar trafilyby teraz I ponownie w kolejnym cyklu (duplikaty).
const TAIL_ARGV = (offsetPlus1: number, file: string, maxBytes: number): string[] => [
  'sh',
  '-c',
  'tail -c +"$1" "$2" | head -c "$3"',
  'sh',
  String(offsetPlus1),
  file,
  String(maxBytes),
];

type ContainerStatus = 'agentic' | 'non-agentic' | 'unreadable';

interface SessionEntry {
  tracker: SessionTracker;
  key: string; // klucz rejestru tail — potrzebny przy usuwaniu sesji (forget)
  ended: boolean; // czy zaaplikowano już turn-end po zniknięciu kontenera
}

interface ContainerEntry {
  info: ContainerInfo;
  status?: ContainerStatus; // undefined = jeszcze nie sondowany
  probedAtPoll: number; // numer cyklu ostatniej sondy (dla re-sondażu)
  present: boolean; // widziany w ostatnim `docker ps`
  sessions: Map<string, SessionEntry>; // klucz = surowy sessionId (uuid)
}

export class DockerPoller {
  private known = new Map<string, ContainerEntry>(); // klucz = container id
  private tails = new ContainerTailRegistry();
  private timer?: NodeJS.Timeout;
  private running = false;
  private polling = false; // bariera reentrancji — `poll()` nie moze nachodzic sam na siebie
  private pollCount = 0;
  private loggedUnavailable = false;

  constructor(
    private readonly world: World,
    private readonly client: DockerClient,
    private readonly intervalMs: number = POLL_INTERVAL_MS,
    private readonly reprobeEveryPolls: number = REPROBE_EVERY_POLLS,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    if (process.env.AGENTCRAFT_DOCKER === '0') {
      console.log('[Docker] Poller wyłączony (AGENTCRAFT_DOCKER=0)');
      return;
    }
    this.running = true;
    if (await this.client.available()) {
      if (!this.running) return;
      console.log('[Docker] Poller started');
    } else {
      if (!this.running) return;
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

  /** Publiczne dla testów — jeden cykl pollingu. Niereentrancyjne: nakladajacy sie
   *  cykl (gdy `exec`-i trwaja dluzej niz interval) jest pomijany, by nie czytac
   *  dwa razy z tego samego offsetu. */
  async poll(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    try {
      await this.pollOnce();
    } finally {
      this.polling = false;
    }
  }

  private async pollOnce(): Promise<void> {
    this.pollCount++;

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
        this.known.set(info.id, { info, present: true, probedAtPoll: 0, sessions: new Map() });
      }
    }

    for (const entry of this.known.values()) {
      if (!entry.present) continue;
      // Sonduj nowe kontenery; „nieagentowe" re-sonduj okresowo (agent mogl wstac
      // pozniej). „unreadable" (brak sh) i „agentic" zostaja zcache'owane na stale.
      const needProbe =
        entry.status === undefined ||
        (entry.status === 'non-agentic' && this.pollCount - entry.probedAtPoll >= this.reprobeEveryPolls);
      if (needProbe) await this.probe(entry);
      if (entry.status === 'agentic') await this.readContainer(entry);
    }

    this.sweep(liveIds);
  }

  /** Sonda: czy kontener ma ~/.claude/projects. Wynik cache'owany w status. */
  private async probe(entry: ContainerEntry): Promise<void> {
    entry.probedAtPoll = this.pollCount;
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
      // Dedup: hostowe źródło Claude już śledzi ten UUID (współdzielony ~/.claude) →
      // host wygrywa (kontenerowy bohater zyje pod kluczem `docker:<id>:<uuid>`,
      // hostowy pod surowym `<uuid>` — wiec getHero(uuid) trafia tylko w hosta).
      if (this.world.getHero(sessionId)) {
        this.removeSession(entry, sessionId);
        continue;
      }
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
      sess = { tracker, key, ended: false };
      entry.sessions.set(sessionId, sess);
      if (size > BIG_FILE_BYTES) this.tails.registerAtEnd(key, size); // pomiń historię dużych plików
    }

    const offset = this.tails.getOffset(key);
    if (size < offset) this.tails.forget(key);
    if (size <= this.tails.getOffset(key)) return; // brak przyrostu

    // Ogranicz odczyt do (size - offset) bajtow — patrz komentarz przy TAIL_ARGV.
    const nextOffset = this.tails.getOffset(key);
    const exec = await this.client.exec(entry.info.id, TAIL_ARGV(nextOffset + 1, file, size - nextOffset), {
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    if (exec.code !== 0) return;

    for (const l of this.tails.feed(key, size, exec.stdout)) {
      for (const fact of interpretLine(l)) sess.tracker.apply(fact);
    }
    sess.ended = false;
  }

  private removeSession(entry: ContainerEntry, sessionId: string): void {
    const sess = entry.sessions.get(sessionId);
    if (!sess) return;
    this.world.removeHero(`docker:${entry.info.id}:${sessionId}`);
    this.tails.forget(sess.key);
    entry.sessions.delete(sessionId);
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
        if (sess.tracker.tick(now) === 'remove') {
          this.tails.forget(sess.key); // nie przeciekaj offsetow usunietych sesji
          entry.sessions.delete(sid);
        }
      }
      if (!liveIds.has(id) && entry.sessions.size === 0) this.known.delete(id);
    }
  }
}
