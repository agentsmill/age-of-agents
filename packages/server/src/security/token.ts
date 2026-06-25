import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function tokenFilePath(): string {
  return join(homedir(), '.age-of-agents', 'session-token');
}

/**
 * Reads the session token, generating and persisting one (atomic write, 0600)
 * on first run. Stable across restarts so installed hooks and local tools keep
 * working. Mirrors the persistence pattern in mapping-config.ts.
 */
export async function loadOrCreateToken(path = tokenFilePath()): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    /* missing/unreadable -> create below */
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, token, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmp, 0o600); // ensure mode even if umask altered the create mode
  await rename(tmp, path);
  return token;
}

/** Constant-time string compare; false on length mismatch without leaking timing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
