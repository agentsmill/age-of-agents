import { randomUUID } from 'node:crypto';
import type { LaunchParams, LiveSession, SdkRunner } from './types.js';
import type { PendingRegistry } from '../pending-registry.js';
import { makeCanUseTool } from './bridge.js';

/**
 * Real adapter over `@anthropic-ai/claude-agent-sdk`. Imported dynamically so the
 * app runs without the optional dependency installed. Permissions, plan approval
 * AND AskUserQuestion all go through the official `canUseTool` callback (the SDK's
 * documented path), which resolves via the shared PendingRegistry (panel answers).
 */
export class RealSdkRunner implements SdkRunner {
  constructor(private registry: PendingRegistry, private timeoutMs: number) {}

  async available(): Promise<boolean> {
    try { await import('@anthropic-ai/claude-agent-sdk'); return true; } catch { return false; }
  }

  async launch(params: LaunchParams, hooks: { onSessionId: (id: string) => void }): Promise<LiveSession> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const sessionKey = randomUUID();
    let realId: string | undefined;
    const idFor = () => realId ?? sessionKey;

    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    async function* inputStream(): AsyncGenerator<unknown> {
      yield { type: 'user', message: { role: 'user', content: params.prompt }, parent_tool_use_id: null };
      while (!closed) {
        if (queue.length === 0) await new Promise<void>((r) => { wake = r; });
        while (queue.length) yield { type: 'user', message: { role: 'user', content: queue.shift()! }, parent_tool_use_id: null };
      }
    }

    const abort = new AbortController();

    type LiveQuery = { interrupt(): Promise<void> } & AsyncIterable<{ session_id?: string }>;
    const q = sdk.query({
      prompt: inputStream() as never,
      options: {
        cwd: params.cwd,
        ...(params.model ? { model: params.model } : {}),
        permissionMode: params.permissionMode,
        // One callback handles permissions, plan approval AND AskUserQuestion.
        canUseTool: (tool: string, input: Record<string, unknown>) =>
          makeCanUseTool(idFor(), this.registry, this.timeoutMs)(tool, input, undefined) as never,
        abortController: abort,
      } as never,
    }) as unknown as LiveQuery;

    (async () => {
      try {
        for await (const msg of q) {
          if (!realId && msg.session_id) { realId = msg.session_id; hooks.onSessionId(realId); }
        }
      } catch { /* aborted / ended */ } finally { closed = true; (wake as (() => void) | null)?.(); }
    })();

    return {
      get sessionId() { return realId; },
      stop: async () => { closed = true; wake?.(); try { await q.interrupt(); } catch { /* */ } abort.abort(); },
      pushText: (t: string) => { queue.push(t); wake?.(); },
    };
  }
}
