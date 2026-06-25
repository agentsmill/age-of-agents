# Local LLM Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local-LLM sessions (Ollama, llama.cpp, vLLM, oMLX) appear as heroes in Age of Agents by capturing their conversations in flight and writing them in the JSONL transcript format the watcher already reads.

**Architecture:** Two capture adapters feed one shared JSONL transcript, read by one new `local-llm` source. Adapter A (`aoa local <model>`) wraps `ollama run` behind an ephemeral Ollama-native logging proxy (`OLLAMA_HOST`); Adapter B (`aoa local-proxy`) is a long-lived OpenAI `/v1` proxy restored from closed PR #2. The model name flows into the existing model registry automatically via `HeroSnapshot.model`.

**Tech Stack:** TypeScript (ESM, NodeNext — imports use `.js` extensions), Node ≥22 (global `fetch`, `node:http`, `node:crypto`), Vitest, npm workspaces (`@agent-citadel/shared` | `server` | `client`).

## Global Constraints

- Node ≥22; ESM with NodeNext resolution — **every relative import ends in `.js`** even from `.ts` source.
- **No new runtime dependencies** — use Node built-ins only (`node:http`, `node:fs/promises`, `node:path`, `node:crypto`, `node:stream`, global `fetch`).
- **Code comments and developer-facing strings in English** (project convention, PR #8). User-facing chat stays Polish; this is code.
- Tests: Vitest. Server tests live in `packages/server/test/*.test.ts`; run with `npm run test -w @agent-citadel/server`. Client tests in `packages/client/tests/*.test.ts`.
- Source `parseLine` MUST be pure (no I/O) and MUST NOT throw — return `[]` on bad input, mirroring sibling sources.
- Transcript dir: `~/.age-of-agents/local-llm/sessions/<uuid>.jsonl`, overridable via `LOCAL_LLM_SESSIONS_DIR`.
- Full type-check + tests must pass before each commit: `npm run build && npm test` from repo root.

---

## File Structure

| Path | Create/Modify | Responsibility |
|------|---------------|----------------|
| `packages/shared/src/index.ts` | Modify (1 line) | add `'local-llm'` to `AgentKind` |
| `packages/shared/src/providers.ts` | Modify (1 entry) | add `local-llm` to `AGENT_PROVIDERS` (single source of truth for badges) |
| `packages/client/src/game/emblems.ts` | Modify (1 token) | add `'local-llm'` to the `KINDS` array |
| `packages/shared/src/index.ts` (registry) | Modify (optional) | starter sprite/window rules for common local model families |
| `packages/server/src/sources/local-llm.ts` | Create | classify `sessions/*.jsonl` + pure `parseLine` → Facts |
| `packages/server/src/sources/index.ts` | Modify (2 lines) | register `localLlmSource` in `ALL_SOURCES` |
| `packages/server/src/proxy/ollama-logger.ts` | Create | transparent Ollama proxy; tee `/api/chat` NDJSON → transcript; `/api/show` → context window |
| `packages/server/src/proxy/openai-logger.ts` | Create (restored from PR #2) | OpenAI `/v1/chat/completions` proxy → `LLM_BASE_URL`; tee SSE/non-stream → transcript |
| `packages/server/src/cli-args.ts` | Modify | parse leading subcommand (`local`, `local-proxy`) |
| `packages/server/src/cli.ts` | Modify | dispatch subcommands; default unchanged (start server) |
| `packages/server/test/local-llm.test.ts` | Create | `parseLine` golden tests |
| `packages/server/test/ollama-logger.test.ts` | Create | NDJSON tee → JSONL |
| `packages/server/test/openai-logger.test.ts` | Create | SSE + non-stream tee → JSONL |
| `packages/server/test/cli-args.test.ts` | Create | subcommand parsing |
| `README.md` | Modify | document `aoa local` / `aoa local-proxy` + four backend URLs |

---

## Task 1: Register the `local-llm` agent kind

**Files:**
- Modify: `packages/shared/src/index.ts:10`
- Modify: `packages/shared/src/providers.ts:21-26`
- Modify: `packages/client/src/game/emblems.ts:10`
- Test: `packages/server/test/local-llm-kind.test.ts` (Create)

**Interfaces:**
- Produces: `AgentKind` union now includes `'local-llm'`; `AGENT_PROVIDERS['local-llm']: ProviderInfo`; `resolveProvider('local-llm')` returns it.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/local-llm-kind.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDERS, resolveProvider } from '@agent-citadel/shared';

describe('local-llm provider', () => {
  it('is registered in AGENT_PROVIDERS', () => {
    expect(AGENT_PROVIDERS['local-llm']).toBeDefined();
    expect(AGENT_PROVIDERS['local-llm'].label).toBe('Local LLM');
    expect(AGENT_PROVIDERS['local-llm'].labelShort).toBe('L');
  });

  it('resolves by string', () => {
    expect(resolveProvider('local-llm').kind).toBe('local-llm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- local-llm-kind`
Expected: FAIL — `AGENT_PROVIDERS['local-llm']` is `undefined` (and a type error on the union).

- [ ] **Step 3: Add the kind to the union**

In `packages/shared/src/index.ts:10`, change:

```ts
export type AgentKind = 'claude' | 'codex' | 'opencode' | 'koda' | 'local-llm';
```

- [ ] **Step 4: Add the provider entry**

In `packages/shared/src/providers.ts`, add to the `AGENT_PROVIDERS` object (after the `koda` line):

```ts
  'local-llm': { kind: 'local-llm', label: 'Local LLM', labelShort: 'L', color: '#22d3ee' }, // cyan-400
```

- [ ] **Step 5: Add the kind to client emblems**

In `packages/client/src/game/emblems.ts:10`, change:

```ts
const KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'koda', 'local-llm'];
```

- [ ] **Step 6: Run test + full type-check**

Run: `npm run test -w @agent-citadel/server -- local-llm-kind`
Expected: PASS.
Run: `npm run build`
Expected: PASS — no `Record<AgentKind>` is left incomplete (this is the compiler guard; if any other map errors, add a `local-llm` entry there too).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/providers.ts packages/client/src/game/emblems.ts packages/server/test/local-llm-kind.test.ts
git commit -m "feat(shared): register 'local-llm' agent kind + provider"
```

---

## Task 2: The `local-llm` source (pure parser)

**Files:**
- Create: `packages/server/src/sources/local-llm.ts`
- Modify: `packages/server/src/sources/index.ts`
- Test: `packages/server/test/local-llm.test.ts` (Create)

**Interfaces:**
- Consumes: `AgentSource`, `ClassifiedFile` from `./types.js`; `Fact` from `../transcript/facts.js`.
- Produces: `localLlmSource: AgentSource` (id `'local-llm'`); `localLlmSessionsDir(): string`; `interpretLocalLlmLine(line: string): Fact[]`; `localLlmToolToCanonical(name: string): string`. These are imported by `proxy/ollama-logger.ts` and `proxy/openai-logger.ts` (they call `localLlmSessionsDir()`).

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/local-llm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { interpretLocalLlmLine, localLlmToolToCanonical, localLlmSource } from '../src/sources/local-llm.js';

describe('interpretLocalLlmLine', () => {
  it('maps a session record to a meta fact with model + context window', () => {
    const facts = interpretLocalLlmLine(
      JSON.stringify({ type: 'session', ts: '2026-06-22T00:00:00Z', cwd: '/tmp', model: 'bielik:Q4', contextWindow: 8192 }),
    );
    expect(facts).toContainEqual({ kind: 'meta', model: 'bielik:Q4', cwd: '/tmp' });
    expect(facts).toContainEqual(
      expect.objectContaining({ kind: 'usage', contextWindow: 8192 }),
    );
  });

  it('maps a user message to a prompt fact', () => {
    const facts = interpretLocalLlmLine(JSON.stringify({ type: 'message', ts: 't', role: 'user', content: 'hi' }));
    expect(facts).toEqual([{ kind: 'prompt', text: 'hi', ts: 't' }]);
  });

  it('maps an assistant message + tool call to assistant-text + tool-start', () => {
    const facts = interpretLocalLlmLine(
      JSON.stringify({
        type: 'message',
        ts: 't',
        role: 'assistant',
        content: 'running',
        tool_calls: [{ id: 'c1', function: { name: 'shell', arguments: '{"command":"ls"}' } }],
      }),
    );
    expect(facts).toContainEqual({ kind: 'assistant-text', text: 'running', ts: 't' });
    expect(facts).toContainEqual(
      expect.objectContaining({ kind: 'tool-start', tool: 'Bash', detail: 'ls', messageId: 'c1' }),
    );
  });

  it('maps usage and turn_complete', () => {
    expect(interpretLocalLlmLine(JSON.stringify({ type: 'usage', input: 5, output: 7 }))).toContainEqual(
      expect.objectContaining({ kind: 'usage-total', input: 5, output: 7 }),
    );
    expect(interpretLocalLlmLine(JSON.stringify({ type: 'turn_complete', ts: 't' }))).toEqual([
      { kind: 'turn-end', ts: 't' },
    ]);
  });

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(interpretLocalLlmLine('not json')).toEqual([]);
  });
});

describe('localLlmToolToCanonical', () => {
  it('canonicalizes common names', () => {
    expect(localLlmToolToCanonical('exec')).toBe('Bash');
    expect(localLlmToolToCanonical('read_file')).toBe('Read');
    expect(localLlmToolToCanonical('my.custom.tool')).toBe('mcp__my__custom__tool');
  });
});

describe('localLlmSource.classify', () => {
  it('classifies a uuid .jsonl at root as a session', () => {
    const root = '/sessions';
    const c = localLlmSource.classify(`${root}/123e4567-e89b-12d3-a456-426614174000.jsonl`, root);
    expect(c).toEqual({ kind: 'session', sessionId: '123e4567-e89b-12d3-a456-426614174000', projectDir: '' });
  });
  it('ignores non-jsonl and nested files', () => {
    const root = '/sessions';
    expect(localLlmSource.classify(`${root}/notes.txt`, root).kind).toBe('other');
    expect(localLlmSource.classify(`${root}/sub/123e4567-e89b-12d3-a456-426614174000.jsonl`, root).kind).toBe('other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- local-llm.test`
Expected: FAIL — cannot find module `../src/sources/local-llm.js`.

- [ ] **Step 3: Create the source**

Create `packages/server/src/sources/local-llm.ts` (restored from PR #2, extended with `contextWindow` on the meta/usage path):

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Source "local-llm": any agent speaking OpenAI-compatible chat-completions
 * (Ollama, llama.cpp, vLLM, oMLX) captured through one of the bundled logging
 * proxies (proxy/ollama-logger.ts, proxy/openai-logger.ts). The proxy writes a
 * JSONL transcript to ~/.age-of-agents/local-llm/sessions/<uuid>.jsonl, which
 * this source reads exactly like the claude/codex/opencode/koda sources.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function localLlmSessionsDir(): string {
  return process.env.LOCAL_LLM_SESSIONS_DIR ?? join(homedir(), '.age-of-agents', 'local-llm', 'sessions');
}

function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** OpenAI/Ollama function-call name → canonical game tool name. */
export function localLlmToolToCanonical(name: string): string {
  switch (name.toLowerCase()) {
    case 'bash':
    case 'shell':
    case 'exec':
      return 'Bash';
    case 'read':
    case 'read_file':
      return 'Read';
    case 'edit':
    case 'edit_file':
      return 'Edit';
    case 'write':
    case 'write_file':
      return 'Write';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Grep';
    case 'web_search':
    case 'websearch':
      return 'WebSearch';
    case 'web_fetch':
    case 'webfetch':
      return 'WebFetch';
    case 'task':
    case 'agent':
      return 'Task';
    case 'todo':
    case 'todowrite':
      return 'TodoWrite';
    default:
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}

function toolCallDetail(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const generic = str(args.command) ?? str(args.path) ?? str(args.file_path) ?? str(args.query) ?? str(args.pattern);
  return generic ? clip(generic, 60) : undefined;
}

function parseToolArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return undefined;
}

function handleMessage(record: any, ts: string, facts: Fact[]): void {
  const role = str(record.role);
  const content = typeof record.content === 'string' ? record.content : undefined;

  if (role === 'user' && content) {
    facts.push({ kind: 'prompt', text: clip(content), ts });
  } else if (role === 'assistant' && content) {
    facts.push({ kind: 'assistant-text', text: clip(content), ts });
  } else if (role === 'tool') {
    const isError = typeof content === 'string' && /error/i.test(content.slice(0, 32));
    facts.push({ kind: 'tool-result', isError, ts });
  }

  const toolCalls: any[] = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  for (const call of toolCalls) {
    const name = str(call?.function?.name) ?? str(call?.name);
    if (!name) continue;
    facts.push({
      kind: 'tool-start',
      tool: localLlmToolToCanonical(name),
      detail: toolCallDetail(parseToolArgs(call?.function?.arguments ?? call?.arguments)),
      messageId: str(call?.id) ?? `local-llm-${ts}`,
      ts,
    });
  }
}

/** Parse one JSONL line written by a logging proxy → Facts. Pure; never throws. */
export function interpretLocalLlmLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];

  const ts: string = str(record.ts) ?? new Date().toISOString();
  const facts: Fact[] = [];

  switch (record.type) {
    case 'session': {
      facts.push({ kind: 'meta', cwd: str(record.cwd), model: str(record.model) });
      // Carry the real context window (from Ollama /api/show) so the hero's
      // context bar is correct before any WindowRule exists in the registry.
      if (typeof record.contextWindow === 'number' && record.contextWindow > 0) {
        facts.push({ kind: 'usage', messageId: `local-llm-window-${ts}`, input: 0, output: 0, contextWindow: record.contextWindow });
      }
      break;
    }
    case 'message':
      handleMessage(record, ts, facts);
      break;
    case 'usage':
      if (typeof record.input === 'number' || typeof record.output === 'number') {
        facts.push({ kind: 'usage-total', input: Number(record.input ?? 0), output: Number(record.output ?? 0) });
      }
      break;
    case 'turn_complete':
      facts.push({ kind: 'turn-end', ts });
      break;
  }

  return facts;
}

/** Source local-llm: ~/.age-of-agents/local-llm/sessions/<uuid>.jsonl, one file per session. */
export const localLlmSource: AgentSource = {
  id: 'local-llm',
  roots: () => [localLlmSessionsDir()],
  depth: 1,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    if (rel.includes('/')) return { kind: 'other' };
    if (!rel.endsWith('.jsonl')) return { kind: 'other' };
    const m = rel.match(UUID_RE);
    if (!m) return { kind: 'other' };
    return { kind: 'session', sessionId: m[0], projectDir: '' };
  },
  parseLine: interpretLocalLlmLine,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-citadel/server -- local-llm.test`
Expected: PASS (all cases).

- [ ] **Step 5: Register the source**

In `packages/server/src/sources/index.ts`, add the import and include it in `ALL_SOURCES`:

```ts
import { localLlmSource } from './local-llm.js';
// ...
export const ALL_SOURCES: AgentSource[] = [claudeSource, codexSource, opencodeSource, kodaSource, localLlmSource];
```

- [ ] **Step 6: Run full build + tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sources/local-llm.ts packages/server/src/sources/index.ts packages/server/test/local-llm.test.ts
git commit -m "feat(server): add local-llm source reading proxy transcripts"
```

---

## Task 3: Ollama logging proxy (Adapter A core)

**Files:**
- Create: `packages/server/src/proxy/ollama-logger.ts`
- Test: `packages/server/test/ollama-logger.test.ts` (Create)

**Interfaces:**
- Consumes: `localLlmSessionsDir` from `../sources/local-llm.js`.
- Produces: `startOllamaLoggerProxy(opts?: OllamaLoggerOptions): Promise<RunningProxy>` where
  `OllamaLoggerOptions = { port?: number; host?: string; upstream?: string; sessionsDir?: string }`
  and `RunningProxy = { url: string; port: number; close: () => Promise<void> }`.
  Also exports the pure helper `parseOllamaContextWindow(showResponse: unknown): number | undefined`
  and `teeOllamaChat(reqMessages: any[], ndjsonLines: string[]): TranscriptRecord[]` for testing.
- `TranscriptRecord` is `Record<string, unknown>` written one-per-line as JSON.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/ollama-logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseOllamaContextWindow, teeOllamaChat } from '../src/proxy/ollama-logger.js';

describe('parseOllamaContextWindow', () => {
  it('reads the *.context_length key from model_info', () => {
    const show = { model_info: { 'llama.context_length': 8192, 'general.architecture': 'llama' } };
    expect(parseOllamaContextWindow(show)).toBe(8192);
  });
  it('returns undefined when absent', () => {
    expect(parseOllamaContextWindow({})).toBeUndefined();
    expect(parseOllamaContextWindow(null)).toBeUndefined();
  });
});

describe('teeOllamaChat', () => {
  it('logs new request messages, the accumulated assistant reply, usage, and turn_complete', () => {
    const reqMessages = [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ];
    const ndjson = [
      JSON.stringify({ message: { role: 'assistant', content: 'hi' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: ' there' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 12, eval_count: 4 }),
    ];
    const records = teeOllamaChat(reqMessages, ndjson);
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', content: 'hello' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'message', role: 'assistant', content: 'hi there' }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'usage', input: 12, output: 4 }));
    expect(records).toContainEqual(expect.objectContaining({ type: 'turn_complete' }));
  });

  it('captures tool calls from the final assistant message', () => {
    const ndjson = [
      JSON.stringify({
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'shell', arguments: { command: 'ls' } } }] },
        done: true,
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    ];
    const records = teeOllamaChat([{ role: 'user', content: 'run ls' }], ndjson);
    const assistant = records.find((r) => r.type === 'message' && r.role === 'assistant') as any;
    expect(assistant.tool_calls?.[0]?.function?.name).toBe('shell');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- ollama-logger`
Expected: FAIL — cannot find module `../src/proxy/ollama-logger.js`.

- [ ] **Step 3: Implement the proxy**

Create `packages/server/src/proxy/ollama-logger.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { localLlmSessionsDir } from '../sources/local-llm.js';

/**
 * Transparent reverse-proxy for the Ollama API. The `aoa local` wrapper points
 * `OLLAMA_HOST` at this proxy and execs `ollama run`, so every request the CLI
 * makes is forwarded verbatim to the real Ollama server. We additionally tee
 * `/api/chat` traffic into a JSONL transcript that the `local-llm` source reads.
 * One proxy instance == one `ollama run` == one session file (no fingerprinting).
 */

export interface OllamaLoggerOptions {
  port?: number;
  host?: string;
  /** Real Ollama server "host:port" (no scheme). Default OLLAMA_HOST or 127.0.0.1:11434. */
  upstream?: string;
  sessionsDir?: string;
}

export interface RunningProxy {
  url: string;
  port: number;
  close: () => Promise<void>;
}

type TranscriptRecord = Record<string, unknown>;

const isChatPath = (url: string): boolean => url === '/api/chat' || url.startsWith('/api/chat?');

/** Ollama /api/show returns model_info with an "<arch>.context_length" key. */
export function parseOllamaContextWindow(show: unknown): number | undefined {
  if (!show || typeof show !== 'object') return undefined;
  const info = (show as any).model_info;
  if (!info || typeof info !== 'object') return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

/** Pure tee: given the request messages and the upstream NDJSON lines, build transcript records. */
export function teeOllamaChat(reqMessages: any[], ndjsonLines: string[]): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  const ts = new Date().toISOString();
  for (const m of reqMessages) {
    out.push({ type: 'message', ts, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
  }
  let assistantText = '';
  let toolCalls: any[] | undefined;
  let input = 0;
  let output = 0;
  let done = false;
  for (const line of ndjsonLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // partial frame split across chunks; the next chunk completes it
    }
    if (typeof evt?.message?.content === 'string') assistantText += evt.message.content;
    if (Array.isArray(evt?.message?.tool_calls) && evt.message.tool_calls.length) toolCalls = evt.message.tool_calls;
    if (evt?.done) {
      done = true;
      input = Number(evt.prompt_eval_count ?? 0);
      output = Number(evt.eval_count ?? 0);
    }
  }
  if (done) {
    out.push({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined, tool_calls: toolCalls });
    out.push({ type: 'usage', input, output });
    out.push({ type: 'turn_complete', ts: new Date().toISOString() });
  }
  return out;
}

export async function startOllamaLoggerProxy(opts: OllamaLoggerOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? '127.0.0.1';
  const upstream = (opts.upstream ?? process.env.OLLAMA_HOST ?? '127.0.0.1:11434').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const sessionsDir = opts.sessionsDir ?? localLlmSessionsDir();
  await mkdir(sessionsDir, { recursive: true });

  const file = join(sessionsDir, `${randomUUID()}.jsonl`);
  let sessionStarted = false;
  let knownMessages = 0;

  const logLine = (record: TranscriptRecord): Promise<void> => appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');

  async function fetchContextWindow(model: string): Promise<number | undefined> {
    try {
      const r = await fetch(`http://${upstream}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: model }) });
      if (!r.ok) return undefined;
      return parseOllamaContextWindow(await r.json());
    } catch {
      return undefined;
    }
  }

  async function ensureSession(model: string | undefined): Promise<void> {
    if (sessionStarted) return;
    sessionStarted = true;
    const contextWindow = model ? await fetchContextWindow(model) : undefined;
    await logLine({ type: 'session', ts: new Date().toISOString(), cwd: process.cwd(), model, backend: 'ollama', contextWindow });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'content-length' || typeof v === 'undefined') continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(`http://${upstream}${url}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' || body.length === 0 ? undefined : body,
      });
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `cannot reach Ollama at ${upstream}: ${(err as Error).message}` }));
      return;
    }

    const resHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (key === 'content-length' || key === 'content-encoding') return;
      resHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, resHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    // Non-chat endpoints: transparent passthrough.
    if (!(req.method === 'POST' && isChatPath(url))) {
      Readable.fromWeb(upstreamRes.body as any).pipe(res);
      return;
    }

    // Chat endpoint: tee while streaming back to the client unchanged.
    let reqBody: any = {};
    try {
      reqBody = body.length ? JSON.parse(body.toString('utf8')) : {};
    } catch {
      // not JSON: just pass through without logging
    }
    const messages: any[] = Array.isArray(reqBody.messages) ? reqBody.messages : [];
    await ensureSession(typeof reqBody.model === 'string' ? reqBody.model : undefined);

    const newMessages = messages.slice(knownMessages);
    knownMessages = messages.length;
    const reqTs = new Date().toISOString();
    for (const m of newMessages) {
      await logLine({ type: 'message', ts: reqTs, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
    }

    let buffered = '';
    let assistantText = '';
    let toolCalls: any[] | undefined;
    const node = Readable.fromWeb(upstreamRes.body as any);
    node.on('data', (chunk: Buffer) => {
      res.write(chunk);
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (typeof evt?.message?.content === 'string') assistantText += evt.message.content;
          if (Array.isArray(evt?.message?.tool_calls) && evt.message.tool_calls.length) toolCalls = evt.message.tool_calls;
          if (evt?.done) {
            void logLine({ type: 'message', ts: new Date().toISOString(), role: 'assistant', content: assistantText || undefined, tool_calls: toolCalls })
              .then(() => {
                knownMessages += 1;
                return logLine({ type: 'usage', input: Number(evt.prompt_eval_count ?? 0), output: Number(evt.eval_count ?? 0) });
              })
              .then(() => logLine({ type: 'turn_complete', ts: new Date().toISOString() }));
            assistantText = '';
            toolCalls = undefined;
          }
        } catch {
          // partial NDJSON frame; the next chunk completes it
        }
      }
    });
    node.on('end', () => res.end());
    node.on('error', () => res.end());
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-citadel/server -- ollama-logger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/proxy/ollama-logger.ts packages/server/test/ollama-logger.test.ts
git commit -m "feat(server): add Ollama logging proxy (tee /api/chat to transcript)"
```

---

## Task 4: `aoa local <model>` subcommand (Adapter A wiring)

**Files:**
- Modify: `packages/server/src/cli-args.ts`
- Modify: `packages/server/src/cli.ts`
- Test: `packages/server/test/cli-args.test.ts` (Create)

**Interfaces:**
- Consumes: `startOllamaLoggerProxy` from `./proxy/ollama-logger.js`.
- Produces: `parseSubcommand(argv: string[]): { command: 'serve' | 'local' | 'local-proxy'; rest: string[] }`.
  `cli.ts` `main()` dispatches on `command`; `serve` keeps today's behavior exactly.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/cli-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSubcommand } from '../src/cli-args.js';

describe('parseSubcommand', () => {
  it('defaults to serve with all args as rest', () => {
    expect(parseSubcommand(['--port', '9000'])).toEqual({ command: 'serve', rest: ['--port', '9000'] });
    expect(parseSubcommand([])).toEqual({ command: 'serve', rest: [] });
  });
  it('detects local + passes the model and trailing args through', () => {
    expect(parseSubcommand(['local', 'bielik:Q4', '--verbose'])).toEqual({ command: 'local', rest: ['bielik:Q4', '--verbose'] });
  });
  it('detects local-proxy', () => {
    expect(parseSubcommand(['local-proxy'])).toEqual({ command: 'local-proxy', rest: [] });
  });
  it('treats a leading flag as serve (not a subcommand)', () => {
    expect(parseSubcommand(['--demo']).command).toBe('serve');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- cli-args`
Expected: FAIL — `parseSubcommand` is not exported.

- [ ] **Step 3: Add `parseSubcommand` to `cli-args.ts`**

Append to `packages/server/src/cli-args.ts`:

```ts
export type Subcommand = 'serve' | 'local' | 'local-proxy';

/**
 * Splits a leading subcommand off argv. A token is a subcommand only if it is
 * the first arg and not a flag, so existing flag-only invocations keep working.
 */
export function parseSubcommand(argv: string[]): { command: Subcommand; rest: string[] } {
  const first = argv[0];
  if (first === 'local' || first === 'local-proxy') {
    return { command: first, rest: argv.slice(1) };
  }
  return { command: 'serve', rest: argv };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-citadel/server -- cli-args`
Expected: PASS.

- [ ] **Step 5: Wire the dispatch in `cli.ts`**

In `packages/server/src/cli.ts`, add imports near the top:

```ts
import { parseArgs, shouldOpenBrowser, parseSubcommand } from './cli-args.js';
import { startOllamaLoggerProxy } from './proxy/ollama-logger.js';
```

Add this function above `main()`:

```ts
async function runLocal(rest: string[]): Promise<number> {
  const model = rest[0];
  if (!model) {
    process.stderr.write('Usage: aoa local <model> [ollama run args…]\n');
    return 1;
  }
  const proxy = await startOllamaLoggerProxy();
  // `ollama` reads OLLAMA_HOST as "host:port" (no scheme).
  const ollamaHost = proxy.url.replace(/^https?:\/\//, '');
  process.stdout.write(`  ▸ Logging this session to Age of Agents (proxy ${proxy.url})\n\n`);
  const child = spawn('ollama', ['run', ...rest], {
    stdio: 'inherit',
    env: { ...process.env, OLLAMA_HOST: ollamaHost },
  });
  return await new Promise<number>((resolve) => {
    child.on('error', (err) => {
      process.stderr.write(`Failed to run 'ollama' — is it installed and on PATH? (${(err as Error).message})\n`);
      resolve(127);
    });
    child.on('exit', (code) => {
      void proxy.close().then(() => resolve(code ?? 0));
    });
  });
}
```

Change `main()` to dispatch before parsing server flags:

```ts
async function main(): Promise<void> {
  const { command, rest } = parseSubcommand(process.argv.slice(2));
  if (command === 'local') {
    process.exitCode = await runLocal(rest);
    return;
  }
  // (Task 6 adds: if (command === 'local-proxy') …)

  const opts = parseArgs(rest);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  // …existing server startup unchanged…
}
```

- [ ] **Step 6: Manual smoke test (skip if no Ollama)**

Run: `echo "say hi in one word" | npx tsx packages/server/src/cli.ts local lfm2.5-thinking`
Expected: Ollama responds in the terminal; a new file appears under `~/.age-of-agents/local-llm/sessions/`. Verify:
Run: `ls ~/.age-of-agents/local-llm/sessions/ && tail -1 ~/.age-of-agents/local-llm/sessions/*.jsonl`
Expected: at least one `{"type":"session",…}` line and message/usage lines.

- [ ] **Step 7: Run full build + tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/cli-args.ts packages/server/src/cli.ts packages/server/test/cli-args.test.ts
git commit -m "feat(cli): add 'aoa local <model>' wrapper for ollama run"
```

---

## Task 5: OpenAI `/v1` logging proxy (Adapter B core)

**Files:**
- Create: `packages/server/src/proxy/openai-logger.ts`
- Test: `packages/server/test/openai-logger.test.ts` (Create)

**Interfaces:**
- Consumes: `localLlmSessionsDir` from `../sources/local-llm.js`.
- Produces: `startOpenAiLoggerProxy(opts?: OpenAiLoggerOptions): Promise<RunningProxy>` with
  `OpenAiLoggerOptions = { port?: number; host?: string; baseUrl?: string; model?: string; apiKey?: string; sessionsDir?: string }`
  and the same `RunningProxy` shape as Task 3. Also exports pure `fingerprint(messages: any[]): string`
  and `accumulateSse(lines: string[]): { content: string; toolCalls: any[] }`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/openai-logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fingerprint, accumulateSse } from '../src/proxy/openai-logger.js';

describe('fingerprint', () => {
  it('is stable for the same anchor message and differs across conversations', () => {
    const a = [{ role: 'system', content: 'A' }, { role: 'user', content: 'x' }];
    const a2 = [{ role: 'system', content: 'A' }, { role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }];
    const b = [{ role: 'system', content: 'B' }];
    expect(fingerprint(a)).toBe(fingerprint(a2));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe('accumulateSse', () => {
  it('joins streamed content deltas and tool-call fragments', () => {
    const lines = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'sh', arguments: '{"a":' } } }] } }] }),
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] }),
      'data: [DONE]',
    ];
    const { content, toolCalls } = accumulateSse(lines);
    expect(content).toBe('Hello');
    expect(toolCalls[0].function.name).toBe('sh');
    expect(toolCalls[0].function.arguments).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- openai-logger`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the proxy (restored from PR #2, refactored for testable purity)**

Create `packages/server/src/proxy/openai-logger.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { localLlmSessionsDir } from '../sources/local-llm.js';

/**
 * OpenAI-compatible /v1/chat/completions logging proxy. A client (coding agent,
 * script) sets its base URL to this proxy; we forward to the real backend at
 * LLM_BASE_URL (llama.cpp / vLLM / oMLX / Ollama's /v1) and tee the conversation
 * delta into the same JSONL transcript the `local-llm` source reads.
 * Restored from closed PR #2 (local-llm-proxy.ts).
 */

export interface OpenAiLoggerOptions {
  port?: number;
  host?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  sessionsDir?: string;
}

export interface RunningProxy {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface SessionState {
  file: string;
  knownMessages: number;
}

/** Identify "the same" conversation across stateless requests: the system /
 *  first message is the stable anchor while history grows. */
export function fingerprint(messages: any[]): string {
  const anchor = messages.find((m) => m && m.role === 'system') ?? messages[0];
  return createHash('sha1').update(JSON.stringify(anchor ?? null)).digest('hex').slice(0, 32);
}

/** Pure accumulator for an SSE stream → final assistant content + tool calls. */
export function accumulateSse(lines: string[]): { content: string; toolCalls: any[] } {
  let content = '';
  const acc = new Map<number, any>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: any;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = evt?.choices?.[0]?.delta;
    if (typeof delta?.content === 'string') content += delta.content;
    for (const tc of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
      const i = tc.index ?? 0;
      const cur = acc.get(i) ?? { id: undefined, function: { name: '', arguments: '' } };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      acc.set(i, cur);
    }
  }
  return { content, toolCalls: [...acc.values()] };
}

export async function startOpenAiLoggerProxy(opts: OpenAiLoggerOptions = {}): Promise<RunningProxy> {
  const host = opts.host ?? '127.0.0.1';
  const baseUrl = (opts.baseUrl ?? process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.LLM_MODEL;
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY;
  const sessionsDir = opts.sessionsDir ?? localLlmSessionsDir();
  await mkdir(sessionsDir, { recursive: true });

  const sessions = new Map<string, SessionState>();
  const logLine = (state: SessionState, record: Record<string, unknown>): Promise<void> =>
    appendFile(state.file, `${JSON.stringify(record)}\n`, 'utf8');

  async function ensureSession(fp: string, requestedModel: string | undefined): Promise<SessionState> {
    const existing = sessions.get(fp);
    if (existing) return existing;
    const state: SessionState = { file: join(sessionsDir, `${randomUUID()}.jsonl`), knownMessages: 0 };
    sessions.set(fp, state);
    await logLine(state, { type: 'session', ts: new Date().toISOString(), cwd: process.cwd(), backend: 'openai', model: model ?? requestedModel });
    return state;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: any;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'invalid JSON body' } }));
      return;
    }

    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const state = await ensureSession(fingerprint(messages), body.model);
    const newMessages = messages.slice(state.knownMessages);
    state.knownMessages = messages.length;
    const reqTs = new Date().toISOString();
    for (const m of newMessages) {
      await logLine(state, { type: 'message', ts: reqTs, role: m?.role, content: typeof m?.content === 'string' ? m.content : undefined, tool_calls: m?.tool_calls });
    }

    const outgoing = { ...body, model: model ?? body.model };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(outgoing) });
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `cannot reach LLM_BASE_URL (${baseUrl}): ${(err as Error).message}` } }));
      return;
    }

    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    if (!upstream.body) {
      res.end();
      return;
    }

    if (outgoing.stream) {
      let buffered = '';
      const lines: string[] = [];
      const node = Readable.fromWeb(upstream.body as any);
      node.on('data', (chunk: Buffer) => {
        res.write(chunk);
        buffered += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffered.indexOf('\n')) >= 0) {
          lines.push(buffered.slice(0, idx));
          buffered = buffered.slice(idx + 1);
        }
      });
      node.on('end', () => {
        res.end();
        const { content, toolCalls } = accumulateSse(lines);
        void logLine(state, { type: 'message', ts: new Date().toISOString(), role: 'assistant', content: content || undefined, tool_calls: toolCalls.length ? toolCalls : undefined }).then(() => {
          state.knownMessages += 1;
        });
      });
      node.on('error', () => res.end());
      return;
    }

    const text = await upstream.text();
    res.end(text);
    try {
      const json = JSON.parse(text);
      const message = json?.choices?.[0]?.message;
      if (message) {
        await logLine(state, { type: 'message', ts: new Date().toISOString(), role: message.role ?? 'assistant', content: typeof message.content === 'string' ? message.content : undefined, tool_calls: message.tool_calls });
        state.knownMessages += 1;
      }
      const usage = json?.usage;
      if (usage) await logLine(state, { type: 'usage', input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
    } catch {
      // non-JSON upstream body (e.g. an error page) — nothing to log
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: (err as Error).message } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${port}/v1`,
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-citadel/server -- openai-logger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/proxy/openai-logger.ts packages/server/test/openai-logger.test.ts
git commit -m "feat(server): restore OpenAI /v1 logging proxy from PR #2"
```

---

## Task 6: `aoa local-proxy` subcommand (Adapter B wiring)

**Files:**
- Modify: `packages/server/src/cli.ts`

**Interfaces:**
- Consumes: `startOpenAiLoggerProxy` from `./proxy/openai-logger.js`.

- [ ] **Step 1: Add the import and runner to `cli.ts`**

Add import:

```ts
import { startOpenAiLoggerProxy } from './proxy/openai-logger.js';
```

Add runner above `main()`:

```ts
async function runLocalProxy(): Promise<number> {
  const proxy = await startOpenAiLoggerProxy();
  const backend = process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1';
  process.stdout.write(
    `\n  ▸ Local LLM proxy running: ${proxy.url}\n` +
      `    Forwarding to: ${backend}  (override with LLM_BASE_URL / LLM_MODEL / LLM_API_KEY)\n` +
      `    Point your OpenAI-compatible client's base URL here.\n    (Ctrl+C to stop)\n\n`,
  );
  return await new Promise<number>(() => {
    // Stays up until the user Ctrl+C's the process.
  });
}
```

- [ ] **Step 2: Add the dispatch branch in `main()`**

In `main()`, after the `command === 'local'` branch:

```ts
  if (command === 'local-proxy') {
    process.exitCode = await runLocalProxy();
    return;
  }
```

- [ ] **Step 3: Manual smoke test (skip if no backend)**

Run (terminal A): `npx tsx packages/server/src/cli.ts local-proxy`
Run (terminal B): `curl -s http://127.0.0.1:<printed-port>/v1/chat/completions -d '{"model":"lfm2.5-thinking","messages":[{"role":"user","content":"hi"}]}' -H 'content-type: application/json'` with `LLM_BASE_URL=http://localhost:11434/v1` exported when starting terminal A.
Expected: a completion comes back; a `sessions/<uuid>.jsonl` appears.

- [ ] **Step 4: Update HELP text in `cli.ts`**

In the `HELP` template literal, add under Usage:

```
  aoa local <model> [args]   Run `ollama run <model>` and log it as a hero
  aoa local-proxy            OpenAI /v1 logging proxy (llama.cpp/vLLM/oMLX)
```

- [ ] **Step 5: Run full build + tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/cli.ts
git commit -m "feat(cli): add 'aoa local-proxy' for OpenAI-compatible backends"
```

---

## Task 7: Starter sprite rules for local model families (optional polish)

**Files:**
- Modify: `packages/shared/src/index.ts` (`DEFAULT_MODEL_CONFIG.sprites`)
- Test: `packages/server/test/local-llm-sprites.test.ts` (Create)

**Interfaces:**
- Consumes: `resolveModel`, `DEFAULT_MODEL_CONFIG` from `@agent-citadel/shared`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/local-llm-sprites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveModel, DEFAULT_MODEL_CONFIG } from '@agent-citadel/shared';

describe('local model family sprites', () => {
  it('gives common local families a non-fallback identity', () => {
    expect(resolveModel('qwen3-embedding:latest', DEFAULT_MODEL_CONFIG).displayName).toBeDefined();
    expect(resolveModel('SpeakLeash/bielik-11b-v3.0-instruct:Q4_K_M', DEFAULT_MODEL_CONFIG).displayName).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @agent-citadel/server -- local-llm-sprites`
Expected: FAIL — these resolve to fallback (no `displayName`).

- [ ] **Step 3: Add starter rules**

In `packages/shared/src/index.ts`, append to `DEFAULT_MODEL_CONFIG.sprites` (before the closing `]`, after the `fable` rule). Reuse existing sprite ids (no new assets):

```ts
    // Local model families (Ollama/llama.cpp/vLLM/oMLX). Reuse existing sprites.
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'sonnet', displayName: 'Llama' },
    { match: { kind: 'pattern', pattern: 'qwen' }, sprite: 'haiku', displayName: 'Qwen' },
    { match: { kind: 'pattern', pattern: 'mistral' }, sprite: 'opus', displayName: 'Mistral' },
    { match: { kind: 'pattern', pattern: 'ministral' }, sprite: 'opus', displayName: 'Ministral' },
    { match: { kind: 'pattern', pattern: 'gemma' }, sprite: 'fable', displayName: 'Gemma' },
    { match: { kind: 'pattern', pattern: 'phi' }, sprite: 'haiku', displayName: 'Phi' },
    { match: { kind: 'pattern', pattern: 'bielik' }, sprite: 'sonnet', displayName: 'Bielik' },
    { match: { kind: 'pattern', pattern: 'gpt-oss' }, sprite: 'fable', displayName: 'GPT-OSS' },
    { match: { kind: 'pattern', pattern: 'glm' }, sprite: 'opus', displayName: 'GLM' },
    { match: { kind: 'pattern', pattern: 'lfm' }, sprite: 'haiku', displayName: 'LFM' },
```

Note: `gpt-oss` must sit **before** the existing `{ pattern: 'gpt-' }` rule, OR keep it after — since `gpt-` already matches `gpt-oss` and maps to the `fable` sprite + 'GPT' name. To get the 'GPT-OSS' name, place the `gpt-oss` rule **above** the `gpt-` rule in the array. Move it accordingly during implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @agent-citadel/server -- local-llm-sprites`
Expected: PASS.

- [ ] **Step 5: Run full build + tests**

Run: `npm run build && npm test`
Expected: PASS (existing `model-config` tests still green — `upgradeModelConfig` appends these to user configs).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/server/test/local-llm-sprites.test.ts
git commit -m "feat(shared): starter sprites for local model families"
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Local LLM" section to README**

Add after the existing source/usage docs:

````markdown
### Local LLMs (Ollama, llama.cpp, vLLM, oMLX)

Local engines don't write transcripts, so Age of Agents captures them through a
small logging proxy. Two ways in:

**Ollama (terminal):**

```bash
aoa local llama3        # wraps `ollama run llama3` and logs it as a hero
```

The session shows up on the battlefield; the model appears in the **Modele** tab,
where you can assign a sprite (context window is read automatically from Ollama).

**Any OpenAI-compatible backend (llama.cpp / vLLM / oMLX / coding agents):**

```bash
LLM_BASE_URL=http://localhost:8000/v1 aoa local-proxy   # prints a proxy URL
```

Point your client's base URL at the printed proxy URL. Default backend base URLs:

| Backend   | Default base URL                |
|-----------|---------------------------------|
| Ollama    | `http://localhost:11434/v1`     |
| llama.cpp | `http://localhost:8080/v1`      |
| vLLM      | `http://localhost:8000/v1`      |
| oMLX      | `http://localhost:10240/v1`     |

Overrides: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document aoa local / local-proxy for local LLMs"
```

---

## Self-Review

**1. Spec coverage:**
- Two adapters, one format, one source → Tasks 2 (source), 3 (Ollama proxy), 5 (OpenAI proxy). ✓
- `aoa local` wrapper (Adapter A) → Task 4. ✓
- `aoa local-proxy` (Adapter B) → Task 6. ✓
- AgentKind + provider/emblem wiring → Task 1. ✓
- Model registry integration: automatic via `{kind:'meta', model}` (Task 2) + `/api/show` context window (Tasks 2 + 3) + starter sprites (Task 7). ✓
- Transcript format (`session`/`message`/`usage`/`turn_complete`, `backend`, `contextWindow`) → Tasks 2, 3, 5. ✓
- Error handling (backend unreachable 502, ollama-not-on-PATH, malformed lines) → Tasks 3, 4, 5 (impl) + tests. ✓
- Testing (NDJSON, SSE, parseLine, smoke) → Tasks 2–6. ✓
- README + four backend URLs → Task 8. ✓
- Phasing: Phase 1 = Tasks 1–4; Phase 2 = Tasks 5–8. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step shows complete code. ✓

**3. Type consistency:** `RunningProxy` shape identical in Tasks 3 and 5. `startOllamaLoggerProxy` returns `url` WITHOUT `/v1` (Ollama host); `startOpenAiLoggerProxy` returns `url` WITH `/v1`. `runLocal` strips the scheme from `proxy.url` for `OLLAMA_HOST` — consistent. `parseSubcommand` returns `{ command, rest }` consumed identically in Tasks 4 and 6. `localLlmSessionsDir` imported by both proxies — consistent. ✓
