import { create } from 'zustand';
import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PeonSnapshot,
  ProjectArsenal,
  TranscriptLine,
} from '@agent-citadel/shared';
import { deriveNotification, contextPressureNotification, DEDUP_WINDOW, MAX_VISIBLE, type Notification } from './notifications';
import { resolveModelLive } from './model-store';

interface WorldStore {
  connected: boolean;
  heroes: Record<string, HeroSnapshot>;
  peons: Record<string, PeonSnapshot>;
  missions: Record<string, MissionSnapshot>;
  /** Ostatnie linie transkryptu per sesja (bufor do panelu bocznego). */
  transcripts: Record<string, TranscriptLine[]>;
  /** Efemeryczne powiadomienia (stos w lewym-górnym rogu). */
  notifications: Notification[];
  selectedSessionId?: string;
  selectedBuildingId?: string;
  /** Czy kamera ma śledzić wybranego bohatera (opt-in per agent; reset przy zmianie zaznaczenia). */
  autofollow: boolean;
  /** Statyczny Arsenał per projectDir (Źródło A). */
  arsenal: Record<string, ProjectArsenal>;
  /**
   * Wybrany projekt (miasto). `undefined` = pokaż wszystkie (overlay).
   * Wpływa na panel boczny: Architect Hall pokazuje tylko wybrany projekt,
   * mapa filtruje agentów po projectDir.
   */
  selectedProjectDir?: string;
  /** Tryb Chronicle (#7): replay nadpisuje świat, żywe eventy WS są ignorowane. */
  replayMode: boolean;
  setConnected(connected: boolean): void;
  select(sessionId?: string): void;
  selectBuilding(buildingId?: string): void;
  setAutofollow(on: boolean): void;
  dismissNotification(id: string): void;
  selectProject(projectDir?: string): void;
  enterReplay(): void;
  exitReplay(): void;
  setReplayWorld(
    heroes: Record<string, HeroSnapshot>,
    peons: Record<string, PeonSnapshot>,
    missions: Record<string, MissionSnapshot>,
  ): void;
  apply(event: GameEvent): void;
}

const TRANSCRIPT_BUFFER = 200;

/** Wstaw powiadomienie z dedupem (sessionId+reason w oknie per-waga) i limitem stosu. */
function addNotif(list: Notification[], n: Notification | null, now: number): Notification[] {
  if (!n) return list;
  const dup = list.some(
    (e) => e.sessionId === n.sessionId && e.reason === n.reason && now - e.createdAt < DEDUP_WINDOW[n.kind],
  );
  if (dup) return list;
  return [...list, n].slice(-MAX_VISIBLE);
}

export const useWorld = create<WorldStore>((set) => ({
  connected: false,
  heroes: {},
  peons: {},
  missions: {},
  transcripts: {},
  notifications: [],
  autofollow: false,
  arsenal: {},
  replayMode: false,
  setConnected: (connected) => set({ connected }),
  // Wybór jednostki i budynku wzajemnie się wykluczają (jeden panel po prawej).
  // Reset autofollow tylko przy ZMIANIE celu (opt-in per agent): ponowny klik w już
  // śledzoną jednostkę nie zrywa follow, a przełączenie na inną — owszem.
  select: (sessionId) =>
    set((s) => ({
      selectedSessionId: sessionId,
      selectedBuildingId: undefined,
      autofollow: sessionId === s.selectedSessionId ? s.autofollow : false,
    })),
  selectBuilding: (selectedBuildingId) => set({ selectedBuildingId, selectedSessionId: undefined, autofollow: false }),
  setAutofollow: (autofollow) => set({ autofollow }),
  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
  selectProject: (selectedProjectDir) => set({ selectedProjectDir }),
  // Chronicle (#7): wejście czyści selekcję; replay potem nadpisuje świat przez setReplayWorld.
  enterReplay: () => set({ replayMode: true, selectedSessionId: undefined, selectedBuildingId: undefined }),
  exitReplay: () => set({ replayMode: false }),
  setReplayWorld: (heroes, peons, missions) => set({ heroes, peons, missions }),
  apply: (event) =>
    set((state) => {
      switch (event.type) {
        case 'snapshot':
          return {
            heroes: Object.fromEntries(event.heroes.map((h) => [h.sessionId, h])),
            peons: Object.fromEntries(event.peons.map((p) => [p.agentId, p])),
            missions: Object.fromEntries(event.missions.map((m) => [m.id, m])),
            // `?? []` — odporność na starszy serwer bez arsenału w snapshocie.
            arsenal: Object.fromEntries((event.arsenals ?? []).map((a) => [a.projectDir, a])),
          };
        case 'hero-spawned':
        case 'hero-updated': {
          const prev = state.heroes[event.hero.sessionId];
          const now = Date.now();
          let notifs = addNotif(state.notifications, deriveNotification(prev, event, now), now);
          // Ciśnienie kontekstu: okno modelu z rejestru (klient zna contextTokens + model).
          const win = resolveModelLive(event.hero.model).contextWindow;
          notifs = addNotif(notifs, contextPressureNotification(prev, event.hero, win, now), now);
          return {
            heroes: { ...state.heroes, [event.hero.sessionId]: event.hero },
            notifications: notifs,
          };
        }
        case 'hero-removed': {
          const heroes = { ...state.heroes };
          delete heroes[event.sessionId];
          // Usunięto śledzonego bohatera → wygaś selekcję i autofollow (brak martwego celu).
          if (state.selectedSessionId === event.sessionId) {
            return { heroes, selectedSessionId: undefined, autofollow: false };
          }
          return { heroes };
        }
        case 'peon-spawned':
        case 'peon-updated':
          return { peons: { ...state.peons, [event.peon.agentId]: event.peon } };
        case 'peon-completed': {
          const peons = { ...state.peons };
          delete peons[event.agentId];
          return { peons };
        }
        case 'mission-started':
        case 'mission-completed': {
          const now = Date.now();
          return {
            missions: { ...state.missions, [event.mission.id]: event.mission },
            notifications: addNotif(state.notifications, deriveNotification(undefined, event, now), now),
          };
        }
        case 'transcript-line': {
          const lines = state.transcripts[event.line.sessionId] ?? [];
          return {
            transcripts: {
              ...state.transcripts,
              [event.line.sessionId]: [...lines, event.line].slice(-TRANSCRIPT_BUFFER),
            },
          };
        }
        case 'arsenal-updated': {
          return { arsenal: { ...state.arsenal, [event.arsenal.projectDir]: event.arsenal } };
        }
        default:
          return state;
      }
    }),
}));

// Dev-only uchwyt do debugowania żywego świata z konsoli (np. wstrzyknięcie
// snapshotu, inspekcja heroes/peons). Nie trafia do builda produkcyjnego.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  (globalThis as Record<string, unknown>).__world = useWorld;
}
