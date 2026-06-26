import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { SessionTracker, DEFAULT_THRESHOLDS } from '../state-machine.js';
import type { World } from '../world.js';
import { getAuggieSessionsDir, parseAuggieSession } from './auggie.js';

/**
 * Auggie Poller: watches ~/.augment/sessions/*.json for changes.
 *
 * Auggie stores each session as a single JSON file (not JSONL), so the standard
 * SourceWatcher + parseLine pattern does not apply. This poller watches the
 * sessions directory, parses full JSON files on change, and feeds facts into
 * SessionTracker.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const STALE_SESSION_MS = 30 * 60_000; // 30 minutes
const POLL_INTERVAL_MS = 5_000; // Check for stale sessions every 5s.

interface SessionEntry {
  tracker: SessionTracker;
  lastModified: number;
  processedSeqs: Set<number>;
}

export class AuggiePoller {
  private sessions = new Map<string, SessionEntry>();
  private watcher?: FSWatcher;
  private sweepTimer?: NodeJS.Timeout;
  private queue = Promise.resolve();
  private isRunning = false;

  constructor(private readonly world: World) {}

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const root = getAuggieSessionsDir();
    try {
      this.watcher = watch(root, {
        depth: 0,
        ignoreInitial: false,
        alwaysStat: true,
        usePolling: true,
        interval: 2_000,
        ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.json'),
      });

      const enqueue = (path: string, stats?: { mtimeMs?: number }) => {
        this.queue = this.queue
          .then(() => this.handleFile(path, stats))
          .catch((err) => console.error('[Auggie] Error processing', path, err));
      };

      this.watcher.on('add', (path, stats) => enqueue(path, stats));
      this.watcher.on('change', (path, stats) => enqueue(path, stats));
      this.watcher.on('error', (err) => console.error('[Auggie] Watcher error:', err));

      this.sweepTimer = setInterval(() => this.sweep(), POLL_INTERVAL_MS);
      console.log('[Auggie] Poller started, watching', root);
    } catch (err) {
      console.warn('[Auggie] Could not start poller:', err instanceof Error ? err.message : String(err));
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    clearInterval(this.sweepTimer);
    await this.watcher?.close();
  }

  private async handleFile(path: string, stats?: { mtimeMs?: number }): Promise<void> {
    if (!path.endsWith('.json')) return;

    const filename = basename(path, '.json');
    const uuidMatch = filename.match(UUID_RE);
    if (!uuidMatch) return;

    const sessionId = uuidMatch[0];
    const mtimeMs = stats?.mtimeMs ?? Date.now();

    try {
      const raw = await readFile(path, 'utf-8');
      const session = JSON.parse(raw) as Record<string, unknown>;

      let entry = this.sessions.get(sessionId);
      if (!entry) {
        const modified = typeof session.modified === 'string'
          ? Date.parse(session.modified)
          : mtimeMs;

        // Skip stale sessions on first sight.
        if (Date.now() - modified > STALE_SESSION_MS) return;

        entry = {
          tracker: new SessionTracker(this.world, sessionId, '', DEFAULT_THRESHOLDS, 'auggie'),
          lastModified: modified,
          processedSeqs: new Set(),
        };
        this.sessions.set(sessionId, entry);

        // Emit title from session if available.
        entry.tracker.apply({
          kind: 'title',
          title: `Auggie session ${sessionId.slice(0, 8)}`,
          ts: new Date(modified).toISOString(),
        });
      }

      // Parse new chat history entries.
      const { facts, newSeqs } = parseAuggieSession(session, entry.processedSeqs);
      for (const seq of newSeqs) entry.processedSeqs.add(seq);
      for (const fact of facts) entry.tracker.apply(fact);

      // Extract token usage from top-level fields.
      const credits = session.subAgentCreditsUsed;
      if (typeof credits === 'number' && credits > 0) {
        entry.tracker.apply({
          kind: 'usage-total',
          input: Math.round(credits * 0.7), // Approximate split.
          output: Math.round(credits * 0.3),
        });
      }

      entry.lastModified = mtimeMs;
    } catch (err) {
      // JSON parse errors on large files are expected during writes.
      if (err instanceof SyntaxError) return;
      console.error('[Auggie] Error parsing', path, err);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastModified > STALE_SESSION_MS) {
        entry.tracker.apply({ kind: 'turn-end', ts: new Date().toISOString() });
        if (entry.tracker.tick(now) === 'remove') {
          this.sessions.delete(sessionId);
        }
      } else {
        entry.tracker.tick(now);
      }
    }
  }
}
