import type { LaunchParams, LiveSession, SdkRunner } from './types.js';

/** In-memory fake of the SDK for tests. */
export class FakeSdkRunner implements SdkRunner {
  lastSession?: { params: LaunchParams; pushed: string[]; stopped: boolean };
  private counter = 0;

  async available(): Promise<boolean> { return true; }

  async launch(params: LaunchParams, hooks: { onSessionId: (id: string) => void }): Promise<LiveSession> {
    const id = `fake-session-${++this.counter}`;
    const rec = { params, pushed: [] as string[], stopped: false };
    this.lastSession = rec;
    hooks.onSessionId(id);
    return {
      sessionId: id,
      stop: async () => { rec.stopped = true; },
      pushText: (t) => { rec.pushed.push(t); },
    };
  }
}
