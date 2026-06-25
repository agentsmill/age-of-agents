import { describe, it, expect } from 'vitest';
import { LiveSessionRegistry } from '../src/sdk/sessions.js';
import { FakeSdkRunner } from '../src/sdk/fake-runner.js';

describe('LiveSessionRegistry', () => {
  it('launches, tracks, pushes text and stops a session', async () => {
    const runner = new FakeSdkRunner();
    const reg = new LiveSessionRegistry(runner);
    const { sessionId } = await reg.launch({ cwd: '/p', prompt: 'do x', permissionMode: 'default' });
    expect(sessionId).toBe('fake-session-1');
    expect(reg.list().map((s) => s.sessionId)).toContain('fake-session-1');

    reg.pushText('fake-session-1', 'also do y');
    expect(runner.lastSession?.pushed).toContain('also do y');

    await reg.stop('fake-session-1');
    expect(runner.lastSession?.stopped).toBe(true);
    expect(reg.list()).toHaveLength(0);
  });

  it('stop/pushText on unknown id are no-ops returning false', async () => {
    const reg = new LiveSessionRegistry(new FakeSdkRunner());
    expect(reg.pushText('nope', 'x')).toBe(false);
    await expect(reg.stop('nope')).resolves.toBe(false);
  });

  it('fires onSessionStarted exactly once with the session id', async () => {
    const seen: string[] = [];
    const reg = new LiveSessionRegistry(new FakeSdkRunner(), (id) => seen.push(id));
    await reg.launch({ cwd: '/p', prompt: 'x', permissionMode: 'default' });
    expect(seen).toEqual(['fake-session-1']);
  });
});
