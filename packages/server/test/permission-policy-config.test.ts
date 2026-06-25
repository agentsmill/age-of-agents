import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPermissionPolicy,
  savePermissionPolicy,
  invalidatePermissionPolicyCache,
} from '../src/permission-policy.js';
import { DEFAULT_PERMISSION_POLICY, type PermissionPolicy } from '@agent-citadel/shared';

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-pol-')), 'permission-policy.json');
}

beforeEach(() => invalidatePermissionPolicyCache());

describe('loadPermissionPolicy', () => {
  it('missing file -> DEFAULT (disabled)', async () => {
    expect(await loadPermissionPolicy(tmpPath())).toEqual(DEFAULT_PERMISSION_POLICY);
  });
  it('broken JSON -> DEFAULT', async () => {
    const p = tmpPath();
    writeFileSync(p, 'nope');
    expect(await loadPermissionPolicy(p)).toEqual(DEFAULT_PERMISSION_POLICY);
  });
});

describe('savePermissionPolicy', () => {
  it('saves and reloads', async () => {
    const p = tmpPath();
    const policy: PermissionPolicy = { enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'allow' }] };
    await savePermissionPolicy(policy, p);
    expect(await loadPermissionPolicy(p)).toEqual(policy);
  });
  it('rejects invalid policy', async () => {
    await expect(
      savePermissionPolicy({ enabled: 'yes' } as unknown as PermissionPolicy, tmpPath()),
    ).rejects.toThrow();
  });
});
