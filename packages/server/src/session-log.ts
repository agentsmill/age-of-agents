import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SessionSummary } from '@agent-citadel/shared';

/**
 * Trwały dziennik „sekcji zwłok" sesji (#4 Session Autopsy).
 *
 * Jedyny zapis Age of Agents na dysk usera POZA configami — i tylko do WŁASNEGO
 * katalogu ~/.age-of-agents/, nigdy do transkryptów (zgodność z polityką
 * read-only wobec danych sesji). Append-only z limitem, deduplikacja po
 * sessionId (re-usunięcie obudzonej sesji nadpisuje, nie duplikuje).
 */

const DEFAULT_PATH = join(homedir(), '.age-of-agents', 'session-log.json');
/** Limit wpisów — log to wygodny rejestr ostatnich sesji, nie archiwum bez dna. */
const MAX_ENTRIES = 500;

/** Serializacja zapisów: read-modify-write nie może się przeplatać między sesjami. */
let queue: Promise<void> = Promise.resolve();

export async function readSessionLog(path = DEFAULT_PATH): Promise<SessionSummary[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionSummary[]) : [];
  } catch {
    return []; // brak pliku / uszkodzony → pusty dziennik
  }
}

/**
 * Dopisz podsumowanie (dedup po sessionId, najnowsze na górze, przytnij do limitu).
 * Nigdy nie rzuca — wołane ze sweepa maszyny stanów, jego awaria nie może ubić pętli.
 */
export function recordSessionSummary(summary: SessionSummary, path = DEFAULT_PATH): Promise<void> {
  queue = queue
    .then(async () => {
      const log = await readSessionLog(path);
      const deduped = log.filter((s) => s.sessionId !== summary.sessionId);
      const next = [summary, ...deduped].slice(0, MAX_ENTRIES);
      await mkdir(dirname(path), { recursive: true });
      // Zapis atomowy: tmp + rename, by równoległy odczyt nigdy nie złapał połówki.
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await rename(tmp, path);
    })
    .catch((err) => {
      console.error('[session-log] zapis nieudany — pomijam:', err);
    });
  return queue;
}
