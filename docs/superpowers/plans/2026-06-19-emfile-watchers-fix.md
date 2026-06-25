# EMFILE Watchers Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `EMFILE: too many open files, watch` by starting only requested source watchers and narrowing Codex filesystem watching to recent date folders instead of the full historical session tree.

**Architecture:** Add a small source configuration layer that parses `AOA_SOURCES`, filters enabled sources, and lets the server start only the watchers/pollers that matter. Keep each `AgentSource` responsible for its own watch roots, but make Codex roots date-scoped and make missing optional roots return no watcher roots. `SourceWatcher` remains the generic tailing/state bridge and should no-op cleanly when a source has no roots.

**Tech Stack:** Node 22, TypeScript ESM, Fastify, chokidar, Vitest, npm workspaces.

---

## File Structure

- Modify: `packages/server/src/sources/types.ts`
  - Define the source id type used by config helpers.
- Create: `packages/server/src/sources/config.ts`
  - Parse `AOA_SOURCES`.
  - Parse Codex lookback config.
  - Provide date-root helpers.
  - Provide `rootIfExists`.
- Modify: `packages/server/src/sources/index.ts`
  - Export `ALL_SOURCES`.
  - Export `activeSources(raw?: string)`.
  - Keep `SOURCES` as a backwards-compatible alias for default active sources.
- Modify: `packages/server/src/sources/claude.ts`
  - Return the Claude root only when it exists.
- Modify: `packages/server/src/sources/koda.ts`
  - Return the Koda root only when it exists.
- Modify: `packages/server/src/sources/codex.ts`
  - Replace whole-tree `~/.codex/sessions` watching with recent date folder roots.
- Modify: `packages/server/src/watcher.ts`
  - No-op when an enabled source has no roots.
  - Keep the existing watcher `error` handler.
- Modify: `packages/server/src/server.ts`
  - Use `activeSources(process.env.AOA_SOURCES)`.
  - Start `OpenCodePoller` only when `opencode` is enabled.
- Test: `packages/server/test/sources-config.test.ts`
  - Config parsing, source filtering, date roots, env defaults.
- Test: `packages/server/test/codex.test.ts`
  - Codex source root helper behavior.
- Test: `packages/server/tests/server.test.ts`
  - Server can start with `AOA_SOURCES=codex` without requiring other roots.

---

### Task 1: Source Config Helpers

**Files:**
- Create: `packages/server/src/sources/config.ts`
- Modify: `packages/server/src/sources/types.ts`
- Test: `packages/server/test/sources-config.test.ts`

- [ ] **Step 1: Write the failing config tests**

Create `packages/server/test/sources-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  codexDateRoots,
  filterSources,
  parseCodexLookbackDays,
  parseSourceFilter,
  rootIfExists,
} from '../src/sources/config.js';
import type { AgentSource } from '../src/sources/types.js';

const source = (id: AgentSource['id']): AgentSource => ({
  id,
  roots: () => [],
  classify: () => ({ kind: 'other' }),
  parseLine: () => [],
});

describe('sources config', () => {
  it('parseSourceFilter returns undefined for empty input, meaning all sources', () => {
    expect(parseSourceFilter(undefined)).toBeUndefined();
    expect(parseSourceFilter('')).toBeUndefined();
    expect(parseSourceFilter('  ')).toBeUndefined();
  });

  it('parseSourceFilter accepts comma-separated known source ids', () => {
    expect(parseSourceFilter('codex, claude')).toEqual(new Set(['codex', 'claude']));
  });

  it('parseSourceFilter rejects unknown source ids', () => {
    expect(() => parseSourceFilter('codex,nope')).toThrow('Unknown AOA_SOURCES value: nope');
  });

  it('filterSources keeps only selected sources when a filter is provided', () => {
    const all = [source('claude'), source('codex'), source('opencode'), source('koda')];
    expect(filterSources(all, 'codex,koda').map((s) => s.id)).toEqual(['codex', 'koda']);
  });

  it('parseCodexLookbackDays defaults to 1 and rejects invalid values', () => {
    expect(parseCodexLookbackDays(undefined)).toBe(1);
    expect(parseCodexLookbackDays('3')).toBe(3);
    expect(() => parseCodexLookbackDays('0')).toThrow('Invalid AOA_CODEX_LOOKBACK_DAYS');
    expect(() => parseCodexLookbackDays('abc')).toThrow('Invalid AOA_CODEX_LOOKBACK_DAYS');
  });

  it('codexDateRoots returns yesterday, today, and tomorrow for default lookback', () => {
    const roots = codexDateRoots('/home/u/.codex/sessions', new Date('2026-06-19T12:00:00Z'), 1);
    expect(roots).toEqual([
      '/home/u/.codex/sessions/2026/06/18',
      '/home/u/.codex/sessions/2026/06/19',
      '/home/u/.codex/sessions/2026/06/20',
    ]);
  });

  it('rootIfExists returns [] for missing directories', () => {
    expect(rootIfExists('/definitely/missing/age-of-agents-test-root')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -w @agent-citadel/server -- sources-config.test.ts
```

Expected: FAIL because `../src/sources/config.js` does not exist.

- [ ] **Step 3: Add the source id type**

Modify `packages/server/src/sources/types.ts` to make the source id reusable:

```ts
export type SourceId = AgentKind;
```

Place it after `export type { AgentKind };`.

- [ ] **Step 4: Implement config helpers**

Create `packages/server/src/sources/config.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSource, SourceId } from './types.js';

const SOURCE_IDS = ['claude', 'codex', 'opencode', 'koda'] as const satisfies readonly SourceId[];
const SOURCE_ID_SET: ReadonlySet<string> = new Set(SOURCE_IDS);

export function parseSourceFilter(raw: string | undefined): Set<SourceId> | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  const out = new Set<SourceId>();
  for (const part of text.split(',')) {
    const id = part.trim();
    if (!SOURCE_ID_SET.has(id)) throw new Error(`Unknown AOA_SOURCES value: ${id}`);
    out.add(id as SourceId);
  }
  return out;
}

export function filterSources(sources: AgentSource[], raw = process.env.AOA_SOURCES): AgentSource[] {
  const filter = parseSourceFilter(raw);
  if (!filter) return sources;
  return sources.filter((source) => filter.has(source.id));
}

export function parseCodexLookbackDays(raw = process.env.AOA_CODEX_LOOKBACK_DAYS): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error(`Invalid AOA_CODEX_LOOKBACK_DAYS: ${raw}`);
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateRoot(base: string, date: Date): string {
  return join(
    base,
    String(date.getFullYear()),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  );
}

export function codexDateRoots(base: string, now = new Date(), lookbackDays = parseCodexLookbackDays()): string[] {
  const roots: string[] = [];
  for (let offset = -lookbackDays; offset <= 1; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    roots.push(localDateRoot(base, date));
  }
  return roots;
}

export function rootIfExists(path: string): string[] {
  try {
    return existsSync(path) && statSync(path).isDirectory() ? [path] : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run config tests**

Run:

```bash
npm run test -w @agent-citadel/server -- sources-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sources/types.ts packages/server/src/sources/config.ts packages/server/test/sources-config.test.ts
git commit -m "feat(server): add source watcher configuration helpers"
```

---

### Task 2: Narrow Optional Source Roots

**Files:**
- Modify: `packages/server/src/sources/claude.ts`
- Modify: `packages/server/src/sources/koda.ts`
- Modify: `packages/server/src/sources/codex.ts`
- Test: `packages/server/test/codex.test.ts`

- [ ] **Step 1: Add failing Codex root tests**

Append to `packages/server/test/codex.test.ts`:

```ts
import { codexSessionRoots } from '../src/sources/codex.js';

describe('codexSessionRoots', () => {
  it('scopes watching to recent date folders instead of the whole sessions tree', () => {
    const roots = codexSessionRoots('/Users/x/.codex/sessions', new Date('2026-06-19T12:00:00Z'), 1);
    expect(roots).toEqual([
      '/Users/x/.codex/sessions/2026/06/18',
      '/Users/x/.codex/sessions/2026/06/19',
      '/Users/x/.codex/sessions/2026/06/20',
    ]);
  });
});
```

- [ ] **Step 2: Run Codex tests to verify failure**

Run:

```bash
npm run test -w @agent-citadel/server -- codex.test.ts
```

Expected: FAIL because `codexSessionRoots` is not exported yet.

- [ ] **Step 3: Update Claude roots**

Modify `packages/server/src/sources/claude.ts`:

```ts
import { rootIfExists } from './config.js';
```

Replace:

```ts
roots: () => [join(homedir(), '.claude', 'projects')],
```

with:

```ts
roots: () => rootIfExists(join(homedir(), '.claude', 'projects')),
```

- [ ] **Step 4: Update Koda roots**

In `packages/server/src/sources/koda.ts`, import:

```ts
import { rootIfExists } from './config.js';
```

Replace its root declaration:

```ts
roots: () => [join(homedir(), '.koda', 'agent', 'sessions')],
```

with:

```ts
roots: () => rootIfExists(join(homedir(), '.koda', 'agent', 'sessions')),
```

- [ ] **Step 5: Update Codex roots**

Modify `packages/server/src/sources/codex.ts` to import:

```ts
import { codexDateRoots } from './config.js';
```

Add this helper above `codexSource`:

```ts
export function codexSessionRoots(
  base = join(homedir(), '.codex', 'sessions'),
  now = new Date(),
  lookbackDays?: number,
): string[] {
  return codexDateRoots(base, now, lookbackDays);
}
```

Replace:

```ts
roots: () => [join(homedir(), '.codex', 'sessions')],
```

with:

```ts
roots: () => codexSessionRoots(),
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run test -w @agent-citadel/server -- codex.test.ts sources-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sources/claude.ts packages/server/src/sources/koda.ts packages/server/src/sources/codex.ts packages/server/test/codex.test.ts
git commit -m "fix(server): narrow source watcher roots"
```

---

### Task 3: Filter Active Sources In Server Startup

**Files:**
- Modify: `packages/server/src/sources/index.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/sources-config.test.ts`
- Test: `packages/server/tests/server.test.ts`

- [ ] **Step 1: Extend source filtering tests**

Append to `packages/server/test/sources-config.test.ts`:

```ts
import { activeSources } from '../src/sources/index.js';

describe('activeSources', () => {
  it('uses AOA_SOURCES-style filtering over registered sources', () => {
    expect(activeSources('codex').map((s) => s.id)).toEqual(['codex']);
    expect(activeSources('claude,codex').map((s) => s.id)).toEqual(['claude', 'codex']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm run test -w @agent-citadel/server -- sources-config.test.ts
```

Expected: FAIL because `activeSources` is not exported.

- [ ] **Step 3: Implement active source registry**

Modify `packages/server/src/sources/index.ts`:

```ts
import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import { opencodeSource } from './opencode.js';
import { kodaSource } from './koda.js';
import { filterSources } from './config.js';
import type { AgentSource } from './types.js';

/** Wszystkie znane źródła agentów. */
export const ALL_SOURCES: AgentSource[] = [claudeSource, codexSource, opencodeSource, kodaSource];

export function activeSources(raw = process.env.AOA_SOURCES): AgentSource[] {
  return filterSources(ALL_SOURCES, raw);
}

/** Wszystkie aktywne źródła agentów dla domyślnego środowiska. */
export const SOURCES: AgentSource[] = activeSources();
```

- [ ] **Step 4: Use activeSources in server startup**

Modify `packages/server/src/server.ts`.

Replace:

```ts
const { SOURCES } = await import('./sources/index.js');
```

with:

```ts
const { activeSources } = await import('./sources/index.js');
```

Replace:

```ts
const watchers = SOURCES.map((source) => new SourceWatcher(world, source));
```

with:

```ts
const sources = activeSources(process.env.AOA_SOURCES);
const watchers = sources.map((source) => new SourceWatcher(world, source));
```

Replace:

```ts
const opencodePoller = new OpenCodePoller(world);
```

with:

```ts
const opencodeEnabled = sources.some((source) => source.id === 'opencode');
const opencodePoller = opencodeEnabled ? new OpenCodePoller(world) : undefined;
```

Replace:

```ts
await opencodePoller.start();
```

with:

```ts
await opencodePoller?.start();
```

- [ ] **Step 5: Add a server startup test with source filtering**

Append to `packages/server/tests/server.test.ts`:

```ts
it('starts in real mode with only Codex source enabled', async () => {
  const prev = process.env.AOA_SOURCES;
  process.env.AOA_SOURCES = 'codex';
  try {
    running = await startServer({ port: 0, demo: false });
    const res = await fetch(`${running.url}/health`);
    expect(await res.json()).toEqual({ ok: true, demo: false });
  } finally {
    if (prev === undefined) delete process.env.AOA_SOURCES;
    else process.env.AOA_SOURCES = prev;
  }
});
```

- [ ] **Step 6: Run focused server tests**

Run:

```bash
npm run test -w @agent-citadel/server -- sources-config.test.ts server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/sources/index.ts packages/server/src/server.ts packages/server/test/sources-config.test.ts packages/server/tests/server.test.ts
git commit -m "feat(server): allow filtering watched agent sources"
```

---

### Task 4: No-Op Cleanly For Sources With No Roots

**Files:**
- Modify: `packages/server/src/watcher.ts`
- Test: `packages/server/test/watcher.test.ts`

- [ ] **Step 1: Add failing watcher no-root test**

Append to `packages/server/test/watcher.test.ts`:

```ts
it('does not create a chokidar watcher when a source has no roots', async () => {
  const world = new World();
  const source: AgentSource = {
    id: 'koda',
    roots: () => [],
    classify: () => ({ kind: 'other' }),
    parseLine: () => [],
  };
  const watcher = new SourceWatcher(world, source, DEFAULT_THRESHOLDS);

  expect(() => watcher.start()).not.toThrow();
  await watcher.stop();
  expect(world.snapshot()).toEqual({ heroes: [], peons: [], missions: [] });
});
```

- [ ] **Step 2: Run watcher tests**

Run:

```bash
npm run test -w @agent-citadel/server -- watcher.test.ts
```

Expected before implementation: may fail or produce unwanted watcher behavior for empty roots.

- [ ] **Step 3: Implement no-root guard**

Modify `packages/server/src/watcher.ts`.

At the top of `start()` add:

```ts
if (this.roots.length === 0) {
  console.error('[watcher]', this.source.id, 'no roots configured; source disabled');
  return;
}
```

Keep the existing `this.watcher.on('error', ...)` line.

- [ ] **Step 4: Run watcher tests**

Run:

```bash
npm run test -w @agent-citadel/server -- watcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/watcher.ts packages/server/test/watcher.test.ts
git commit -m "fix(server): skip watchers with no source roots"
```

---

### Task 5: Documentation And Manual Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add runtime source-filter docs**

In `README.md`, under “From source”, add:

```md
For focused local testing you can limit which session sources are watched:

```bash
AOA_SOURCES=codex npm run dev
AOA_SOURCES=claude,codex npm run dev
AOA_CODEX_LOOKBACK_DAYS=3 npm run dev
```

`AOA_SOURCES` accepts `claude`, `codex`, `opencode`, and `koda`.
Codex watches recent date folders by default instead of the entire historical
`~/.codex/sessions` tree.
```

- [ ] **Step 2: Run full server verification**

Run:

```bash
npm run test -w @agent-citadel/server
npm run build -w @agent-citadel/server
```

Expected: all server tests pass and `tsc --noEmit` reports no errors.

- [ ] **Step 3: Run client smoke verification**

Run:

```bash
npm run test -w @agent-citadel/client
```

Expected: client tests pass.

- [ ] **Step 4: Manual dev-server verification with Codex only**

Stop any existing `npm run dev`, then run:

```bash
AOA_SOURCES=codex npm run dev
```

Expected server logs:

```text
Source watchers active: codex
Age of Agents server (dev): http://127.0.0.1:8123 (ws: /ws)
```

Expected not to appear during startup:

```text
[watcher] claude Error: EMFILE
[watcher] koda Error: EMFILE
[OpenCode] Could not start poller
```

- [ ] **Step 5: Manual browser verification**

Open or reload:

```text
http://localhost:5173/
```

Then run:

```bash
node -e "const { WebSocket } = require('ws'); const ws = new WebSocket('ws://127.0.0.1:8123/ws'); ws.on('message', m => { const e = JSON.parse(m); console.log(JSON.stringify({ heroes: e.heroes?.length, peons: e.peons?.length }, null, 2)); ws.close(); });"
```

Expected: WebSocket returns a snapshot object. `heroes` and `peons` may be `0` if no active/recent Codex sessions exist, but the command must connect without server errors.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document source watcher filters"
```

---

## Self-Review

**Spec coverage:** The plan addresses source over-starting with `AOA_SOURCES`, historical Codex tree watching with date-scoped roots, missing optional roots with `rootIfExists`, and empty root startup with a `SourceWatcher` no-op guard. It also preserves the existing `SourceWatcher` abstraction and the Codex subagent work already added.

**Placeholder scan:** No `TBD`, vague “add tests”, or unspecified file edits remain. Every code step names exact files and includes the concrete code to add or replace.

**Type consistency:** `SourceId` is defined once in `sources/types.ts`, `parseSourceFilter` returns `Set<SourceId> | undefined`, `filterSources` accepts `AgentSource[]`, and `activeSources` uses the same function signature in tests and server startup.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-emfile-watchers-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
