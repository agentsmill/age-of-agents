import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken, timingSafeEqualStr } from '../src/security/token.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe('loadOrCreateToken', () => {
  it('creates a 64-char hex token in a 0600 file and is stable on reload', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    const first = await loadOrCreateToken(p);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const second = await loadOrCreateToken(p);
    expect(second).toBe(first);
  });
});

describe('timingSafeEqualStr', () => {
  it('compares by value and length', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});
