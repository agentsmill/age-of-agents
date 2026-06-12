import type { HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';
import type { Fact } from './transcript/facts.js';
import type { World } from './world.js';

/**
 * Progi czasowe sterujące cyklem życia jednostek na mapie.
 * To decyzje UX gry, nie technikalia — patrz TODO niżej.
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
  private tokens = { input: 0, output: 0 };
  private missionCounter = 0;
  private activeMissionId?: string;
  private errorUntil = 0;

  constructor(
    private readonly world: World,
    private readonly sessionId: string,
    private readonly projectDir: string,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
  ) {}

  private hero(): HeroSnapshot {
    const existing = this.world.getHero(this.sessionId);
    if (existing) return existing;
    const now = new Date().toISOString();
    return {
      sessionId: this.sessionId,
      title: this.sessionId.slice(0, 8),
      projectDir: this.projectDir,
      teamColor: this.world.claimTeamColor(),
      state: 'idle',
      tokens: this.tokens,
      startedAt: now,
      lastActivityAt: now,
    };
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
        this.missionCounter++;
        this.activeMissionId = `${this.sessionId}-m${this.missionCounter}`;
        this.world.startMission({
          id: this.activeMissionId,
          sessionId: this.sessionId,
          prompt: fact.text,
          status: 'active',
          startedAt: fact.ts,
        });
        this.patch({ state: 'thinking' }, fact.ts);
        this.world.emitTranscriptLine({
          type: 'transcript-line',
          line: { sessionId: this.sessionId, role: 'user', text: fact.text, ts: fact.ts },
        });
        break;
      }

      case 'title':
        this.patch({ title: fact.title });
        break;

      case 'meta':
        this.patch({
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

      case 'tool-start':
        if (fact.tool === 'AskUserQuestion' || fact.tool === 'ExitPlanMode') {
          this.patch({ state: 'awaiting-input', currentTool: fact.tool, toolDetail: fact.detail }, fact.ts);
        } else {
          this.patch({ state: 'working', currentTool: fact.tool, toolDetail: fact.detail }, fact.ts);
        }
        break;

      case 'usage':
        if (!this.seenUsage.has(fact.messageId)) {
          this.seenUsage.add(fact.messageId);
          this.tokens = {
            input: this.tokens.input + fact.input,
            output: this.tokens.output + fact.output,
          };
          this.patch({ tokens: this.tokens });
        }
        break;

      case 'tool-result':
        if (fact.isError) {
          this.errorUntil = Date.now() + this.thresholds.errorFlashMs;
          this.patch({ state: 'error' }, fact.ts);
        }
        break;

      case 'turn-end':
        this.patch({ state: 'returning', currentTool: undefined, toolDetail: undefined }, fact.ts);
        if (this.activeMissionId) {
          this.world.completeMission(this.activeMissionId, 'completed', fact.ts);
          this.activeMissionId = undefined;
        }
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
