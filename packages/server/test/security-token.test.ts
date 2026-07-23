import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadOrCreateToken, timingSafeEqualStr } from '../src/security/token.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const tokenChildScript = `
  import { loadOrCreateToken } from './packages/server/src/security/token.ts';
  const tokenPath = process.env.AOA_TOKEN_TEST_PATH;
  if (!tokenPath) throw new Error('AOA_TOKEN_TEST_PATH is required');
  process.stdout.write(await loadOrCreateToken(tokenPath));
`;

function expectSinglePersistedToken(tokens: string[], path: string): void {
  expect(new Set(tokens).size).toBe(1);
  expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
  expect(readFileSync(path, 'utf8')).toBe(tokens[0]);
  expect(statSync(path).mode & 0o777).toBe(0o600);
}

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

  it('handles concurrent first-run creators', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    const tokens = await Promise.all(Array.from({ length: 20 }, () => loadOrCreateToken(p)));

    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('replaces an invalid existing token file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    writeFileSync(p, 'not-a-valid-token');

    const token = await loadOrCreateToken(p);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(p, 'utf8')).toBe(token);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('handles concurrent creators when an invalid token file already exists', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    writeFileSync(p, 'not-a-valid-token');

    const tokens = await Promise.all(Array.from({ length: 20 }, () => loadOrCreateToken(p)));

    expectSinglePersistedToken(tokens, p);
  });

  it('handles separate processes recovering the same invalid token file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'aoa-tok-'));
    const p = join(dir, 'session-token');
    writeFileSync(p, 'not-a-valid-token');

    const runs = Array.from({ length: 24 }, () =>
      execFileAsync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', tokenChildScript],
        {
          cwd: repoRoot,
          env: { ...process.env, AOA_TOKEN_TEST_PATH: p },
          timeout: 20_000,
        },
      ),
    );
    const tokens = (await Promise.all(runs)).map(({ stdout }) => stdout.trim());

    expectSinglePersistedToken(tokens, p);
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
