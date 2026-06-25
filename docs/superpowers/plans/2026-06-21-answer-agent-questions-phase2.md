# Odpowiadanie na pytania agentów — Faza 2 (SDK) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uruchamianie agentów Claude Code z poziomu aplikacji (wybór folderu + prompt + model + permission mode) przez Claude Agent SDK, z **pełnym** odpowiadaniem w panelu na uprawnienia, plan ORAZ `AskUserQuestion`, plus dosyłanie wiadomości do żywej sesji i jej zatrzymywanie.

**Architecture:** Appka odpala sesję przez `@anthropic-ai/claude-agent-sdk` (`query()` ze streaming-inputem). `canUseTool` kieruje uprawnienia/plan do istniejącego `PendingRegistry` (ten sam kanał WS co Faza 1) i mapuje `QuestionDecision` → `PermissionResult`. `AskUserQuestion` jest **przekierowane** przez `Options.toolAliases` na własne narzędzie SDK MCP (`createSdkMcpServer` + `tool`), którego handler rejestruje `PendingQuestion`, czeka na wybór z panelu i zwraca `CallToolResult` — model kontynuuje. Sesja zapisuje transkrypt → istniejący watcher pokazuje ją jako bohatera. SDK jest **optionalDependency** za cienkim interfejsem `SdkRunner` (fake do testów, realny adapter weryfikowany E2E).

**Tech Stack:** TypeScript ESM, Node 22, Fastify, `ws`, React 19 + Zustand, Vitest. Nowe optionalDependencies: `@anthropic-ai/claude-agent-sdk` (^0.3) + `zod` (^4, peer SDK, do schematu narzędzia MCP).

**Spec:** [2026-06-21-answer-agent-questions-design.md](../specs/2026-06-21-answer-agent-questions-design.md) §5
**Bazuje na Fazie 1** (scalonej): `PendingQuestion`/`QuestionDecision`/`QuestionAnswer`, `PendingRegistry` (`ask`/`resolve`/`cancelForSession`/`open`), dwukierunkowy WS (`answer`), karta `PendingQuestionCard`.

---

## Uziemione fakty SDK 0.3.185 (z `sdk.d.ts` — dla implementerów)

```ts
query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;            // = STOP
  setPermissionMode(m: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
}
type PermissionMode = 'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto';
type CanUseTool = (toolName: string, input: Record<string,unknown>, options: { signal: AbortSignal; toolUseID: string; suggestions?: PermissionUpdate[]; title?: string; ... }) => Promise<PermissionResult>;
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string,unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };
type SDKUserMessage = { type:'user'; message: MessageParam; parent_tool_use_id: string|null; shouldQuery?: boolean; session_id?: string };
type Options = { cwd?; model?; permissionMode?; canUseTool?; mcpServers?: Record<string, McpServerConfig>; toolAliases?: Record<string,string>; abortController?; includePartialMessages?; ... };
function createSdkMcpServer(o: { name: string; version?: string; tools?: SdkMcpToolDefinition[] }): McpSdkServerConfigWithInstance;
function tool(name, description, inputSchema /* zod raw shape */, handler: (args, extra) => Promise<CallToolResult>): SdkMcpToolDefinition;
// CallToolResult (from @modelcontextprotocol/sdk): { content: Array<{type:'text', text:string}>, isError?: boolean }
// First stream message is a system 'init' carrying session_id.
// AskUserQuestionInput: { questions: [{ question, header, options: [{label, description, preview?}] }] }  (1-4 q, 2-4 opts)
```

**Auth:** SDK używa logowania Claude Code z `~/.claude` (zero dodatkowej konfiguracji, o ile user jest zalogowany).

**Reużycie Fazy 1:** `canUseTool` i handler AskUserQuestion wołają `registry.ask(question, timeoutMs)` (broadcast `pending-question`, await `QuestionDecision`). Mapowanie:
- decyzja `allow` → `{behavior:'allow'}`; `deny` → `{behavior:'deny',message}`; `reject-plan` → `{behavior:'deny',message:reason}`; `approve-plan` → `{behavior:'allow'}`; `select` → `CallToolResult` z wybraną opcją; `text`/timeout → patrz zadania.

**Ryzyko integracyjne (jedyne):** dokładny kształt `CallToolResult`, który model zaakceptuje jako odpowiedź `AskUserQuestion` po aliasie. Zadanie 4 (realny adapter) zawiera krok weryfikacji E2E; logika i UI są niezależne i w pełni testowane fake'iem.

---

## Mapa plików

Nowe (server):
- `packages/server/src/sdk/types.ts` — `SdkRunner` interfejs, `LiveSession`, `LaunchParams`.
- `packages/server/src/sdk/bridge.ts` — czysta logika: `decisionToPermissionResult`, `selectionToToolResult`, builder canUseTool/handlera w oparciu o `PendingRegistry`.
- `packages/server/src/sdk/sessions.ts` — `LiveSessionRegistry` (launch/stop/pushText/list) na wstrzykniętym `SdkRunner`.
- `packages/server/src/sdk/real-runner.ts` — realny adapter na `@anthropic-ai/claude-agent-sdk` (optionalDependency, dynamiczny import).
- `packages/server/src/sdk/fake-runner.ts` — fake do testów.
- `packages/server/src/session-routes.ts` — `POST /sessions/launch|:id/stop|:id/message`, `GET /sessions`.
- `packages/server/src/fs-routes.ts` — `GET /fs/list`.
- testy: `sdk-bridge.test.ts`, `sdk-sessions.test.ts`, `session-routes.test.ts`, `fs-routes.test.ts`.

Nowe (client):
- `packages/client/src/hud/LaunchAgentDialog.tsx` — okno startu.
- `packages/client/src/hud/LaunchAgentButton.tsx` — przycisk otwierający okno.
- `packages/client/src/sessions.ts` — fetch helpers (launch/stop/message) + recent dirs.

Modyfikowane:
- `packages/shared/src/pending.ts` — `LaunchAgentRequest`, `SdkPermissionMode`, `validateLaunchRequest`.
- `packages/server/src/server.ts` — wpięcie routów + `LiveSessionRegistry`.
- `packages/client/src/hud/PendingQuestionCard.tsx` — gałęzie dla `source:'sdk'` (opcje AskUserQuestion, reject z powodem, free-text, Stop).
- `packages/client/src/i18n.ts` — nowe klucze.
- `packages/client/src/hud/ThemeSwitch.tsx` — `<LaunchAgentButton/>`.
- `package.json` (root) — optionalDependencies.

---

## Task 1: shared — typy launch + walidator

**Files:**
- Modify: `packages/shared/src/pending.ts`
- Test: `packages/server/test/launch-request.test.ts`

- [ ] **Step 1: Failing test** `packages/server/test/launch-request.test.ts`:
```ts
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
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @agent-citadel/server -- launch-request`

- [ ] **Step 3: Add to `packages/shared/src/pending.ts`:**
```ts
/** Permission modes we expose in the launch dialog (subset of the SDK's). */
export type SdkPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export const SDK_PERMISSION_MODES: readonly SdkPermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export interface LaunchAgentRequest {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode: SdkPermissionMode;
}

export function validateLaunchRequest(
  input: unknown,
): { ok: true; value: LaunchAgentRequest } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Request must be an object.' };
  const o = input as Record<string, unknown>;
  if (typeof o.cwd !== 'string' || !o.cwd.trim()) return { ok: false, error: '"cwd" required.' };
  if (typeof o.prompt !== 'string' || !o.prompt.trim()) return { ok: false, error: '"prompt" required.' };
  let permissionMode: SdkPermissionMode = 'default';
  if (o.permissionMode !== undefined) {
    if (!SDK_PERMISSION_MODES.includes(o.permissionMode as SdkPermissionMode)) {
      return { ok: false, error: `Unknown permissionMode ${String(o.permissionMode)}.` };
    }
    permissionMode = o.permissionMode as SdkPermissionMode;
  }
  const value: LaunchAgentRequest = { cwd: o.cwd.trim(), prompt: o.prompt, permissionMode };
  if (o.model !== undefined) {
    if (typeof o.model !== 'string') return { ok: false, error: '"model" must be a string.' };
    if (o.model.trim()) value.model = o.model.trim();
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: Run → PASS**; type-check: `npm run build -w @agent-citadel/shared && npm run build -w @agent-citadel/server`.
- [ ] **Step 5: Commit** `git add packages/shared/src/pending.ts packages/server/test/launch-request.test.ts && git commit -m "feat(shared): launch-agent request type + validator"`

---

## Task 2: server — bridge (decision↔SDK mapping, canUseTool/handler builders)

**Files:**
- Create: `packages/server/src/sdk/types.ts`, `packages/server/src/sdk/bridge.ts`
- Test: `packages/server/test/sdk-bridge.test.ts`

- [ ] **Step 1: Failing test** `packages/server/test/sdk-bridge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import { makeCanUseTool, makeAskQuestionHandler } from '../src/sdk/bridge.js';

const reg = () => new PendingRegistry(new World());

describe('makeCanUseTool', () => {
  it('safe tool -> allow without prompting', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    await expect(canUse('Read', { file_path: 'a.ts' }, { toolUseID: 't1' } as never)).resolves.toEqual({ behavior: 'allow' });
    expect(r.open()).toHaveLength(0);
  });
  it('risky tool -> pending; allow answer -> allow', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const p = canUse('Bash', { command: 'rm -rf x' }, { toolUseID: 't2' } as never);
    const q = r.open()[0];
    expect(q.kind).toBe('tool-permission');
    r.resolve({ id: q.id, decision: { type: 'allow' } });
    await expect(p).resolves.toEqual({ behavior: 'allow' });
  });
  it('risky tool -> deny answer -> deny with message', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const p = canUse('Bash', { command: 'rm' }, { toolUseID: 't3' } as never);
    r.resolve({ id: r.open()[0].id, decision: { type: 'deny', reason: 'no' } });
    await expect(p).resolves.toEqual({ behavior: 'deny', message: 'no' });
  });
  it('ExitPlanMode approve -> allow; reject -> deny(reason)', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 5000);
    const a = canUse('ExitPlanMode', {}, { toolUseID: 't4' } as never);
    expect(r.open()[0].kind).toBe('plan-approval');
    r.resolve({ id: r.open()[0].id, decision: { type: 'approve-plan' } });
    await expect(a).resolves.toEqual({ behavior: 'allow' });
    const d = canUse('ExitPlanMode', {}, { toolUseID: 't5' } as never);
    r.resolve({ id: r.open()[0].id, decision: { type: 'reject-plan', reason: 'redo' } });
    await expect(d).resolves.toEqual({ behavior: 'deny', message: 'redo' });
  });
  it('timeout -> deny (safe default)', async () => {
    const r = reg();
    const canUse = makeCanUseTool('s1', r, 1);
    await expect(canUse('Bash', { command: 'rm' }, { toolUseID: 't6' } as never))
      .resolves.toEqual({ behavior: 'deny', message: 'No answer from panel' });
  });
});

describe('makeAskQuestionHandler', () => {
  it('registers a question and returns the selection as a tool result', async () => {
    const r = reg();
    const handler = makeAskQuestionHandler('s1', r, 5000);
    const p = handler({ questions: [{ question: 'Which DB?', header: 'DB', options: [{ label: 'PG', description: 'pg' }, { label: 'SQLite', description: 'lite' }] }] }, {});
    const q = r.open()[0];
    expect(q.kind).toBe('ask-user-question');
    expect(q.options?.map((o) => o.label)).toEqual(['PG', 'SQLite']);
    r.resolve({ id: q.id, decision: { type: 'select', optionLabels: ['SQLite'] } });
    const res = await p;
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain('SQLite');
  });
  it('timeout -> isError result', async () => {
    const r = reg();
    const handler = makeAskQuestionHandler('s1', r, 1);
    const res = await handler({ questions: [{ question: 'Q', header: 'h', options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }] }, {});
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @agent-citadel/server -- sdk-bridge`

- [ ] **Step 3: Create `packages/server/src/sdk/types.ts`:**
```ts
import type { SdkPermissionMode } from '@agent-citadel/shared';

export interface LaunchParams {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode: SdkPermissionMode;
}

/** A running agent session the app owns. */
export interface LiveSession {
  /** Claude session id once known (from the SDK init message). */
  sessionId?: string;
  /** Stop the session (SDK interrupt + abort). */
  stop(): Promise<void>;
  /** Push a follow-up user message into the live session. */
  pushText(text: string): void;
}

/** Abstraction over the Claude Agent SDK so the rest of the app is testable. */
export interface SdkRunner {
  /** Whether the underlying SDK is installed/usable. */
  available(): Promise<boolean>;
  /**
   * Launch a session. `onSessionId` fires once the SDK reports the session id.
   * Resolves to a handle for control (stop / pushText).
   */
  launch(params: LaunchParams, hooks: { onSessionId: (id: string) => void }): Promise<LiveSession>;
}
```

- [ ] **Step 4: Create `packages/server/src/sdk/bridge.ts`:**
```ts
import { parseAskUserQuestion } from '../hook-decide.js';
import { randomUUID } from 'node:crypto';
import { isSafeTool, type PendingQuestion } from '@agent-citadel/shared';
import type { PendingRegistry } from '../pending-registry.js';

/** Minimal subset of the SDK PermissionResult we produce. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export type CallToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Builds a `canUseTool` for one session that routes decisions through the panel. */
export function makeCanUseTool(sessionId: string, registry: PendingRegistry, timeoutMs: number) {
  return async (toolName: string, input: Record<string, unknown>, _opts: unknown): Promise<PermissionResult> => {
    if (isSafeTool(toolName)) return { behavior: 'allow' };
    const isPlan = toolName === 'ExitPlanMode';
    const question: PendingQuestion = {
      id: randomUUID(),
      sessionId,
      source: 'sdk',
      kind: isPlan ? 'plan-approval' : 'tool-permission',
      tool: toolName,
      detail: detailOf(toolName, input),
      createdAt: new Date().toISOString(),
    };
    const decision = await registry.ask(question, timeoutMs);
    if (!decision) return { behavior: 'deny', message: 'No answer from panel' };
    switch (decision.type) {
      case 'allow': return { behavior: 'allow' };
      case 'approve-plan': return { behavior: 'allow' };
      case 'deny': return { behavior: 'deny', message: decision.reason ?? 'Denied in panel' };
      case 'reject-plan': return { behavior: 'deny', message: decision.reason ?? 'Plan rejected in panel' };
      default: return { behavior: 'deny', message: 'Unsupported decision' };
    }
  };
}

/** Builds the AskUserQuestion MCP tool handler for one session. */
export function makeAskQuestionHandler(sessionId: string, registry: PendingRegistry, timeoutMs: number) {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const { question: questionText, options } = parseAskUserQuestion(args);
    const question: PendingQuestion = {
      id: randomUUID(),
      sessionId,
      source: 'sdk',
      kind: 'ask-user-question',
      tool: 'AskUserQuestion',
      detail: questionText,
      options,
      createdAt: new Date().toISOString(),
    };
    const decision = await registry.ask(question, timeoutMs);
    if (decision?.type === 'select') {
      return { content: [{ type: 'text', text: JSON.stringify({ selected: decision.optionLabels }) }] };
    }
    return { content: [{ type: 'text', text: 'No answer provided by the user.' }], isError: true };
  };
}

/** Tiny detail extractor for permission cards (kept local; mirrors transcript toolDetail intent). */
function detailOf(tool: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  if (tool === 'Bash') return s(input.command);
  if (tool === 'Edit' || tool === 'Write' || tool === 'Read') return s(input.file_path);
  if (tool === 'WebFetch') return s(input.url);
  return undefined;
}
```

- [ ] **Step 5: Run → PASS**; type-check server.
- [ ] **Step 6: Commit** `git add packages/server/src/sdk/types.ts packages/server/src/sdk/bridge.ts packages/server/test/sdk-bridge.test.ts && git commit -m "feat(server): SDK bridge — route permissions/plan/question through PendingRegistry"`

---

## Task 3: server — LiveSessionRegistry + fake runner

**Files:**
- Create: `packages/server/src/sdk/sessions.ts`, `packages/server/src/sdk/fake-runner.ts`
- Test: `packages/server/test/sdk-sessions.test.ts`

- [ ] **Step 1: Failing test** `packages/server/test/sdk-sessions.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @agent-citadel/server -- sdk-sessions`

- [ ] **Step 3: Create `packages/server/src/sdk/fake-runner.ts`:**
```ts
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
```

- [ ] **Step 4: Create `packages/server/src/sdk/sessions.ts`:**
```ts
import type { LaunchParams, LiveSession, SdkRunner } from './types.js';

interface Entry { session: LiveSession; sessionId?: string; startedAt: string; cwd: string; }

/** Tracks the agent sessions the app owns (launched via the SDK). */
export class LiveSessionRegistry {
  private entries: Entry[] = [];
  constructor(private runner: SdkRunner) {}

  available(): Promise<boolean> { return this.runner.available(); }

  async launch(params: LaunchParams): Promise<{ sessionId?: string }> {
    const entry: Entry = { session: undefined as unknown as LiveSession, startedAt: new Date().toISOString(), cwd: params.cwd };
    entry.session = await this.runner.launch(params, { onSessionId: (id) => { entry.sessionId = id; } });
    entry.sessionId ??= entry.session.sessionId;
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
```

- [ ] **Step 5: Run → PASS**; type-check server.
- [ ] **Step 6: Commit** `git add packages/server/src/sdk/sessions.ts packages/server/src/sdk/fake-runner.ts packages/server/test/sdk-sessions.test.ts && git commit -m "feat(server): live SDK session registry + fake runner"`

---

## Task 4: server — real SDK runner (optionalDependency)

**Files:**
- Create: `packages/server/src/sdk/real-runner.ts`
- Modify: root `package.json` (optionalDependencies)

(No unit test — thin adapter over the external SDK; verified by the E2E in Task 12. Keep ALL real-SDK calls in this one file behind `SdkRunner`.)

- [ ] **Step 1: Add optionalDependencies** to root `package.json` (alongside the existing `optionalDependencies` block with `better-sqlite3`):
```jsonc
  "optionalDependencies": {
    "better-sqlite3": "^12.11.1",
    "@anthropic-ai/claude-agent-sdk": "^0.3.185",
    "zod": "^4.0.0"
  }
```
Run `npm install` to populate the lockfile (these are optional; install still succeeds without network for core).

- [ ] **Step 2: Create `packages/server/src/sdk/real-runner.ts`:**
```ts
import { randomUUID } from 'node:crypto';
import type { LaunchParams, LiveSession, SdkRunner } from './types.js';
import type { PendingRegistry } from '../pending-registry.js';
import { makeCanUseTool, makeAskQuestionHandler } from './bridge.js';

/**
 * Real adapter over `@anthropic-ai/claude-agent-sdk`. Imported dynamically so the
 * app runs without the optional dependency installed. AskUserQuestion is routed
 * to an in-process MCP tool via `toolAliases`; permissions/plan go through
 * `canUseTool`. Both resolve via the shared PendingRegistry (panel answers).
 */
export class RealSdkRunner implements SdkRunner {
  constructor(private registry: PendingRegistry, private timeoutMs: number) {}

  async available(): Promise<boolean> {
    try { await import('@anthropic-ai/claude-agent-sdk'); return true; } catch { return false; }
  }

  async launch(params: LaunchParams, hooks: { onSessionId: (id: string) => void }): Promise<LiveSession> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    const sessionKey = randomUUID(); // panel-side correlation until the real id arrives
    let realId: string | undefined;
    const idFor = () => realId ?? sessionKey;

    // Queue for follow-up user messages (free-text) pushed from the panel.
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

    const askTool = sdk.tool(
      'askUserQuestion',
      'Ask the user a multiple-choice question and return their selection.',
      { questions: z.array(z.any()) },
      async (args: Record<string, unknown>) => makeAskQuestionHandler(idFor(), this.registry, this.timeoutMs)(args),
    );
    const panelServer = sdk.createSdkMcpServer({ name: 'panel', version: '1.0.0', tools: [askTool] });
    const abort = new AbortController();

    const q = sdk.query({
      prompt: inputStream() as never,
      options: {
        cwd: params.cwd,
        ...(params.model ? { model: params.model } : {}),
        permissionMode: params.permissionMode,
        canUseTool: (tool: string, input: Record<string, unknown>) =>
          makeCanUseTool(idFor(), this.registry, this.timeoutMs)(tool, input, undefined) as never,
        mcpServers: { panel: panelServer },
        toolAliases: { AskUserQuestion: 'mcp__panel__askUserQuestion' },
        abortController: abort,
      } as never,
    });

    // Drain the stream in the background; capture the session id from the init message.
    (async () => {
      try {
        for await (const msg of q as AsyncIterable<{ type?: string; subtype?: string; session_id?: string }>) {
          if (!realId && msg.session_id) { realId = msg.session_id; hooks.onSessionId(realId); }
        }
      } catch { /* aborted / ended */ } finally { closed = true; wake?.(); }
    })();

    return {
      get sessionId() { return realId; },
      stop: async () => { closed = true; wake?.(); try { await q.interrupt(); } catch { /* */ } abort.abort(); },
      pushText: (t: string) => { queue.push(t); wake?.(); },
    };
  }
}
```

- [ ] **Step 3: Type-check** `npm run build -w @agent-citadel/server`. If TS cannot resolve the optional module types, add `// @ts-expect-error optional dependency` on the dynamic import lines (same approach the repo uses for `better-sqlite3`; check `docker-client.ts`/sqlite usage for the established pattern and mirror it). Do NOT add it to `dependencies`.
- [ ] **Step 4: Commit** `git add package.json package-lock.json packages/server/src/sdk/real-runner.ts && git commit -m "feat(server): real Claude Agent SDK runner (optional dependency)"`

---

## Task 5: server — folder list endpoint

**Files:**
- Create: `packages/server/src/fs-routes.ts`
- Test: `packages/server/test/fs-routes.test.ts`

- [ ] **Step 1: Failing test** `packages/server/test/fs-routes.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerFsRoutes } from '../src/fs-routes.js';

let app: Awaited<ReturnType<typeof build>> | undefined;
async function build() { const a = Fastify(); registerFsRoutes(a); await a.ready(); return a; }
afterEach(async () => { await app?.close(); app = undefined; });

describe('GET /fs/list', () => {
  it('lists subdirectories only', async () => {
    const base = mkdtempSync(join(tmpdir(), 'aoa-fs-'));
    mkdirSync(join(base, 'sub-a')); mkdirSync(join(base, 'sub-b')); writeFileSync(join(base, 'file.txt'), 'x');
    app = await build();
    const res = await app.inject({ method: 'GET', url: `/fs/list?dir=${encodeURIComponent(base)}` });
    const body = res.json();
    expect(body.dir).toBe(base);
    expect(body.entries.map((e: { name: string }) => e.name).sort()).toEqual(['sub-a', 'sub-b']);
  });
  it('missing dir -> 400', async () => {
    app = await build();
    const res = await app.inject({ method: 'GET', url: '/fs/list?dir=/no/such/path/xyz' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @agent-citadel/server -- fs-routes`

- [ ] **Step 3: Create `packages/server/src/fs-routes.ts`:**
```ts
import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';

/** Lists immediate subdirectories of an absolute path (folder picker). Local-only server. */
export function registerFsRoutes(app: FastifyInstance): void {
  app.get('/fs/list', async (request, reply) => {
    const raw = (request.query as { dir?: string }).dir;
    const dir = raw && isAbsolute(raw) ? raw : homedir();
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, path: join(dir, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { dir, parent: dir === '/' ? null : join(dir, '..'), entries };
    } catch {
      return reply.code(400).send({ error: 'cannot read directory' });
    }
  });
}
```

- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Commit** `git add packages/server/src/fs-routes.ts packages/server/test/fs-routes.test.ts && git commit -m "feat(server): /fs/list folder picker endpoint"`

---

## Task 6: server — session routes + server.ts wiring

**Files:**
- Create: `packages/server/src/session-routes.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/session-routes.test.ts`

- [ ] **Step 1: Failing test** `packages/server/test/session-routes.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionRoutes } from '../src/session-routes.js';
import { LiveSessionRegistry } from '../src/sdk/sessions.js';
import { FakeSdkRunner } from '../src/sdk/fake-runner.js';

let app: Awaited<ReturnType<typeof Fastify>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function build() {
  app = Fastify();
  const sessions = new LiveSessionRegistry(new FakeSdkRunner());
  registerSessionRoutes(app, { sessions });
  await app.ready();
  return { app, sessions };
}

describe('session routes', () => {
  it('POST /sessions/launch validates and launches', async () => {
    const { app } = await build();
    const ok = await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '/p', prompt: 'do x', permissionMode: 'default' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sessionId).toBe('fake-session-1');
    const bad = await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '', prompt: '' } });
    expect(bad.statusCode).toBe(400);
  });
  it('message + stop route to the registry', async () => {
    const { app } = await build();
    await app.inject({ method: 'POST', url: '/sessions/launch', payload: { cwd: '/p', prompt: 'x', permissionMode: 'default' } });
    const msg = await app.inject({ method: 'POST', url: '/sessions/fake-session-1/message', payload: { text: 'more' } });
    expect(msg.statusCode).toBe(200);
    const stop = await app.inject({ method: 'POST', url: '/sessions/fake-session-1/stop' });
    expect(stop.statusCode).toBe(200);
    const stopMissing = await app.inject({ method: 'POST', url: '/sessions/nope/stop' });
    expect(stopMissing.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run → FAIL** `npm run test -w @agent-citadel/server -- session-routes`

- [ ] **Step 3: Create `packages/server/src/session-routes.ts`:**
```ts
import type { FastifyInstance } from 'fastify';
import { validateLaunchRequest } from '@agent-citadel/shared';
import type { LiveSessionRegistry } from './sdk/sessions.js';

export interface SessionRoutesOptions { sessions: LiveSessionRegistry; }

export function registerSessionRoutes(app: FastifyInstance, opts: SessionRoutesOptions): void {
  app.get('/sessions', async () => ({ available: await opts.sessions.available(), sessions: opts.sessions.list() }));

  app.post('/sessions/launch', async (request, reply) => {
    const res = validateLaunchRequest(request.body);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    if (!(await opts.sessions.available())) return reply.code(501).send({ error: 'Claude Agent SDK not installed' });
    try {
      return await opts.sessions.launch(res.value);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'launch failed' });
    }
  });

  app.post<{ Params: { id: string }; Body: { text?: string } }>('/sessions/:id/message', async (request, reply) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: 'text required' });
    if (!opts.sessions.pushText(request.params.id, text)) return reply.code(404).send({ error: 'unknown session' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/stop', async (request, reply) => {
    if (!(await opts.sessions.stop(request.params.id))) return reply.code(404).send({ error: 'unknown session' });
    return { ok: true };
  });
}
```

- [ ] **Step 4: Wire into `server.ts`:**
  - Imports:
    ```ts
    import { LiveSessionRegistry } from './sdk/sessions.js';
    import { registerSessionRoutes } from './session-routes.js';
    import { registerFsRoutes } from './fs-routes.js';
    ```
  - In the REAL branch, after the policy routes, create the registry with the real runner and register routes:
    ```ts
    const { RealSdkRunner } = await import('./sdk/real-runner.js');
    const liveSessions = new LiveSessionRegistry(new RealSdkRunner(pendingRegistry, (DECIDE_TIMEOUT_SEC - 10) * 1000));
    registerSessionRoutes(app, { sessions: liveSessions });
    registerFsRoutes(app);
    ```
    And in `close()` add `await liveSessions.stopAll();` (declare `liveSessions` in the outer scope like `opencodePoller`, assign in the branch).
  - In the DEMO branch, register no-op equivalents so the client doesn't 404:
    ```ts
    const { LiveSessionRegistry } = await import('./sdk/sessions.js');
    const { FakeSdkRunner } = await import('./sdk/fake-runner.js');
    registerSessionRoutes(app, { sessions: new LiveSessionRegistry(new FakeSdkRunner()) });
    registerFsRoutes(app);
    ```
    (Demo's FakeSdkRunner makes "launch" harmless; the dialog is still demoable.)

- [ ] **Step 5: Run → PASS**; full server suite `npm run test -w @agent-citadel/server`; build server.
- [ ] **Step 6: Commit** `git add packages/server/src/session-routes.ts packages/server/src/server.ts packages/server/test/session-routes.test.ts && git commit -m "feat(server): session launch/stop/message routes + wiring"`

---

## Task 7: client — Vite proxy + session fetch helpers

**Files:**
- Modify: `packages/client/vite.config.ts`
- Create: `packages/client/src/sessions.ts`

- [ ] **Step 1: Proxy the new paths** (add to the `proxy` block, mirroring the Phase 1 fix):
```ts
      '/sessions': 'http://127.0.0.1:8123',
      '/fs': 'http://127.0.0.1:8123',
```

- [ ] **Step 2: Create `packages/client/src/sessions.ts`:**
```ts
import type { LaunchAgentRequest } from '@agent-citadel/shared';

const RECENT_KEY = 'agent-citadel.recent-dirs';

export async function launchAgent(req: LaunchAgentRequest): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  try {
    const res = await fetch('/sessions/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    rememberDir(req.cwd);
    return { ok: true, sessionId: body.sessionId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

export async function stopSession(sessionId: string): Promise<void> {
  await fetch(`/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => {});
}

export async function sendSessionMessage(sessionId: string, text: string): Promise<void> {
  await fetch(`/sessions/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  }).catch(() => {});
}

export async function sdkAvailable(): Promise<boolean> {
  try { const r = await fetch('/sessions'); return (await r.json()).available === true; } catch { return false; }
}

export async function listDirs(dir?: string): Promise<{ dir: string; parent: string | null; entries: { name: string; path: string }[] }> {
  const r = await fetch(`/fs/list${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
  if (!r.ok) throw new Error('cannot list');
  return r.json();
}

export function recentDirs(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function rememberDir(dir: string): void {
  const next = [dir, ...recentDirs().filter((d) => d !== dir)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
```

- [ ] **Step 3: Type-check client** `npm run build -w @agent-citadel/client`.
- [ ] **Step 4: Commit** `git add packages/client/vite.config.ts packages/client/src/sessions.ts && git commit -m "feat(client): session fetch helpers + dev proxy for /sessions,/fs"`

---

## Task 8: client — i18n for launch dialog + SDK card actions

**Files:**
- Modify: `packages/client/src/i18n.ts`

- [ ] **Step 1: Add keys** to the `UiStrings` interface and to EN/PL/IT maps (the `i18n-base-language` test enforces parity):

EN:
```ts
  launchAgent: 'Launch agent',
  launchTitle: 'Launch a Claude Code agent',
  launchFolder: 'Working folder',
  launchPrompt: 'Prompt',
  launchModel: 'Model (blank = account default)',
  launchPermissionMode: 'Permission mode',
  launchStart: 'Launch',
  launchCancel: 'Cancel',
  launchCostWarning: 'This runs a real Claude Code session — it uses your account and consumes tokens.',
  launchUnavailable: 'Claude Agent SDK not installed — run npm i @anthropic-ai/claude-agent-sdk zod',
  pqSend: 'Send',
  pqSendPlaceholder: 'Reply to the agent…',
  pqStop: 'Stop agent',
  pqRejectReason: 'Reason (optional)',
  pqOpenQuestion: 'agent has a question — open',
  pqClose: 'Close',
```
PL:
```ts
  launchAgent: 'Uruchom agenta',
  launchTitle: 'Uruchom agenta Claude Code',
  launchFolder: 'Folder roboczy',
  launchPrompt: 'Prompt',
  launchModel: 'Model (puste = domyślny konta)',
  launchPermissionMode: 'Tryb uprawnień',
  launchStart: 'Uruchom',
  launchCancel: 'Anuluj',
  launchCostWarning: 'To uruchamia prawdziwą sesję Claude Code — używa Twojego konta i zużywa tokeny.',
  launchUnavailable: 'Brak Claude Agent SDK — uruchom npm i @anthropic-ai/claude-agent-sdk zod',
  pqSend: 'Wyślij',
  pqSendPlaceholder: 'Odpowiedz agentowi…',
  pqStop: 'Zatrzymaj agenta',
  pqRejectReason: 'Powód (opcjonalnie)',
  pqOpenQuestion: 'agent ma pytanie — otwórz',
  pqClose: 'Zamknij',
```
IT:
```ts
  launchAgent: 'Avvia agente',
  launchTitle: 'Avvia un agente Claude Code',
  launchFolder: 'Cartella di lavoro',
  launchPrompt: 'Prompt',
  launchModel: 'Modello (vuoto = predefinito account)',
  launchPermissionMode: 'Modalità permessi',
  launchStart: 'Avvia',
  launchCancel: 'Annulla',
  launchCostWarning: 'Avvia una vera sessione Claude Code — usa il tuo account e consuma token.',
  launchUnavailable: 'Claude Agent SDK non installato — esegui npm i @anthropic-ai/claude-agent-sdk zod',
  pqSend: 'Invia',
  pqSendPlaceholder: 'Rispondi all’agente…',
  pqStop: 'Ferma agente',
  pqRejectReason: 'Motivo (facoltativo)',
  pqOpenQuestion: 'l’agente ha una domanda — apri',
  pqClose: 'Chiudi',
```

- [ ] **Step 2: Run** `npm run test -w @agent-citadel/client -- i18n` → PASS; build client.
- [ ] **Step 3: Commit** `git add packages/client/src/i18n.ts && git commit -m "feat(client): i18n for launch dialog + SDK card actions"`

---

## Task 9: client — Launch dialog + button

**Files:**
- Create: `packages/client/src/hud/LaunchAgentDialog.tsx`, `packages/client/src/hud/LaunchAgentButton.tsx`
- Modify: `packages/client/src/hud/ThemeSwitch.tsx`

- [ ] **Step 1: Create `LaunchAgentDialog.tsx`:**
```tsx
import { useEffect, useState } from 'react';
import { SDK_PERMISSION_MODES, type SdkPermissionMode } from '@agent-citadel/shared';
import { useUi } from '../i18n';
import { launchAgent, listDirs, recentDirs, sdkAvailable } from '../sessions';

export function LaunchAgentDialog({ onClose }: { onClose: () => void }) {
  const t = useUi();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<SdkPermissionMode>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browse, setBrowse] = useState<{ dir: string; parent: string | null; entries: { name: string; path: string }[] } | null>(null);

  useEffect(() => { void sdkAvailable().then(setAvailable); }, []);
  useEffect(() => { if (available) void listDirs(cwd || undefined).then(setBrowse).catch(() => setBrowse(null)); }, [available, cwd]);

  const submit = async () => {
    setBusy(true); setError(null);
    const res = await launchAgent({ cwd, prompt, model: model || undefined, permissionMode: mode });
    setBusy(false);
    if (res.ok) onClose(); else setError(res.error ?? 'failed');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div className="hud-panel" style={{ width: 460, maxWidth: '90vw', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <strong className="px" style={{ fontSize: 15, color: '#fac775' }}>{t.launchTitle}</strong>
        {available === false && <div style={{ color: '#f09595', fontSize: 12 }}>{t.launchUnavailable}</div>}
        <div style={{ fontSize: 11, opacity: 0.7 }}>{t.launchCostWarning}</div>

        <label style={{ fontSize: 12 }}>{t.launchFolder}
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/you/project" style={{ width: '100%' }} />
        </label>
        {recentDirs().length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {recentDirs().map((d) => <button key={d} className="ghost" style={{ fontSize: 11 }} onClick={() => setCwd(d)}>{d.split('/').pop()}</button>)}
          </div>
        )}
        {browse && (
          <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid #ffffff14', fontSize: 12 }}>
            {browse.parent && <div style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={() => setCwd(browse.parent!)}>📁 ..</div>}
            {browse.entries.map((e) => <div key={e.path} style={{ cursor: 'pointer', padding: '2px 6px' }} onClick={() => setCwd(e.path)}>📁 {e.name}</div>)}
          </div>
        )}

        <label style={{ fontSize: 12 }}>{t.launchPrompt}
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12 }}>{t.launchModel}
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-8" style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 12 }}>{t.launchPermissionMode}
          <select value={mode} onChange={(e) => setMode(e.target.value as SdkPermissionMode)} style={{ width: '100%' }}>
            {SDK_PERMISSION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        {error && <div style={{ color: '#f09595', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>{t.launchCancel}</button>
          <button className="ghost" disabled={busy || !cwd.trim() || !prompt.trim()} onClick={submit}>{t.launchStart}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `LaunchAgentButton.tsx`:**
```tsx
import { useEffect, useState } from 'react';
import { useUi } from '../i18n';
import { sdkAvailable } from '../sessions';
import { LaunchAgentDialog } from './LaunchAgentDialog';

export function LaunchAgentButton() {
  const t = useUi();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => { void sdkAvailable().then(setAvailable); }, []);
  if (!available) return null; // hide when the SDK isn't installed
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)} title={t.launchAgent}>🚀 {t.launchAgent}</button>
      {open && <LaunchAgentDialog onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 3: Render the button** in `ThemeSwitch.tsx` next to `<PanelControlToggle />`:
```tsx
import { LaunchAgentButton } from './LaunchAgentButton';
...
<PanelControlToggle />
<LaunchAgentButton />
```

- [ ] **Step 4: Build client** `npm run build -w @agent-citadel/client`.
- [ ] **Step 5: Commit** `git add packages/client/src/hud/LaunchAgentDialog.tsx packages/client/src/hud/LaunchAgentButton.tsx packages/client/src/hud/ThemeSwitch.tsx && git commit -m "feat(client): launch-agent dialog + button"`

---

## Task 10: client — AskUserQuestion centered modal + panel trigger + SDK session controls

**Design (per user):** `AskUserQuestion` is NOT shown inline. The hero's panel shows a clickable **trigger** ("📣 agent has a question"); clicking opens a **centered, game-event-style modal** with the question text + options. Read-only (hook/terminal source) → options shown without answer buttons + "answer in the terminal" badge. SDK source → clickable option buttons that send the selection and close the modal. Permission + plan stay as inline cards in the panel (Phase 1 behavior; SDK plan additionally gets reject-with-reason). A reply/stop footer for SDK-launched sessions lives in the panel.

**Files:**
- Modify: `packages/client/src/store.ts` (open-question UI state + sdk session ids)
- Modify: `packages/client/src/hud/PendingQuestionCard.tsx` (ask-user-question → trigger; SDK plan reject-reason)
- Create: `packages/client/src/hud/QuestionModal.tsx`
- Modify: root app component that renders `<SidePanel/>` (render `<QuestionModal/>`) — find with `grep -rn "<SidePanel" packages/client/src`
- Modify: `packages/client/src/hud/SidePanel.tsx` (SDK reply/stop footer)
- Modify: `packages/client/src/hud/LaunchAgentDialog.tsx` (mark launched session)

- [ ] **Step 1: store — open-question + sdk-session state** (`store.ts`):
  - In `WorldStore` add:
    ```ts
      /** Id of the AskUserQuestion shown as a centered modal (undefined = closed). */
      openQuestionId?: string;
      /** Session ids the app launched via the SDK (drive the reply/stop footer). */
      sdkSessionIds: Record<string, true>;
      openQuestion(id?: string): void;
      markSdkSession(sessionId: string): void;
    ```
  - Initial state: add `sdkSessionIds: {},`
  - Actions:
    ```ts
      openQuestion: (openQuestionId) => set({ openQuestionId }),
      markSdkSession: (sessionId) => set((s) => ({ sdkSessionIds: { ...s.sdkSessionIds, [sessionId]: true } })),
    ```
  - In `apply`, `case 'snapshot'`: add `openQuestionId: undefined` to the reset object.
  - In `apply`, `case 'pending-question-resolved'`: also clear the modal when it showed that question:
    ```ts
        case 'pending-question-resolved': {
          const pending = { ...state.pending };
          delete pending[event.id];
          return { pending, openQuestionId: state.openQuestionId === event.id ? undefined : state.openQuestionId };
        }
    ```

- [ ] **Step 2: PendingQuestionCard — ask-user-question becomes a trigger** (`PendingQuestionCard.tsx`):
  - Add `import { useWorld } from '../store';` if not present (it is).
  - Make the detail/tool line NOT render for `isQuestion` (the modal carries the text now): change the detail block so the `isQuestion` branch renders `null` (keep the mono tool+detail line only for permission/plan).
  - Replace the whole `isQuestion` body (options/hint) with a single trigger button (both sources):
    ```tsx
        {isQuestion && (
          <button
            className="ghost"
            style={{ alignSelf: 'flex-start', color: '#ef9f27', fontWeight: 600 }}
            onClick={() => useWorld.getState().openQuestion(question.id)}
          >
            📣 {t.pqOpenQuestion}
          </button>
        )}
    ```
  - Keep the `tool-permission` block unchanged. For `plan-approval`: guard the existing approve/reject buttons to `question.source !== 'sdk'`, and add an SDK variant with a reason input:
    ```tsx
        {question.kind === 'plan-approval' && question.source === 'sdk' && (
          <PlanRejectControls id={question.id} t={t} />
        )}
    ```
    helper at the bottom of the file:
    ```tsx
    function PlanRejectControls({ id, t }: { id: string; t: ReturnType<typeof useUi> }) {
      const [reason, setReason] = useState('');
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="ghost" onClick={() => sendAnswer({ id, decision: { type: 'approve-plan' } })}>{t.pqApprovePlan}</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.pqRejectReason} style={{ flex: 1, minWidth: 100 }} />
          <button className="ghost" onClick={() => sendAnswer({ id, decision: { type: 'reject-plan', reason: reason || undefined } })}>{t.pqRejectPlan}</button>
        </div>
      );
    }
    ```
    (Import `useState` from `react`.) The gating-on-awaiting (from Phase 1) stays for `ask-user-question`.

- [ ] **Step 3: Create `packages/client/src/hud/QuestionModal.tsx`** (centered "game event" overlay):
    ```tsx
    import { useEffect } from 'react';
    import type { PendingQuestion } from '@agent-citadel/shared';
    import { useWorld } from '../store';
    import { useUi } from '../i18n';
    import { sendAnswer } from '../ws';

    /** Centered modal showing one AskUserQuestion (opened from the hero panel trigger). */
    export function QuestionModal() {
      const openId = useWorld((s) => s.openQuestionId);
      const pending = useWorld((s) => s.pending);
      const heroes = useWorld((s) => s.heroes);
      const t = useUi();
      const close = () => useWorld.getState().openQuestion(undefined);
      const q: PendingQuestion | undefined = openId ? pending[openId] : undefined;

      useEffect(() => {
        if (!q) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [q]);

      if (!q || q.kind !== 'ask-user-question') return null;
      const heroName = heroes[q.sessionId]?.title ?? '';
      const answer = (label: string) => { sendAnswer({ id: q.id, decision: { type: 'select', optionLabels: [label] } }); close(); };

      return (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: '#000a', display: 'grid', placeItems: 'center', zIndex: 100 }}>
          <div onClick={(e) => e.stopPropagation()} className="hud-panel" style={{ width: 520, maxWidth: '92vw', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 0 0 2px #ef9f27, 0 12px 40px #000a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>📣</span>
              <div style={{ flex: 1 }}>
                <div className="px" style={{ fontSize: 15, color: '#fac775' }}>{t.pqQuestionTitle}</div>
                {heroName && <div style={{ fontSize: 12, opacity: 0.7 }}>{heroName}</div>}
              </div>
              <button className="ghost" onClick={close}>{t.pqClose}</button>
            </div>
            {q.detail && <div style={{ fontSize: 15, lineHeight: 1.5 }}>{q.detail}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(q.options ?? []).map((o, i) =>
                q.source === 'sdk' ? (
                  <button key={i} className="ghost" style={{ textAlign: 'left', padding: '8px 10px' }} onClick={() => answer(o.label)}>
                    <b>{o.label}</b>{o.description ? <span style={{ opacity: 0.7 }}> — {o.description}</span> : null}
                  </button>
                ) : (
                  <div key={i} style={{ padding: '8px 10px', border: '1px solid #ffffff14' }}>
                    <b>{o.label}</b>{o.description ? <span style={{ opacity: 0.7 }}> — {o.description}</span> : null}
                  </div>
                ),
              )}
            </div>
            {q.source !== 'sdk' && <div style={{ opacity: 0.7, fontSize: 12 }}>{t.pqAnswerInTerminal}</div>}
          </div>
        </div>
      );
    }
    ```

- [ ] **Step 4: Render `<QuestionModal/>` at app root.** `grep -rn "<SidePanel" packages/client/src` to find the root component; import and render `<QuestionModal />` as a top-level sibling of `<SidePanel/>` so it overlays the whole screen.

- [ ] **Step 5: SidePanel — SDK reply/stop footer** (`SidePanel.tsx`):
  - Add imports: `import { sendSessionMessage, stopSession } from '../sessions';` and ensure `useState`/`useUi` are imported.
  - After computing `hero` (before the early return is fine; compute the selector unconditionally near the others): `const isSdk = useWorld((s) => (selected ? !!s.sdkSessionIds[selected] : false));`
  - In the JSX after the transcript block, add: `{isSdk && <SdkSessionFooter sessionId={selected} />}`
  - Helper at the bottom of the file:
    ```tsx
    function SdkSessionFooter({ sessionId }: { sessionId: string }) {
      const t = useUi();
      const [text, setText] = useState('');
      return (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.pqSendPlaceholder} style={{ flex: 1 }} />
          <button className="ghost" disabled={!text.trim()} onClick={() => { void sendSessionMessage(sessionId, text); setText(''); }}>{t.pqSend}</button>
          <button className="ghost" onClick={() => void stopSession(sessionId)}>{t.pqStop}</button>
        </div>
      );
    }
    ```

- [ ] **Step 6: Mark launched sessions** (`LaunchAgentDialog.tsx`): on successful launch, before `onClose()`, when `res.sessionId` is present call `useWorld.getState().markSdkSession(res.sessionId)` (import `useWorld` from `../store`).

- [ ] **Step 7: Build + tests** `npm run build -w @agent-citadel/client && npm run test -w @agent-citadel/client`.
- [ ] **Step 8: Commit** `git add packages/client/src/store.ts packages/client/src/hud/PendingQuestionCard.tsx packages/client/src/hud/QuestionModal.tsx packages/client/src/hud/SidePanel.tsx packages/client/src/hud/LaunchAgentDialog.tsx <root app file> && git commit -m "feat(client): AskUserQuestion centered modal + SDK session controls"`

---

## Task 11: preview verification (demo + injected SDK question)

- [ ] **Step 1:** `preview_start` demo; confirm no console errors; `🚀 Launch agent` button visible (note: with the SDK installed `sdkAvailable()` is true; in demo the FakeSdkRunner makes it available too).
- [ ] **Step 2:** Open the dialog; verify folder browse (`/fs/list`), prompt, model, permission-mode select, cost warning render.
- [ ] **Step 3:** Inject an SDK AskUserQuestion and verify the **panel trigger → centered modal** flow:
  ```js
  const sid = Object.keys(__world.getState().heroes)[0];
  __world.getState().select(sid);
  __world.getState().apply({ type:'hero-updated', hero: { ...__world.getState().heroes[sid], state:'awaiting-input' } });
  __world.getState().apply({ type:'pending-question', question: { id:'sdk-q', sessionId:sid, source:'sdk', kind:'ask-user-question', tool:'AskUserQuestion', detail:'Which database should I use?', options:[{label:'PostgreSQL',description:'relational'},{label:'SQLite',description:'file-based'}], createdAt:new Date().toISOString() } });
  ```
  Confirm: the panel shows a **trigger** ("📣 agent has a question"), NOT inline options. Click it (or `__world.getState().openQuestion('sdk-q')`) → a **centered modal** appears with the question text + clickable option buttons. Clicking an option sends a `select` answer over WS and closes the modal. Esc / click-outside / Close also dismiss.
- [ ] **Step 3b:** Repeat with `source:'hook'` → the modal shows options **read-only** + "answer in the terminal" badge (no answer buttons).
- [ ] **Step 4:** Screenshot the centered modal as proof; stop preview.

---

## Task 12: real E2E + docs

- [ ] **Step 1: Install the SDK** (real): `npm i @anthropic-ai/claude-agent-sdk zod` (these are optionalDependencies; install for real use).
- [ ] **Step 2: `npm run dev`**, enable nothing special (SDK launch uses its own canUseTool, independent of the Phase 1 hooks toggle). Click **🚀 Launch agent**, pick a folder, prompt the agent to do something requiring Bash AND to ask a clarifying question (e.g. "Ask me which package manager to use, then run its install"). Confirm:
  - permission card appears in the panel for Bash → Allow/Deny works;
  - **AskUserQuestion card appears with real option buttons** → clicking continues the agent (this validates the `toolAliases`+MCP path — the one integration risk);
  - free-text reply reaches the agent; **Stop** interrupts it.
  - If the model does not accept the `CallToolResult` shape, adjust `selectionToToolResult` in `bridge.ts` (try returning the full `AskUserQuestionOutput` echo with the chosen option marked) and re-test. This is the only step expected to possibly need iteration.
- [ ] **Step 3: Update README** Privacy/feature section: app can now launch agents (real sessions, your account); SDK is optional (`npm i @anthropic-ai/claude-agent-sdk zod`).
- [ ] **Step 4:** `npm test && npm run build` → all green.
- [ ] **Step 5: Commit** docs + any bridge adjustment.

---

## Self-review (wykonane przy pisaniu planu)

- **Pokrycie specu §5:** okno startu (folder+prompt+model+mode) → Task 9; SDK jako optionalDependency → Task 4; `query`+`canUseTool`→panel → Task 2/4; `AskUserQuestion` przez panel (toolAliases+MCP) → Task 2/4/10; sesja jako bohater przez watcher → automatyczne (bez kodu); to samo UI karty → Task 10; dosyłanie wiadomości + stop → Task 6/10.
- **Reużycie Fazy 1:** `PendingRegistry`, kanał WS `answer`, `QuestionDecision` (`select`/`text`/`reject-plan` już istnieją), `parseAskUserQuestion`, karta — bez zmian protokołu.
- **Placeholdery:** brak; każdy krok z kodem. Realny adapter (Task 4) jest jedynym miejscem bez unit-testu (cienki, za interfejsem) — weryfikacja w Task 12, z jawnym krokiem korekty kształtu `CallToolResult`.
- **Spójność typów:** `SdkRunner`/`LiveSession`/`LaunchParams`, `makeCanUseTool`/`makeAskQuestionHandler`, `PermissionResult`/`CallToolResult`, `LiveSessionRegistry` (launch/list/pushText/stop/stopAll), `validateLaunchRequest`/`LaunchAgentRequest`/`SdkPermissionMode`, route'y `/sessions*`/`/fs/list`, helpery klienta — użyte spójnie.

## Ryzyka / do potwierdzenia
- **`toolAliases` + kształt `CallToolResult` dla `AskUserQuestion`** — jedyny realny unknown; izolowany w `bridge.ts`/`real-runner.ts`, weryfikowany E2E (Task 12) z gotowym planem korekty.
- Korelacja `session_id`: hero tworzy watcher z transkryptu; panel używa `session_id` z init SDK. Drobne okno czasowe zanim id dotrze — pytania trzymają `sessionId` z chwili wywołania (realId gdy dostępne, inaczej klucz tymczasowy); w praktyce init przychodzi przed pierwszym narzędziem.
- Bezpieczeństwo: launch = realne wykonanie na koncie usera; okno startu ostrzega; `bypassPermissions` jako świadomy wybór w dropdownie.
```
