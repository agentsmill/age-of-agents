import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHooks, hooksStatus, uninstallHooks, DECIDE_TIMEOUT_SEC } from '../src/hooks.js';

function tmpSettings(initial: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), 'aoa-hooks-')), 'settings.json');
  if (initial !== undefined) writeFileSync(p, JSON.stringify(initial, null, 2));
  return p;
}

function pre(settingsPath: string) {
  return JSON.parse(readFileSync(settingsPath, 'utf8')).hooks.PreToolUse;
}

describe('installHooks migration', () => {
  it('fresh install: PreToolUse gets the long-timeout blocking shim', async () => {
    const p = tmpSettings({});
    await installHooks(p);
    const entry = pre(p)[0];
    expect(entry.hooks[0].timeout).toBe(DECIDE_TIMEOUT_SEC);
    expect(entry.hooks[0].command).toContain('/hooks/decide');
    expect((await hooksStatus(p)).installed).toBe(true);
    expect((await hooksStatus(p)).needsMigration).toBe(false);
  });

  it('repairs a stale (timeout:1) PreToolUse entry instead of skipping it', async () => {
    // Simulate an old install: our marker command but the fast timeout.
    const staleCmd = "node -e \"const marker='age-of-agents-hook-shim'\"";
    const p = tmpSettings({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: staleCmd, timeout: 1 }] }] } });
    expect((await hooksStatus(p)).needsMigration).toBe(true); // flagged before repair

    await installHooks(p);

    const entries = pre(p);
    // Exactly one of our entries, now with the long timeout + blocking shim.
    const ourEntries = entries.filter((e: any) => e.hooks.some((h: any) => h.command?.includes('age-of-agents-hook-shim') || h.command?.includes('/hooks/decide')));
    expect(ourEntries).toHaveLength(1);
    expect(ourEntries[0].hooks[0].timeout).toBe(DECIDE_TIMEOUT_SEC);
    expect((await hooksStatus(p)).needsMigration).toBe(false); // no longer stuck
    expect((await hooksStatus(p)).installed).toBe(true);
  });

  it('preserves a foreign hook entry on install and uninstall', async () => {
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other', timeout: 5 }] };
    const p = tmpSettings({ hooks: { PreToolUse: [foreign] } });
    await installHooks(p);
    let entries = pre(p);
    expect(entries.some((e: any) => e.hooks[0].command === 'echo other')).toBe(true); // foreign kept
    await uninstallHooks(p);
    entries = JSON.parse(readFileSync(p, 'utf8')).hooks?.PreToolUse ?? [];
    expect(entries.some((e: any) => e.hooks[0].command === 'echo other')).toBe(true); // still kept
    expect(entries.some((e: any) => e.hooks[0].command?.includes('/hooks/decide'))).toBe(false); // ours removed
  });
});
