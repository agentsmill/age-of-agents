import { open, readFile, mkdir, chmod, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function tokenFilePath(): string {
  return join(homedir(), '.age-of-agents', 'session-token');
}

function isValidToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

const tokenLoads = new Map<string, Promise<string>>();
const TOKEN_LOCK_RETRY_MS = 10;
const TOKEN_LOCK_TIMEOUT_MS = 35_000;

async function readValidToken(path: string): Promise<string | undefined> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (isValidToken(existing)) return existing;
  } catch {
    /* missing/unreadable -> create below */
  }
  return undefined;
}

async function replaceInvalidToken(path: string, token: string): Promise<string> {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, token, { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
    return (await readValidToken(path)) ?? token;
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

async function replaceInvalidTokenWithLock(path: string, token: string): Promise<string> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + TOKEN_LOCK_TIMEOUT_MS;

  while (true) {
    const existing = await readValidToken(path);
    if (existing) return existing;

    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
      const winner = await readValidToken(path);
      if (winner) return winner;
      return await replaceInvalidToken(path, token);
    } catch (err) {
      if (errorCode(err) !== 'EEXIST') throw err;
      const winner = await readValidToken(path);
      if (winner) return winner;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for token recovery lock: ${lockPath}`);
      await sleep(TOKEN_LOCK_RETRY_MS);
    } finally {
      if (lock) {
        await lock.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
    }
  }
}

/**
 * Reads the session token, generating and persisting one (atomic write, 0600)
 * on first run. Stable across restarts so installed hooks and local tools keep
 * working. Mirrors the persistence pattern in mapping-config.ts.
 */
export async function loadOrCreateToken(path = tokenFilePath()): Promise<string> {
  const pending = tokenLoads.get(path);
  if (pending) return pending;

  const promise = loadOrCreateTokenUncached(path).finally(() => {
    if (tokenLoads.get(path) === promise) tokenLoads.delete(path);
  });
  tokenLoads.set(path, promise);
  return promise;
}

async function loadOrCreateTokenUncached(path: string): Promise<string> {
  const existing = await readValidToken(path);
  if (existing) return existing;

  const token = randomBytes(32).toString('hex');
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(token, 'utf8');
    await chmod(path, 0o600); // ensure mode even if umask altered the create mode
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const winner = await readValidToken(path);
      if (winner) return winner;
      return replaceInvalidTokenWithLock(path, token);
    }
    throw err;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Constant-time string compare; false on length mismatch without leaking timing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
