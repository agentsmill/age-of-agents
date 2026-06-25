import type {
  ReplayFrame,
  HeroSnapshot,
  PeonSnapshot,
  MissionSnapshot,
} from '@agent-citadel/shared';

export interface ReplayWorld {
  heroes: Record<string, HeroSnapshot>;
  peons: Record<string, PeonSnapshot>;
  missions: Record<string, MissionSnapshot>;
}

/**
 * Składa stan świata na chwilę `tMs`, przewijając klatki replayu (#7 Chronicle).
 * Klatki MUSZĄ być posortowane rosnąco po tMs — przerywa na pierwszej z przyszłości.
 * Reużywa tych samych GameEventów co tor live, więc render jest identyczny.
 */
export function foldReplay(frames: ReplayFrame[], tMs: number): ReplayWorld {
  const heroes: Record<string, HeroSnapshot> = {};
  const peons: Record<string, PeonSnapshot> = {};
  const missions: Record<string, MissionSnapshot> = {};
  for (const f of frames) {
    if (f.tMs > tMs) break;
    const e = f.event;
    switch (e.type) {
      case 'snapshot':
        for (const h of e.heroes) heroes[h.sessionId] = h;
        for (const p of e.peons) peons[p.agentId] = p;
        for (const m of e.missions) missions[m.id] = m;
        break;
      case 'hero-spawned':
      case 'hero-updated':
        heroes[e.hero.sessionId] = e.hero;
        break;
      case 'hero-removed':
        delete heroes[e.sessionId];
        break;
      case 'peon-spawned':
      case 'peon-updated':
        peons[e.peon.agentId] = e.peon;
        break;
      case 'peon-completed':
        delete peons[e.agentId];
        break;
      case 'mission-started':
      case 'mission-completed':
        missions[e.mission.id] = e.mission;
        break;
      default:
        break; // transcript-line / arsenal-updated → bez wpływu na mapę
    }
  }
  return { heroes, peons, missions };
}
