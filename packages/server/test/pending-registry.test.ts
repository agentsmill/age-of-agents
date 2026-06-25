import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import type { PendingQuestion } from '@agent-citadel/shared';

function q(id: string, sessionId = 's1'): PendingQuestion {
  return { id, sessionId, source: 'hook', kind: 'tool-permission', tool: 'Bash', detail: 'rm', createdAt: '2026-06-21T00:00:00Z' };
}

describe('PendingRegistry', () => {
  it('broadcasts on ask and resolves with the answered decision', async () => {
    const world = new World();
    const events: string[] = [];
    world.onEvent((e) => events.push(e.type));
    const reg = new PendingRegistry(world);

    const promise = reg.ask(q('a1'), 5000);
    expect(events).toContain('pending-question');
    expect(reg.resolve({ id: 'a1', decision: { type: 'deny', reason: 'no' } })).toBe(true);

    await expect(promise).resolves.toEqual({ type: 'deny', reason: 'no' });
    expect(events).toContain('pending-question-resolved');
  });

  it('returns null on timeout', async () => {
    vi.useFakeTimers();
    const reg = new PendingRegistry(new World());
    const promise = reg.ask(q('a2'), 1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('resolve of unknown id returns false', () => {
    const reg = new PendingRegistry(new World());
    expect(reg.resolve({ id: 'nope', decision: { type: 'allow' } })).toBe(false);
  });

  it('cancelForSession resolves matching questions with null', async () => {
    const reg = new PendingRegistry(new World());
    const p = reg.ask(q('a3', 's9'), 5000);
    reg.cancelForSession('s9');
    await expect(p).resolves.toBeNull();
  });
});
