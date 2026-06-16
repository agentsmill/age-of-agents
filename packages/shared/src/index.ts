/** Protokół WebSocket Agent Citadel — wspólne typy serwera i klienta. */

/** Który CLI wygenerował sesję — steruje odznaką bohatera i mapowaniem narzędzi. */
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'koda';

export type HeroStateKind =
  | 'thinking'
  | 'working'
  | 'awaiting-input'
  | 'idle'
  | 'sleeping'
  | 'error'
  | 'returning';

/** Jedna „akcja" bohatera (użycie narzędzia) — do osi „ostatnie akcje" w panelu. */
export interface ActionEntry {
  /** Nazwa narzędzia, np. 'Edit', 'Bash', 'mcp__slack__send'. */
  tool: string;
  /** Krótki opis (plik, komenda, query) — jak toolDetail. */
  detail?: string;
  ts: string;
}

export interface HeroSnapshot {
  sessionId: string;
  /** Pochodzenie sesji (Claude/Codex). Brak → traktuj jak 'claude' (zgodność wsteczna). */
  agent?: AgentKind;
  title: string;
  projectDir: string;
  /** Czytelna nazwa projektu (basename cwd, np. "RTS agents") — do HUD. */
  projectName?: string;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  /** Indeks w palecie kolorów drużyn (klient mapuje na barwę). */
  teamColor: number;
  state: HeroStateKind;
  /** Nazwa narzędzia gdy state === 'working', np. 'Edit' lub 'mcp__slack__send'. */
  currentTool?: string;
  /** Krótki opis do dymka nad jednostką (np. Bash.description). */
  toolDetail?: string;
  tokens: { input: number; output: number };
  /** Ostatnie użyte narzędzia (najnowsze pierwsze, max kilka) — oś aktywności w panelu. */
  recentActions?: ActionEntry[];
  startedAt: string;
  lastActivityAt: string;
}

export interface PeonSnapshot {
  agentId: string;
  parentSessionId: string;
  state: HeroStateKind;
  currentTool?: string;
  description?: string;
}

export type MissionStatus = 'active' | 'completed' | 'failed';

export interface MissionSnapshot {
  id: string;
  sessionId: string;
  prompt: string;
  status: MissionStatus;
  startedAt: string;
  completedAt?: string;
}

export interface WorldSnapshot {
  heroes: HeroSnapshot[];
  peons: PeonSnapshot[];
  missions: MissionSnapshot[];
}

/** Linia transkryptu do panelu bocznego (skrót, nie pełna treść). */
export interface TranscriptLine {
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
}

export type GameEvent =
  | ({ type: 'snapshot' } & WorldSnapshot)
  | { type: 'hero-spawned'; hero: HeroSnapshot }
  | { type: 'hero-updated'; hero: HeroSnapshot }
  | { type: 'hero-removed'; sessionId: string }
  | { type: 'peon-spawned'; peon: PeonSnapshot }
  | { type: 'peon-updated'; peon: PeonSnapshot }
  | { type: 'peon-completed'; agentId: string }
  | { type: 'mission-started'; mission: MissionSnapshot }
  | { type: 'mission-completed'; mission: MissionSnapshot }
  | { type: 'transcript-line'; line: TranscriptLine };

export const SERVER_PORT = 8123;
export const WS_PATH = '/ws';

// ─── Budynki + mapowanie narzędzie→budynek (serce metafory gry) ───
// Kanoniczne w shared, bo potrzebują tego ZARÓWNO klient (placement jednostek)
// JAK I serwer (atrybucja tokenów do budynku w statystykach).

export type BuildingId =
  | 'citadel'
  | 'tower'
  | 'forge'
  | 'library'
  | 'mine'
  | 'barracks'
  | 'market'
  | 'guild';

const TOOL_BUILDING: Record<string, BuildingId> = {
  WebSearch: 'tower',
  WebFetch: 'tower',
  Edit: 'forge',
  Write: 'forge',
  MultiEdit: 'forge',
  NotebookEdit: 'forge',
  Read: 'library',
  Grep: 'library',
  Glob: 'library',
  LSP: 'library',
  Bash: 'mine',
  BashOutput: 'mine',
  KillShell: 'mine',
  Task: 'barracks',
  Agent: 'barracks',
  Workflow: 'barracks',
  StructuredOutput: 'barracks', // subagenci workflow zwracają wynik tym narzędziem
  ToolSearch: 'library',
};

/** Polecenia gitowe w Bash kierujemy na targ (karawana z towarem). */
const GIT_RE = /\bgit\s+(commit|push|pull|merge|rebase)\b/;

export function toolToBuilding(tool: string | undefined, detail?: string): BuildingId {
  if (!tool) return 'citadel';
  if (tool === 'Bash' && detail && GIT_RE.test(detail)) return 'market';
  if (tool.startsWith('mcp__')) return 'guild';
  return TOOL_BUILDING[tool] ?? 'citadel';
}

/** Zużycie tokenów (wyjściowych) budynku w oknach czasowych. */
export interface BuildingWindowStats {
  today: number;
  week: number;
  month: number;
}

export interface BuildingStatsResponse {
  updatedAt: string;
  buildings: Partial<Record<BuildingId, BuildingWindowStats>>;
}
