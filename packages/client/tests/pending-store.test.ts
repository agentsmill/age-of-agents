import { describe, it, expect, beforeEach } from 'vitest';
import { useWorld } from '../src/store';
import type { PendingQuestion } from '@agent-citadel/shared';

const q = (id: string, sessionId: string): PendingQuestion => ({
  id, sessionId, source: 'hook', kind: 'tool-permission', tool: 'Bash', detail: 'rm', createdAt: '2026-06-21T00:00:00Z',
});

beforeEach(() => {
  useWorld.getState().apply({ type: 'snapshot', heroes: [], peons: [], missions: [], transcripts: [], arsenals: [] });
});

describe('pending-question store handling', () => {
  it('adds and removes a pending question', () => {
    useWorld.getState().apply({ type: 'pending-question', question: q('p1', 's1') });
    expect(useWorld.getState().pending.p1).toBeDefined();
    useWorld.getState().apply({ type: 'pending-question-resolved', id: 'p1' });
    expect(useWorld.getState().pending.p1).toBeUndefined();
  });

  it('snapshot resets pending', () => {
    useWorld.getState().apply({ type: 'pending-question', question: q('p2', 's1') });
    useWorld.getState().apply({ type: 'snapshot', heroes: [], peons: [], missions: [], transcripts: [], arsenals: [] });
    expect(Object.keys(useWorld.getState().pending)).toHaveLength(0);
  });

  it('hero-removed clears that session\'s pending questions', () => {
    useWorld.getState().apply({ type: 'pending-question', question: q('p3', 's1') });
    useWorld.getState().apply({ type: 'pending-question', question: q('p4', 's2') });
    useWorld.getState().apply({ type: 'hero-removed', sessionId: 's1' });
    expect(useWorld.getState().pending.p3).toBeUndefined();
    expect(useWorld.getState().pending.p4).toBeDefined();
  });
});
