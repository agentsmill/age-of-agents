import type { World } from './world.js';
import type { PendingQuestion, QuestionAnswer, QuestionDecision } from '@agent-citadel/shared';

interface Entry {
  question: PendingQuestion;
  resolve: (decision: QuestionDecision | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Tracks questions awaiting a human answer. Each `ask` broadcasts a
 * `pending-question` event and returns a promise that settles when the user
 * answers (via `resolve`), the session is cancelled, or the timeout fires (null).
 */
export class PendingRegistry {
  private entries = new Map<string, Entry>();

  constructor(private world: World) {}

  ask(question: PendingQuestion, timeoutMs: number): Promise<QuestionDecision | null> {
    return new Promise((resolve) => {
      const settle = (decision: QuestionDecision | null) => {
        const entry = this.entries.get(question.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.entries.delete(question.id);
        this.world.emitCustom({ type: 'pending-question-resolved', id: question.id });
        resolve(decision);
      };
      const timer = setTimeout(() => settle(null), timeoutMs);
      this.entries.set(question.id, { question, resolve: settle, timer });
      this.world.emitCustom({ type: 'pending-question', question });
    });
  }

  /** Resolve from a client answer. Returns false if the id is unknown/expired. */
  resolve(answer: QuestionAnswer): boolean {
    const entry = this.entries.get(answer.id);
    if (!entry) return false;
    entry.resolve(answer.decision);
    return true;
  }

  cancelForSession(sessionId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.question.sessionId === sessionId) entry.resolve(null);
    }
  }

  /** Snapshot of currently open questions (for new clients). */
  open(): PendingQuestion[] {
    return [...this.entries.values()].map((e) => e.question);
  }
}
