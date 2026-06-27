import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptLine } from '@agent-citadel/shared';

const DEFAULT_DB_PATH = join(homedir(), '.age-of-agents', 'transcripts.db');

/**
 * Persists transcript lines to a local SQLite database so they survive
 * server restarts and can be queried for session replay.
 *
 * Uses dynamic import for better-sqlite3 (optional dependency).
 */
export class TranscriptStore {
  private db: any = null; // better-sqlite3 Database
  private insertStmt: any = null;
  private queryStmt: any = null;
  private recentStmt: any = null;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_DB_PATH;
  }

  async open(): Promise<boolean> {
    try {
      const mod = await import('better-sqlite3');
      const Database = mod.default;
      if (!Database || typeof Database !== 'function') {
        throw new Error('better-sqlite3 did not export a Database constructor');
      }

      mkdirSync(dirname(this.dbPath), { recursive: true });
      this.db = new (Database as any)(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcript (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          ts TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript(session_id, id);
      `);
      this.insertStmt = this.db.prepare(
        'INSERT INTO transcript (session_id, role, text, ts) VALUES (?, ?, ?, ?)',
      );
      this.queryStmt = this.db.prepare(
        'SELECT session_id AS sessionId, role, text, ts FROM transcript WHERE session_id = ? ORDER BY id DESC LIMIT ?',
      );
      this.recentStmt = this.db.prepare(
        'SELECT session_id AS sessionId, role, text, ts FROM transcript ORDER BY id DESC LIMIT ?',
      );
      console.log('[transcript-store] Opened', this.dbPath);
      return true;
    } catch (err) {
      console.warn('[transcript-store] Not available:', err instanceof Error ? err.message : String(err));
      console.log('[transcript-store] Install better-sqlite3 for transcript persistence: npm install better-sqlite3');
      return false;
    }
  }

  append(line: TranscriptLine): void {
    this.insertStmt?.run(line.sessionId, line.role, line.text, line.ts);
  }

  /** Query transcript lines for a session (newest first, then reversed to chronological). */
  query(sessionId: string, limit = 500): TranscriptLine[] {
    if (!this.queryStmt) return [];
    return (this.queryStmt.all(sessionId, limit) as TranscriptLine[]).reverse();
  }

  /** Get the most recent transcript lines across all sessions. */
  recent(limit = 50): TranscriptLine[] {
    if (!this.recentStmt) return [];
    return (this.recentStmt.all(limit) as TranscriptLine[]).reverse();
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.insertStmt = null;
    this.queryStmt = null;
    this.recentStmt = null;
  }
}
