# Codex Context And Building Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Codex context bars after compaction and make state/social buildings show activity and stats through explicit state attribution.

**Architecture:** Codex transcript parsing should distinguish model capacity from current context usage: `model_context_window` remains capacity metadata, while `last_token_usage.input_tokens` becomes current context usage. Building attribution should gain a shared state-aware resolver so client panels and server historical stats use the same concept for work, awaiting, idle/home, and completed/resting states instead of relying only on tool mappings.

**Tech Stack:** TypeScript monorepo, Vitest, Fastify server, Vite React client, shared protocol/types in `@agent-citadel/shared`.

---

### Task 1: Codex Current Context After Compaction

**Files:**
- Modify: `packages/server/test/codex.test.ts`
- Modify: `packages/server/test/state-machine.test.ts`
- Modify: `packages/server/src/transcript/facts.ts`
- Modify: `packages/server/src/sources/codex.ts`
- Modify: `packages/server/src/state-machine.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests showing that a Codex `token_count` record uses `last_token_usage.input_tokens` as current context and `model_context_window` as capacity, and that `type: "compacted"` does not end the current task:

```ts
it('Codex token_count uses last input as current context and preserves window capacity', () => {
  expect(interpretCodexLine(line({
    type: 'event_msg',
    timestamp: '2026-06-20T10:57:13.383Z',
    payload: {
      type: 'token_count',
      info: {
        model_context_window: 258400,
        total_token_usage: { input_tokens: 9849971, output_tokens: 48090 },
        last_token_usage: { input_tokens: 20116, output_tokens: 145 },
      },
    },
  }))).toContainEqual({
    kind: 'usage-total',
    input: 9849971,
    output: 48090,
    context: 20116,
    contextWindow: 258400,
    last: { input: 20116, output: 145 },
  });
});

it('Codex compacted records do not end the current task', () => {
  expect(interpretCodexLine(line({
    type: 'compacted',
    timestamp: '2026-06-20T10:57:08.706Z',
    payload: { window_id: 1, window_number: 2 },
  }))).toEqual([]);
});
```

- [ ] **Step 2: Write failing state-machine test**

Add a test proving `usage-total.context` can drop after compact without changing cumulative totals incorrectly:

```ts
it('usage-total updates current Codex context from last turn input after compaction', () => {
  const world = new World();
  const tracker = new SessionTracker(world, 'sCodexCompact', '/tmp/project', undefined, 'codex');

  tracker.apply({ kind: 'usage-total', input: 9829855, output: 47945, context: 226384, contextWindow: 258400 });
  expect(world.getHero('sCodexCompact')?.contextTokens).toBe(226384);

  tracker.apply({ kind: 'usage-total', input: 9849971, output: 48090, context: 20116, contextWindow: 258400 });

  const hero = world.getHero('sCodexCompact');
  expect(hero?.tokens).toEqual({ input: 9849971, output: 48090 });
  expect(hero?.contextTokens).toBe(20116);
});
```

- [ ] **Step 3: Run tests red**

Run:

```bash
npm test -w @agent-citadel/server -- test/codex.test.ts test/state-machine.test.ts
```

Expected: FAIL because `usage-total` does not have `contextWindow` and parser still stores `model_context_window` as `context`.

- [ ] **Step 4: Extend the fact type**

Change the `usage-total` fact in `packages/server/src/transcript/facts.ts` to include an optional `contextWindow`:

```ts
| {
    kind: 'usage-total';
    input: number;
    output: number;
    context?: number;
    contextWindow?: number;
    cachedInput?: number;
    reasoningOutput?: number;
    last?: { input: number; output: number; cachedInput?: number; reasoningOutput?: number };
  }
```

- [ ] **Step 5: Fix Codex usage extraction**

In `extractCodexUsage`, set:

```ts
const context = last ? last.input : undefined;
const contextWindow = optionalToken(info?.model_context_window);
```

and return `contextWindow` separately from `context`. Leave `type: "compacted"` without a fact; the following `token_count.last_token_usage.input_tokens` carries the current context reset.

- [ ] **Step 6: Preserve state-machine behavior**

Keep `SessionTracker` using `fact.context` for `HeroSnapshot.contextTokens`; it should ignore `contextWindow` because the client resolves model capacity from model settings.

- [ ] **Step 7: Run tests green**

Run:

```bash
npm test -w @agent-citadel/server -- test/codex.test.ts test/state-machine.test.ts
```

Expected: PASS.

### Task 2: Shared State Building Resolver

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/client/src/game/home-building.ts`
- Create: `packages/client/tests/activity-building.test.ts`

- [ ] **Step 1: Write failing shared/client tests**

Create `packages/client/tests/activity-building.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING } from '@agent-citadel/shared';
import { activityBuildingForHero, activityBuildingForAction } from '../src/game/home-building';

describe('activity building attribution', () => {
  it('keeps working sessions on their mapped tool building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'working',
      currentTool: 'Read',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('library');
  });

  it('sends awaiting-input sessions to the theme waiting building', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'awaiting-input',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBe('shrine');
  });

  it('does not infer idle or sleeping physical location from project home', () => {
    expect(activityBuildingForHero('fantasy', {
      state: 'idle',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBeUndefined();
    expect(activityBuildingForHero('fantasy', {
      state: 'sleeping',
      projectName: 'age-of-agents',
      projectDir: '/repo/age-of-agents',
    }, DEFAULT_MAPPING)).toBeUndefined();
  });

  it('assigns completed action entries to theme resting buildings', () => {
    expect(activityBuildingForAction({ kind: 'completed', projectName: 'age-of-agents', projectDir: '/repo/age-of-agents' }, 'fantasy', DEFAULT_MAPPING)).toBe('garden');
    expect(activityBuildingForAction({ kind: 'completed', projectName: 'age-of-agents', projectDir: '/repo/age-of-agents' }, 'scifi', DEFAULT_MAPPING)).toBe('hydroponics');
  });
});
```

- [ ] **Step 2: Run test red**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts
```

Expected: FAIL because `activityBuildingForHero` and `activityBuildingForAction` do not exist.

- [ ] **Step 3: Implement state-aware helpers**

Export new helpers from `packages/client/src/game/home-building.ts`:

```ts
export function completedBuilding(themeId: string): BuildingId {
  return themeId === 'scifi' ? 'hydroponics' : 'garden';
}

export function activityBuildingForHero(
  themeId: string,
  hero: Pick<HeroSnapshot, 'state' | 'currentTool' | 'toolDetail' | 'projectName' | 'projectDir'>,
  mapping: MappingConfig,
): BuildingId {
  if (hero.state === 'working') return resolveBuilding(hero.currentTool, hero.toolDetail, mapping);
  if (hero.state === 'awaiting-input') return awaitingBuilding(themeId);
  return undefined;
}

export type ActivityAction =
  | { kind: 'tool'; tool: string; detail?: string }
  | { kind: 'completed'; projectName?: string; projectDir?: string };

export function activityBuildingForAction(action: ActivityAction, themeId: string, mapping: MappingConfig): BuildingId {
  if (action.kind === 'tool') return resolveBuilding(action.tool, action.detail, mapping);
  return completedBuilding(themeId);
}
```

Import `resolveBuilding` and `type MappingConfig` from `@agent-citadel/shared`.

- [ ] **Step 4: Run test green**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts
```

Expected: PASS.

### Task 3: Building Panel Uses State Attribution

**Files:**
- Modify: `packages/client/src/hud/BuildingPanel.tsx`
- Modify: `packages/client/tests/activity-building.test.ts`

- [ ] **Step 1: Add panel-oriented tests to helper coverage**

Extend `activity-building.test.ts` with a case showing idle/returning sessions are not counted as physical social-building presence without explicit location data:

```ts
it('does not count returning sessions as social-building presence', () => {
  expect(activityBuildingForHero('fantasy', {
    state: 'returning',
    projectName: 'age-of-agents',
    projectDir: '/repo/age-of-agents',
  }, DEFAULT_MAPPING)).toBeUndefined();
});
```

- [ ] **Step 2: Run test green**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts
```

Expected: PASS because Task 2 already implemented the helper.

- [ ] **Step 3: Update BuildingPanel**

In `packages/client/src/hud/BuildingPanel.tsx`:

```ts
import { activityBuildingForHero, activityBuildingForAction } from '../game/home-building';
```

Replace worker hero filtering with:

```ts
const workerHeroes = Object.values(heroes).filter(
  (h) => activityBuildingForHero(themeId, h, mapping) === buildingId,
);
```

Keep peons tool-based for now because peons do not have project/home fields.

Replace activity filtering with:

```ts
.filter(({ a }) => activityBuildingForAction({ kind: 'tool', tool: a.tool, detail: a.detail }, themeId, mapping) === buildingId)
```

- [ ] **Step 4: Run focused client tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts tests/resolve-building.test.ts
```

Expected: PASS.

### Task 4: Server Historical Stats Credit Codex Completed And State Buildings

**Files:**
- Modify: `packages/server/test/building-stats.test.ts`
- Modify: `packages/server/src/building-stats.ts`
- Modify: `packages/shared/src/index.ts` if shared action helpers are moved from client to shared during implementation

- [ ] **Step 1: Write failing stats tests**

Add tests proving Codex `compacted` does not double count output and that `task_complete` credits completed/resting activity to both theme resting buildings:

```ts
it('does not create Codex output deltas from compacted token_count repeats', async () => {
  invalidateBuildingStatsCache();
  const root = rootWithCodexRecords([
    {
      type: 'response_item',
      timestamp: new Date(NOW).toISOString(),
      payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) },
    },
    {
      type: 'event_msg',
      timestamp: new Date(NOW).toISOString(),
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } } },
    },
    { type: 'compacted', timestamp: new Date(NOW + 1000).toISOString(), payload: { window_id: 1 } },
    {
      type: 'event_msg',
      timestamp: new Date(NOW + 1000).toISOString(),
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } } },
    },
  ]);

  const res = await computeBuildingStats(root, NOW + 2000);
  expect(res.buildings.mine?.today).toBe(40);
});

it('credits Codex task completion to theme resting buildings', async () => {
  invalidateBuildingStatsCache();
  const root = rootWithCodexRecords([
    {
      type: 'response_item',
      timestamp: new Date(NOW).toISOString(),
      payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) },
    },
    {
      type: 'event_msg',
      timestamp: new Date(NOW).toISOString(),
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 40 } } },
    },
    {
      type: 'event_msg',
      timestamp: new Date(NOW + 1000).toISOString(),
      payload: { type: 'task_complete' },
    },
    {
      type: 'event_msg',
      timestamp: new Date(NOW + 1000).toISOString(),
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 90 } } },
    },
  ]);

  const res = await computeBuildingStats(root, NOW + 2000);
  expect(res.buildings.mine?.today).toBe(40);
  expect(res.buildings.garden?.today).toBe(50);
  expect(res.buildings.hydroponics?.today).toBe(50);
});
```

- [ ] **Step 2: Run test red**

Run:

```bash
npm test -w @agent-citadel/server -- test/building-stats.test.ts
```

Expected: FAIL for resting-building attribution because stats currently keep the previous tool building after `task_complete`.

- [ ] **Step 3: Implement completion attribution**

In `scanFile`, when a Codex record is `event_msg` with payload type `task_complete` or `turn_complete`, set current attribution to both theme resting buildings before future `token_count` deltas. Keep repeated compact `token_count` safe by retaining the existing `delta > 0` guard.

- [ ] **Step 4: Run stats test green**

Run:

```bash
npm test -w @agent-citadel/server -- test/building-stats.test.ts
```

Expected: PASS.

### Task 5: Settings Copy Clarifies Tool Assignment

**Files:**
- Modify: `packages/client/src/i18n.ts`
- Modify: `packages/client/src/hud/BuildingReactionsEditor.tsx`

- [ ] **Step 1: Update text to clarify scope**

Change the English hint to say tool reactions are for live-log tools and social buildings are state-driven:

```ts
buildingReactionsHint: 'Pick which live-log tools each working building reacts to. Social buildings use session state such as idle, awaiting input, or completed work.',
```

Keep existing non-English text unless updating all locales is straightforward in the same file.

- [ ] **Step 2: Ensure social-building note remains visible**

Keep the existing social-building note rendered after working-building cards.

- [ ] **Step 3: Run client tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts tests/i18n-base-language.test.ts
```

Expected: PASS.

### Task 6: Final Verification

**Files:**
- Inspect all touched TypeScript files with problems tooling when available.

- [ ] **Step 1: Focused server tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/codex.test.ts test/state-machine.test.ts test/building-stats.test.ts
```

Expected: PASS.

- [ ] **Step 2: Focused client tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts tests/resolve-building.test.ts tests/i18n-base-language.test.ts
```

Expected: PASS.

- [ ] **Step 3: Full suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

### Self-Review

- Spec coverage: Task 1 covers Codex compact/context reset. Tasks 2-4 cover state/social building attribution across helper logic, panel usage, and historical stats. Task 5 covers settings affordance/copy confusion. Task 6 covers required verification.
- Placeholder scan: no task uses TBD/TODO/fill-in language; code snippets and commands are concrete.
- Type consistency: `contextWindow` is optional on `usage-total`; `context` remains current usage. `activityBuildingForHero` uses `HeroSnapshot.state/currentTool/toolDetail/projectName/projectDir`; `activityBuildingForAction` distinguishes tool and completed records.
