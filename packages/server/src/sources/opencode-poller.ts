import { getOpencodeDbPath, interpretOpencodePart, extractOpencodeMeta } from './opencode.js';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../state-machine.js';
import type { World } from '../world.js';
import type { Fact } from '../transcript/facts.js';

/**
 * OpenCode Poller: periodically queries the OpenCode SQLite database.
 * and generates facts for SessionTracker.
 * 
 * OpenCode does not use JSONL files like Claude/Codex, so SourceWatcher cannot
 * be used. Use SQL polling instead.
 */

const POLL_INTERVAL_MS = 1000;
/** How many days back to fetch existing sessions on startup / restart.
 * Enough to fill 'Today / 7d / 30d' stats before the session has time to do
 * anything new. */
const HISTORICAL_WINDOW_DAYS = 31;
const HISTORICAL_WINDOW_MS = HISTORICAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Seconds without time_updated change after which a session is treated as "dead".
 * Sessions older than this threshold: (a) do not spawn a hero on the map,
 * (b) tracker receives tick(), which removes it from World after removeAfterMs.
 * OpenCode keeps ALL historical sessions in SQLite; without this filter there
 * would be hundreds of "zombie" heroes on the map (185+ on one machine). */
const STALE_SESSION_MS = 5 * 60_000;
/** Data validity boundary: remove sessions older than this from the set so
 * memory does not grow forever. = HISTORICAL_WINDOW_MS. */
const SESSION_RETENTION_MS = HISTORICAL_WINDOW_MS;

/** How long to wait before re-checking for a database that does not exist yet
 * (OpenCode not installed, or installed but never run). Doubles up to the cap:
 * the file can appear at any time, so this is recoverable — unlike schema drift. */
const DB_RETRY_INITIAL_MS = 5_000;
const DB_RETRY_MAX_MS = 5 * 60_000;

/** better-sqlite3 cannot open the file — it (or its directory) does not exist.
 * SQLITE_CANTOPEN is what a readonly open of a missing file throws. */
function isDbMissingError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'SQLITE_CANTOPEN' || code === 'ENOENT';
}

function isSchemaMismatchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // Trwały dryf schematu OpenCode: usunięta kolumna („no such column") albo
  // usunięta/przemianowana tabela („no such table" — query robi LEFT JOIN project).
  // To są błędy z SELECT-a; „has no column named" pochodzi tylko z INSERT/UPDATE,
  // a baza jest otwierana readonly, więc tu nieosiągalne.
  return /no such column/i.test(message) || /no such table/i.test(message);
}

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
  private retryTimer?: NodeJS.Timeout;
  private retryDelayMs = DB_RETRY_INITIAL_MS;
  private waitingLogged = false;
  private db: any; // better-sqlite3 Database
  private isRunning = false;
  /** Historical sessions (time_updated > STALE_SESSION_MS) already handled:
   * do not repeat work for them. */
  private processedStale = new Set<string>();

  constructor(private readonly world: World) {}

  async start(): Promise<void> {
    if (this.isRunning || this.retryTimer) return;

    let Database: unknown;
    try {
      // Dynamic import better-sqlite3 (optional dependency).
      const mod = await import('better-sqlite3');
      Database = mod.default; // better-sqlite3 (CJS) exports constructor as default
      if (!Database || typeof Database !== 'function') {
        throw new Error('better-sqlite3 did not export a Database constructor');
      }
    } catch (err) {
      // Missing native module: not recoverable at runtime — one accurate message.
      console.warn('[OpenCode] better-sqlite3 unavailable — OpenCode source disabled:', err instanceof Error ? err.message : String(err));
      console.log('[OpenCode] Install it to enable OpenCode sessions: npm install better-sqlite3');
      return;
    }
    await this.open(Database);
  }

  /** Opens the database and starts polling. A missing file is recoverable
   * (OpenCode may be installed or run later) — re-check with backoff instead
   * of disabling the source or blaming better-sqlite3. */
  private async open(Database: unknown): Promise<void> {
    this.retryTimer = undefined;
    const dbPath = getOpencodeDbPath();
    try {
      this.db = new (Database as any)(dbPath, { readonly: true });
    } catch (err) {
      if (isDbMissingError(err)) {
        if (!this.waitingLogged) {
          console.log(`[OpenCode] Database not found at ${dbPath} — will keep checking in the background`);
          this.waitingLogged = true;
        }
        this.retryTimer = setTimeout(() => void this.open(Database), this.retryDelayMs);
        this.retryTimer.unref?.();
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, DB_RETRY_MAX_MS);
        return;
      }
      console.warn('[OpenCode] Could not open database:', err instanceof Error ? err.message : String(err));
      return;
    }

    this.isRunning = true;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    // Pierwsze odpytanie natychmiast
    await this.poll();

    if (this.isRunning) console.log('[OpenCode] Poller started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.db) {
      this.db.close();
      this.db = undefined as any;
    }
  }

  private async poll(): Promise<void> {
    if (!this.db || !this.isRunning) return;

    try {
      // Fetch sessions from the whole stats window (default 31 days). This
      // ensures that after client restart the 'Today / 7d / 30d' window has data
      // instead of waiting until a session becomes active again.
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
          // Old session (zombie): do not spawn hero, do not update tracker.
          // Still here to collect tokens for stats (once).
          await this.processStaleSession(session);
        } else {
          await this.processSession(session);
        }
      }

      // Remove sessions older than retention window so memory does not grow.
      this.sweep();
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        // Niezgodność schematu (np. nowsza wersja OpenCode usunęła kolumny z `session`)
        // nie naprawi się sama przy kolejnym pollu — zatrzymaj pollera zamiast
        // logować ten sam błąd co sekundę w nieskończoność.
        console.warn('[OpenCode] Poll error, stopping poller:', err instanceof Error ? err.message : String(err));
        await this.stop();
        return;
      }
      // Nieoczekiwany/przejściowy błąd: zachowaj pełny obiekt (stack) — to klasa
      // błędów, gdzie ślad jest najcenniejszy. Spam ogranicza tylko gałąź schema-stop.
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
      // New session: create tracker.
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
      
      // Send aggregated tokens from session table (OpenCode stores them on session).
      // 'usage-total' sets (does not add), so once at first session sighting
      // is enough for the tracker to initialize stats.
      this.applySessionTokens(state, sessionRow);
    } else {
      // Known session: update tokens (session may have received new data meanwhile).
      this.applySessionTokens(state, sessionRow);
      state.projectDir = projectDir;
      state.title = title;
    }

    // Fetch new parts for this session only if something changed since last time.
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
        // Ignore parsing errors for individual parts.
      }
    }

    // Ensure lastPartTime is not older than time_updated, because we use it for
    // "when the session was last seen".
    if (timeUpdated > state.lastPartTime) {
      state.lastPartTime = timeUpdated;
    }
  }

  /** Sends usage-total only when aggregated session tokens increased.
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
      // Tracker is the source of truth for hero lifecycle: tick() will transition
      // go w 'sleeping' po sleepAfterMs, a po removeAfterMs (30 min) usunie
      // from World. Call it here so zombie sessions eventually disappear from the map.
      if (state.tracker.tick(now) === 'remove') {
        this.sessions.delete(sessionId);
        continue;
      }
      // Remove sessions older than retention window (default 31 days). This
      // prevents uncontrolled memory growth for clients using the agent for months.
      if (now - state.lastPartTime > SESSION_RETENTION_MS) {
        state.tracker.apply({ kind: 'turn-end', ts: new Date().toISOString() });
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * For historical session (>5 min without update), do not spawn a hero.
   * Only count tokens for windowed stats (if session has not been seen yet) and
   * drop from memory.
   */
  private async processStaleSession(sessionRow: Record<string, unknown>): Promise<void> {
    const sessionId = String(sessionRow.id);
    if (this.processedStale.has(sessionId)) return;
    this.processedStale.add(sessionId);
    // Tokens processed only once: applySessionTokens is in SessionState.
    // from RESERVED, but there is no tracker here because we do not want a hero.
    // Building stats are computed by another mechanism (JSONL files).
  }
}
