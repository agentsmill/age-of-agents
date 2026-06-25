import { describe, it, expect } from 'vitest';
import { validateLaunchRequest } from '@agent-citadel/shared';

describe('validateLaunchRequest', () => {
  it('accepts a valid request', () => {
    const r = validateLaunchRequest({ cwd: '/tmp/p', prompt: 'do x', model: 'claude-opus-4-8', permissionMode: 'default' });
    expect(r.ok).toBe(true);
  });
  it('defaults permissionMode to default and model optional', () => {
    const r = validateLaunchRequest({ cwd: '/tmp/p', prompt: 'do x' });
    expect(r.ok && r.value.permissionMode).toBe('default');
    expect(r.ok && r.value.model).toBeUndefined();
  });
  it('rejects empty cwd or prompt', () => {
    expect(validateLaunchRequest({ cwd: '', prompt: 'x' }).ok).toBe(false);
    expect(validateLaunchRequest({ cwd: '/p', prompt: '  ' }).ok).toBe(false);
  });
  it('rejects unknown permissionMode', () => {
    expect(validateLaunchRequest({ cwd: '/p', prompt: 'x', permissionMode: 'yolo' }).ok).toBe(false);
  });
});
