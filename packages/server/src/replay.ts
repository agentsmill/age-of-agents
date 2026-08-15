import { readFile, readdir, stat } from 'node:fs/promises';
import { sep } from 'node:path';
import type { GameEvent, ReplayFrame, ReplayTimeline } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import { DEFAULT_THRESHOLDS, SessionTracker } from './state-machine.js';
import { SOURCES } from './sources/index.js';
import type { AgentSource } from './sources/types.js';
import { World } from './world.js';

/**
 * Chronicle (#7): replay dnia jako time-lapse.
 *
 * Re-czyta transkrypty JSONL z dysku i przepuszcza fakty historyczne przez TEN
 * SAM potok Fakt → World co serwer na żywo (SessionTracker → World.onEvent).
 * Dzięki temu odtworzone GameEventy są identyczne w kształcie z żywymi — klient
 * reużywa całej ścieżki renderu. Operacja jest READ-ONLY: tylko czyta pliki już
 * obecne na dysku, buduje świeży, izolowany World (nigdy nie dotyka żywego) i
 * nie startuje żadnych watcherów ani serwerów.
 *
 * Ograniczenia v1:
 *  - subagenci (peony) pominięci — odtwarzamy tylko sesje-bohaterów,
 *  - przejścia czasowe (idle/sleep/remove z tick()) NIE są odtwarzane; klatki
 *    są wyłącznie sterowane faktami,
 *  - liczba klatek ograniczona do FRAME_CAP, by uniknąć patologicznej pamięci.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Górny limit klatek (ochrona pamięci przy bardzo gęstych oknach). */
const FRAME_CAP = 20_000;

export type ReplayWindow = 'today' | 'week';

/** Jeden fakt wraz z kontekstem potrzebnym do globalnego porządkowania i routingu. */
interface TimedFact {
  tMs: number;
  sessionId: string;
  source: AgentSource;
  projectDir: string;
  fact: Fact;
}

/** Początek okna: 'today' = lokalna północ `now`; 'week' = now - 7 dni. */
function windowStart(window: ReplayWindow, now: number): number {
  if (window === 'week') return now - WEEK;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Wyciąga znacznik czasu (ms epoch) z faktu, jeśli go niesie. Fakty bez `ts`
 * (`usage`, `usage-total`, `title` bez ts, `attribution`) zwracają undefined —
 * dziedziczą wtedy ostatni widziany ts z tego samego pliku (patrz parseFile).
 */
function factTs(fact: Fact): number | undefined {
  const raw = 'ts' in fact ? fact.ts : undefined;
  if (typeof raw !== 'string') return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Korzeń źródła, do którego należy ścieżka (lub undefined). */
function rootFor(roots: string[], path: string): string | undefined {
  return roots.find((r) => path === r || path.startsWith(r + sep));
}

/**
 * Parsuje jeden plik sesji do uporządkowanych TimedFact-ów. Każdemu faktowi bez
 * własnego `ts` nadajemy ostatni widziany ts z tego pliku, by miał klucz
 * sortowania. Fakty przed `start` są odfiltrowane.
 */
async function parseFile(
  path: string,
  source: AgentSource,
  sessionId: string,
  projectDir: string,
  start: number,
): Promise<TimedFact[]> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return []; // nieczytelny plik — pomiń (read-only, odporność)
  }

  const out: TimedFact[] = [];
  let lastTs = 0;
  for (const line of content.split('\n')) {
    if (!line) continue;
    let facts: Fact[];
    try {
      facts = source.parseLine(line);
    } catch {
      continue; // wadliwa linia — pomiń
    }
    for (const fact of facts) {
      const own = factTs(fact);
      if (own !== undefined) lastTs = own;
      const tMs = own ?? lastTs;
      if (tMs < start) continue;
      out.push({ tMs, sessionId, source, projectDir, fact });
    }
  }
  return out;
}

/** Zbiera wszystkie TimedFact-y z plików sesji w oknie, ze wszystkich źródeł. */
async function collectFacts(start: number, now: number): Promise<TimedFact[]> {
  const all: TimedFact[] = [];

  for (const source of SOURCES) {
    const roots = source.roots();
    for (const root of roots) {
      let entries: string[];
      try {
        entries = await readdir(root, { recursive: true });
      } catch {
        continue; // korzeń nie istnieje / brak dostępu
      }

      for (const rel of entries) {
        if (!rel.endsWith('.jsonl')) continue;
        const path = root + sep + rel;
        let mtimeMs: number;
        try {
          const s = await stat(path);
          mtimeMs = s.mtimeMs;
        } catch {
          continue;
        }
        // Plik bez zapisu w oknie nie zawiera istotnych faktów.
        if (mtimeMs < start || mtimeMs > now + DAY) continue;

        const fileRoot = rootFor(roots, path) ?? root;
        const target = source.classify(path, fileRoot);
        if (target.kind !== 'session' || !target.sessionId) continue; // peony pominięte (v1)

        const facts = await parseFile(path, source, target.sessionId, target.projectDir ?? '', start);
        for (const f of facts) all.push(f);
      }
    }
  }

  return all;
}

/**
 * Buduje chronologiczną oś czasu replayu dla danego okna, przepuszczając każdy
 * pasujący transkrypt przez świeży, izolowany World. Domyślny korzeń = korzenie
 * wszystkich SOURCES.
 */
export async function computeReplayTimeline(
  window: ReplayWindow,
  now: number = Date.now(),
): Promise<ReplayTimeline> {
  const start = windowStart(window, now);
  const facts = await collectFacts(start, now);

  // Globalny porządek czasowy. Stabilny tie-break po sessionId, by fakty tej
  // samej chwili z różnych sesji nie przeplatały się niedeterministycznie.
  facts.sort((a, b) => a.tMs - b.tMs || a.sessionId.localeCompare(b.sessionId));

  const world = new World();
  const frames: ReplayFrame[] = [];
  let currentTs = start;
  let capped = false;

  const unsubscribe = world.onEvent((event: GameEvent) => {
    if (frames.length >= FRAME_CAP) {
      capped = true;
      return;
    }
    frames.push({ tMs: currentTs, event });
  });

  // Jeden tracker na sesję, tworzony leniwie — jak w watcherze. agent = source.id.
  const trackers = new Map<string, SessionTracker>();

  try {
    for (const tf of facts) {
      if (capped) break;
      currentTs = tf.tMs; // każdy emitowany event dostaje ts aktualnie aplikowanego faktu
      let tracker = trackers.get(tf.sessionId);
      if (!tracker) {
        tracker = new SessionTracker(world, tf.sessionId, tf.projectDir, DEFAULT_THRESHOLDS, tf.source.id);
        trackers.set(tf.sessionId, tracker);
      }
      tracker.apply(tf.fact);
    }
  } finally {
    unsubscribe();
  }

  // Klatki są już rosnące po tMs (fakty były posortowane), ale gwarantujemy to.
  frames.sort((a, b) => a.tMs - b.tMs);

  const startMs = frames.length ? frames[0].tMs : start;
  const endMs = frames.length ? frames[frames.length - 1].tMs : now;
  return { startMs, endMs, frames };
}
