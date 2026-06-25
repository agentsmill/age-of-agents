import type { LaunchParams, LiveSession, SdkRunner } from './types.js';

interface Entry { session: LiveSession; sessionId?: string; startedAt: string; cwd: string; }

/** Tracks the agent sessions the app owns (launched via the SDK). */
export class LiveSessionRegistry {
  private entries: Entry[] = [];
  /** `onSessionStarted` fires when a session's real id becomes known — possibly
   *  AFTER `launch()` returns (the SDK reports it asynchronously). The server uses
   *  it to broadcast the id so the client can attach session controls. */
  constructor(private runner: SdkRunner, private onSessionStarted?: (sessionId: string) => void) {}

  available(): Promise<boolean> { return this.runner.available(); }

  async launch(params: LaunchParams): Promise<{ sessionId?: string }> {
    const entry: Entry = { session: undefined as unknown as LiveSession, startedAt: new Date().toISOString(), cwd: params.cwd };
    let emitted = false;
    const emit = (id: string) => { if (!emitted) { emitted = true; this.onSessionStarted?.(id); } };
    entry.session = await this.runner.launch(params, { onSessionId: (id) => { entry.sessionId = id; emit(id); } });
    entry.sessionId ??= entry.session.sessionId;
    if (entry.sessionId) emit(entry.sessionId);
    this.entries.push(entry);
    return { sessionId: entry.sessionId };
  }

  list(): { sessionId?: string; startedAt: string; cwd: string }[] {
    return this.entries.map((e) => ({ sessionId: e.sessionId, startedAt: e.startedAt, cwd: e.cwd }));
  }

  pushText(sessionId: string, text: string): boolean {
    const e = this.entries.find((x) => x.sessionId === sessionId);
    if (!e) return false;
    e.session.pushText(text);
    return true;
  }

  async stop(sessionId: string): Promise<boolean> {
    const i = this.entries.findIndex((x) => x.sessionId === sessionId);
    if (i < 0) return false;
    await this.entries[i].session.stop();
    this.entries.splice(i, 1);
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.entries.map((e) => e.session.stop().catch(() => {})));
    this.entries = [];
  }
}
