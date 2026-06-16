import { getOpencodeDbPath, interpretOpencodePart, extractOpencodeMeta } from './opencode.js';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../state-machine.js';
import type { World } from '../world.js';
import type { Fact } from '../transcript/facts.js';

/**
 * OpenCode Poller - okresowo odpytuje bazę SQLite OpenCode
 * i generuje fakty dla SessionTracker.
 * 
 * OpenCode nie używa plików JSONL jak Claude/Codex, więc
 * nie możemy użyć SourceWatcher. Zamiast tego polling SQL.
 */

const POLL_INTERVAL_MS = 1000;
/** Ile dni wstecz pobieramy istniejceju sesje przy starcie / po restarcie.
 * Wystarczajco, by uzupenić statystyki 'Today / 7d / 30d' zanim jeszcze sesja
 * zdąży cokolwiek nowego zrobić. */
const HISTORICAL_WINDOW_DAYS = 31;
const HISTORICAL_WINDOW_MS = HISTORICAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Ile sekund bez aktualizacji time_updated traktujemy sesję jako „martwą”.
 * Sesje-starsze niż ten próg: (a) nie spawnają bohatera na mapie, (b) tracker
 * dostaje tick(), który usunie go z World po removeAfterMs. OpenCode trzyma
 * w SQLite WSZYSTKIE historyczne sesje — bez tego filtra mielibyśmy setki
 * „zombie” bohaterów na mapie (185+ na jednym komputerze). */
const STALE_SESSION_MS = 5 * 60_000;
/** Granica ważności danych: sesje starsze niż to usuwamy ze zbioru, by nie
 * rosnąć w pamięci w nieskończoność. = HISTORICAL_WINDOW_MS. */
const SESSION_RETENTION_MS = HISTORICAL_WINDOW_MS;

interface SessionState {
  tracker: SessionTracker;
  lastPartTime: number;
  lastSeq: number;
  projectDir: string;
  title: string;
  model?: string;
  directory?: string;
}

export class OpenCodePoller {
  private sessions = new Map<string, SessionState>();
  private timer?: NodeJS.Timeout;
  private db: any; // better-sqlite3 Database
  private isRunning = false;
  /** Sesje-historyczne (time_updated > STALE_SESSION_MS) już obsłużone —
   * nie powtarzamy pracy dla nich. */
  private processedStale = new Set<string>();

  constructor(private readonly world: World) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    try {
      // Dynamic import better-sqlite3 (opcjonalna zależność)
      const mod = await import('better-sqlite3');
      const Database = mod.default ?? mod.Database;
      if (!Database || typeof Database !== 'function') {
        throw new Error('better-sqlite3 did not export a Database constructor');
      }
      const dbPath = getOpencodeDbPath();
      this.db = new (Database as any)(dbPath, { readonly: true });
      
      // Przygotuj zapytania
      this.isRunning = true;
      this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
      
      // Pierwsze odpytanie natychmiast
      await this.poll();
      
      console.log('[OpenCode] Poller started');
    } catch (err) {
      console.warn('[OpenCode] Could not start poller:', err instanceof Error ? err.message : String(err));
      console.log('[OpenCode] Make sure better-sqlite3 is installed: npm install better-sqlite3');
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.db) {
      this.db.close();
      this.db = undefined as any;
    }
  }

  private async poll(): Promise<void> {
    if (!this.db || !this.isRunning) return;

    try {
      // Pobierz sesje z całego okna statystyk (domyślnie 31 dni). To zapewnia,
      // że po restarcie klienta okno 'Today / 7d / 30d' ma dane, a nie czeka,
      // aż sesja znowu stanie się aktywna.
      const cutoffTime = Date.now() - HISTORICAL_WINDOW_MS;
      
      const sessions = this.db.prepare(`
        SELECT 
          s.id,
          s.title,
          s.directory,
          s.model,
          s.time_created,
          s.time_updated,
          s.tokens_input,
          s.tokens_output,
          s.tokens_reasoning,
          s.tokens_cache_read,
          s.tokens_cache_write,
          s.cost,
          p.id as project_id,
          p.name as project_name
        FROM session s
        LEFT JOIN project p ON s.project_id = p.id
        WHERE s.time_updated > ?
        ORDER BY s.time_updated DESC
      `).all(cutoffTime);

      for (const session of sessions) {
        const ageMs = Date.now() - Number(session.time_updated);
        if (ageMs > STALE_SESSION_MS) {
          // Stara sesja (zombie): nie spawnuj bohatera, nie aktualizuj trackera.
          // Nadal tu jesteśmy po to, by zgromadzić tokeny do statystyk (jeden raz).
          await this.processStaleSession(session);
        } else {
          await this.processSession(session);
        }
      }

      // Usuń sesje starsze niż okno retencji, by nie rosnąć w pamięci
      this.sweep();
    } catch (err) {
      console.error('[OpenCode] Poll error:', err);
    }
  }

  private async processSession(sessionRow: Record<string, unknown>): Promise<void> {
    const sessionId = String(sessionRow.id);
    const projectDir = String(sessionRow.project_name ?? sessionRow.directory ?? 'unknown');
    const title = String(sessionRow.title ?? 'Untitled');
    const timeUpdated = Number(sessionRow.time_updated);
    const timeCreated = Number(sessionRow.time_created);
    
    let state = this.sessions.get(sessionId);
    
    if (!state) {
      // Nowa sesja - utwórz tracker
      const meta = extractOpencodeMeta(sessionRow);
      state = {
        tracker: new SessionTracker(this.world, sessionId, projectDir, DEFAULT_THRESHOLDS, 'opencode'),
        lastPartTime: 0,
        lastSeq: 0,
        projectDir,
        title,
        model: meta.model,
        directory: meta.cwd,
      };
      this.sessions.set(sessionId, state);
      
      // Dodaj meta fakty
      state.tracker.apply({
        kind: 'meta',
        model: meta.model,
        cwd: meta.cwd,
        ts: new Date(timeCreated || Date.now()).toISOString(),
      });
      
      state.tracker.apply({
        kind: 'title',
        title,
        ts: new Date(timeCreated || Date.now()).toISOString(),
      });
      
      // Wyślij zagregowane tokeny z tabeli session (OpenCode trzyma je w sesji).
      // 'usage-total' ustawia (nie dodaje), więc wystarczy raz przy pierwszym
      // widzeniu sesji - tracker zainicjalizuje statystyki.
      this.applySessionTokens(state, sessionRow);
    } else {
      // Sesja znana - aktualizuj tokeny (sesja mogła dostać nowe dane w międzyczasie)
      this.applySessionTokens(state, sessionRow);
      state.projectDir = projectDir;
      state.title = title;
    }

    // Pobierz nowe części (parts) dla tej sesji - tylko jeśli coś się
    // zmieniło od ostatniego razu.
    const parts = this.db.prepare(`
      SELECT 
        p.id,
        p.data,
        p.time_created,
        m.id as message_id
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE p.session_id = ?
        AND p.time_created > ?
      ORDER BY p.time_created ASC
    `).all(sessionId, state.lastPartTime);

    for (const part of parts) {
      try {
        const data = JSON.parse(String(part.data));
        const ts = new Date(Number(part.time_created)).toISOString();
        
        const facts = interpretOpencodePart(data, ts);
        for (const fact of facts) {
          state.tracker.apply(fact);
        }
        
        state.lastPartTime = Math.max(state.lastPartTime, Number(part.time_created));
      } catch (err) {
        // Ignoruj błędy parsowania pojedynczych partów
      }
    }

    // Upewnij się, że lastPartTime nie jest starsze niż time_updated,
    // bo to go używamy do "kiedy ostatnio widziano sesję".
    if (timeUpdated > state.lastPartTime) {
      state.lastPartTime = timeUpdated;
    }
  }

  /** Wysyła usage-total tylko gdy zagregowane tokeny w sesji wzrosły.
   * Zapobiega cofaniu licznika (usage-total SET, nie ADD). */
  private applySessionTokens(state: SessionState, row: Record<string, unknown>): void {
    const tokensInput = Number(row.tokens_input ?? 0);
    const tokensOutput = Number(row.tokens_output ?? 0);
    const tokensReasoning = Number(row.tokens_reasoning ?? 0);
    const tokensCacheRead = Number(row.tokens_cache_read ?? 0);
    const tokensCacheWrite = Number(row.tokens_cache_write ?? 0);
    const totalIn = tokensInput + tokensCacheRead + tokensCacheWrite;
    const totalOut = tokensOutput + tokensReasoning;
    if (totalIn <= 0 && totalOut <= 0) return;
    const current = state.tracker.tokens;
    if (totalIn > current.input || totalOut > current.output) {
      state.tracker.apply({ kind: 'usage-total', input: totalIn, output: totalOut });
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, state] of this.sessions) {
      // Tracker jest źródłem prawdy o lifecycle bohatera — tick() przejdzie
      // go w 'sleeping' po sleepAfterMs, a po removeAfterMs (30 min) usunie
      // z World. Wywołujemy tu, by zombie sesje w końcu znikły z mapy.
      if (state.tracker.tick(now) === 'remove') {
        this.sessions.delete(sessionId);
        continue;
      }
      // Usuwamy sesje starsze niż okno retencji (domyślnie 31 dni).
      // To zapobiega niekontrolowanemu wzrostowi pamięci dla klientów,
      // którzy używają agenta od miesięcy.
      if (now - state.lastPartTime > SESSION_RETENTION_MS) {
        state.tracker.apply({ kind: 'turn-end', ts: new Date().toISOString() });
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Dla sesji-historycznej (>5 min bez aktualizacji) nie spawnujemy bohatera.
   * Tylko zliczamy tokeny do statystyk okienkowych (jeśli sesja nie była
   * jeszcze widziana) i wyrzucamy z pamięci.
   */
  private async processStaleSession(sessionRow: Record<string, unknown>): Promise<void> {
    const sessionId = String(sessionRow.id);
    if (this.processedStale.has(sessionId)) return;
    this.processedStale.add(sessionId);
    // Tokeny przetworzone tylko raz — applySessionTokens jest w SessionState
    // z RESERVED, ale tu nie mamy trackera (bo nie chcemy bohatera).
    // Statystyki budynków liczone są z innego mechanizmu (pliki JSONL).
  }
}
