import { describe, it, expect } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import { makeCanUseTool } from '../src/sdk/bridge.js';

const reg = () => new PendingRegistry(new World());

describe('makeCanUseTool', () => {
  it('safe tool -> allow without prompting', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    await expect(canUse('Read', { file_path: 'a.ts' }, { toolUseID: 't1' } as never)).resolves.toEqual({ behavior: 'allow' });
    expect(r.open()).toHaveLength(0);
  });
  it('risky tool -> pending; allow answer -> allow', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const p = canUse('Bash', { command: 'rm -rf x' }, { toolUseID: 't2' } as never);
    const q = r.open()[0];
    expect(q.kind).toBe('tool-permission');
    r.resolve({ id: q.id, decision: { type: 'allow' } });
    await expect(p).resolves.toEqual({ behavior: 'allow' });
  });
  it('risky tool -> deny answer -> deny with message', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const p = canUse('Bash', { command: 'rm' }, { toolUseID: 't3' } as never);
    r.resolve({ id: r.open()[0].id, decision: { type: 'deny', reason: 'no' } });
    await expect(p).resolves.toEqual({ behavior: 'deny', message: 'no' });
  });
  it('ExitPlanMode approve -> allow; reject -> deny(reason)', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const a = canUse('ExitPlanMode', {}, { toolUseID: 't4' } as never);
    expect(r.open()[0].kind).toBe('plan-approval');
    r.resolve({ id: r.open()[0].id, decision: { type: 'approve-plan' } });
    await expect(a).resolves.toEqual({ behavior: 'allow' });
    const d = canUse('ExitPlanMode', {}, { toolUseID: 't5' } as never);
    r.resolve({ id: r.open()[0].id, decision: { type: 'reject-plan', reason: 'redo' } });
    await expect(d).resolves.toEqual({ behavior: 'deny', message: 'redo' });
  });
  it('timeout -> deny (safe default)', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 1);
    await expect(canUse('Bash', { command: 'rm' }, { toolUseID: 't6' } as never))
      .resolves.toEqual({ behavior: 'deny', message: 'No answer from panel' });
  });
});

describe('makeCanUseTool: AskUserQuestion (official canUseTool + updatedInput path)', () => {
  const input = { questions: [{ question: 'Which DB?', header: 'DB', options: [{ label: 'PG', description: 'pg' }, { label: 'SQLite', description: 'lite' }] }] };

  it('registers an ask-user-question pending and returns updatedInput with the answer', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const p = canUse('AskUserQuestion', input, { toolUseID: 'q1' } as never);
    const q = r.open()[0];
    expect(q.kind).toBe('ask-user-question');
    expect(q.detail).toBe('Which DB?');
    expect(q.options?.map((o) => o.label)).toEqual(['PG', 'SQLite']);
    r.resolve({ id: q.id, decision: { type: 'select', optionLabels: ['SQLite'] } });
    const res = await p;
    expect(res).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Which DB?': 'SQLite' } } });
  });

  it('timeout -> deny (safe default)', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 1);
    await expect(canUse('AskUserQuestion', input, { toolUseID: 'q2' } as never))
      .resolves.toEqual({ behavior: 'deny', message: 'No answer from panel' });
  });
});
