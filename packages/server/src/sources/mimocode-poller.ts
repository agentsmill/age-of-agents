import { SessionTracker, DEFAULT_THRESHOLDS } from '../state-machine.js';
import type { World } from '../world.js';
import { getMimoCodeDbPath } from './mimocode.js';
import { interpretOpencodePart, extractOpencodeMeta } from './opencode.js';

/**
 * MiMo Code Poller: periodically queries the MiMo Code SQLite database.
 *
 * MiMo Code is a fork of OpenCode with the same schema (session, message, part).
 * Key difference: the session table does NOT have model or tokens_* columns.
 * Model info is in message.data.model; tokens are extracted from part data.
 *
 * Based on OpenCodePoller with adaptations for the schema differences.
 */

const POLL_INTERVAL_MS = 1000;
const HISTORICAL_WINDOW_DAYS = 31;
const HISTORICAL_WINDOW_MS = HISTORICAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const STALE_SESSION_MS = 5 * 60_000;
const SESSION_RETENTION_MS = HISTORICAL_WINDOW_MS;

function isSchemaMismatchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such column/i.test(message) || /no such table/i.test(message);
}

interface SessionState {
  tracker: SessionTracker;
  lastPartTime: number;
  projectDir: string;
  title: string;
  model?: string;
  directory?: string;
}

export class MimoCodePoller {
  private sessions = new Map<string, SessionState>();
  private timer?: NodeJS.Timeout;
  private db: any; // better-sqlite3 Database
  private isRunning = false;
  private processedStale = new Set<string>();

  constructor(private readonly world: World) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      const mod = await import('better-sqlite3');
      const Database = mod.default;
      if (!Database || typeof Database !== 'function') {
        throw new Error('better-sqlite3 did not export a Database constructor');
      }
      const dbPath = getMimoCodeDbPath();
      this.db = new (Database as any)(dbPath, { readonly: true });

      this.isRunning = true;
      this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
      await this.poll();

      if (this.isRunning) console.log('[MiMo Code] Poller started');
    } catch (err) {
      console.warn('[MiMo Code] Could not start poller:', err instanceof Error ? err.message : String(err));
      console.log('[MiMo Code] Make sure better-sqlite3 is installed: npm install better-sqlite3');
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
      const cutoffTime = Date.now() - HISTORICAL_WINDOW_MS;

      // MiMo Code session table: no model or tokens_* columns.
      const sessions = this.db.prepare(`
        SELECT
          s.id,
          s.title,
          s.directory,
          s.time_created,
          s.time_updated,
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
          await this.processStaleSession(session);
        } else {
          await this.processSession(session);
        }
      }

      this.sweep();
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        console.warn('[MiMo Code] Poll error, stopping poller:', err instanceof Error ? err.message : String(err));
        await this.stop();
        return;
      }
      console.error('[MiMo Code] Poll error:', err);
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
      // Extract model from message.data.model (MiMo Code stores it there).
      const model = this.extractModelFromMessages(sessionId);

      state = {
        tracker: new SessionTracker(this.world, sessionId, projectDir, DEFAULT_THRESHOLDS, 'mimocode'),
        lastPartTime: 0,
        projectDir,
        title,
        model,
        directory: String(sessionRow.directory ?? ''),
      };
      this.sessions.set(sessionId, state);

      state.tracker.apply({
        kind: 'meta',
        model: state.model,
        cwd: state.directory,
        ts: new Date(timeCreated || Date.now()).toISOString(),
      });

      state.tracker.apply({
        kind: 'title',
        title,
        ts: new Date(timeCreated || Date.now()).toISOString(),
      });
    } else {
      state.projectDir = projectDir;
      state.title = title;
    }

    // Fetch new parts for this session.
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

        // Extract token usage from part data if available.
        this.extractTokensFromPart(data, state);

        state.lastPartTime = Math.max(state.lastPartTime, Number(part.time_created));
      } catch {
        // Ignore parsing errors for individual parts.
      }
    }

    if (timeUpdated > state.lastPartTime) {
      state.lastPartTime = timeUpdated;
    }
  }

  /** Extract model info from the first message in a session. */
  private extractModelFromMessages(sessionId: string): string | undefined {
    try {
      const row = this.db.prepare(`
        SELECT data FROM message
        WHERE session_id = ?
        ORDER BY time_created ASC
        LIMIT 1
      `).get(sessionId);
      if (row?.data) {
        const msg = JSON.parse(String(row.data));
        const modelObj = msg.model;
        if (modelObj && typeof modelObj === 'object') {
          return modelObj.modelID && modelObj.modelID !== 'unknown'
            ? `${modelObj.providerID}/${modelObj.modelID}`
            : modelObj.providerID;
        }
      }
    } catch {
      // Ignore.
    }
    return undefined;
  }

  /** Extract token usage from part data if it contains usage info. */
  private extractTokensFromPart(data: Record<string, unknown>, state: SessionState): void {
    // MiMo Code may embed token counts in part data under various keys.
    // Check for usage-like fields in the part state.
    const partState = data.state as Record<string, unknown> | undefined;
    if (partState) {
      const usage = partState.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage === 'object') {
        const input = Number(usage.input_tokens ?? usage.input ?? 0);
        const output = Number(usage.output_tokens ?? usage.output ?? 0);
        if (input > 0 || output > 0) {
          state.tracker.apply({ kind: 'usage-total', input, output });
        }
      }
    }
  }

  private async processStaleSession(sessionRow: Record<string, unknown>): Promise<void> {
    const sessionId = String(sessionRow.id);
    if (this.processedStale.has(sessionId)) return;
    this.processedStale.add(sessionId);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, state] of this.sessions) {
      if (state.tracker.tick(now) === 'remove') {
        this.sessions.delete(sessionId);
        continue;
      }
      if (now - state.lastPartTime > SESSION_RETENTION_MS) {
        state.tracker.apply({ kind: 'turn-end', ts: new Date().toISOString() });
        this.sessions.delete(sessionId);
      }
    }
  }
}
