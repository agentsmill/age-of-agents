/** Protokół WebSocket Agent Citadel — wspólne typy serwera i klienta. */

/** Który CLI wygenerował sesję — steruje odznaką bohatera i mapowaniem narzędzi. */
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'koda' | 'local-llm';

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
  /** Realny, absolutny katalog roboczy (cwd z transkryptu). UWAGA: różny od `projectDir`,
   *  które dla źródła Claude jest zakodowaną nazwą folderu (~/.claude/projects/<enc>).
   *  Poller intelu czyta `.beads`/`graphify` z TEGO pola, nie z projectDir. */
  workingDir?: string;
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
  /** Katalog uruchomienia serwera (cwd) — „miasto domowe". Pozwala pokazać beady/graphify
   *  projektu nawet gdy NIE ma w nim aktywnego bohatera. Undefined w trybie demo. */
  homeProjectDir?: string;
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
  | { type: 'transcript-line'; line: TranscriptLine }
  | { type: 'project-intel-updated'; intel: ProjectIntel };

export const SERVER_PORT = 8123;
export const WS_PATH = '/ws';

// ─── Beads + Graphify types (Project Intel) ───

/** Powód stanu beadów dla panelu architekta:
 *  'ok' = są issues · 'empty' = .beads jest, ale 0 issues ·
 *  'no-bd' = .beads jest, ale brak CLI `bd` na PATH · 'no-dir' = brak katalogu .beads. */
export type BeadsReason = 'ok' | 'empty' | 'no-bd' | 'no-dir';

/** Pojedynczy task z beads (subset Dolt fields, kompatybilny z `bd list --json`). */
export interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  issueType: string;
  assignee?: string;
  blocksCount: number;
  blockedByCount: number;
  createdAt?: number;
  updatedAt?: number;
}

/** Statystyki z graphify code graph (subset graph.json stats section). */
export interface GraphifySummary {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  topHubs: Array<{ symbol: string; degree: number }>;
  generatedAt?: string;
}

/** Inteligentny snapshot jednego projektu (= jedno miasto w Age of Agents). */
export interface ProjectIntel {
  projectDir: string;
  projectName: string;
  activeSessions: number;
  activeAgents: AgentKind[];
  beads: { available: boolean; issues: BeadsIssue[]; error?: string; reason?: BeadsReason };
  graphify: { available: boolean; summary: GraphifySummary | null; error?: string };
  refreshedAt: number;
}

/**
 * Inteligentny layer „salonu architekta": beads issues + graphify code graph
 * per projekt monitorowany. Serwer polluje `.beads/issues.jsonl` i
 * `graphify-out/graph.json` z katalogu projektu każdego znanego bohatera
 * i emette `project-intel-updated` event do klienta.
 */

/** Pojedynczy task z beads (subset Dolt fields, kompatybilny z `bd list --json`). */
export interface BeadsIssue {
  /** Unikalne id (np. "bd-1") — link do .beads/issues.jsonl. */
  id: string;
  title: string;
  /** status: 'open' | 'in_progress' | 'closed' | 'deferred'. */
  status: string;
  /** priority 0..4, 0=critical, 4=backlog. */
  priority: number;
  /** issue_type: 'bug' | 'feature' | 'task' | 'epic' | 'chore'. */
  issueType: string;
  /** Kto ma to zrobione (z Bd `assignee` field). */
  assignee?: string;
  /** Ile issue'ów blokuje to — 0 = liść. */
  blocksCount: number;
  /** Ile issue'ów jest zablokowane przez to. */
  blockedByCount: number;
  /** unix timestamp (created_at) — do sortowania/age. */
  createdAt?: number;
  /** unix timestamp (updated_at) — do badge „świeży". */
  updatedAt?: number;
}

/** Statystyki z graphify code graph (subset graph.json stats section). */
export interface GraphifySummary {
  /** Ile symboli (funkcji, klas, zmiennych) w grafie. */
  nodeCount: number;
  /** Ile krawędzi (imports, calls, refs). */
  edgeCount: number;
  /** Ile wykrytych wspólnot (modułów). */
  communityCount: number;
  /** Top 5 god-nodes (najczęściej importowane) — wzbogaca UI. */
  topHubs: Array<{ symbol: string; degree: number }>;
  /** Ostatnia aktualizacja graphify-out/. */
  generatedAt?: string;
}

/**
 * Inteligentny snapshot jednego projektu (= jedno miasto w Age of Agents).
 * Serwer emituje to po wykryciu bohatera z danym `projectDir` lub co poll.
 */
export interface ProjectIntel {
  /** Absolutna ścieżka katalogu projektu (cwd bohatera) — unikalny klucz miasta. */
  projectDir: string;
  /** Krótka, czytelna nazwa (basename projectDir lub package.json name). */
  projectName: string;
  /** Ile aktywnych sesji AI pracuje w tym projekcie (do nagłówka miasta). */
  activeSessions: number;
  /** Ile unikalnych agentów (claude/codex/opencode/koda). */
  activeAgents: AgentKind[];
  /** Status źródeł intel: czy beads + graphify istnieją. */
  beads: { available: boolean; issues: BeadsIssue[]; error?: string; reason?: BeadsReason };
  graphify: { available: boolean; summary: GraphifySummary | null; error?: string };
  /** Kiedy ostatnio odświeżono. */
  refreshedAt: number;
}

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
  | 'guild'
  | 'arena'
  | 'tavern'
  | 'garden'
  | 'bar'
  | 'shrine'
  | 'holodeck'
  | 'mess'
  | 'hydroponics'
  | 'lounge'
  | 'medbay';

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
