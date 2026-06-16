import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PeonSnapshot,
  WorldSnapshot,
} from '@agent-citadel/shared';

type Listener = (event: GameEvent) => void;

/**
 * Stan świata w pamięci. Jedyne źródło prawdy po stronie serwera —
 * watcher, hooki i generator demo wszystkie mutują świat przez te metody,
 * a każda mutacja emituje zdarzenie do podłączonych klientów.
 */
export class World {
  private heroes = new Map<string, HeroSnapshot>();
  private peons = new Map<string, PeonSnapshot>();
  private missions = new Map<string, MissionSnapshot>();
  private listeners = new Set<Listener>();
  private nextTeamColor = 0;

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    // Listener (np. broadcast WS na zerwanym sockecie) nie może ubić mutacji
    // ani — przez sweep/connection — całego procesu. Izolujemy każdy z osobna.
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
    };
  }

  /** Zwraca unikalne, aktywne katalogi projektów (w tej chwili pracujących sesji).
   * Używane przez project-intel-poller do wykrycia, dla których katalogów
   * czytać `.beads/` i `graphify-out/`. */
  activeProjectDirs(): string[] {
    const dirs = new Set<string>();
    for (const hero of this.heroes.values()) {
      if (hero.projectDir) dirs.add(hero.projectDir);
    }
    return [...dirs];
  }

  /** Zwraca snapshot sesji należących do danego projektu. */
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
    this.emit(line);
  }

  /** Publiczny emit dla zdarzeń niestandardowych (np. project-intel-updated
   * z pollerów, które nie są źródłem agentów). */
  emitCustom(event: GameEvent): void {
    this.emit(event);
  }
}
