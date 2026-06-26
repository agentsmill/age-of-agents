import { open, readFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function tokenFilePath(): string {
  return join(homedir(), '.age-of-agents', 'session-token');
}

function isValidToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

async function readValidToken(path: string): Promise<string | undefined> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (isValidToken(existing)) return existing;
  } catch {
    /* missing/unreadable -> create below */
  }
  return undefined;
}

/**
 * Reads the session token, generating and persisting one (atomic write, 0600)
 * on first run. Stable across restarts so installed hooks and local tools keep
 * working. Mirrors the persistence pattern in mapping-config.ts.
 */
export async function loadOrCreateToken(path = tokenFilePath()): Promise<string> {
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
