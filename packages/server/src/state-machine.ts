import { basename } from 'node:path';
import type { ActionEntry, AgentKind, HeroSnapshot, WieldedArsenal } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import { cleanTitle, isSubstantialPrompt } from './transcript/title.js';
import type { World } from './world.js';

/**
 * Time thresholds controlling unit lifecycle on the map.
 * These are game UX decisions, not technicalities; see DEFAULT_THRESHOLDS below.
 */
export interface StateThresholds {
  /** After how many ms since last activity the hero switches to 'idle' (stands by citadel). */
  idleAfterMs: number;
  /** After how many ms 'idle' changes to 'sleeping' (desaturation, zzz). */
  sleepAfterMs: number;
  /** After how many ms asleep the hero disappears from the map. */
  removeAfterMs: number;
  /** How long the hero shows 'error' before returning to work/idle. */
  errorFlashMs: number;
  /** After how many ms without transcript writes a peon (subagent) is considered completed. */
  peonDoneAfterMs: number;
}

// "Balanced" profile: user project choice (2026-06-13), rhythm similar to
// AgentCraft (sleep after 5 min idle).
export const DEFAULT_THRESHOLDS: StateThresholds = {
  idleAfterMs: 30_000,
  sleepAfterMs: 5 * 60_000,
  removeAfterMs: 30 * 60_000,
  errorFlashMs: 4_000,
  peonDoneAfterMs: 90_000,
};

type SessionTrackerExtra = Partial<Pick<HeroSnapshot, 'container'>>;

/**
 * State machine for one session: consumes Facts (from transcript or hooks) and
 * mutates World. Knows neither JSONL format nor data source.
 */
export class SessionTracker {
  private seenUsage = new Set<string>();
  private _tokens = { input: 0, output: 0 };
  private contextTokens?: number;
  private contextWindowTokens?: number;
  /** Public getter for comparing with new values (for example in OpenCode poller). */
  get tokens(): { input: number; output: number } {
    return this._tokens;
  }
  private missionCounter = 0;
  private activeMissionId?: string;
  private errorUntil = 0;
  private lastPrompt = { text: '', atMs: 0 };
  // Hero-name candidates in descending priority (see displayTitle()).
  private explicitTitle?: string; // explicit CLI title (custom-title/ai-title), if Claude version records it
  private firstSubstantialPrompt?: string; // pierwszy SENSOWNY prompt (nie "ok"/"dawaj") — stabilna nazwa
  private projectName?: string; // basename cwd, np. "RTS agents"
  private workingDir?: string; // full cwd from transcript: real path to arsenal config
  private recentActions: ActionEntry[] = []; // recent tools, newest first (activity axis in panel)
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
    /** Static fields mixed into the hero and preserved across patches. */
    private readonly extra: SessionTrackerExtra = {},
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
      contextWindowTokens: this.contextWindowTokens,
      wielded: this.wielded(),
      startedAt: now,
      lastActivityAt: now,
      ...(this.extra.container ? { container: this.extra.container } : {}),
    };
  }

  /** Hero name by priority: explicit title -> first MEANINGFUL prompt -> project -> UUID.
   *  Conversational openers ("ok"/"dawaj"/"realizuj plan") NEVER become the name. */
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
        // Hook and watcher see the same prompt through two channels: deduplicate.
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

      case 'subagent-meta':
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
        // Activity axis: add tool at buffer start (newest first), trim.
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
          if (typeof fact.contextWindow === 'number') this.contextWindowTokens = fact.contextWindow;
          this.patch({
            tokens: this._tokens,
            ...(typeof fact.context === 'number' ? { contextTokens: fact.context } : {}),
            ...(typeof fact.contextWindow === 'number' ? { contextWindowTokens: fact.contextWindow } : {}),
          });
        }
        break;

      case 'usage-total':
        // Codex: token_count is cumulative -> SET, do not add.
        this._tokens = { input: fact.input, output: fact.output };
        if (typeof fact.context === 'number') this.contextTokens = fact.context;
        if (typeof fact.contextWindow === 'number') this.contextWindowTokens = fact.contextWindow;
        this.patch({
          tokens: this._tokens,
          ...(typeof fact.context === 'number' ? { contextTokens: fact.context } : {}),
          ...(typeof fact.contextWindow === 'number' ? { contextWindowTokens: fact.contextWindow } : {}),
        });
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

      case 'turn-aborted':
        this.patch({ state: 'recovering', currentTool: undefined, toolDetail: undefined }, fact.ts);
        if (this.activeMissionId) {
          this.world.completeMission(this.activeMissionId, 'failed', fact.ts);
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

      case 'cleared':
        {
          const parsed = Date.parse(fact.ts);
          this.patch({ clearedAt: Number.isFinite(parsed) ? parsed : Date.now() }, fact.ts);
        }
        break;
    }
  }

  private inErrorFlash(): boolean {
    return Date.now() < this.errorUntil;
  }

  /** Called periodically: transitions that depend on elapsed time. */
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
      (hero.state === 'returning' || hero.state === 'recovering' || hero.state === 'working' || hero.state === 'thinking')
    ) {
      this.world.upsertHero({ ...hero, state: 'idle', currentTool: undefined, toolDetail: undefined });
    }
    return 'keep';
  }
}
