import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PeonSnapshot,
  ProjectArsenal,
  TranscriptLine,
  WorldSnapshot,
} from '@agent-citadel/shared';

type Listener = (event: GameEvent) => void;
const TRANSCRIPT_BUFFER = 200;

/**
 * In-memory world state. The only server-side source of truth: watcher, hooks,
 * and demo generator all mutate the world through these methods, and every
 * mutation emits an event to connected clients.
 */
export class World {
  private heroes = new Map<string, HeroSnapshot>();
  private peons = new Map<string, PeonSnapshot>();
  private missions = new Map<string, MissionSnapshot>();
  private transcripts = new Map<string, TranscriptLine[]>();
  private arsenals = new Map<string, ProjectArsenal>();
  private listeners = new Set<Listener>();
  private nextTeamColor = 0;
  /** Optional transcript persistence (set by server when better-sqlite3 is available). */
  transcriptStore?: { append(line: TranscriptLine): void };

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    // A listener (for example WS broadcast on a broken socket) must not kill the
    // mutation or, through sweep/connection, the whole process. Isolate each one.
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[world] listener error for event', event.type, err);
      }
    }
  }

  snapshot(): WorldSnapshot {
    return {
      heroes: [...this.heroes.values()],
      peons: [...this.peons.values()],
      missions: [...this.missions.values()],
      transcripts: [...this.transcripts.values()].flatMap((lines) => lines),
      arsenals: [...this.arsenals.values()],
    };
  }

  setArsenal(arsenal: ProjectArsenal): void {
    this.arsenals.set(arsenal.projectDir, arsenal);
    this.emit({ type: 'arsenal-updated', arsenal });
  }

  /** Returns unique active project directories (currently working sessions).
   * Used by ArsenalPoller to detect which directories should have arsenal config read. */
  activeProjectDirs(): string[] {
    const dirs = new Set<string>();
    for (const hero of this.heroes.values()) {
      if (hero.projectDir) dirs.add(hero.projectDir);
    }
    return [...dirs];
  }

  /** Returns a snapshot of sessions belonging to a project. */
  heroesByProject(projectDir: string): HeroSnapshot[] {
    return [...this.heroes.values()].filter((h) => h.projectDir === projectDir);
  }

  claimTeamColor(): number {
    return this.nextTeamColor++;
  }

  upsertHero(hero: HeroSnapshot): void {
    const isNew = !this.heroes.has(hero.sessionId);
    this.heroes.set(hero.sessionId, hero);
    this.emit(isNew ? { type: 'hero-spawned', hero } : { type: 'hero-updated', hero });
  }

  getHero(sessionId: string): HeroSnapshot | undefined {
    return this.heroes.get(sessionId);
  }

  removeHero(sessionId: string): void {
    if (!this.heroes.delete(sessionId)) return;
    for (const peon of [...this.peons.values()]) {
      if (peon.parentSessionId === sessionId) this.peons.delete(peon.agentId);
    }
    this.emit({ type: 'hero-removed', sessionId });
  }

  upsertPeon(peon: PeonSnapshot): void {
    const isNew = !this.peons.has(peon.agentId);
    this.peons.set(peon.agentId, peon);
    this.emit(isNew ? { type: 'peon-spawned', peon } : { type: 'peon-updated', peon });
  }

  completePeon(agentId: string): void {
    if (!this.peons.delete(agentId)) return;
    this.emit({ type: 'peon-completed', agentId });
  }

  startMission(mission: MissionSnapshot): void {
    this.missions.set(mission.id, mission);
    this.emit({ type: 'mission-started', mission });
  }

  completeMission(id: string, status: 'completed' | 'failed', completedAt: string): void {
    const mission = this.missions.get(id);
    if (!mission || mission.status !== 'active') return;
    const done = { ...mission, status, completedAt };
    this.missions.set(id, done);
    this.emit({ type: 'mission-completed', mission: done });
  }

  emitTranscriptLine(line: GameEvent & { type: 'transcript-line' }): void {
    const lines = this.transcripts.get(line.line.sessionId) ?? [];
    this.transcripts.set(line.line.sessionId, [...lines, line.line].slice(-TRANSCRIPT_BUFFER));
    this.transcriptStore?.append(line.line);
    this.emit(line);
  }

  /** Public emit for custom events (for example arsenal-updated from pollers
   * that are not agent sources). */
  emitCustom(event: GameEvent): void {
    this.emit(event);
  }
}
