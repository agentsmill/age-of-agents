import { create } from 'zustand';
import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PendingQuestion,
  PeonSnapshot,
  ProjectArsenal,
  TranscriptLine,
} from '@agent-citadel/shared';
import { deriveNotification, DEDUP_WINDOW, MAX_VISIBLE, type Notification } from './notifications';

interface WorldStore {
  connected: boolean;
  heroes: Record<string, HeroSnapshot>;
  peons: Record<string, PeonSnapshot>;
  missions: Record<string, MissionSnapshot>;
  /** Latest transcript lines per session (side-panel buffer). */
  transcripts: Record<string, TranscriptLine[]>;
  /** Ephemeral notifications (stack in the top-left corner). */
  notifications: Notification[];
  selectedSessionId?: string;
  selectedBuildingId?: string;
  /** Whether the camera should follow the selected hero (opt-in per agent; resets on selection change). */
  autofollow: boolean;
  /** Static Arsenal per projectDir (Source A). */
  arsenal: Record<string, ProjectArsenal>;
  /** Open agent questions awaiting a panel answer, keyed by question id. */
  pending: Record<string, PendingQuestion>;
  /**
   * Selected project (city). `undefined` = show all (overlay).
   * Affects the side panel: Architect Hall shows only the selected project,
   * and the map filters agents by projectDir.
   */
  selectedProjectDir?: string;
  setConnected(connected: boolean): void;
  select(sessionId?: string): void;
  selectBuilding(buildingId?: string): void;
  setAutofollow(on: boolean): void;
  dismissNotification(id: string): void;
  selectProject(projectDir?: string): void;
  apply(event: GameEvent): void;
}

const TRANSCRIPT_BUFFER = 200;

/** Inserts a notification with deduping (sessionId+reason within the per-kind window) and stack limit. */
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
  pending: {},
  setConnected: (connected) => set({ connected }),
  // Unit and building selection are mutually exclusive (one right-side panel).
  // Reset autofollow only when the target CHANGES (opt-in per agent): clicking
  // the already followed unit does not break follow, switching to another does.
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
  apply: (event) =>
    set((state) => {
      switch (event.type) {
        case 'snapshot':
          return {
            heroes: Object.fromEntries(event.heroes.map((h) => [h.sessionId, h])),
            peons: Object.fromEntries(event.peons.map((p) => [p.agentId, p])),
            missions: Object.fromEntries(event.missions.map((m) => [m.id, m])),
            transcripts: Object.fromEntries(
              (event.transcripts ?? []).reduce((acc, line) => {
                const lines = acc.get(line.sessionId) ?? [];
                lines.push(line);
                acc.set(line.sessionId, lines.slice(-TRANSCRIPT_BUFFER));
                return acc;
              }, new Map<string, TranscriptLine[]>()),
            ),
            arsenal: Object.fromEntries((event.arsenals ?? []).map((a) => [a.projectDir, a])),
            pending: {},
          };
        case 'hero-spawned':
        case 'hero-updated': {
          const prev = state.heroes[event.hero.sessionId];
          const now = Date.now();
          return {
            heroes: { ...state.heroes, [event.hero.sessionId]: event.hero },
            notifications: addNotif(state.notifications, deriveNotification(prev, event, now), now),
          };
        }
        case 'hero-removed': {
          const heroes = { ...state.heroes };
          delete heroes[event.sessionId];
          const pending = Object.fromEntries(
            Object.entries(state.pending).filter(([, q]) => q.sessionId !== event.sessionId),
          );
          if (state.selectedSessionId === event.sessionId) {
            return { heroes, pending, selectedSessionId: undefined, autofollow: false };
          }
          return { heroes, pending };
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
        case 'pending-question':
          return { pending: { ...state.pending, [event.question.id]: event.question } };
        case 'pending-question-resolved': {
          const pending = { ...state.pending };
          delete pending[event.id];
          return { pending };
        }
        default:
          return state;
      }
    }),
}));

// Dev-only handle for debugging the live world from the console (for example
// injecting a snapshot or inspecting heroes/peons). Excluded from production builds.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  (globalThis as Record<string, unknown>).__world = useWorld;
}
