# Codex Support Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex sessions first-class in the UI: correct model identity, correct building movement/reactions, sane token/context counters, visible conversation history, and building statistics that include Codex logs.

**Architecture:** Keep the game and UI on canonical agent facts. Fix Codex-specific drift at the parser and server-state boundaries, then let existing shared building/model resolution continue to work. Add snapshot-backed transcript buffers so the side panel is not only a live websocket stream.

**Tech Stack:** TypeScript, Vitest, Fastify/WebSocket server, Zustand client store, shared `@agent-citadel/shared` types, Codex JSONL rollout logs.

---

## File Structure

- Modify `packages/server/test/codex.test.ts`: lock current Codex JSONL shapes with failing parser tests.
- Modify `packages/server/src/sources/codex.ts`: normalize current Codex tool records, protect real model names from `model_provider: openai`, parse custom/tool-search calls, and include context usage.
- Modify `packages/server/src/transcript/facts.ts`: extend `usage-total` with optional context/cache/reasoning fields.
- Modify `packages/server/test/state-machine.test.ts`: assert Codex `usage-total` updates context and cumulative tokens correctly.
- Modify `packages/server/src/state-machine.ts`: store `usage-total.context` as `HeroSnapshot.contextTokens`.
- Modify `packages/client/tests/models.test.ts`: cover Codex/OpenAI default model presets.
- Modify `packages/shared/src/index.ts`: add Codex/OpenAI rules to `DEFAULT_MODEL_CONFIG`.
- Modify `packages/server/test/world.test.ts`: cover transcript history in `World.snapshot()`.
- Modify `packages/server/src/world.ts`: store bounded transcript lines and include them in snapshots.
- Modify `packages/shared/src/index.ts`: add `transcripts: TranscriptLine[]` to `WorldSnapshot`.
- Modify `packages/client/src/store.ts`: hydrate transcript buffers from snapshot.
- Modify `packages/server/test/building-stats.test.ts`: cover Codex historical stats attribution from Codex logs.
- Modify `packages/server/src/building-stats.ts`: scan Codex rollout records in addition to Claude assistant records.
- Optionally modify `docs/superpowers/specs/2026-06-14-codex-source-design.md`: update the stale Codex source notes after implementation, only if docs are kept in sync.

---

### Task 1: Lock Current Codex Parser Shapes

**Files:**
- Modify: `packages/server/test/codex.test.ts`

- [ ] **Step 1: Add failing tests for current Codex app records**

Add these tests inside `describe('interpretCodexLine', ...)`:

```ts
  it('turn_context concrete model is preserved and session_meta provider is not treated as a model', () => {
    expect(interpretCodexLine(line({
      type: 'turn_context',
      timestamp: '2026-06-20T11:59:55.986Z',
      payload: { cwd: '/Users/x/age-of-agents', model: 'gpt-5.5' },
    }))).toContainEqual({
      kind: 'meta',
      cwd: '/Users/x/age-of-agents',
      model: 'gpt-5.5',
    });

    expect(interpretCodexLine(line({
      type: 'session_meta',
      timestamp: '2026-06-20T11:59:56.225Z',
      payload: { cwd: '/Users/x/age-of-agents', model_provider: 'openai', thread_source: 'user' },
    }))).toContainEqual({
      kind: 'meta',
      cwd: '/Users/x/age-of-agents',
      model: undefined,
    });
  });

  it('current Codex function_call names normalize to canonical game tools', () => {
    const exec = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:10.084Z',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-exec',
        arguments: JSON.stringify({ cmd: 'npm test', workdir: '/repo' }),
      },
    }));
    expect(exec).toContainEqual({
      kind: 'tool-start',
      tool: 'Bash',
      detail: 'npm test',
      messageId: 'call-exec',
      ts: '2026-06-20T12:00:10.084Z',
    });

    const js = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:25.638Z',
      payload: {
        type: 'function_call',
        name: 'js',
        call_id: 'call-js',
        arguments: JSON.stringify({ code: 'await page.title()' }),
      },
    }));
    expect(js).toContainEqual({
      kind: 'tool-start',
      tool: 'mcp__node_repl__js',
      detail: 'await page.title()',
      messageId: 'call-js',
      ts: '2026-06-20T12:00:25.638Z',
    });

    const plan = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T11:56:20.263Z',
      payload: {
        type: 'function_call',
        name: 'update_plan',
        call_id: 'call-plan',
        arguments: JSON.stringify({ plan: [{ step: 'Inspect', status: 'in_progress' }] }),
      },
    }));
    expect(plan.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Workflow',
      detail: 'Inspect',
    });
  });

  it('current Codex custom/tool-search records become canonical tool-start facts', () => {
    const patch = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T11:55:00.000Z',
      payload: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'call-patch',
        input: '*** Begin Patch\n*** Update File: packages/server/src/sources/codex.ts\n@@\n-a\n+b\n*** End Patch',
      },
    }));
    expect(patch.find((f) => f.kind === 'tool-start')).toMatchObject({
      kind: 'tool-start',
      tool: 'Edit',
      detail: 'codex.ts',
    });

    const search = interpretCodexLine(line({
      type: 'response_item',
      timestamp: '2026-06-20T12:00:20.394Z',
      payload: { type: 'tool_search_call', call_id: 'call-search', query: 'browser control' },
    }));
    expect(search).toContainEqual({
      kind: 'tool-start',
      tool: 'ToolSearch',
      detail: 'browser control',
      messageId: 'call-search',
      ts: '2026-06-20T12:00:20.394Z',
    });
  });

  it('Codex token_count preserves cumulative totals and current context window', () => {
    expect(interpretCodexLine(line({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model_context_window: 258400,
          total_token_usage: {
            input_tokens: 37049245,
            cached_input_tokens: 35437952,
            output_tokens: 178333,
            reasoning_output_tokens: 24685,
            total_tokens: 37227578,
          },
          last_token_usage: {
            input_tokens: 180825,
            cached_input_tokens: 179072,
            output_tokens: 227,
            reasoning_output_tokens: 98,
            total_tokens: 181052,
          },
        },
      },
    }))).toContainEqual({
      kind: 'usage-total',
      input: 37049245,
      output: 178333,
      context: 258400,
      cachedInput: 35437952,
      reasoningOutput: 24685,
      last: { input: 180825, output: 227, cachedInput: 179072, reasoningOutput: 98 },
    });
  });
```

- [ ] **Step 2: Run the parser tests and verify they fail**

Run:

```bash
npm test -- packages/server/test/codex.test.ts
```

Expected: FAIL. The failure should show at least `exec_command` returning `exec_command`, `js` returning `js`, `session_meta` returning model `openai`, and `usage-total` missing context/cache/reasoning fields.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/server/test/codex.test.ts
git commit -m "test: capture current Codex rollout shapes"
```

---

### Task 2: Normalize Codex Parser Output

**Files:**
- Modify: `packages/server/src/transcript/facts.ts`
- Modify: `packages/server/src/sources/codex.ts`
- Test: `packages/server/test/codex.test.ts`

- [ ] **Step 1: Extend the normalized usage fact**

Change the `usage-total` variant in `packages/server/src/transcript/facts.ts` to:

```ts
  | {
      kind: 'usage-total';
      input: number;
      output: number;
      context?: number;
      cachedInput?: number;
      reasoningOutput?: number;
      last?: { input: number; output: number; cachedInput?: number; reasoningOutput?: number };
    }
```

- [ ] **Step 2: Replace Codex tool canonicalization with current-name coverage**

In `packages/server/src/sources/codex.ts`, replace `codexToolToCanonical` with:

```ts
export function codexToolToCanonical(name: string): string {
  switch (name) {
    case 'shell':
    case 'local_shell':
    case 'exec':
    case 'exec_command':
    case 'functions.exec_command':
      return 'Bash';
    case 'apply_patch':
    case 'functions.apply_patch':
      return 'Edit';
    case 'read_file':
    case 'view_image':
    case 'functions.view_image':
      return 'Read';
    case 'web_search':
    case 'web.run':
    case 'search_query':
    case 'image_query':
      return 'WebSearch';
    case 'tool_search_call':
    case 'tool_search_tool':
      return 'ToolSearch';
    case 'update_plan':
    case 'functions.update_plan':
    case 'multi_tool_use.parallel':
      return 'Workflow';
    case 'js':
      return 'mcp__node_repl__js';
    default:
      if (name.startsWith('mcp__')) return name;
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name;
  }
}
```

- [ ] **Step 3: Teach tool detail extraction current Codex argument keys**

In `packages/server/src/sources/codex.ts`, update `codexToolDetail` to this shape:

```ts
function codexToolDetail(name: string, argumentsRaw: unknown): string | undefined {
  let args: any;
  if (typeof argumentsRaw === 'string') {
    try {
      args = JSON.parse(argumentsRaw);
    } catch {
      return clip(argumentsRaw, 60);
    }
  } else if (argumentsRaw && typeof argumentsRaw === 'object') {
    args = argumentsRaw;
  } else {
    return undefined;
  }

  if (name === 'shell' || name === 'local_shell' || name === 'exec' || name === 'exec_command' || name === 'functions.exec_command') {
    const cmd =
      Array.isArray(args.command) ? args.command.join(' ')
        : str(args.command) ?? str(args.cmd);
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }

  if (name === 'web_search') return str(args.query);
  if (name === 'web.run') {
    const q = args.search_query?.[0]?.q ?? args.image_query?.[0]?.q;
    return str(q);
  }

  if (name === 'apply_patch' || name === 'functions.apply_patch') {
    const patch = str(args.input) ?? str(args.patch) ?? '';
    const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    return m ? m[1].split('/').pop() : undefined;
  }

  if (name === 'update_plan' || name === 'functions.update_plan') {
    const first = Array.isArray(args.plan) ? args.plan[0] : undefined;
    return str(first?.step);
  }

  if (name === 'js') return clip(str(args.code) ?? str(args.input) ?? '', 60) || undefined;
  if (name === 'tool_search_tool') return str(args.query);

  return str(args.path) ?? str(args.file_path) ?? str(args.query);
}
```

- [ ] **Step 4: Replace Codex usage extraction**

Replace `extractCodexUsage` with:

```ts
function extractCodexUsage(payload: any):
  | {
      input: number;
      output: number;
      context?: number;
      cachedInput?: number;
      reasoningOutput?: number;
      last?: { input: number; output: number; cachedInput?: number; reasoningOutput?: number };
    }
  | undefined {
  const info = payload?.info ?? payload;
  const total = info?.total_token_usage ?? payload?.total_token_usage ?? payload;
  if (!total || typeof total !== 'object') return undefined;

  const input = Number(total.input_tokens ?? total.input ?? 0);
  const output = Number(total.output_tokens ?? total.output ?? 0);
  if (!input && !output) return undefined;

  const lastRaw = info?.last_token_usage;
  const last = lastRaw && typeof lastRaw === 'object'
    ? {
        input: Number(lastRaw.input_tokens ?? lastRaw.input ?? 0),
        output: Number(lastRaw.output_tokens ?? lastRaw.output ?? 0),
        cachedInput: Number(lastRaw.cached_input_tokens ?? 0),
        reasoningOutput: Number(lastRaw.reasoning_output_tokens ?? 0),
      }
    : undefined;

  return {
    input,
    output,
    context: typeof info?.model_context_window === 'number' ? info.model_context_window : undefined,
    cachedInput: Number(total.cached_input_tokens ?? 0),
    reasoningOutput: Number(total.reasoning_output_tokens ?? 0),
    last,
  };
}
```

- [ ] **Step 5: Prevent generic provider records from becoming model names**

In the `session_meta` branch, replace the meta push with:

```ts
        const model = str(payload.model);
        facts.push({ kind: 'meta', cwd: str(payload.cwd), model });
```

This keeps `cwd` from `session_meta`, but does not overwrite `gpt-5.5` with `openai`.

- [ ] **Step 6: Update old session_meta test expectations**

In `packages/server/test/codex.test.ts`, change the old `session_meta` expectation from:

```ts
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: 'openai' });
```

to:

```ts
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: undefined });
```

In the Codex subagent `session_meta` test, change:

```ts
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: 'openai' });
```

to:

```ts
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: undefined });
```

- [ ] **Step 7: Parse custom tool and tool-search records**

In the `response_item` switch, add these cases next to `function_call`:

```ts
        case 'custom_tool_call': {
          const name = str(payload.name);
          if (name) {
            facts.push({
              kind: 'tool-start',
              tool: codexToolToCanonical(name),
              detail: codexToolDetail(name, payload.arguments ?? payload.input),
              messageId: str(payload.call_id) ?? `codex-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'custom_tool_call_output':
          facts.push({ kind: 'tool-result', isError: codexOutputIsError(payload.output), ts });
          break;
        case 'tool_search_call':
          facts.push({
            kind: 'tool-start',
            tool: 'ToolSearch',
            detail: str(payload.query),
            messageId: str(payload.call_id) ?? `codex-${ts}`,
            ts,
          });
          break;
        case 'tool_search_output':
          facts.push({ kind: 'tool-result', isError: false, ts });
          break;
```

- [ ] **Step 8: Run Codex parser tests**

Run:

```bash
npm test -- packages/server/test/codex.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit parser normalization**

```bash
git add packages/server/src/transcript/facts.ts packages/server/src/sources/codex.ts packages/server/test/codex.test.ts
git commit -m "fix: normalize current Codex rollout records"
```

---

### Task 3: Preserve Codex Context Window in Hero State

**Files:**
- Modify: `packages/server/test/state-machine.test.ts`
- Modify: `packages/server/src/state-machine.ts`

- [ ] **Step 1: Add a failing state-machine test**

Add this test to `packages/server/test/state-machine.test.ts`:

```ts
  it('usage-total updates cumulative tokens and latest Codex context window', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sCodexUsage', 'PD');

    tracker.apply({ kind: 'usage-total', input: 37049245, output: 178333, context: 258400 });
    expect(world.getHero('sCodexUsage')?.tokens).toEqual({ input: 37049245, output: 178333 });
    expect(world.getHero('sCodexUsage')?.contextTokens).toBe(258400);

    tracker.apply({ kind: 'usage-total', input: 37200000, output: 178900, context: 258400 });
    expect(world.getHero('sCodexUsage')?.tokens).toEqual({ input: 37200000, output: 178900 });
    expect(world.getHero('sCodexUsage')?.contextTokens).toBe(258400);
  });
```

- [ ] **Step 2: Run the state-machine test and verify it fails**

Run:

```bash
npm test -- packages/server/test/state-machine.test.ts
```

Expected: FAIL because `usage-total` does not patch `contextTokens`.

- [ ] **Step 3: Patch `usage-total` handling**

In `packages/server/src/state-machine.ts`, replace the `usage-total` case body with:

```ts
        this._tokens = { input: fact.input, output: fact.output };
        if (typeof fact.context === 'number') this.contextTokens = fact.context;
        this.patch({
          tokens: this._tokens,
          ...(typeof fact.context === 'number' ? { contextTokens: fact.context } : {}),
        });
        break;
```

- [ ] **Step 4: Run the state-machine test**

Run:

```bash
npm test -- packages/server/test/state-machine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit context handling**

```bash
git add packages/server/test/state-machine.test.ts packages/server/src/state-machine.ts
git commit -m "fix: expose Codex context window on heroes"
```

---

### Task 4: Add Codex/OpenAI Model Presets

**Files:**
- Modify: `packages/client/tests/models.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add failing default model tests**

Add these tests to `packages/client/tests/models.test.ts`:

```ts
  it('Codex/OpenAI model names resolve to non-Claude display names', () => {
    expect(resolveModel('gpt-5.5', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.5',
      contextWindow: 258_400,
    });
    expect(resolveModel('gpt-5.4-codex', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'fable',
      displayName: 'GPT-5.4 Codex',
      contextWindow: 258_400,
    });
    expect(resolveModel('gpt-5.4-mini', DEFAULT_MODEL_CONFIG)).toMatchObject({
      sprite: 'haiku',
      displayName: 'GPT-5.4 Mini',
      contextWindow: 258_400,
    });
  });
```

- [ ] **Step 2: Run model tests and verify they fail**

Run:

```bash
npm test -- packages/client/tests/models.test.ts
```

Expected: FAIL because current defaults return Sonnet fallback and 200k context for GPT model names.

- [ ] **Step 3: Add Codex/OpenAI model rules**

In `packages/shared/src/index.ts`, insert the Codex rules before the Claude rules in `DEFAULT_MODEL_CONFIG`:

```ts
    { match: { kind: 'exact', id: 'gpt-5.5' }, sprite: 'fable', displayName: 'GPT-5.5' },
    { match: { kind: 'pattern', pattern: 'gpt-5.4-codex' }, sprite: 'fable', displayName: 'GPT-5.4 Codex' },
    { match: { kind: 'pattern', pattern: 'gpt-5.4-mini' }, sprite: 'haiku', displayName: 'GPT-5.4 Mini' },
    { match: { kind: 'pattern', pattern: 'gpt-' }, sprite: 'fable', displayName: 'GPT' },
```

Insert these window rules before the Claude window rules:

```ts
    { match: { kind: 'exact', id: 'gpt-5.5' }, contextWindow: 258_400 },
    { match: { kind: 'pattern', pattern: 'gpt-5.4' }, contextWindow: 258_400 },
    { match: { kind: 'pattern', pattern: 'gpt-' }, contextWindow: 258_400 },
```

- [ ] **Step 4: Run model tests**

Run:

```bash
npm test -- packages/client/tests/models.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit model presets**

```bash
git add packages/client/tests/models.test.ts packages/shared/src/index.ts
git commit -m "fix: add Codex model presets"
```

---

### Task 5: Include Conversation Transcript Lines in Snapshots

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/test/world.test.ts`
- Modify: `packages/server/src/world.ts`
- Modify: `packages/client/src/store.ts`

- [ ] **Step 1: Extend the snapshot type**

In `packages/shared/src/index.ts`, change `WorldSnapshot` to:

```ts
export interface WorldSnapshot {
  heroes: HeroSnapshot[];
  peons: PeonSnapshot[];
  missions: MissionSnapshot[];
  transcripts: TranscriptLine[];
}
```

- [ ] **Step 2: Add failing world snapshot tests**

Add to `packages/server/test/world.test.ts`:

```ts
  it('stores recent transcript lines in snapshots', () => {
    const world = new World();
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 's1',
        role: 'user',
        text: 'Fix Codex support',
        ts: '2026-06-20T12:00:00.000Z',
      },
    });
    world.emitTranscriptLine({
      type: 'transcript-line',
      line: {
        sessionId: 's1',
        role: 'assistant',
        text: 'I will inspect the parser',
        ts: '2026-06-20T12:00:01.000Z',
      },
    });

    expect(world.snapshot().transcripts).toEqual([
      { sessionId: 's1', role: 'user', text: 'Fix Codex support', ts: '2026-06-20T12:00:00.000Z' },
      { sessionId: 's1', role: 'assistant', text: 'I will inspect the parser', ts: '2026-06-20T12:00:01.000Z' },
    ]);
  });
```

- [ ] **Step 3: Run world tests and verify they fail**

Run:

```bash
npm test -- packages/server/test/world.test.ts
```

Expected: FAIL because snapshots do not include transcript lines.

- [ ] **Step 4: Store a bounded transcript buffer in `World`**

In `packages/server/src/world.ts`, import `TranscriptLine`, add a buffer, include it in snapshots, and store lines when emitting:

```ts
import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PeonSnapshot,
  TranscriptLine,
  WorldSnapshot,
} from '@agent-citadel/shared';

const TRANSCRIPT_BUFFER = 200;
```

Add a private field:

```ts
  private transcripts: TranscriptLine[] = [];
```

Change `snapshot()` to:

```ts
  snapshot(): WorldSnapshot {
    return {
      heroes: [...this.heroes.values()],
      peons: [...this.peons.values()],
      missions: [...this.missions.values()],
      transcripts: this.transcripts,
    };
  }
```

Change `emitTranscriptLine` to:

```ts
  emitTranscriptLine(line: GameEvent & { type: 'transcript-line' }): void {
    this.transcripts = [...this.transcripts, line.line].slice(-TRANSCRIPT_BUFFER);
    this.emit(line);
  }
```

- [ ] **Step 5: Hydrate client transcripts from snapshots**

In `packages/client/src/store.ts`, change the `snapshot` case to:

```ts
        case 'snapshot':
          return {
            heroes: Object.fromEntries(event.heroes.map((h) => [h.sessionId, h])),
            peons: Object.fromEntries(event.peons.map((p) => [p.agentId, p])),
            missions: Object.fromEntries(event.missions.map((m) => [m.id, m])),
            transcripts: Object.fromEntries(
              (event.transcripts ?? []).reduce((acc, line) => {
                const lines = acc.get(line.sessionId) ?? [];
                lines.push(line);
                acc.set(line.sessionId, lines.slice(-TRANSCRIPT_BUFFER));
                return acc;
              }, new Map<string, TranscriptLine[]>()),
            ),
          };
```

- [ ] **Step 6: Update snapshot expectations in existing tests**

Find existing exact snapshot assertions:

```bash
rg -n "snapshot\\(\\)\\)\\.toEqual|snapshot\\(\\)" packages/server/test packages/client/tests
```

For any exact world snapshot that expects only `heroes`, `peons`, and `missions`, add `transcripts: []`.

- [ ] **Step 7: Run world and client store tests**

Run:

```bash
npm test -- packages/server/test/world.test.ts packages/server/test/watcher.test.ts packages/client/tests
```

Expected: PASS.

- [ ] **Step 8: Commit transcript snapshots**

```bash
git add packages/shared/src/index.ts packages/server/src/world.ts packages/server/test/world.test.ts packages/server/test/watcher.test.ts packages/client/src/store.ts
git commit -m "fix: include transcripts in world snapshots"
```

---

### Task 6: Add Codex Historical Building Stats

**Files:**
- Modify: `packages/server/test/building-stats.test.ts`
- Modify: `packages/server/src/building-stats.ts`

- [ ] **Step 1: Add failing tests for Codex stats scanning**

Add this helper and test to `packages/server/test/building-stats.test.ts`:

```ts
function rootWithCodexRecords(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'aoa-codex-stats-'));
  writeFileSync(join(dir, 'rollout-2026-06-20T12-00-00-019ee492-d59e-7813-8277-dc58a1bb2c1e.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

describe('computeBuildingStats - Codex rollout records', () => {
  it('attributes Codex token_count output deltas to the latest Codex tool building', async () => {
    invalidateBuildingStatsCache();
    const root = rootWithCodexRecords([
      {
        type: 'response_item',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test' }),
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } },
        },
      },
      {
        type: 'response_item',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch',
        },
      },
      {
        type: 'event_msg',
        timestamp: new Date(NOW + 1000).toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } },
        },
      },
    ]);

    const res = await computeBuildingStats(root, NOW + 2000);
    expect(res.buildings.mine?.today).toBe(40);
    expect(res.buildings.forge?.today).toBe(50);
  });
});
```

Also update the import:

```ts
import { accumulateMessage, computeBuildingStats, getBuildingStats, invalidateBuildingStatsCache } from '../src/building-stats.js';
```

- [ ] **Step 2: Run building stats tests and verify they fail**

Run:

```bash
npm test -- packages/server/test/building-stats.test.ts
```

Expected: FAIL because Codex records are ignored.

- [ ] **Step 3: Reuse Codex normalization in building stats**

In `packages/server/src/building-stats.ts`, import:

```ts
import { codexToolToCanonical } from './sources/codex.js';
```

Add this helper near `sampleFromRecord`:

```ts
function codexToolFromRecord(rec: any): { name: string; detail?: string } | undefined {
  if (rec?.type !== 'response_item') return undefined;
  const payload = rec.payload;
  if (!payload || typeof payload !== 'object') return undefined;

  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    const rawName = typeof payload.name === 'string' ? payload.name : undefined;
    if (!rawName) return undefined;
    let detail: string | undefined;
    const rawArgs = payload.arguments ?? payload.input;
    if (typeof rawArgs === 'string') {
      try {
        const args = JSON.parse(rawArgs);
        detail = typeof args.cmd === 'string'
          ? args.cmd
          : typeof args.command === 'string'
            ? args.command
            : undefined;
      } catch {
        const match = rawArgs.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
        detail = match ? match[1].split('/').pop() : undefined;
      }
    }
    return { name: codexToolToCanonical(rawName), detail };
  }

  if (payload.type === 'tool_search_call') return { name: 'ToolSearch', detail: typeof payload.query === 'string' ? payload.query : undefined };
  return undefined;
}

function codexOutputTotalFromRecord(rec: any): { ts: number; outputTotal: number } | undefined {
  if (rec?.type !== 'event_msg' || rec.payload?.type !== 'token_count') return undefined;
  const ts = Date.parse(rec.timestamp);
  if (!ts) return undefined;
  const total = rec.payload?.info?.total_token_usage ?? rec.payload?.total_token_usage;
  const outputTotal = Number(total?.output_tokens ?? total?.output ?? 0);
  if (!outputTotal) return undefined;
  return { ts, outputTotal };
}
```

- [ ] **Step 4: Track Codex output deltas during file scanning**

In `scanFile`, add Codex state before the loop:

```ts
  let codexOutputTotal = 0;
```

Inside the loop, before the Claude `sampleFromRecord` handling, add:

```ts
    const codexTool = codexToolFromRecord(rec);
    if (codexTool) {
      current = resolveBuilding(codexTool.name, codexTool.detail, config);
      continue;
    }

    const codexUsage = codexOutputTotalFromRecord(rec);
    if (codexUsage) {
      const delta = codexUsage.outputTotal - codexOutputTotal;
      codexOutputTotal = codexUsage.outputTotal;
      if (delta > 0) {
        accumulateMessage(acc, { ts: codexUsage.ts, output: delta, tools: [] }, now, dayStart, current, config);
      }
      continue;
    }
```

- [ ] **Step 5: Run building stats tests**

Run:

```bash
npm test -- packages/server/test/building-stats.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Codex building stats**

```bash
git add packages/server/test/building-stats.test.ts packages/server/src/building-stats.ts
git commit -m "fix: include Codex logs in building stats"
```

---

### Task 7: End-to-End Regression Pass

**Files:**
- Verify only unless failures require changes.

- [ ] **Step 1: Run targeted test suite**

Run:

```bash
npm test -- packages/server/test/codex.test.ts packages/server/test/state-machine.test.ts packages/server/test/world.test.ts packages/server/test/building-stats.test.ts packages/client/tests/models.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for server and client tests.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS. TypeScript should accept the new `WorldSnapshot.transcripts` field and extended `usage-total` fact.

- [ ] **Step 4: Start or reuse the dev server**

Run:

```bash
npm run dev
```

Expected: Vite/client and server are available at the existing local dev URLs. If the command stays attached, leave it running only while manually verifying, then stop it with `Ctrl-C`.

- [ ] **Step 5: Manual UI verification**

In the browser, verify these exact outcomes using a fresh Codex prompt:

```text
Model label: gpt-5.5 resolves to GPT-5.5, not Sonnet.
Settings -> Models: Codex/OpenAI model no longer says it falls back to default.
Settings -> Building reactions: exec_command no longer appears as an uncovered raw tool after new Codex activity.
Map movement: shell work sends the hero to Mine; apply_patch sends the hero to Forge; tool search sends the hero to Library.
Building panel: Working now increments for the active building while a Codex tool is running.
Building panel stats: after token_count records are scanned, Mine/Forge token counters are nonzero for Codex work.
Side panel conversation: reconnecting or refreshing keeps recent user and assistant transcript lines.
Resource/context UI: context bar uses the current Codex context window, not a Claude fallback.
```

- [ ] **Step 6: Fix any regression with a focused test first**

If a manual verification item fails, write one failing test in the nearest existing test file before changing code:

```bash
npm test -- packages/server/test/codex.test.ts packages/server/test/state-machine.test.ts packages/server/test/building-stats.test.ts packages/client/tests/models.test.ts
```

Expected: the new focused test fails before the fix and passes after the fix.

- [ ] **Step 7: Commit final verification adjustments**

If Step 6 changed code, commit the adjustment:

```bash
git add packages
git commit -m "fix: complete Codex UI regression coverage"
```

If Step 6 did not change code, do not create an empty commit.

---

### Task 8: Optional Spec Refresh

**Files:**
- Modify: `docs/superpowers/specs/2026-06-14-codex-source-design.md`

- [ ] **Step 1: Update stale Codex source notes**

Replace the old tool list section that says Codex tools are only `shell`, `apply_patch`, and `web_search` with:

```md
Current Codex rollout records observed on 2026-06-20 include:

- `turn_context` with concrete model names such as `gpt-5.5`.
- `session_meta` with provider names such as `openai`; provider names are not display model names.
- `response_item.function_call` names such as `exec_command`, `js`, and `update_plan`.
- `response_item.custom_tool_call` for `apply_patch`.
- `response_item.tool_search_call` for deferred tool discovery.
- `event_msg.token_count` with cumulative totals, last-turn usage, cached input, reasoning output, and `model_context_window`.

The server normalizes these records into shared facts before the state machine or UI sees them.
```

- [ ] **Step 2: Commit the spec update**

```bash
git add docs/superpowers/specs/2026-06-14-codex-source-design.md
git commit -m "docs: update Codex source design notes"
```

---

## Self-Review

- Spec coverage: model display, duplicated/missing conversation symptoms, token counter semantics, building movement, building counters, and Codex presets are all covered by tasks.
- Placeholder scan: no task relies on unspecified validation or unnamed tests; each implementation task has exact files, code shapes, commands, and expected outcomes.
- Type consistency: `usage-total.context` flows from `Fact` to `SessionTracker` to `HeroSnapshot.contextTokens`; `WorldSnapshot.transcripts` flows from shared type to server `World` to client store; Codex tools normalize to existing `resolveBuilding` canonical names.
