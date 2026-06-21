import { describe, it, expect } from 'vitest';
import { buildHookEntry, DECIDE_TIMEOUT_SEC } from '../src/hooks.js';

describe('buildHookEntry', () => {
  it('PreToolUse uses the long timeout and the deciding shim', () => {
    const entry = buildHookEntry('PreToolUse');
    expect(entry.hooks[0].timeout).toBe(DECIDE_TIMEOUT_SEC);
    expect(entry.hooks[0].command).toContain('/hooks/decide');
    expect(entry.matcher).toBe('*');
  });
  it('Stop uses the fast timeout and no matcher', () => {
    const entry = buildHookEntry('Stop');
    expect(entry.hooks[0].timeout).toBe(1);
    expect(entry.matcher).toBeUndefined();
  });
});
