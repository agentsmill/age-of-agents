import { basename } from 'node:path';
import type { ActionEntry, AgentKind, HeroSnapshot, HeroStateKind, WieldedArsenal } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import { cleanTitle, isSubstantialPrompt } from './transcript/title.js';
import type { World } from './world.js';

/**
 * Progi czasowe sterujące cyklem życia jednostek na mapie.
 * To decyzje UX gry, nie technikalia — patrz profil DEFAULT_THRESHOLDS niżej.
 */
export interface StateThresholds {
  /** Po ilu ms od ostatniej aktywności bohater przechodzi w 'idle' (stoi przy twierdzy). */
  idleAfterMs: number;
  /** Po ilu ms 'idle' zmienia się w 'sleeping' (desaturacja, zzz). */
  sleepAfterMs: number;
  /** Po ilu ms snu bohater znika z mapy. */
  removeAfterMs: number;
  /** Jak długo bohater pokazuje stan 'error' zanim wróci do pracy/idle. */
  errorFlashMs: number;
  /** Po ilu ms bez zapisu transkryptu peon (subagent) uznawany jest za ukończonego. */
  peonDoneAfterMs: number;
}

// Profil "zrównoważony" — wybór projektowy użytkownika (2026-06-13):
// rytm zbliżony do AgentCrafta (sen po 5 min bezczynności).
export const DEFAULT_THRESHOLDS: StateThresholds = {
  idleAfterMs: 30_000,
  sleepAfterMs: 5 * 60_000,
  removeAfterMs: 30 * 60_000,
  errorFlashMs: 4_000,
  peonDoneAfterMs: 90_000,
};

/**
 * Maszyna stanów jednej sesji: konsumuje Fakty (z transkryptu lub hooków)
 * i mutuje World. Nie zna formatu JSONL ani źródła danych.
 */
export class SessionTracker {
  private seenUsage = new Set<string>();
  private _tokens = { input: 0, output: 0 };
  private contextTokens?: number;
  /** Publiczny getter do porównywania z nowymi wartościami (np. w OpenCode pollerze). */
  get tokens(): { input: number; output: number } {
    return this._tokens;
  }
  private missionCounter = 0;
  private activeMissionId?: string;
  private errorUntil = 0;
  private lastPrompt = { text: '', atMs: 0 };
  // Kandydaci na nazwę bohatera, wg malejącego priorytetu (patrz displayTitle()).
  private explicitTitle?: string; // jawny tytuł z CLI (custom-title/ai-title), jeśli wersja Claude go zapisze
  private firstSubstantialPrompt?: string; // pierwszy SENSOWNY prompt (nie "ok"/"dawaj") — stabilna nazwa
  private projectName?: string; // basename cwd, np. "RTS agents"
  private workingDir?: string; // pełny cwd z transkryptu — realna ścieżka do konfiguracji arsenału
  private recentActions: ActionEntry[] = []; // ostatnie narzędzia, najnowsze pierwsze (oś aktywności w panelu)
  private wieldedSkills = new Set<string>();
  private wieldedConnectors = new Set<string>();
  private wieldedPlugins = new Set<string>();

  private static readonly MAX_RECENT_ACTIONS = 5;

  constructor(
    private readonly world: World,
    private readonly sessionId: string,
    private readonly projectDir: string,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
    private readonly agent: AgentKind = 'claude',
  ) {}

  private wielded(): WieldedArsenal {
    return {
      skills: [...this.wieldedSkills],
      connectors: [...this.wieldedConnectors],
      plugins: [...this.wieldedPlugins],
    };
  }

  private hero(): HeroSnapshot {
    const existing = this.world.getHero(this.sessionId);
    if (existing) return existing;
    const now = new Date().toISOString();
    return {
      sessionId: this.sessionId,
      agent: this.agent,
      title: this.displayTitle(),
      projectDir: this.projectDir,
      workingDir: this.workingDir,
      projectName: this.projectName,
      teamColor: this.world.claimTeamColor(),
      state: 'idle',
      tokens: this.tokens,
      recentActions: this.recentActions,
      contextTokens: this.contextTokens,
      wielded: this.wielded(),
      startedAt: now,
      lastActivityAt: now,
    };
  }

  /** Nazwa bohatera wg priorytetu: jawny tytuł → pierwszy SENSOWNY prompt → projekt → UUID.
   *  Konwersacyjne openery ("ok"/"dawaj"/"realizuj plan") NIGDY nie zostają nazwą. */
  private displayTitle(): string {
    return this.explicitTitle ?? this.firstSubstantialPrompt ?? this.projectName ?? this.sessionId.slice(0, 8);
  }

  private patch(patch: Partial<HeroSnapshot>, ts?: string): void {
    const hero = this.hero();
    this.world.upsertHero({
      ...hero,
      ...patch,
      lastActivityAt: ts ?? new Date().toISOString(),
    });
  }

  apply(fact: Fact): void {
    switch (fact.kind) {
      case 'prompt': {
        // Hook i watcher widzą ten sam prompt dwoma kanałami — deduplikuj.
        const atMs = Date.parse(fact.ts) || Date.now();
        if (fact.text === this.lastPrompt.text && Math.abs(atMs - this.lastPrompt.atMs) < 15_000) break;
        this.lastPrompt = { text: fact.text, atMs };
        // Stabilna nazwa = pierwszy SENSOWNY prompt (pomija "ok"/"dawaj"/"realizuj plan").
        if (!this.firstSubstantialPrompt && isSubstantialPrompt(fact.text)) {
          this.firstSubstantialPrompt = cleanTitle(fact.text);
        }
        this.missionCounter++;
        this.activeMissionId = `${this.sessionId}-m${this.missionCounter}`;
        this.world.startMission({
          id: this.activeMissionId,
          sessionId: this.sessionId,
          prompt: fact.text,
          status: 'active',
          startedAt: fact.ts,
        });
        this.patch({ state: 'thinking', title: this.displayTitle() }, fact.ts);
        this.world.emitTranscriptLine({
          type: 'transcript-line',
          line: { sessionId: this.sessionId, role: 'user', text: fact.text, ts: fact.ts },
        });
        break;
      }

      case 'title':
        this.explicitTitle = fact.title;
        this.patch({ title: this.displayTitle() });
        break;

      case 'meta':
        if (fact.cwd) {
          this.projectName = basename(fact.cwd);
          this.workingDir = fact.cwd;
        }
        this.patch({
          ...(this.projectName ? { projectName: this.projectName, title: this.displayTitle() } : {}),
          ...(this.workingDir ? { workingDir: this.workingDir } : {}),
          ...(fact.model ? { model: fact.model } : {}),
          ...(fact.gitBranch ? { gitBranch: fact.gitBranch } : {}),
          ...(fact.permissionMode ? { permissionMode: fact.permissionMode } : {}),
        });
        break;

      case 'thinking':
        if (!this.inErrorFlash()) this.patch({ state: 'thinking', currentTool: undefined, toolDetail: undefined }, fact.ts);
        break;

      case 'assistant-text':
        this.world.emitTranscriptLine({
          type: 'transcript-line',
          line: { sessionId: this.sessionId, role: 'assistant', text: fact.text, ts: fact.ts },
        });
        break;

      case 'tool-start': {
        // Oś aktywności: dorzuć narzędzie na początek bufora (najnowsze pierwsze), przytnij.
        this.recentActions = [{ tool: fact.tool, detail: fact.detail, ts: fact.ts }, ...this.recentActions].slice(
          0,
          SessionTracker.MAX_RECENT_ACTIONS,
        );
        const awaiting = fact.tool === 'AskUserQuestion' || fact.tool === 'ExitPlanMode';
        this.patch(
          { state: awaiting ? 'awaiting-input' : 'working', currentTool: fact.tool, toolDetail: fact.detail, recentActions: this.recentActions },
          fact.ts,
        );
        break;
      }

      case 'usage':
        if (!this.seenUsage.has(fact.messageId)) {
          this.seenUsage.add(fact.messageId);
          this._tokens = {
            input: this.tokens.input + fact.input,
            output: this.tokens.output + fact.output,
          };
          if (typeof fact.context === 'number') this.contextTokens = fact.context;
          this.patch({ tokens: this._tokens, ...(typeof fact.context === 'number' ? { contextTokens: fact.context } : {}) });
        }
        break;

      case 'usage-total':
        // Codex: token_count jest kumulatywny → USTAW, nie dodawaj.
        this._tokens = { input: fact.input, output: fact.output };
        this.patch({ tokens: this._tokens });
        break;

      case 'tool-result':
        if (fact.isError) {
          this.errorUntil = Date.now() + this.thresholds.errorFlashMs;
          this.patch({ state: 'error' }, fact.ts);
        } else if (this.world.getHero(this.sessionId)?.state === 'awaiting-input') {
          // Odpowiedź usera na AskUserQuestion/ExitPlanMode: gasimy "!" od razu.
          // Nie czekamy, aż w transkrypcie pojawi się blok 'thinking' (bywa, że
          // kontynuacja jest samym tekstem) — inaczej bohater wisiał w awaiting-input.
          this.patch({ state: 'thinking', currentTool: undefined, toolDetail: undefined }, fact.ts);
        }
        break;

      case 'turn-end':
        this.patch({ state: 'returning', currentTool: undefined, toolDetail: undefined }, fact.ts);
        if (this.activeMissionId) {
          this.world.completeMission(this.activeMissionId, 'completed', fact.ts);
          this.activeMissionId = undefined;
        }
        break;

      case 'attribution': {
        let changed = false;
        if (fact.skill && !this.wieldedSkills.has(fact.skill)) { this.wieldedSkills.add(fact.skill); changed = true; }
        if (fact.mcpServer && !this.wieldedConnectors.has(fact.mcpServer)) { this.wieldedConnectors.add(fact.mcpServer); changed = true; }
        if (fact.plugin && !this.wieldedPlugins.has(fact.plugin)) { this.wieldedPlugins.add(fact.plugin); changed = true; }
        if (changed) this.patch({ wielded: this.wielded() });
        break;
      }

      case 'awaiting':
        this.patch({ state: 'awaiting-input', currentTool: undefined }, fact.ts);
        break;
    }
  }

  private inErrorFlash(): boolean {
    return Date.now() < this.errorUntil;
  }

  /** Wywoływane okresowo — przejścia zależne od upływu czasu. */
  tick(nowMs: number): 'keep' | 'remove' {
    const hero = this.world.getHero(this.sessionId);
    if (!hero) return 'remove';
    const sinceActivity = nowMs - Date.parse(hero.lastActivityAt);

    if (hero.state === 'error' && !this.inErrorFlash()) {
      this.patch({ state: 'idle' });
      return 'keep';
    }
    if (sinceActivity > this.thresholds.removeAfterMs) {
      this.world.removeHero(this.sessionId);
      return 'remove';
    }
    if (sinceActivity > this.thresholds.sleepAfterMs && hero.state !== 'sleeping') {
      this.world.upsertHero({ ...hero, state: 'sleeping' });
    } else if (
      sinceActivity > this.thresholds.idleAfterMs &&
      (hero.state === 'returning' || hero.state === 'working' || hero.state === 'thinking')
    ) {
      this.world.upsertHero({ ...hero, state: 'idle', currentTool: undefined, toolDetail: undefined });
    }
    return 'keep';
  }
}
