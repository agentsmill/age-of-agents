import { describe, it, expect } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import { decideHook, parseAskUserQuestion } from '../src/hook-decide.js';
import type { PermissionPolicy } from '@agent-citadel/shared';

const on = (rules: PermissionPolicy['rules'] = []): PermissionPolicy => ({ enabled: true, rules });

describe('parseAskUserQuestion', () => {
  it('extracts question + options from the nested {questions:[...]} shape', () => {
    const r = parseAskUserQuestion({
      questions: [{ question: 'Which DB?', options: [{ label: 'Postgres' }, { label: 'SQLite', description: 'file-based' }] }],
    });
    expect(r.question).toBe('Which DB?');
    expect(r.options).toEqual([{ label: 'Postgres' }, { label: 'SQLite', description: 'file-based' }]);
  });

  it('handles the flat {question, options} shape and string options', () => {
    const r = parseAskUserQuestion({ question: 'Pick one', options: ['A', 'B'] });
    expect(r.question).toBe('Pick one');
    expect(r.options).toEqual([{ label: 'A' }, { label: 'B' }]);
  });

  it('returns empty object for missing/garbage input', () => {
    expect(parseAskUserQuestion(undefined)).toEqual({});
    expect(parseAskUserQuestion({})).toEqual({});
  });
});

describe('decideHook: AskUserQuestion display', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Which DB?', options: [{ label: 'Postgres' }, { label: 'SQLite', description: 'file-based' }] }] },
    ...over,
  });

  it('registers a display-only pending card and defers ({})', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    expect(out).toEqual({}); // defer: terminal still answers the question
    const open = reg.open();
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('ask-user-question');
    expect(open[0].source).toBe('hook');
    expect(open[0].detail).toBe('Which DB?');
    expect(open[0].options).toEqual([{ label: 'Postgres' }, { label: 'SQLite', description: 'file-based' }]);
    reg.cancelForSession('s1'); // clean up the pending timer
  });

  it('does not register anything when the policy is disabled', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: { enabled: false, rules: [] }, registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    expect(out).toEqual({});
    expect(reg.open()).toHaveLength(0);
  });
});
