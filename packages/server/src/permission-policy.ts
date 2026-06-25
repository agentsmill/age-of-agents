import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  DEFAULT_PERMISSION_POLICY,
  validatePermissionPolicy,
  type PermissionPolicy,
} from '@agent-citadel/shared';

/**
 * Persistence for the permission policy that drives panel-based answering.
 * Source of truth: `~/.age-of-agents/permission-policy.json`. Missing or damaged
 * files fall back to DEFAULT_PERMISSION_POLICY (disabled), so the app stays a
 * passive observer until the user explicitly turns the feature on.
 */

export function defaultPolicyPath(): string {
  return join(homedir(), '.age-of-agents', 'permission-policy.json');
}

const cache = new Map<string, PermissionPolicy>();

export function invalidatePermissionPolicyCache(): void {
  cache.clear();
}

export async function loadPermissionPolicy(path = defaultPolicyPath()): Promise<PermissionPolicy> {
  const hit = cache.get(path);
  if (hit) return hit;

  let policy: PermissionPolicy = DEFAULT_PERMISSION_POLICY;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const res = validatePermissionPolicy(parsed);
    if (res.ok) policy = res.config;
  } catch {
    /* missing file / bad JSON -> DEFAULT */
  }
  cache.set(path, policy);
  return policy;
}

export async function savePermissionPolicy(
  policy: PermissionPolicy,
  path = defaultPolicyPath(),
): Promise<PermissionPolicy> {
  const res = validatePermissionPolicy(policy);
  if (!res.ok) throw new Error(res.error);

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(res.config, null, 2), 'utf8');
  await rename(tmp, path); // atomic write: rename does not leave a partial file
  cache.set(path, res.config);
  return res.config;
}

/** Append a rule and persist; used by "allow always". Idempotent on exact duplicates. */
export async function addPolicyRule(
  rule: PermissionPolicy['rules'][number],
  path = defaultPolicyPath(),
): Promise<PermissionPolicy> {
  const current = await loadPermissionPolicy(path);
  const exists = current.rules.some(
    (r) => r.tool === rule.tool && r.match === rule.match && r.value === rule.value && r.scope === rule.scope && r.decision === rule.decision,
  );
  if (exists) return current;
  return savePermissionPolicy({ ...current, rules: [...current.rules, rule] }, path);
}
