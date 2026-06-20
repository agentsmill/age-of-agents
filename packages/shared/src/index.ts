import type { ProjectArsenal, WieldedArsenal } from './arsenal.js';
export * from './arsenal.js';
export * from './providers.js';

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
  /** Bieżący rozmiar kontekstu z OSTATNIEJ wiadomości (input + cache_read + cache_creation).
   *  ≠ tokens.input (suma kumulatywna). Brak → nie pokazuj paska kontekstu. */
  contextTokens?: number;
  /** Co ta sesja realnie wyciągnęła z arsenału (z atrybucji transkryptu). */
  wielded?: WieldedArsenal;
  /** Tożsamość kontenera Docker, jeśli sesja działa w kontenerze (źródło Docker).
   *  Brak → sesja hostowa. Steruje odznaką kontenera w panelu. */
  container?: { id: string; name: string; image: string };
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
  /** Statyczny ekwipunek per projekt — w snapshocie, by nowy klient dostał go
   * od razu (arsenal-updated leci tylko przy zmianie). */
  arsenals: ProjectArsenal[];
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

// ─── Chronicle (#7): replay dnia jako time-lapse ──────────────────────────────
// Serwer odtwarza transkrypty przez ten sam potok Faktów → World i zwraca
// CHRONOLOGICZNĄ listę GameEventów ze znacznikami czasu (ms epoch). Klient gra/
// scrubuje je lokalnie, reużywając całej ścieżki renderu (te same GameEventy).

/** Jedna klatka osi czasu replayu: zdarzenie + jego wirtualny czas (ms epoch). */
export interface ReplayFrame {
  tMs: number;
  event: GameEvent;
}

/** Pełna oś czasu replayu okna (np. „dziś"). frames posortowane rosnąco po tMs. */
export interface ReplayTimeline {
  startMs: number;
  endMs: number;
  frames: ReplayFrame[];
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

// ── Rejestr modeli (DANE) — bliźniak MappingConfig ──────────────────────────
// Dwie osie z RÓŻNYM dopasowaniem: tożsamość (sprite + nazwa) łapie BAZOWY model
// i ignoruje tag [1m]; pojemność (okno kontekstu) honoruje [1m] (wariant 1M).
// Każda tabela: pierwsze trafienie wygrywa (kolejność = priorytet).

/** Pula dostępnych sprite'ów bohaterów — JEDNO źródło prawdy (klient importuje to). */
export const SPRITE_IDS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export type SpriteId = (typeof SPRITE_IDS)[number];

const SPRITE_ID_SET: ReadonlySet<string> = new Set(SPRITE_IDS);
/** Czy string jest znanym SpriteId (runtime guard dla walidacji). */
export function isSpriteId(value: unknown): value is SpriteId {
  return typeof value === 'string' && SPRITE_ID_SET.has(value);
}

/** Dopasowanie wpisu do stringa modelu w runtime. */
export type ModelMatch =
  | { kind: 'exact'; id: string }          // pełna równość (case-insensitive)
  | { kind: 'pattern'; pattern: string };  // podciąg (case-insensitive)

/** Reguła tożsamości: model → sprite (+ nazwa). Ignoruje [1m]. */
export interface SpriteRule {
  match: ModelMatch;
  sprite: SpriteId;
  displayName?: string;
}

/** Reguła pojemności: model → okno kontekstu w tokenach. [1m] ma tu znaczenie. */
export interface WindowRule {
  match: ModelMatch;
  contextWindow: number;
}

/** Edytowalny rejestr modeli (DANE, nie kod). */
export interface ModelConfig {
  sprites: SpriteRule[];
  windows: WindowRule[];
  fallback: { sprite: SpriteId; contextWindow: number };
}

/** Rozwiązane metadane modelu (do renderu). */
export interface ResolvedModel {
  sprite: SpriteId;
  displayName?: string;
  contextWindow: number;
}

/** Czy `match` trafia w string modelu (case-insensitive). */
export function matchModel(model: string, match: ModelMatch): boolean {
  const m = model.toLowerCase();
  if (match.kind === 'exact') return m === match.id.toLowerCase();
  return m.includes(match.pattern.toLowerCase());
}

/** Tożsamość: pierwszy trafiony SpriteRule; inaczej fallback.sprite. */
export function resolveSprite(
  model: string | undefined,
  cfg: ModelConfig,
): { sprite: SpriteId; displayName?: string } {
  if (model) {
    for (const r of cfg.sprites) {
      if (matchModel(model, r.match)) return { sprite: r.sprite, displayName: r.displayName };
    }
  }
  return { sprite: cfg.fallback.sprite };
}

/** Pojemność: pierwszy trafiony WindowRule; inaczej fallback.contextWindow. */
export function resolveContextWindow(model: string | undefined, cfg: ModelConfig): number {
  if (model) {
    for (const r of cfg.windows) {
      if (matchModel(model, r.match)) return r.contextWindow;
    }
  }
  return cfg.fallback.contextWindow;
}

/** Złączenie obu osi (wygoda konsumentów). */
export function resolveModel(model: string | undefined, cfg: ModelConfig): ResolvedModel {
  const { sprite, displayName } = resolveSprite(model, cfg);
  return { sprite, displayName, contextWindow: resolveContextWindow(model, cfg) };
}

/**
 * Wbudowany rejestr = presety tożsamości + realne okna kontekstu Claude
 * (potwierdzone przez skill claude-api, 2026-06): Opus 4.8 / Sonnet 4.6 / Fable 5
 * to natywnie 1M, Haiku 4.5 to 200k. Tag [1m] (jawny beta-flag, np. Sonnet 4.5)
 * trzymamy na górze, by wymusić 1M niezależnie od bazy. Modele nie-Claude →
 * fallback do konfiguracji przez usera. To naprawia stary contextWindow() (200k
 * dla wszystkiego poza [1m]), który zaniżał okno modeli natywnie 1M.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  sprites: [
    { match: { kind: 'pattern', pattern: 'opus' }, sprite: 'opus', displayName: 'Opus 4.8' },
    { match: { kind: 'pattern', pattern: 'sonnet' }, sprite: 'sonnet', displayName: 'Sonnet 4.6' },
    { match: { kind: 'pattern', pattern: 'haiku' }, sprite: 'haiku', displayName: 'Haiku 4.5' },
    { match: { kind: 'pattern', pattern: 'fable' }, sprite: 'fable', displayName: 'Fable 5' },
  ],
  windows: [
    { match: { kind: 'pattern', pattern: '[1m]' }, contextWindow: 1_000_000 }, // jawny tag 1M bije bazę
    { match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 1_000_000 }, // Opus 4.6/4.7/4.8 = 1M
    { match: { kind: 'pattern', pattern: 'sonnet' }, contextWindow: 1_000_000 }, // Sonnet 4.6 = 1M
    { match: { kind: 'pattern', pattern: 'haiku' }, contextWindow: 200_000 }, // Haiku 4.5 = 200k
    { match: { kind: 'pattern', pattern: 'fable' }, contextWindow: 1_000_000 }, // Fable 5 = 1M
  ],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 }, // nieznane modele: konserwatywnie 200k
};

/** Waliduje surowy obiekt na ModelConfig. Buduje CZYSTY config (bez nadmiarowych pól). */
export function validateModelConfig(
  input: unknown,
): { ok: true; config: ModelConfig } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Config musi być obiektem.' };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.sprites)) return { ok: false, error: 'Brakuje tablicy "sprites".' };
  if (!Array.isArray(obj.windows)) return { ok: false, error: 'Brakuje tablicy "windows".' };
  if (typeof obj.fallback !== 'object' || obj.fallback === null) {
    return { ok: false, error: 'Brakuje obiektu "fallback".' };
  }
  const fb = obj.fallback as Record<string, unknown>;
  if (!isSpriteId(fb.sprite)) return { ok: false, error: `Nieznany "fallback.sprite": ${String(fb.sprite)}.` };
  if (typeof fb.contextWindow !== 'number' || !(fb.contextWindow > 0)) {
    return { ok: false, error: 'Pole "fallback.contextWindow" musi być liczbą > 0.' };
  }

  const cleanMatch = (
    raw: unknown,
    where: string,
  ): { ok: true; match: ModelMatch } | { ok: false; error: string } => {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `${where}: "match" nie jest obiektem.` };
    const mm = raw as Record<string, unknown>;
    if (mm.kind === 'exact') {
      if (typeof mm.id !== 'string' || !mm.id) return { ok: false, error: `${where}: "exact" wymaga niepustego "id".` };
      return { ok: true, match: { kind: 'exact', id: mm.id } };
    }
    if (mm.kind === 'pattern') {
      if (typeof mm.pattern !== 'string' || !mm.pattern) return { ok: false, error: `${where}: "pattern" wymaga niepustego "pattern".` };
      return { ok: true, match: { kind: 'pattern', pattern: mm.pattern } };
    }
    return { ok: false, error: `${where}: nieznany "match.kind" ${String(mm.kind)}.` };
  };

  const sprites: SpriteRule[] = [];
  for (let i = 0; i < obj.sprites.length; i++) {
    const raw = obj.sprites[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `sprites[${i}]: nie jest obiektem.` };
    const r = raw as Record<string, unknown>;
    const m = cleanMatch(r.match, `sprites[${i}]`);
    if (!m.ok) return m;
    if (!isSpriteId(r.sprite)) return { ok: false, error: `sprites[${i}]: nieznany "sprite" ${String(r.sprite)}.` };
    const rule: SpriteRule = { match: m.match, sprite: r.sprite };
    if (r.displayName !== undefined) {
      if (typeof r.displayName !== 'string') return { ok: false, error: `sprites[${i}]: "displayName" musi być stringiem.` };
      rule.displayName = r.displayName;
    }
    sprites.push(rule);
  }

  const windows: WindowRule[] = [];
  for (let i = 0; i < obj.windows.length; i++) {
    const raw = obj.windows[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `windows[${i}]: nie jest obiektem.` };
    const r = raw as Record<string, unknown>;
    const m = cleanMatch(r.match, `windows[${i}]`);
    if (!m.ok) return m;
    if (typeof r.contextWindow !== 'number' || !(r.contextWindow > 0)) {
      return { ok: false, error: `windows[${i}]: "contextWindow" musi być liczbą > 0.` };
    }
    windows.push({ match: m.match, contextWindow: r.contextWindow });
  }

  return { ok: true, config: { sprites, windows, fallback: { sprite: fb.sprite, contextWindow: fb.contextWindow } } };
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

/** Mapa cieplna „rytmu dnia": sumy tokenów wyjściowych per budynek × godzina
 *  doby (tablica 24 liczb, indeks = godzina 0..23 czasu lokalnego serwera). */
export interface BuildingHeatmapResponse {
  updatedAt: string;
  buildings: Partial<Record<BuildingId, number[]>>;
}

/** Sekcja zwłok sesji (#4): podsumowanie liczone w chwili usunięcia bohatera
 *  z mapy (po removeAfterMs bezczynności) i utrwalane na dysk. */
export interface SessionSummary {
  sessionId: string;
  agent: AgentKind;
  title: string;
  projectName?: string;
  model?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  tokens: { input: number; output: number };
  /** Liczba błędnych wyników narzędzi w trakcie sesji. */
  errorCount: number;
  /** Tokeny wyjściowe przypisane do budynków (mapowanie domyślne). */
  perBuilding: Partial<Record<BuildingId, number>>;
}
