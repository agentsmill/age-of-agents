import type { ProjectArsenal, WieldedArsenal } from './arsenal.js';
import type { PendingQuestion } from './pending.js';
export * from './arsenal.js';
export * from './providers.js';
export * from './pending.js';

/** Agent Citadel WebSocket protocol: shared server/client types. */

/** Which CLI generated the session; controls the hero badge and tool mapping. */
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'koda' | 'local-llm';

export type HeroStateKind =
  | 'thinking'
  | 'working'
  | 'awaiting-input'
  | 'idle'
  | 'sleeping'
  | 'error'
  | 'recovering'
  | 'returning';

/** One hero action (tool use), shown in the panel's recent actions timeline. */
export interface ActionEntry {
  /** Tool name, e.g. 'Edit', 'Bash', 'mcp__slack__send'. */
  tool: string;
  /** Short description (file, command, query), same shape as toolDetail. */
  detail?: string;
  ts: string;
}

export interface HeroSnapshot {
  sessionId: string;
  /** Session origin (Claude/Codex). Missing means 'claude' for backwards compatibility. */
  agent?: AgentKind;
  title: string;
  projectDir: string;
  /** Real absolute working directory (cwd from the transcript). NOTE: this differs from
   *  `projectDir`, which is an encoded folder name for Claude sources (~/.claude/projects/<enc>).
   *  ArsenalPoller reads config from this field, not projectDir. */
  workingDir?: string;
  /** Readable project name (cwd basename, e.g. "RTS agents") for the HUD. */
  projectName?: string;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  /** Index in the team color palette; the client maps it to an actual color. */
  teamColor: number;
  state: HeroStateKind;
  /** Tool name when state === 'working', e.g. 'Edit' or 'mcp__slack__send'. */
  currentTool?: string;
  /** Short description for the bubble above the unit, e.g. Bash.description. */
  toolDetail?: string;
  tokens: { input: number; output: number };
  /** Recently used tools, newest first, capped to a few entries for the panel timeline. */
  recentActions?: ActionEntry[];
  /** Current context size from the LAST message (input + cache_read + cache_creation).
   *  Not the same as tokens.input (the cumulative total). Missing means hide the context bar. */
  contextTokens?: number;
  /** Context window size reported by the CLI. Missing means the client falls back to model config. */
  contextWindowTokens?: number;
  /** What this session actually drew from the arsenal, based on transcript attribution. */
  wielded?: WieldedArsenal;
  /** Tożsamość kontenera Docker, jeśli sesja działa w kontenerze (źródło Docker).
   *  Brak → sesja hostowa. Steruje odznaką kontenera w panelu. */
  container?: { id: string; name: string; image: string };
  startedAt: string;
  lastActivityAt: string;
  /** Bumped when a session is cleared so the client can play one cosmetic strike. */
  clearedAt?: number;
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
  transcripts: TranscriptLine[];
  /** Statyczny ekwipunek per projekt — w snapshocie, by nowy klient dostał go
   * od razu (arsenal-updated leci tylko przy zmianie). */
  arsenals: ProjectArsenal[];
}

/** Transcript line for the side panel: a summary, not the full content. */
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
  | { type: 'arsenal-updated'; arsenal: ProjectArsenal }
  | { type: 'pending-question'; question: PendingQuestion }
  | { type: 'pending-question-resolved'; id: string }
  | { type: 'sdk-session-started'; sessionId: string };

export const SERVER_PORT = 8123;
export const WS_PATH = '/ws';

// Buildings + tool-to-building mapping: the heart of the game metaphor.
// Canonical in shared because both the client (unit placement) and the server
// (token attribution to buildings in stats) need it.

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

/** All canonical building ids as a runtime array for validation, UI, and coverage. */
export const BUILDING_IDS = [
  'citadel', 'tower', 'forge', 'library', 'mine', 'barracks', 'market', 'guild',
  'arena', 'tavern', 'garden', 'bar', 'shrine',
  'holodeck', 'mess', 'hydroponics', 'lounge', 'medbay',
] as const satisfies readonly BuildingId[];

// Completeness guard: if someone adds a value to the BuildingId union but forgets
// to add it to BUILDING_IDS, this type stops being `never` and compilation fails.
type _MissingFromBuildingIds = Exclude<BuildingId, (typeof BUILDING_IDS)[number]>;
const _buildingIdsComplete: _MissingFromBuildingIds extends never ? true : never = true;
void _buildingIdsComplete;

const BUILDING_ID_SET: ReadonlySet<string> = new Set(BUILDING_IDS);

/** Whether a string is a known BuildingId, used as a runtime guard for config validation. */
export function isBuildingId(value: unknown): value is BuildingId {
  return typeof value === 'string' && BUILDING_ID_SET.has(value);
}

/**
 * One tool-to-building mapping rule. Three matching scopes:
 *  - exact:  exact tool name (Edit -> forge)
 *  - prefix: name prefix (mcp__ -> guild); longest prefix wins on collision
 *  - detail: tool + regex over detail text (Bash with "git commit..." -> market)
 */
export type MappingRule =
  | { kind: 'exact'; tool: string; building: BuildingId }
  | { kind: 'prefix'; prefix: string; building: BuildingId }
  | { kind: 'detail'; tool: string; pattern: string; building: BuildingId };

/** Editable mapping config (data, not code). `fallback` is the catch-all building. */
export interface MappingConfig {
  rules: MappingRule[];
  fallback: BuildingId;
}

/** Source of truth for DEFAULT_MAPPING, kept as a readable exact-match table. */
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
  StructuredOutput: 'barracks', // workflow subagents return results through this tool
  ToolSearch: 'library',
};

/** Bash git commands go to the market (the caravan carrying goods). */
const GIT_RE = /\bgit\s+(commit|push|pull|merge|rebase)\b/;

/**
 * Built-in mapping: the previous hard-coded behavior expressed as data.
 * Resolution keeps the same precedence as the old function: detail (git) ->
 * prefix (mcp__) -> exact (table) -> fallback (citadel).
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
 * Configurable successor to toolToBuilding. Precedence follows specificity, not
 * array order, so detailed rules beat broad ones without exposing drag-to-reorder
 * behavior in the UI:
 *   1) detail (tool + regex), 2) prefix (longest), 3) exact, 4) fallback.
 * Invalid detail regexes are silently skipped so the game does not crash.
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
        /* invalid regex -> skip the rule */
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

const HOME_BUILDINGS_BY_THEME: Record<string, BuildingId[]> = {
  fantasy: ['arena', 'tavern', 'garden', 'bar', 'shrine'],
  scifi: ['holodeck', 'mess', 'hydroponics', 'lounge', 'medbay'],
};

const AWAITING_BUILDING_BY_THEME: Record<string, BuildingId> = {
  fantasy: 'shrine',
  scifi: 'lounge',
};

const COMPLETED_BUILDING_BY_THEME: Record<string, BuildingId> = {
  fantasy: 'garden',
  scifi: 'hydroponics',
};

const RECOVERY_BUILDING_BY_THEME: Record<string, BuildingId> = {
  fantasy: 'shrine',
  scifi: 'medbay',
};

function projectHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function homeBuildingForTheme(
  themeId: string,
  hero: Pick<HeroSnapshot, 'projectName' | 'projectDir'> & Partial<Pick<HeroSnapshot, 'sessionId'>>,
): BuildingId {
  const options = HOME_BUILDINGS_BY_THEME[themeId];
  if (!options || options.length === 0) return 'citadel';
  const base = hero.projectName ?? hero.projectDir ?? '';
  if (!base) return 'citadel';
  const key = hero.sessionId ? `${base}:${hero.sessionId}` : base;
  return options[projectHash(key) % options.length];
}

export function awaitingBuildingForTheme(themeId: string): BuildingId {
  return AWAITING_BUILDING_BY_THEME[themeId] ?? 'citadel';
}

export function completedBuildingForTheme(themeId: string): BuildingId {
  return COMPLETED_BUILDING_BY_THEME[themeId] ?? 'citadel';
}

export function recoveryBuildingForTheme(themeId: string): BuildingId {
  return RECOVERY_BUILDING_BY_THEME[themeId] ?? 'citadel';
}

export function activityBuildingForHero(
  themeId: string,
  hero: Pick<HeroSnapshot, 'state' | 'currentTool' | 'toolDetail' | 'projectName' | 'projectDir'> & Partial<Pick<HeroSnapshot, 'sessionId'>>,
  config: MappingConfig,
): BuildingId | undefined {
  if (hero.state === 'working') return resolveBuilding(hero.currentTool, hero.toolDetail, config);
  if (hero.state === 'awaiting-input') return awaitingBuildingForTheme(themeId);
  if (hero.state === 'returning') return completedBuildingForTheme(themeId);
  if (hero.state === 'recovering' || hero.state === 'error') return recoveryBuildingForTheme(themeId);
  if (hero.state === 'idle' || hero.state === 'sleeping') return homeBuildingForTheme(themeId, hero);
  return undefined;
}

export type ActivityAction =
  | { kind: 'tool'; tool: string; detail?: string }
  | { kind: 'completed'; projectName?: string; projectDir?: string };

export function activityBuildingForAction(
  action: ActivityAction,
  themeId: string,
  config: MappingConfig,
): BuildingId {
  if (action.kind === 'tool') return resolveBuilding(action.tool, action.detail, config);
  return completedBuildingForTheme(themeId);
}

/** Thin DEFAULT_MAPPING wrapper for backwards compatibility with existing imports. */
export function toolToBuilding(tool: string | undefined, detail?: string): BuildingId {
  return resolveBuilding(tool, detail, DEFAULT_MAPPING);
}

/**
 * Validates a raw object (for example from a file or JSON textarea) as MappingConfig.
 * Returns a concrete config on success, or a readable English error.
 */
export function validateMapping(
  input: unknown,
): { ok: true; config: MappingConfig } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Config must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.rules)) {
    return { ok: false, error: 'Missing "rules" array.' };
  }
  if (!isBuildingId(obj.fallback)) {
    return { ok: false, error: `Unknown "fallback": ${String(obj.fallback)}.` };
  }
  // Build a clean config with only known fields, so extra keys injected by the
  // client are not persisted to the source-of-truth file.
  const cleanRules: MappingRule[] = [];
  for (let i = 0; i < obj.rules.length; i++) {
    const raw = obj.rules[i];
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `Rule ${i}: not an object.` };
    }
    const rule = raw as Record<string, unknown>;
    if (!isBuildingId(rule.building)) {
      return { ok: false, error: `Rule ${i}: unknown "building" ${String(rule.building)}.` };
    }
    if (rule.kind === 'exact') {
      if (typeof rule.tool !== 'string' || !rule.tool) {
        return { ok: false, error: `Rule ${i}: "exact" requires a non-empty "tool".` };
      }
      cleanRules.push({ kind: 'exact', tool: rule.tool, building: rule.building });
    } else if (rule.kind === 'prefix') {
      if (typeof rule.prefix !== 'string' || !rule.prefix) {
        return { ok: false, error: `Rule ${i}: "prefix" requires a non-empty "prefix".` };
      }
      cleanRules.push({ kind: 'prefix', prefix: rule.prefix, building: rule.building });
    } else if (rule.kind === 'detail') {
      if (typeof rule.tool !== 'string' || !rule.tool) {
        return { ok: false, error: `Rule ${i}: "detail" requires a non-empty "tool".` };
      }
      // Empty pattern -> new RegExp('') matches every detail (silent catch-all). Reject it.
      if (typeof rule.pattern !== 'string' || !rule.pattern) {
        return { ok: false, error: `Rule ${i}: "detail" requires a non-empty "pattern".` };
      }
      try {
        new RegExp(rule.pattern);
      } catch {
        return { ok: false, error: `Rule ${i}: invalid regex in "pattern".` };
      }
      cleanRules.push({ kind: 'detail', tool: rule.tool, pattern: rule.pattern, building: rule.building });
    } else {
      return { ok: false, error: `Rule ${i}: unknown "kind" ${String(rule.kind)}.` };
    }
  }
  return { ok: true, config: { rules: cleanRules, fallback: obj.fallback } };
}

// Model registry (data): sibling to MappingConfig.
// Two axes with different matching behavior: identity (sprite + name) matches the
// base model and ignores [1m]; capacity (context window) honors [1m] as the 1M variant.
// In each table, the first match wins (order is priority).

/** Pool of available hero sprites: the single source of truth imported by the client. */
export const SPRITE_IDS = ['opus', 'sonnet', 'haiku', 'fable', 'local', 'golem', 'familiar', 'oracle'] as const;
export type SpriteId = (typeof SPRITE_IDS)[number];

const SPRITE_ID_SET: ReadonlySet<string> = new Set(SPRITE_IDS);
/** Whether a string is a known SpriteId, used as a runtime guard for validation. */
export function isSpriteId(value: unknown): value is SpriteId {
  return typeof value === 'string' && SPRITE_ID_SET.has(value);
}

/** Runtime match rule against a model string. */
export type ModelMatch =
  | { kind: 'exact'; id: string }          // full equality, case-insensitive
  | { kind: 'pattern'; pattern: string };  // substring, case-insensitive

/** Identity rule: model -> sprite (+ display name). Ignores [1m]. */
export interface SpriteRule {
  match: ModelMatch;
  sprite: SpriteId;
  displayName?: string;
}

/** Capacity rule: model -> context window in tokens. [1m] matters here. */
export interface WindowRule {
  match: ModelMatch;
  contextWindow: number;
}

/** Editable model registry (data, not code). */
export interface ModelConfig {
  sprites: SpriteRule[];
  windows: WindowRule[];
  fallback: { sprite: SpriteId; contextWindow: number };
}

/** Resolved model metadata for rendering. */
export interface ResolvedModel {
  sprite: SpriteId;
  displayName?: string;
  contextWindow: number;
}

/** Whether `match` hits the model string, case-insensitive. */
export function matchModel(model: string, match: ModelMatch): boolean {
  const m = model.toLowerCase();
  if (match.kind === 'exact') return m === match.id.toLowerCase();
  return m.includes(match.pattern.toLowerCase());
}

/** Identity axis: first matching SpriteRule, otherwise fallback.sprite. */
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

/** Capacity axis: first matching WindowRule, otherwise fallback.contextWindow. */
export function resolveContextWindow(model: string | undefined, cfg: ModelConfig): number {
  if (model) {
    for (const r of cfg.windows) {
      if (matchModel(model, r.match)) return r.contextWindow;
    }
  }
  return cfg.fallback.contextWindow;
}

/** Join both axes for consumer convenience. */
export function resolveModel(model: string | undefined, cfg: ModelConfig): ResolvedModel {
  const { sprite, displayName } = resolveSprite(model, cfg);
  return { sprite, displayName, contextWindow: resolveContextWindow(model, cfg) };
}

/**
 * Built-in registry = identity presets + real Claude context windows
 * (confirmed through the claude-api skill, 2026-06): Opus 4.8 / Sonnet 4.6 / Fable 5
 * are natively 1M, Haiku 4.5 is 200k. The [1m] tag (explicit beta flag, e.g.
 * Sonnet 4.5) stays at the top to force 1M regardless of base model. Non-Claude
 * models fall back to user configuration. This fixes the old contextWindow()
 * behavior (200k for everything except [1m]), which underreported native 1M models.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  sprites: [
    { match: { kind: 'exact', id: 'gpt-5.5' }, sprite: 'fable', displayName: 'GPT-5.5' },
    { match: { kind: 'pattern', pattern: 'gpt-5.4-codex' }, sprite: 'fable', displayName: 'GPT-5.4 Codex' },
    { match: { kind: 'pattern', pattern: 'gpt-5.4-mini' }, sprite: 'haiku', displayName: 'GPT-5.4 Mini' },
    { match: { kind: 'pattern', pattern: 'gpt-oss' }, sprite: 'fable', displayName: 'GPT-OSS' },
    { match: { kind: 'pattern', pattern: 'gpt-' }, sprite: 'fable', displayName: 'GPT' },
    { match: { kind: 'pattern', pattern: 'opus' }, sprite: 'opus', displayName: 'Opus 4.8' },
    { match: { kind: 'pattern', pattern: 'sonnet' }, sprite: 'sonnet', displayName: 'Sonnet 4.6' },
    { match: { kind: 'pattern', pattern: 'haiku' }, sprite: 'haiku', displayName: 'Haiku 4.5' },
    { match: { kind: 'pattern', pattern: 'fable' }, sprite: 'fable', displayName: 'Fable 5' },
    // Local model families (Ollama/llama.cpp/vLLM/oMLX) — dedicated 'local' sprite.
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local', displayName: 'Llama' },
    { match: { kind: 'pattern', pattern: 'qwen' }, sprite: 'local', displayName: 'Qwen' },
    { match: { kind: 'pattern', pattern: 'ministral' }, sprite: 'local', displayName: 'Ministral' },
    { match: { kind: 'pattern', pattern: 'mistral' }, sprite: 'local', displayName: 'Mistral' },
    { match: { kind: 'pattern', pattern: 'gemma' }, sprite: 'local', displayName: 'Gemma' },
    { match: { kind: 'pattern', pattern: 'phi' }, sprite: 'local', displayName: 'Phi' },
    { match: { kind: 'pattern', pattern: 'bielik' }, sprite: 'local', displayName: 'Bielik' },
    { match: { kind: 'pattern', pattern: 'glm' }, sprite: 'local', displayName: 'GLM' },
    { match: { kind: 'pattern', pattern: 'lfm' }, sprite: 'local', displayName: 'LFM' },
  ],
  windows: [
    { match: { kind: 'pattern', pattern: '[1m]' }, contextWindow: 1_000_000 }, // explicit 1M tag beats base model
    { match: { kind: 'exact', id: 'gpt-5.5' }, contextWindow: 258_400 },
    { match: { kind: 'pattern', pattern: 'gpt-5.4' }, contextWindow: 258_400 },
    { match: { kind: 'pattern', pattern: 'gpt-' }, contextWindow: 258_400 },
    { match: { kind: 'pattern', pattern: 'opus' }, contextWindow: 1_000_000 }, // Opus 4.6/4.7/4.8 = 1M
    { match: { kind: 'pattern', pattern: 'sonnet' }, contextWindow: 1_000_000 }, // Sonnet 4.6 = 1M
    { match: { kind: 'pattern', pattern: 'haiku' }, contextWindow: 200_000 }, // Haiku 4.5 = 200k
    { match: { kind: 'pattern', pattern: 'fable' }, contextWindow: 1_000_000 }, // Fable 5 = 1M
  ],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 }, // unknown models: conservative 200k
};

function sameModelMatch(a: ModelMatch, b: ModelMatch): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'exact' && b.kind === 'exact') return a.id === b.id;
  if (a.kind === 'pattern' && b.kind === 'pattern') return a.pattern === b.pattern;
  return false;
}

/**
 * Keeps user-saved registries forward-compatible with new built-in presets.
 * Existing user rules stay first and continue to win; missing default rules are
 * appended so older saved configs recognize newly supported models.
 */
export function upgradeModelConfig(config: ModelConfig): ModelConfig {
  const sprites = [...config.sprites];
  for (const rule of DEFAULT_MODEL_CONFIG.sprites) {
    if (!sprites.some((existing) => sameModelMatch(existing.match, rule.match))) {
      sprites.push(rule);
    }
  }

  const windows = [...config.windows];
  for (const rule of DEFAULT_MODEL_CONFIG.windows) {
    if (!windows.some((existing) => sameModelMatch(existing.match, rule.match))) {
      windows.push(rule);
    }
  }

  return { sprites, windows, fallback: config.fallback };
}

/** Validates a raw object as ModelConfig. Builds a clean config without extra fields. */
export function validateModelConfig(
  input: unknown,
): { ok: true; config: ModelConfig } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Config must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.sprites)) return { ok: false, error: 'Missing "sprites" array.' };
  if (!Array.isArray(obj.windows)) return { ok: false, error: 'Missing "windows" array.' };
  if (typeof obj.fallback !== 'object' || obj.fallback === null) {
    return { ok: false, error: 'Missing "fallback" object.' };
  }
  const fb = obj.fallback as Record<string, unknown>;
  if (!isSpriteId(fb.sprite)) return { ok: false, error: `Unknown "fallback.sprite": ${String(fb.sprite)}.` };
  if (typeof fb.contextWindow !== 'number' || !(fb.contextWindow > 0)) {
    return { ok: false, error: 'Field "fallback.contextWindow" must be a number > 0.' };
  }

  const cleanMatch = (
    raw: unknown,
    where: string,
  ): { ok: true; match: ModelMatch } | { ok: false; error: string } => {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `${where}: "match" is not an object.` };
    const mm = raw as Record<string, unknown>;
    if (mm.kind === 'exact') {
      if (typeof mm.id !== 'string' || !mm.id) return { ok: false, error: `${where}: "exact" requires a non-empty "id".` };
      return { ok: true, match: { kind: 'exact', id: mm.id } };
    }
    if (mm.kind === 'pattern') {
      if (typeof mm.pattern !== 'string' || !mm.pattern) return { ok: false, error: `${where}: "pattern" requires a non-empty "pattern".` };
      return { ok: true, match: { kind: 'pattern', pattern: mm.pattern } };
    }
    return { ok: false, error: `${where}: unknown "match.kind" ${String(mm.kind)}.` };
  };

  const sprites: SpriteRule[] = [];
  for (let i = 0; i < obj.sprites.length; i++) {
    const raw = obj.sprites[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `sprites[${i}]: not an object.` };
    const r = raw as Record<string, unknown>;
    const m = cleanMatch(r.match, `sprites[${i}]`);
    if (!m.ok) return m;
    if (!isSpriteId(r.sprite)) return { ok: false, error: `sprites[${i}]: unknown "sprite" ${String(r.sprite)}.` };
    const rule: SpriteRule = { match: m.match, sprite: r.sprite };
    if (r.displayName !== undefined) {
      if (typeof r.displayName !== 'string') return { ok: false, error: `sprites[${i}]: "displayName" must be a string.` };
      rule.displayName = r.displayName;
    }
    sprites.push(rule);
  }

  const windows: WindowRule[] = [];
  for (let i = 0; i < obj.windows.length; i++) {
    const raw = obj.windows[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `windows[${i}]: not an object.` };
    const r = raw as Record<string, unknown>;
    const m = cleanMatch(r.match, `windows[${i}]`);
    if (!m.ok) return m;
    if (typeof r.contextWindow !== 'number' || !(r.contextWindow > 0)) {
      return { ok: false, error: `windows[${i}]: "contextWindow" must be a number > 0.` };
    }
    windows.push({ match: m.match, contextWindow: r.contextWindow });
  }

  return { ok: true, config: { sprites, windows, fallback: { sprite: fb.sprite, contextWindow: fb.contextWindow } } };
}

/** Output token usage for a building across time windows. */
export interface BuildingWindowStats {
  today: number;
  week: number;
  month: number;
}

export interface BuildingStatsResponse {
  updatedAt: string;
  buildings: Partial<Record<BuildingId, BuildingWindowStats>>;
}
