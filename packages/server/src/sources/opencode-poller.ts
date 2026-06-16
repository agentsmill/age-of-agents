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
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minut bez aktywności = sesja nieaktywna

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
      // Pobierz aktywne sesje (z aktywnością w ostatnich 10 minutach)
      const cutoffTime = Date.now() - SESSION_TIMEOUT_MS;
      
      const sessions = this.db.prepare(`
        SELECT 
          s.id,
          s.title,
          s.directory,
          s.model,
          s.time_updated,
          p.id as project_id,
          p.name as project_name
        FROM session s
        LEFT JOIN project p ON s.project_id = p.id
        WHERE s.time_updated > ?
        ORDER BY s.time_updated DESC
      `).all(cutoffTime);

      for (const session of sessions) {
        await this.processSession(session);
      }

      // Usuń nieaktywne sesje
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
        ts: new Date().toISOString(),
      });
      
      state.tracker.apply({
        kind: 'title',
        title,
        ts: new Date().toISOString(),
      });
    }

    // Pobierz nowe części (parts) dla tej sesji
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

    // Aktualizuj stan
    state.projectDir = projectDir;
    state.title = title;
    state.lastPartTime = timeUpdated;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, state] of this.sessions) {
      if (now - state.lastPartTime > DEFAULT_THRESHOLDS.removeAfterMs) {
        // Sesja nieaktywna - usuń
        state.tracker.apply({ kind: 'turn-end', ts: new Date().toISOString() });
        this.sessions.delete(sessionId);
      }
    }
  }
}
