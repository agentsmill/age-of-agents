import type { ProjectArsenal, WieldedArsenal } from './arsenal.js';
export * from './arsenal.js';

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
  /** Realny, absolutny katalog roboczy (cwd z transkryptu). UWAGA: różny od `projectDir`,
   *  które dla źródła Claude jest zakodowaną nazwą folderu (~/.claude/projects/<enc>).
   *  ArsenalPoller czyta config z TEGO pola, nie z projectDir. */
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
  /** Co ta sesja realnie wyciągnęła z arsenału (z atrybucji transkryptu). */
  wielded?: WieldedArsenal;
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
  | { type: 'transcript-line'; line: TranscriptLine }
  | { type: 'arsenal-updated'; arsenal: ProjectArsenal };

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

/** Wszystkie kanoniczne id budynków jako tablica runtime (do walidacji + UI/coverage). */
export const BUILDING_IDS = [
  'citadel', 'tower', 'forge', 'library', 'mine', 'barracks', 'market', 'guild',
  'arena', 'tavern', 'garden', 'bar', 'shrine',
  'holodeck', 'mess', 'hydroponics', 'lounge', 'medbay',
] as const satisfies readonly BuildingId[];

// Strażnik kompletności: jeśli ktoś doda wartość do unii BuildingId, a zapomni
// dopisać ją do BUILDING_IDS, poniższy typ przestanie być `never` → błąd kompilacji.
type _MissingFromBuildingIds = Exclude<BuildingId, (typeof BUILDING_IDS)[number]>;
const _buildingIdsComplete: _MissingFromBuildingIds extends never ? true : never = true;
void _buildingIdsComplete;

const BUILDING_ID_SET: ReadonlySet<string> = new Set(BUILDING_IDS);

/** Czy string jest znanym BuildingId (runtime guard dla walidacji configu). */
export function isBuildingId(value: unknown): value is BuildingId {
  return typeof value === 'string' && BUILDING_ID_SET.has(value);
}

/**
 * Jedna reguła mapowania narzędzie→budynek. Trzy „zakresy akcji":
 *  - exact:  dokładna nazwa narzędzia (Edit → forge)
 *  - prefix: prefiks nazwy (mcp__ → guild); przy kolizji wygrywa NAJDŁUŻSZY
 *  - detail: narzędzie + regex na opisie (Bash gdy „git commit…" → market)
 */
export type MappingRule =
  | { kind: 'exact'; tool: string; building: BuildingId }
  | { kind: 'prefix'; prefix: string; building: BuildingId }
  | { kind: 'detail'; tool: string; pattern: string; building: BuildingId };

/** Edytowalna konfiguracja mapowania (DANE, nie kod). `fallback` = budynek-kosz. */
export interface MappingConfig {
  rules: MappingRule[];
  fallback: BuildingId;
}

/** Źródło prawdy dla DEFAULT_MAPPING — zachowane jako czytelna tabela exact. */
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

/**
 * Wbudowana mapa = dotychczasowe zahardkodowane zachowanie wyrażone jako DANE.
 * Resolve trzyma się tej samej precedencji co stara funkcja: detail (git) →
 * prefix (mcp__) → exact (tabela) → fallback (citadel).
 */
export const DEFAULT_MAPPING: MappingConfig = {
  rules: [
    { kind: 'detail', tool: 'Bash', pattern: GIT_RE.source, building: 'market' },
    { kind: 'prefix', prefix: 'mcp__', building: 'guild' },
    ...Object.entries(TOOL_BUILDING).map(
      ([tool, building]) => ({ kind: 'exact', tool, building }) as MappingRule,
    ),
  ],
  fallback: 'citadel',
};

/**
 * Konfigurowalny następca toolToBuilding. Precedencja wg SPECYFICZNOŚCI (nie
 * kolejności w tablicy), żeby reguły szczegółowe biły ogólne bez ekspozycji
 * „przeciągania kolejności" w UI:
 *   1) detail (narzędzie + regex), 2) prefix (najdłuższy), 3) exact, 4) fallback.
 * Niepoprawny regex w regule detail jest po cichu pomijany (gra się nie wywala).
 */
export function resolveBuilding(
  tool: string | undefined,
  detail: string | undefined,
  config: MappingConfig,
): BuildingId {
  if (!tool) return config.fallback;

  if (detail) {
    for (const rule of config.rules) {
      if (rule.kind !== 'detail' || rule.tool !== tool) continue;
      try {
        if (new RegExp(rule.pattern).test(detail)) return rule.building;
      } catch {
        /* niepoprawny regex → pomiń regułę */
      }
    }
  }

  let bestPrefix: { len: number; building: BuildingId } | undefined;
  for (const rule of config.rules) {
    if (rule.kind !== 'prefix' || !tool.startsWith(rule.prefix)) continue;
    if (!bestPrefix || rule.prefix.length > bestPrefix.len) {
      bestPrefix = { len: rule.prefix.length, building: rule.building };
    }
  }
  if (bestPrefix) return bestPrefix.building;

  for (const rule of config.rules) {
    if (rule.kind === 'exact' && rule.tool === tool) return rule.building;
  }

  return config.fallback;
}

/** Cienki wrapper na DEFAULT_MAPPING — zgodność wsteczna ze wszystkimi importami. */
export function toolToBuilding(tool: string | undefined, detail?: string): BuildingId {
  return resolveBuilding(tool, detail, DEFAULT_MAPPING);
}

/**
 * Waliduje surowy obiekt (np. z pliku / textarea JSON) na MappingConfig.
 * Zwraca skonkretyzowany config przy sukcesie albo czytelny błąd po polsku.
 */
export function validateMapping(
  input: unknown,
): { ok: true; config: MappingConfig } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Config musi być obiektem.' };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.rules)) {
    return { ok: false, error: 'Brakuje tablicy "rules".' };
  }
  if (!isBuildingId(obj.fallback)) {
    return { ok: false, error: `Nieznany "fallback": ${String(obj.fallback)}.` };
  }
  // Buduj CZYSTY config z wyłącznie znanych pól — żeby nadmiarowe klucze
  // wstrzyknięte przez klienta nie trafiały trwale do pliku źródła prawdy.
  const cleanRules: MappingRule[] = [];
  for (let i = 0; i < obj.rules.length; i++) {
    const raw = obj.rules[i];
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `Reguła ${i}: nie jest obiektem.` };
    }
    const rule = raw as Record<string, unknown>;
    if (!isBuildingId(rule.building)) {
      return { ok: false, error: `Reguła ${i}: nieznany "building" ${String(rule.building)}.` };
    }
    if (rule.kind === 'exact') {
      if (typeof rule.tool !== 'string' || !rule.tool) {
        return { ok: false, error: `Reguła ${i}: "exact" wymaga niepustego "tool".` };
      }
      cleanRules.push({ kind: 'exact', tool: rule.tool, building: rule.building });
    } else if (rule.kind === 'prefix') {
      if (typeof rule.prefix !== 'string' || !rule.prefix) {
        return { ok: false, error: `Reguła ${i}: "prefix" wymaga niepustego "prefix".` };
      }
      cleanRules.push({ kind: 'prefix', prefix: rule.prefix, building: rule.building });
    } else if (rule.kind === 'detail') {
      if (typeof rule.tool !== 'string' || !rule.tool) {
        return { ok: false, error: `Reguła ${i}: "detail" wymaga niepustego "tool".` };
      }
      // Pusty pattern → new RegExp('') łapie KAŻDY detail (cichy catch-all). Odrzuć.
      if (typeof rule.pattern !== 'string' || !rule.pattern) {
        return { ok: false, error: `Reguła ${i}: "detail" wymaga niepustego "pattern".` };
      }
      try {
        new RegExp(rule.pattern);
      } catch {
        return { ok: false, error: `Reguła ${i}: niepoprawny regex w "pattern".` };
      }
      cleanRules.push({ kind: 'detail', tool: rule.tool, pattern: rule.pattern, building: rule.building });
    } else {
      return { ok: false, error: `Reguła ${i}: nieznany "kind" ${String(rule.kind)}.` };
    }
  }
  return { ok: true, config: { rules: cleanRules, fallback: obj.fallback } };
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
