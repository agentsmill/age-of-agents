import { describe, it, expect } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import { decideHook } from '../src/hook-decide.js';
import { decisionToHookOutput } from '../src/hooks.js';
import type { PermissionPolicy } from '@agent-citadel/shared';

const on = (rules: PermissionPolicy['rules'] = []): PermissionPolicy => ({ enabled: true, rules });

describe('decisionToHookOutput', () => {
  it('allow shape', () => {
    expect(decisionToHookOutput('allow')).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  });
  it('deny shape with reason', () => {
    expect(decisionToHookOutput('deny', 'nope')).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'nope' },
    });
  });
});

describe('decideHook', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf x' },
    ...over,
  });

  it('disabled policy -> defer ({})', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: { enabled: false, rules: [] }, registry: reg, timeoutMs: 1000, onAlwaysRule: async () => {} });
    expect(out).toEqual({});
  });

  it('safe tool -> allow output', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body({ tool_name: 'Read', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 1000, onAlwaysRule: async () => {} });
    expect(out).toEqual(decisionToHookOutput('allow'));
  });

  it('risky tool, answered allow -> allow output and persists when scope=always', async () => {
    const reg = new PendingRegistry(new World());
    const saved: unknown[] = [];
    const p = decideHook(body(), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async (r) => { saved.push(r); } });
    const open = reg.open();
    expect(open).toHaveLength(1);
    reg.resolve({ id: open[0].id, decision: { type: 'allow', scope: 'always' } });
    expect(await p).toEqual(decisionToHookOutput('allow'));
    expect(saved).toEqual([{ tool: 'Bash', match: 'any', decision: 'allow', scope: 'global' }]);
  });

  it('risky tool, timeout -> defer ({})', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: on(), registry: reg, timeoutMs: 1, onAlwaysRule: async () => {} });
    expect(out).toEqual({});
  });

  it('plan approve -> allow; plan reject -> defer', async () => {
    const reg = new PendingRegistry(new World());
    const approve = decideHook(body({ tool_name: 'ExitPlanMode', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    reg.resolve({ id: reg.open()[0].id, decision: { type: 'approve-plan' } });
    expect(await approve).toEqual(decisionToHookOutput('allow'));

    const reject = decideHook(body({ tool_name: 'ExitPlanMode', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    reg.resolve({ id: reg.open()[0].id, decision: { type: 'reject-plan' } });
    expect(await reject).toEqual({});
  });
});
