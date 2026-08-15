import { watch, type FSWatcher } from 'chokidar';
import { open } from 'node:fs/promises';
import { sep } from 'node:path';
import type { PeonSnapshot } from '@agent-citadel/shared';
import { TailRegistry } from './transcript/tail.js';
import { DEFAULT_THRESHOLDS, SessionTracker, type StateThresholds } from './state-machine.js';
import { recordSessionSummary } from './session-log.js';
import type { AgentSource, ClassifiedFile } from './sources/types.js';
import type { World } from './world.js';

/**
 * Whether a session is "live" at server startup. Window = removeAfterMs (from
 * thresholds): create a hero only for a session whose state machine would not
 * immediately remove it. Sessions in progress but briefly quiet (waiting for
 * input, author stepped away) appear immediately, while old ones do not flicker
 * (created only to vanish on first sweep). Earlier fixed 10 min lost sessions
 * that briefly wrote nothing to the transcript.
 */
export function isLiveAtStartup(mtimeMs: number, nowMs: number, windowMs: number): boolean {
  return mtimeMs > nowMs - windowMs;
}
/** Tail larger files from the end instead of replaying full history. */
const REPLAY_MAX_BYTES = 2 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 15_000;
const META_SCAN_BYTES = 64 * 1024;

interface PeonEntry {
  peon: PeonSnapshot;
  lastWriteMs: number;
}

interface SubagentTarget {
  agentId: string;
  parentSessionId: string;
  description?: string;
}

/**
 * Watches roots of one source (Claude/Codex): main session transcripts (heroes)
 * and, if the source recognizes them, subagents (peons). All location/format
 * knowledge comes from AgentSource.
 */
export class SourceWatcher {
  private tails = new TailRegistry();
  private trackers = new Map<string, SessionTracker>();
  private peons = new Map<string, PeonEntry>();
  private subagentFiles = new Map<string, SubagentTarget>();
  private watcher?: FSWatcher;
  private sweepTimer?: NodeJS.Timeout;
  private queue = Promise.resolve();
  private roots: string[];

  constructor(
    private readonly world: World,
    private readonly source: AgentSource,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.roots = source.roots();
  }

  get id() {
    return this.source.id;
  }

  start(): void {
    this.refreshRoots();
    if (this.roots.length === 0) {
      console.error('[watcher]', this.source.id, 'no roots configured; source disabled');
      return;
    }
    this.watcher = watch(this.roots, {
      depth: this.source.depth ?? 6,
      ignoreInitial: false,
      alwaysStat: true,
      usePolling: true,
      interval: 1_000,
      // Ignore only CONFIRMED non-.jsonl files (without stats we must not:
      // would cut off tree traversal).
      ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.jsonl'),
    });
    const enqueue = (path: string, stats?: { mtimeMs?: number; size?: number }, initial = false) => {
      this.queue = this.queue
        .then(() => this.handleFile(path, stats, initial))
        .catch((err) => console.error('[watcher]', this.source.id, path, err));
    };
    this.watcher.on('add', (path, stats) => enqueue(path, stats, true));
    this.watcher.on('change', (path, stats) => enqueue(path, stats, false));
    this.watcher.on('error', (err) => console.error('[watcher]', this.source.id, err));
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.sweepTimer);
    await this.watcher?.close();
  }

  /** Fast channel: facts from HTTP hooks go to the same state machine. */
  applyExternalFacts(sessionId: string, projectDir: string, facts: import('./transcript/facts.js').Fact[], cwd?: string): void {
    let tracker = this.trackers.get(sessionId);
    const isNewTracker = !tracker;
    if (!tracker) {
      tracker = new SessionTracker(this.world, sessionId, projectDir, this.thresholds, this.source.id, {}, recordSessionSummary);
      this.trackers.set(sessionId, tracker);
    }
    for (const fact of facts) {
      // Claude /clear starts a replacement session_id. Route the strike to the
      // visible old hero in the same cwd when that link is available.
      if (fact.kind === 'cleared' && isNewTracker && cwd) {
        (this.mostRecentTrackerByCwd(cwd, sessionId) ?? tracker).apply(fact);
        continue;
      }
      tracker.apply(fact);
    }
  }

  private mostRecentTrackerByCwd(cwd: string, excludeSessionId: string): SessionTracker | undefined {
    let best: { tracker: SessionTracker; atMs: number } | undefined;
    for (const [id, tracker] of this.trackers) {
      if (id === excludeSessionId) continue;
      const hero = this.world.getHero(id);
      if (!hero || hero.workingDir !== cwd) continue;
      const atMs = Date.parse(hero.lastActivityAt);
      if (!best || atMs > best.atMs) best = { tracker, atMs };
    }
    return best?.tracker;
  }

  private rootFor(path: string): string | undefined {
    return this.roots.find((r) => path === r || path.startsWith(r + sep));
  }

  private refreshRoots(): void {
    const nextRoots = Array.from(new Set(this.source.roots()));
    const currentRoots = new Set(this.roots);
    const newRoots = nextRoots.filter((root) => !currentRoots.has(root));
    if (newRoots.length === 0) return;
    this.roots = [...this.roots, ...newRoots];
    this.watcher?.add(newRoots);
  }

  private classify(path: string): ClassifiedFile {
    const root = this.rootFor(path);
    if (!root) return { kind: 'other' };
    return this.source.classify(path, root);
  }

  private async handleFile(
    path: string,
    stats: { mtimeMs?: number; size?: number } | undefined,
    initial: boolean,
  ): Promise<void> {
    if (!path.endsWith('.jsonl')) return;
    const target = this.classify(path);
    if (target.kind === 'other') return;

    if (!this.tails.has(path)) {
      const fresh = !initial || isLiveAtStartup(stats?.mtimeMs ?? 0, Date.now(), this.thresholds.removeAfterMs);
      if (!fresh) return; // old session: wakes up on a 'change' event
      if ((stats?.size ?? 0) > REPLAY_MAX_BYTES) {
        if (target.kind === 'session') await this.scanSessionMetadata(path);
        await this.tails.registerAtEnd(path);
      }
    }

    const lines = await this.tails.readNewLines(path);
    if (lines.length === 0) return;

    if (target.kind === 'session') {
      const knownSubagent = this.subagentFiles.get(path);
      if (knownSubagent) {
        this.applyPeonLines(knownSubagent.agentId, knownSubagent.parentSessionId, lines, knownSubagent.description);
        return;
      }

      const sessionId = target.sessionId!;
      const parsed = lines.flatMap((line) => this.source.parseLine(line));
      const subagentMeta = parsed.find((fact): fact is import('./transcript/facts.js').Fact & { kind: 'subagent-meta' } => fact.kind === 'subagent-meta');
      if (subagentMeta) {
        const subagent = {
          agentId: subagentMeta.agentId,
          parentSessionId: subagentMeta.parentSessionId,
          description: subagentMeta.description,
        };
        this.subagentFiles.set(path, subagent);
        this.applyPeonFacts(subagent.agentId, subagent.parentSessionId, parsed, subagent.description);
        return;
      }

      let tracker = this.trackers.get(sessionId);
      if (!tracker) {
        tracker = new SessionTracker(this.world, sessionId, target.projectDir ?? '', this.thresholds, this.source.id, {}, recordSessionSummary);
        this.trackers.set(sessionId, tracker);
      }
      for (const fact of parsed) tracker.apply(fact);
    } else {
      this.applyPeonLines(target.agentId!, target.parentSessionId!, lines);
    }
  }

  private applyPeonLines(agentId: string, parentSessionId: string, lines: string[], description?: string): void {
    this.applyPeonFacts(agentId, parentSessionId, lines.flatMap((line) => this.source.parseLine(line)), description);
  }

  private async scanSessionMetadata(path: string): Promise<void> {
    const lines = await readInitialLines(path, META_SCAN_BYTES);
    const subagentMeta = lines
      .flatMap((line) => this.source.parseLine(line))
      .find((fact): fact is import('./transcript/facts.js').Fact & { kind: 'subagent-meta' } => fact.kind === 'subagent-meta');
    if (!subagentMeta) return;
    this.subagentFiles.set(path, {
      agentId: subagentMeta.agentId,
      parentSessionId: subagentMeta.parentSessionId,
      description: subagentMeta.description,
    });
  }

  private applyPeonFacts(
    agentId: string,
    parentSessionId: string,
    facts: import('./transcript/facts.js').Fact[],
    description?: string,
  ): void {
    let entry = this.peons.get(agentId);
    if (!entry) {
      entry = {
        peon: { agentId, parentSessionId, state: 'working', description },
        lastWriteMs: Date.now(),
      };
      this.peons.set(agentId, entry);
    } else if (description && !entry.peon.description) {
      entry.peon = { ...entry.peon, description };
    }
    entry.lastWriteMs = Date.now();

    for (const fact of facts) {
      if (fact.kind === 'tool-start') {
        entry.peon = { ...entry.peon, state: 'working', currentTool: fact.tool, description: entry.peon.description ?? fact.detail };
      } else if (fact.kind === 'thinking') {
        entry.peon = { ...entry.peon, state: 'thinking', currentTool: undefined };
      } else if (fact.kind === 'prompt' && !entry.peon.description) {
        entry.peon = { ...entry.peon, description: fact.text.slice(0, 80) };
      }
    }
    this.world.upsertPeon(entry.peon);
  }

  private sweep(): void {
    this.refreshRoots();
    const now = Date.now();
    for (const [sessionId, tracker] of this.trackers) {
      if (tracker.tick(now) === 'remove') this.trackers.delete(sessionId);
    }
    for (const [agentId, entry] of this.peons) {
      if (now - entry.lastWriteMs > this.thresholds.peonDoneAfterMs) {
        this.world.completePeon(agentId);
        this.peons.delete(agentId);
      }
    }
  }
}

async function readInitialLines(path: string, maxBytes: number): Promise<string[]> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return text
      .split('\n')
      .slice(0, -1)
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  } finally {
    await file.close();
  }
}
