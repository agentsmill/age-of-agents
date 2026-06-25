import { describe, it, expect } from 'vitest';
import {
  evaluatePolicy,
  classifyHookEvent,
  isSafeTool,
  validatePermissionPolicy,
  validateQuestionAnswer,
  DEFAULT_PERMISSION_POLICY,
  type PermissionPolicy,
} from '@agent-citadel/shared';

const enabled = (rules: PermissionPolicy['rules'] = []): PermissionPolicy => ({ enabled: true, rules });

describe('isSafeTool', () => {
  it('read-only tools are safe', () => {
    expect(isSafeTool('Read')).toBe(true);
    expect(isSafeTool('Grep')).toBe(true);
  });
  it('mutating tools are not safe', () => {
    expect(isSafeTool('Bash')).toBe(false);
    expect(isSafeTool('Edit')).toBe(false);
  });
});

describe('evaluatePolicy', () => {
  it('safe tool -> allow', () => {
    expect(evaluatePolicy('Read', undefined, enabled(), 's1')).toBe('allow');
  });
  it('unknown risky tool -> pending', () => {
    expect(evaluatePolicy('Bash', 'rm -rf x', enabled(), 's1')).toBe('pending');
  });
  it('global allow rule (any) -> allow', () => {
    const p = enabled([{ tool: 'Bash', match: 'any', decision: 'allow', scope: 'global' }]);
    expect(evaluatePolicy('Bash', 'whatever', p, 's1')).toBe('allow');
  });
  it('prefix rule matches on detail', () => {
    const p = enabled([{ tool: 'Bash', match: 'prefix', value: 'npm ', decision: 'allow', scope: 'global' }]);
    expect(evaluatePolicy('Bash', 'npm test', p, 's1')).toBe('allow');
    expect(evaluatePolicy('Bash', 'rm -rf', p, 's1')).toBe('pending');
  });
  it('session-scoped rule only applies to that session', () => {
    const p = enabled([{ tool: 'Edit', match: 'any', decision: 'allow', scope: 'session:s1' }]);
    expect(evaluatePolicy('Edit', undefined, p, 's1')).toBe('allow');
    expect(evaluatePolicy('Edit', undefined, p, 's2')).toBe('pending');
  });
  it('deny rule wins over safe list', () => {
    const p = enabled([{ tool: 'Read', match: 'any', decision: 'deny', scope: 'global' }]);
    expect(evaluatePolicy('Read', undefined, p, 's1')).toBe('deny');
  });
});

describe('classifyHookEvent', () => {
  const base = { hookEvent: 'PreToolUse' as const, sessionId: 's1' };
  it('disabled policy -> defer', () => {
    expect(classifyHookEvent({ ...base, tool: 'Bash' }, DEFAULT_PERMISSION_POLICY).action).toBe('defer');
  });
  it('AskUserQuestion -> show-question', () => {
    expect(classifyHookEvent({ ...base, tool: 'AskUserQuestion' }, enabled()).action).toBe('show-question');
  });
  it('ExitPlanMode -> ask-plan', () => {
    expect(classifyHookEvent({ ...base, tool: 'ExitPlanMode' }, enabled()).action).toBe('ask-plan');
  });
  it('risky tool, no rule -> ask-permission', () => {
    expect(classifyHookEvent({ ...base, tool: 'Bash', detail: 'rm' }, enabled()).action).toBe('ask-permission');
  });
  it('safe tool -> allow', () => {
    expect(classifyHookEvent({ ...base, tool: 'Read' }, enabled()).action).toBe('allow');
  });
  it('non-PreToolUse -> defer', () => {
    expect(classifyHookEvent({ hookEvent: 'Stop', sessionId: 's1' }, enabled()).action).toBe('defer');
  });
});

describe('validatePermissionPolicy', () => {
  it('accepts a clean policy', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'allow' }] });
    expect(res.ok).toBe(true);
  });
  it('rejects unknown decision', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'maybe' }] });
    expect(res.ok).toBe(false);
  });
  it('rejects prefix rule without value', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'prefix', decision: 'allow' }] });
    expect(res.ok).toBe(false);
  });
});

describe('validateQuestionAnswer', () => {
  it('accepts allow always', () => {
    expect(validateQuestionAnswer({ id: 'x', decision: { type: 'allow', scope: 'always' } }).ok).toBe(true);
  });
  it('rejects missing id', () => {
    expect(validateQuestionAnswer({ decision: { type: 'allow' } }).ok).toBe(false);
  });
  it('rejects unknown decision type', () => {
    expect(validateQuestionAnswer({ id: 'x', decision: { type: 'nope' } }).ok).toBe(false);
  });
});
