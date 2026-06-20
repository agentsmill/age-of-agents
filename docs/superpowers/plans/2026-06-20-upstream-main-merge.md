# Upstream Main Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `agentsmill/age-of-agents` upstream `main` into this fork's `main` while preserving the fork's Codex, watcher, transcript, model-registry, and building-stat fixes.

**Architecture:** Do the merge on an isolated branch or worktree, resolve conflicts by combining additive protocol fields and keeping this fork's newer Codex semantics. Adopt upstream's useful user-facing features: Docker container sessions, provider emblems, unit context bars, model sprite cards, city flip, mission-log alignment, arsenal snapshot hydration, and OpenCode schema-stop behavior. Treat `packages/shared/src/index.ts`, `packages/server/src/state-machine.ts`, `packages/server/src/sources/codex.ts`, `packages/server/src/watcher.ts`, `packages/server/src/world.ts`, and client snapshot/context UI files as semantic merge points, not simple conflict files.

**Tech Stack:** TypeScript, npm workspaces, Fastify, ws, Vite React, Pixi, Zustand, Vitest, Git.

---

## Merge Facts

- Fork `HEAD`: `f4f7ab7faa4aeaa05115d390fda17ce6a846cf65`
- Upstream fetched into `FETCH_HEAD`: `c7dad600b74c0e78f6cf0b2e7139ba21470627f5`
- Common base: `86118e97672de530b754a0ac8ab7b73a58649e31`
- Upstream repository: `https://github.com/agentsmill/age-of-agents.git`

Real content conflicts reported by `git merge-tree --write-tree HEAD FETCH_HEAD`:

```text
package-lock.json
package.json
packages/client/src/GameCanvas.tsx
packages/client/src/game/unit.ts
packages/client/src/game/view.ts
packages/client/src/hud/ModelRegistryEditor.tsx
packages/client/src/hud/SidePanel.tsx
packages/client/src/hud/ThemeSwitch.tsx
packages/client/src/hud/context-bar.ts
packages/client/src/settings.ts
packages/client/src/store.ts
packages/client/tests/context-bar.test.ts
packages/server/src/server.ts
packages/server/src/sources/codex.ts
packages/server/src/state-machine.ts
packages/server/src/transcript/facts.ts
packages/server/src/watcher.ts
packages/server/src/world.ts
packages/server/test/codex.test.ts
packages/server/test/parser.test.ts
packages/server/test/state-machine.test.ts
packages/server/test/watcher.test.ts
packages/shared/src/index.ts
```

## File Structure

Core protocol and shared helpers:

- `packages/shared/src/index.ts`: merge protocol fields and keep building/model helpers.
- `packages/shared/src/providers.ts`: adopt upstream provider metadata for emblems.

Server state and sources:

- `packages/server/src/transcript/facts.ts`: merge `usage-total.contextWindow`, `subagent-meta`, and upstream `cleared`.
- `packages/server/src/state-machine.ts`: merge context-window capacity, Docker `extra`, clear lightning flag, awaiting-input completion behavior, and fork context reset.
- `packages/server/src/sources/codex.ts`: keep fork's current Codex parser coverage and context semantics; optionally add upstream-compatible `contextWindowTokens` propagation through `contextWindow`.
- `packages/server/src/watcher.ts`: combine fork EMFILE/polling/subagent routing with upstream clear-routing behavior.
- `packages/server/src/world.ts`: combine fork transcript snapshot buffer with upstream arsenal snapshot state.
- `packages/server/src/server.ts`: combine source filtering, optional OpenCode start, arsenal poller lifecycle, and upstream Docker poller.
- `packages/server/src/sources/docker-client.ts`, `packages/server/src/sources/docker-poller.ts`, `packages/server/src/sources/docker-tail.ts`: adopt upstream Docker source.
- `packages/server/src/sources/opencode-poller.ts`: adopt upstream schema-mismatch stop while keeping fork retention and token behavior.

Client state and UI:

- `packages/client/src/store.ts`: snapshot must hydrate `heroes`, `peons`, `missions`, `transcripts`, and `arsenal`.
- `packages/client/src/context-progress.ts`: adopt upstream context percentage/color source.
- `packages/client/src/hud/context-bar.ts`: re-export from `context-progress.ts` or keep equivalent API.
- `packages/client/src/game/unit.ts`: adopt unit context bar and provider emblem rendering without breaking current unit behavior.
- `packages/client/src/game/view.ts`: adopt unit context progress, flip support, provider emblem loading, and clear lightning while preserving fork building-home/state behavior.
- `packages/client/src/hud/SidePanel.tsx`: combine transcript panel, provider emblem, container badge, and capacity source.
- `packages/client/src/hud/ModelRegistryEditor.tsx`, `packages/client/src/hud/model-sprite-edit.ts`, `packages/client/src/hud/seen-models.ts`: adopt sprite-card UI while preserving fork saved preset upgrade behavior.
- `packages/client/src/settings.ts`, `packages/client/src/GameCanvas.tsx`, `packages/client/src/hud/ThemeSwitch.tsx`, `packages/client/src/hud/Minimap.tsx`: adopt horizontal flip setting and keep existing settings compatibility.

Tests:

- Keep all fork tests.
- Adopt upstream tests for Docker, provider emblems, model sprite cards, settings flip, context progress, and arsenal snapshots.
- Add merge-specific tests listed below where upstream and fork semantics overlap.

Docs/package:

- `package.json` and `package-lock.json`: adopt upstream version/dependency changes after resolving conflicts with `npm install --package-lock-only`.
- `README.md`, `docs/index.html`: merge upstream docs while preserving fork docs additions.

---

### Task 1: Create Merge Workspace

**Files:**
- No source edits.

- [ ] **Step 1: Confirm clean main**

Run:

```bash
git status --short --branch
```

Expected:

```text
## main...origin/main
```

- [ ] **Step 2: Create an isolated merge branch**

Run:

```bash
git switch -c codex/upstream-main-merge
```

Expected:

```text
Switched to a new branch 'codex/upstream-main-merge'
```

- [ ] **Step 3: Add upstream remote if missing**

Run:

```bash
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/agentsmill/age-of-agents.git
git fetch upstream main
```

Expected:

```text
From https://github.com/agentsmill/age-of-agents
 * branch            main       -> FETCH_HEAD
```

- [ ] **Step 4: Start the merge**

Run:

```bash
git merge --no-ff FETCH_HEAD
```

Expected: Git reports conflicts in the files listed in "Merge Facts".

- [ ] **Step 5: Record conflict list**

Run:

```bash
git diff --name-only --diff-filter=U
```

Expected: output includes `packages/shared/src/index.ts`, `packages/server/src/sources/codex.ts`, `packages/server/src/state-machine.ts`, `packages/server/src/watcher.ts`, `packages/server/src/world.ts`, and the client conflict files listed in "Merge Facts".

---

### Task 2: Merge Shared Protocol

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/providers.ts`
- Test: `packages/client/tests/resolve-provider.test.ts`
- Test: `packages/client/tests/activity-building.test.ts`

- [ ] **Step 1: Resolve `HeroSnapshot` and `WorldSnapshot` fields**

In `packages/shared/src/index.ts`, the merged `HeroSnapshot` must contain all of these fields:

```ts
export interface HeroSnapshot {
  sessionId: string;
  agent?: AgentKind;
  title: string;
  projectDir: string;
  workingDir?: string;
  projectName?: string;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  teamColor: number;
  state: HeroStateKind;
  currentTool?: string;
  toolDetail?: string;
  tokens: { input: number; output: number };
  recentActions?: ActionEntry[];
  contextTokens?: number;
  contextWindowTokens?: number;
  wielded?: WieldedArsenal;
  container?: { id: string; name: string; image: string };
  startedAt: string;
  lastActivityAt: string;
  clearedAt?: number;
}
```

In the same file, the merged `WorldSnapshot` must contain both fork and upstream snapshot collections:

```ts
export interface WorldSnapshot {
  heroes: HeroSnapshot[];
  peons: PeonSnapshot[];
  missions: MissionSnapshot[];
  transcripts: TranscriptLine[];
  arsenals: ProjectArsenal[];
}
```

- [ ] **Step 2: Keep fork activity-building helpers**

In `packages/shared/src/index.ts`, keep these exports exactly available:

```ts
export function homeBuildingForTheme(
  themeId: string,
  hero: Pick<HeroSnapshot, 'projectName' | 'projectDir'>,
): BuildingId;

export function awaitingBuildingForTheme(themeId: string): BuildingId;

export function completedBuildingForTheme(themeId: string): BuildingId;

export function activityBuildingForHero(
  themeId: string,
  hero: Pick<HeroSnapshot, 'state' | 'currentTool' | 'toolDetail' | 'projectName' | 'projectDir'>,
  config: MappingConfig,
): BuildingId | undefined;

export type ActivityAction =
  | { kind: 'tool'; tool: string; detail?: string }
  | { kind: 'completed'; projectName?: string; projectDir?: string };

export function activityBuildingForAction(
  action: ActivityAction,
  themeId: string,
  config: MappingConfig,
): BuildingId;
```

Expected behavior:

```text
working -> resolveBuilding(...)
awaiting-input -> awaitingBuildingForTheme(themeId)
idle/sleeping/returning/thinking/error -> undefined
completed action -> completedBuildingForTheme(themeId)
```

- [ ] **Step 3: Adopt provider exports**

Keep upstream `packages/shared/src/providers.ts` and export it from `packages/shared/src/index.ts`:

```ts
export * from './providers.js';
```

- [ ] **Step 4: Run shared/client helper tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts tests/resolve-provider.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit shared protocol merge**

Run:

```bash
git add packages/shared/src/index.ts packages/shared/src/providers.ts packages/client/tests/activity-building.test.ts packages/client/tests/resolve-provider.test.ts
git commit -m "merge: combine upstream protocol with fork building helpers"
```

Expected: commit succeeds.

---

### Task 3: Merge Facts and State Machine

**Files:**
- Modify: `packages/server/src/transcript/facts.ts`
- Modify: `packages/server/src/state-machine.ts`
- Test: `packages/server/test/state-machine.test.ts`
- Test: `packages/server/test/docker-poller.test.ts`

- [ ] **Step 1: Resolve fact union**

In `packages/server/src/transcript/facts.ts`, make sure the fact union includes:

```ts
| { kind: 'usage'; messageId: string; input: number; output: number; context?: number; contextWindow?: number }
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
| { kind: 'subagent-meta'; agentId: string; parentSessionId: string; description?: string }
| { kind: 'cleared'; ts: string }
```

Keep every existing fork fact kind not shown above.

- [ ] **Step 2: Resolve `SessionTracker` constructor**

In `packages/server/src/state-machine.ts`, constructor parameters must include upstream's `extra` object while preserving the existing defaults:

```ts
constructor(
  private readonly world: World,
  private readonly sessionId: string,
  private readonly projectDir: string,
  private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
  private readonly agent: AgentKind = 'claude',
  private readonly extra: Partial<HeroSnapshot> = {},
) {}
```

In `hero()`, include:

```ts
contextTokens: this.contextTokens,
contextWindowTokens: this.contextWindowTokens,
wielded: this.wielded(),
startedAt: now,
lastActivityAt: now,
...this.extra,
```

- [ ] **Step 3: Resolve usage behavior**

In `packages/server/src/state-machine.ts`, both `usage` and `usage-total` must update `contextTokens` from `fact.context` and `contextWindowTokens` from `fact.contextWindow`.

For `usage-total`, keep fork semantics:

```ts
this._tokens = { input: fact.input, output: fact.output };
if (typeof fact.context === 'number') this.contextTokens = fact.context;
if (typeof fact.contextWindow === 'number') this.contextWindowTokens = fact.contextWindow;
this.patch({
  tokens: this._tokens,
  ...(typeof fact.context === 'number' ? { contextTokens: fact.context } : {}),
  ...(typeof fact.contextWindow === 'number' ? { contextWindowTokens: fact.contextWindow } : {}),
});
```

- [ ] **Step 4: Preserve upstream awaiting and clear behavior**

In `tool-result`, keep upstream's non-error `awaiting-input` transition:

```ts
} else if (this.world.getHero(this.sessionId)?.state === 'awaiting-input') {
  this.patch({ state: 'thinking', currentTool: undefined, toolDetail: undefined }, fact.ts);
}
```

Add the upstream clear fact branch:

```ts
case 'cleared':
  this.patch({ clearedAt: Date.now() });
  break;
```

Keep fork's `subagent-meta` branch as a no-op:

```ts
case 'subagent-meta':
  break;
```

- [ ] **Step 5: Run focused state tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/state-machine.test.ts test/docker-poller.test.ts
```

Expected: all tests pass. The `usage-total` tests must assert context reset behavior, and Docker tests must assert `container` survives patches.

- [ ] **Step 6: Commit state merge**

Run:

```bash
git add packages/server/src/transcript/facts.ts packages/server/src/state-machine.ts packages/server/test/state-machine.test.ts packages/server/test/docker-poller.test.ts
git commit -m "merge: combine state protocol for context and containers"
```

Expected: commit succeeds.

---

### Task 4: Merge Codex Parser

**Files:**
- Modify: `packages/server/src/sources/codex.ts`
- Test: `packages/server/test/codex.test.ts`

- [ ] **Step 1: Keep fork canonical tool mapping**

In `packages/server/src/sources/codex.ts`, keep support for these Codex tool names:

```ts
exec_command -> Bash
functions.exec_command -> Bash
functions.write_stdin -> Bash
functions.apply_patch -> Edit
image_gen.imagegen -> Edit
functions.view_image -> Read
web.run -> WebSearch
tool_search_tool -> ToolSearch
tool_search.tool_search_tool -> ToolSearch
functions.request_user_input -> AskUserQuestion
functions.update_plan -> Workflow
functions.update_goal -> Workflow
functions.create_goal -> Workflow
functions.get_goal -> Workflow
multi_tool_use.parallel -> Workflow
js -> mcp__node_repl__js
```

- [ ] **Step 2: Keep fork context semantics**

In `extractCodexUsage`, current context must be `last_token_usage.input_tokens` when positive, and capacity must be `model_context_window`.

Use this exact semantic shape:

```ts
const context = last && last.input > 0 ? last.input : undefined;
const contextWindow = optionalToken(info?.model_context_window);
```

Do not use upstream's `last.total_tokens` or `last.input + last.output + last.reasoning_output_tokens` for `context`, because this fork already verified Codex compaction behavior against live logs.

- [ ] **Step 3: Keep fork compact behavior**

Confirm `interpretCodexLine` returns no facts for `record.type === 'compacted'`.

Expected test assertion:

```ts
expect(interpretCodexLine(line({
  type: 'compacted',
  timestamp: '2026-06-20T10:57:08.706Z',
  payload: { window_id: 1, window_number: 2 },
}))).toEqual([]);
```

- [ ] **Step 4: Keep fork Codex root narrowing**

Keep `codexSessionRoots(...)`, `CODEX_RUNTIME_LOOKAHEAD_DAYS`, and `parseCodexLookbackDays()` import. The source root must stay date-scoped:

```ts
roots: () => codexSessionRoots(join(homedir(), '.codex', 'sessions'), new Date(), undefined, CODEX_RUNTIME_LOOKAHEAD_DAYS),
```

- [ ] **Step 5: Run focused Codex tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/codex.test.ts test/sources-config.test.ts
```

Expected: all tests pass, including current context usage, compact ignored, and date-scoped roots.

- [ ] **Step 6: Commit Codex merge**

Run:

```bash
git add packages/server/src/sources/codex.ts packages/server/test/codex.test.ts packages/server/test/sources-config.test.ts
git commit -m "merge: preserve fork Codex parser semantics"
```

Expected: commit succeeds.

---

### Task 5: Merge Watchers and Server Sources

**Files:**
- Modify: `packages/server/src/watcher.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/sources/index.ts`
- Modify: `packages/server/src/sources/types.ts`
- Create: `packages/server/src/sources/docker-client.ts`
- Create: `packages/server/src/sources/docker-poller.ts`
- Create: `packages/server/src/sources/docker-tail.ts`
- Modify: `packages/server/src/sources/opencode-poller.ts`
- Test: `packages/server/test/watcher.test.ts`
- Test: `packages/server/test/docker-client.test.ts`
- Test: `packages/server/test/docker-tail.test.ts`
- Test: `packages/server/test/docker-poller.test.ts`
- Test: `packages/server/tests/server.test.ts`

- [ ] **Step 1: Resolve `SourceWatcher.applyExternalFacts`**

In `packages/server/src/watcher.ts`, use upstream's optional `cwd` parameter while preserving fork logic:

```ts
applyExternalFacts(
  sessionId: string,
  projectDir: string,
  facts: import('./transcript/facts.js').Fact[],
  cwd?: string,
): void {
  let tracker = this.trackers.get(sessionId);
  const isNewTracker = !tracker;
  if (!tracker) {
    tracker = new SessionTracker(this.world, sessionId, projectDir, this.thresholds, this.source.id);
    this.trackers.set(sessionId, tracker);
  }
  for (const fact of facts) {
    if (fact.kind === 'cleared' && isNewTracker && cwd) {
      (this.mostRecentTrackerByCwd(cwd, sessionId) ?? tracker).apply(fact);
      continue;
    }
    tracker.apply(fact);
  }
}
```

Also keep `mostRecentTrackerByCwd(...)` from upstream.

- [ ] **Step 2: Preserve fork EMFILE protections**

In `packages/server/src/watcher.ts`, keep all of these fork behaviors:

```ts
usePolling: true,
interval: 1_000,
ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.jsonl'),
```

Keep `refreshRoots()` and call it from both `start()` and `sweep()`.

Keep large-file metadata scanning:

```ts
if ((stats?.size ?? 0) > REPLAY_MAX_BYTES) {
  if (target.kind === 'session') await this.scanSessionMetadata(path);
  await this.tails.registerAtEnd(path);
}
```

- [ ] **Step 3: Adopt Docker source files**

Keep upstream files:

```text
packages/server/src/sources/docker-client.ts
packages/server/src/sources/docker-poller.ts
packages/server/src/sources/docker-tail.ts
```

When adopting `DockerPoller`, keep its test-proven behavior:

```text
AGENTCRAFT_DOCKER=0 disables Docker polling.
docker unavailable does not crash server startup.
large container files tail from end.
container sessions are deduped against host Claude sessions.
```

- [ ] **Step 4: Make Docker respect source filtering**

In `packages/server/src/server.ts`, start Docker only when source filtering allows `claude` or a dedicated `docker` source has been introduced. Because current `SourceId` does not include `docker`, use `claude` as the controlling source for now:

```ts
const dockerEnabled = sources.some((source) => source.id === 'claude');
const dockerPoller = dockerEnabled ? new DockerPoller(world, new CliDockerClient()) : undefined;
```

Start and stop it like OpenCode:

```ts
void dockerPoller?.start();
```

and in `close`:

```ts
dockerPoller?.stop();
```

- [ ] **Step 5: Preserve fork OpenCode optional startup**

In `packages/server/src/server.ts`, keep fork behavior:

```ts
const opencodeEnabled = sources.some((source) => source.id === 'opencode');
opencodePoller = opencodeEnabled ? new OpenCodePoller(world) : undefined;
```

Do not instantiate `new OpenCodePoller(world)` unconditionally.

- [ ] **Step 6: Adopt upstream OpenCode schema-stop**

In `packages/server/src/sources/opencode-poller.ts`, keep fork's retention and token logic, and add upstream `isSchemaMismatchError` behavior:

```ts
if (isSchemaMismatchError(err)) {
  console.warn('[OpenCode] Poll error, stopping poller:', err instanceof Error ? err.message : String(err));
  await this.stop();
  return;
}
console.error('[OpenCode] Poll error:', err);
```

- [ ] **Step 7: Run focused source tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/watcher.test.ts test/docker-client.test.ts test/docker-tail.test.ts test/docker-poller.test.ts tests/server.test.ts
```

Expected: all tests pass. `watcher.test.ts` must still assert polling and no watcher for empty roots.

- [ ] **Step 8: Commit watcher/source merge**

Run:

```bash
git add packages/server/src/watcher.ts packages/server/src/server.ts packages/server/src/sources/index.ts packages/server/src/sources/types.ts packages/server/src/sources/docker-client.ts packages/server/src/sources/docker-poller.ts packages/server/src/sources/docker-tail.ts packages/server/src/sources/opencode-poller.ts packages/server/test/watcher.test.ts packages/server/test/docker-client.test.ts packages/server/test/docker-tail.test.ts packages/server/test/docker-poller.test.ts packages/server/tests/server.test.ts
git commit -m "merge: add Docker source without regressing watcher filters"
```

Expected: commit succeeds.

---

### Task 6: Merge World Snapshot State

**Files:**
- Modify: `packages/server/src/world.ts`
- Modify: `packages/server/src/arsenal/arsenal-poller.ts`
- Modify: `packages/client/src/store.ts`
- Test: `packages/server/test/world.test.ts`
- Test: `packages/server/test/arsenal-poller.test.ts`
- Test: `packages/client/tests/store.test.ts`

- [ ] **Step 1: Merge server world state**

In `packages/server/src/world.ts`, keep both maps:

```ts
private transcripts = new Map<string, TranscriptLine[]>();
private arsenals = new Map<string, ProjectArsenal>();
```

In `snapshot()`, return both:

```ts
return {
  heroes: [...this.heroes.values()],
  peons: [...this.peons.values()],
  missions: [...this.missions.values()],
  transcripts: [...this.transcripts.values()].flatMap((lines) => lines),
  arsenals: [...this.arsenals.values()],
};
```

Add upstream `setArsenal` while keeping fork `emitTranscriptLine` buffering:

```ts
setArsenal(arsenal: ProjectArsenal): void {
  this.arsenals.set(arsenal.projectDir, arsenal);
  this.emit({ type: 'arsenal-updated', arsenal });
}

emitTranscriptLine(line: GameEvent & { type: 'transcript-line' }): void {
  const lines = this.transcripts.get(line.line.sessionId) ?? [];
  this.transcripts.set(line.line.sessionId, [...lines, line.line].slice(-TRANSCRIPT_BUFFER));
  this.emit(line);
}
```

- [ ] **Step 2: Merge arsenal poller emission**

In `packages/server/src/arsenal/arsenal-poller.ts`, replace ephemeral custom emit with persistent world state:

```ts
this.world.setArsenal(arsenal);
```

- [ ] **Step 3: Merge client snapshot hydration**

In `packages/client/src/store.ts`, snapshot handling must update both `transcripts` and `arsenal`:

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
    arsenal: Object.fromEntries((event.arsenals ?? []).map((a) => [a.projectDir, a])),
  };
```

- [ ] **Step 4: Run focused snapshot tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/world.test.ts test/arsenal-poller.test.ts
npm test -w @agent-citadel/client -- tests/store.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit snapshot merge**

Run:

```bash
git add packages/server/src/world.ts packages/server/src/arsenal/arsenal-poller.ts packages/client/src/store.ts packages/server/test/world.test.ts packages/server/test/arsenal-poller.test.ts packages/client/tests/store.test.ts
git commit -m "merge: hydrate transcripts and arsenal in snapshots"
```

Expected: commit succeeds.

---

### Task 7: Merge Client Context, Provider Emblems, Flip, and Model Cards

**Files:**
- Create: `packages/client/src/context-progress.ts`
- Create: `packages/client/src/game/emblems.ts`
- Create: `packages/client/src/game/flip.ts`
- Modify: `packages/client/src/game/unit.ts`
- Modify: `packages/client/src/game/view.ts`
- Modify: `packages/client/src/GameCanvas.tsx`
- Create: `packages/client/src/hud/ProviderEmblem.tsx`
- Create: `packages/client/src/hud/container-badge.ts`
- Modify: `packages/client/src/hud/context-bar.ts`
- Modify: `packages/client/src/hud/SidePanel.tsx`
- Modify: `packages/client/src/hud/ThemeSwitch.tsx`
- Modify: `packages/client/src/hud/Minimap.tsx`
- Modify: `packages/client/src/hud/ModelRegistryEditor.tsx`
- Create: `packages/client/src/hud/model-sprite-edit.ts`
- Create: `packages/client/src/hud/seen-models.ts`
- Modify: `packages/client/src/settings.ts`
- Modify: `packages/client/src/i18n.ts`
- Add assets: `packages/client/public/assets/emblems/*.png`
- Test: `packages/client/tests/context-bar.test.ts`
- Test: `packages/client/tests/emblems.test.ts`
- Test: `packages/client/tests/flip.test.ts`
- Test: `packages/client/tests/model-sprite-edit.test.ts`
- Test: `packages/client/tests/seen-models.test.ts`
- Test: `packages/client/tests/settings.test.ts`
- Test: `packages/client/tests/container-badge.test.ts`
- Test: `packages/client/tests/resolve-provider.test.ts`

- [ ] **Step 1: Adopt `context-progress.ts` and preserve API**

Create or keep `packages/client/src/context-progress.ts`:

```ts
export function contextPct(tokens: number, windowSize: number): number {
  if (!(windowSize > 0)) return 0;
  return Math.min(100, Math.round((tokens / windowSize) * 100));
}

export function contextColor(pct: number): string {
  if (pct <= 60) return '#5dcaa5';
  if (pct <= 80) return '#f0d76e';
  return '#e24b4a';
}
```

In `packages/client/src/hud/context-bar.ts`, re-export:

```ts
export { contextPct, contextColor } from '../context-progress';
```

- [ ] **Step 2: Merge side-panel capacity selection**

In `packages/client/src/hud/SidePanel.tsx`, context bar capacity must prefer CLI-reported capacity and fallback to model config:

```tsx
<ContextBar
  tokens={hero.contextTokens}
  windowSize={hero.contextWindowTokens ?? resolveContextWindow(hero.model, models)}
  label={t.context}
/>
```

Keep fork transcript rendering and recent actions rendering.

- [ ] **Step 3: Adopt provider emblem UI**

Keep upstream files:

```text
packages/shared/src/providers.ts
packages/client/src/hud/ProviderEmblem.tsx
packages/client/src/game/emblems.ts
packages/client/public/assets/emblems/claude.png
packages/client/public/assets/emblems/codex.png
packages/client/public/assets/emblems/koda.png
packages/client/public/assets/emblems/opencode.png
```

In `SidePanel.tsx`, replace old inline provider badge with:

```tsx
<ProviderEmblem agent={hero.agent} variant="pill" />
```

Keep the container badge:

```tsx
{hero.container && (
  <div className="px" title={hero.container.id}>
    {containerLabel(hero.container)}
  </div>
)}
```

- [ ] **Step 4: Merge unit context bars**

In `packages/client/src/game/unit.ts`, adopt upstream `setContextProgress(pct)` and the `contextBar` graphics, but keep existing fork unit state and animation behavior. The public method must remain:

```ts
setContextProgress(pct: number | undefined): void
```

In `packages/client/src/game/view.ts`, set progress using:

```ts
const contextWindow = hero.contextWindowTokens ?? resolveModelLive(hero.model).contextWindow;
unit.setContextProgress(typeof hero.contextTokens === 'number' ? contextPct(hero.contextTokens, contextWindow) : undefined);
```

- [ ] **Step 5: Merge flip setting**

Keep upstream `packages/client/src/game/flip.ts`. In `packages/client/src/settings.ts`, preserve existing setting migration and add upstream `flipped` default:

```ts
flipped: false,
```

In `GameCanvas.tsx`, pass the setting into `new GameView(...)`:

```ts
const flipped = useSettings((s) => s.flipped);
```

and construct:

```ts
const view = new GameView(theme, lang, flipped);
```

- [ ] **Step 6: Merge model sprite cards**

Adopt upstream files:

```text
packages/client/src/hud/model-sprite-edit.ts
packages/client/src/hud/seen-models.ts
packages/client/tests/model-sprite-edit.test.ts
packages/client/tests/seen-models.test.ts
```

In `ModelRegistryEditor.tsx`, keep upstream card UI but preserve fork's saved model config compatibility and default GPT model entries. The expected behavior after merge:

```text
Existing saved model configs still load.
Unknown extra keys are not persisted.
gpt-5.5 resolves to 258400 context window.
Sprite card UI can add/remove/edit model match rules.
```

- [ ] **Step 7: Run focused client UI tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/context-bar.test.ts tests/emblems.test.ts tests/flip.test.ts tests/model-sprite-edit.test.ts tests/seen-models.test.ts tests/settings.test.ts tests/container-badge.test.ts tests/resolve-provider.test.ts tests/model-store.test.ts tests/models.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit client UI merge**

Run:

```bash
git add packages/client/src/context-progress.ts packages/client/src/game/emblems.ts packages/client/src/game/flip.ts packages/client/src/game/unit.ts packages/client/src/game/view.ts packages/client/src/GameCanvas.tsx packages/client/src/hud/ProviderEmblem.tsx packages/client/src/hud/container-badge.ts packages/client/src/hud/context-bar.ts packages/client/src/hud/SidePanel.tsx packages/client/src/hud/ThemeSwitch.tsx packages/client/src/hud/Minimap.tsx packages/client/src/hud/ModelRegistryEditor.tsx packages/client/src/hud/model-sprite-edit.ts packages/client/src/hud/seen-models.ts packages/client/src/settings.ts packages/client/src/i18n.ts packages/client/public/assets/emblems packages/client/tests/context-bar.test.ts packages/client/tests/emblems.test.ts packages/client/tests/flip.test.ts packages/client/tests/model-sprite-edit.test.ts packages/client/tests/seen-models.test.ts packages/client/tests/settings.test.ts packages/client/tests/container-badge.test.ts packages/client/tests/resolve-provider.test.ts
git commit -m "merge: adopt upstream provider and context UI"
```

Expected: commit succeeds.

---

### Task 8: Merge Building Stats Compatibility

**Files:**
- Modify: `packages/server/src/building-stats.ts`
- Test: `packages/server/test/building-stats.test.ts`

- [ ] **Step 1: Preserve fork Codex building stats**

In `packages/server/src/building-stats.ts`, keep fork behavior:

```text
Codex `token_count` output deltas are attributed to current building.
`task_complete` / `turn_complete` moves current building to both completed buildings.
`compacted` does not create output deltas.
Stats scan ~/.claude/projects and ~/.codex/sessions, independently of live watcher roots.
```

- [ ] **Step 2: Keep mapping-config invalidation**

Confirm `registerMappingRoutes(... onSaved: invalidateBuildingStatsCache)` still exists in `packages/server/src/server.ts` after the server merge.

Expected line:

```ts
registerMappingRoutes(app, { persist: true, onSaved: invalidateBuildingStatsCache });
```

- [ ] **Step 3: Run focused stats tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/building-stats.test.ts
```

Expected: all tests pass, including compact no-double-count and completion stats for `garden` / `hydroponics`.

- [ ] **Step 4: Commit stats merge**

Run:

```bash
git add packages/server/src/building-stats.ts packages/server/test/building-stats.test.ts packages/server/src/server.ts
git commit -m "merge: preserve fork building statistics"
```

Expected: commit succeeds.

---

### Task 9: Resolve Package and Docs

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/index.html`
- Keep/add upstream docs under `docs/superpowers/plans/` and `docs/superpowers/specs/`

- [ ] **Step 1: Resolve package version**

Use upstream package version `0.5.0` unless the fork intentionally uses a different release numbering scheme.

Expected `package.json` field:

```json
"version": "0.5.0"
```

- [ ] **Step 2: Regenerate lockfile**

Run:

```bash
npm install --package-lock-only
```

Expected: command exits `0`, and `package-lock.json` no longer contains conflict markers.

- [ ] **Step 3: Merge README/docs**

Keep upstream README/docs additions:

```text
npx vs npm -g quick-start wording
Docker container sessions note
context-window meter mention
model registry / make-it-yours landing-page section
```

Preserve fork additions:

```text
Serena/AGENTS workflow docs remain in AGENTS.md and .serena memory files.
Codex support and EMFILE plans remain under docs/superpowers/plans.
Translated comments/docs already in the fork remain English when touched.
```

- [ ] **Step 4: Search for conflict markers**

Run:

```bash
rg -n '<<<<<<<|=======|>>>>>>>' .
```

Expected: no output.

- [ ] **Step 5: Commit package/docs merge**

Run:

```bash
git add package.json package-lock.json README.md docs/index.html docs/superpowers/plans docs/superpowers/specs
git commit -m "merge: update package and upstream docs"
```

Expected: commit succeeds.

---

### Task 10: Full Verification and Review

**Files:**
- No planned source edits.

- [ ] **Step 1: Run server focused high-risk tests**

Run:

```bash
npm test -w @agent-citadel/server -- test/codex.test.ts test/state-machine.test.ts test/watcher.test.ts test/building-stats.test.ts test/docker-client.test.ts test/docker-tail.test.ts test/docker-poller.test.ts test/world.test.ts tests/server.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run client focused high-risk tests**

Run:

```bash
npm test -w @agent-citadel/client -- tests/activity-building.test.ts tests/context-bar.test.ts tests/store.test.ts tests/model-store.test.ts tests/models.test.ts tests/model-sprite-edit.test.ts tests/seen-models.test.ts tests/settings.test.ts tests/flip.test.ts tests/emblems.test.ts tests/resolve-provider.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: server and client test suites pass.

- [ ] **Step 4: Run full build**

Run:

```bash
npm run build
```

Expected: build exits `0`. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Run live smoke test**

Run:

```bash
npm run dev
```

Expected:

```text
Age of Agents server (dev): http://127.0.0.1:8123 (ws: /ws)
VITE ... Local: http://localhost:5173/
```

In a second terminal:

```bash
curl -sS http://127.0.0.1:8123/health
```

Expected:

```json
{"ok":true,"demo":false}
```

- [ ] **Step 6: Verify live Codex context semantics**

Run this while a Codex session is visible:

```bash
node - <<'NODE'
import { WebSocket } from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8123/ws');
const timer = setTimeout(() => { console.error('timeout'); process.exit(2); }, 5000);
ws.on('message', (data) => {
  clearTimeout(timer);
  const event = JSON.parse(String(data));
  const codex = (event.heroes ?? []).filter((h) => h.agent === 'codex');
  console.log(JSON.stringify(codex.map((h) => ({
    sessionId: h.sessionId,
    model: h.model,
    contextTokens: h.contextTokens,
    contextWindowTokens: h.contextWindowTokens,
    tokens: h.tokens,
  })), null, 2));
  ws.close();
});
ws.on('error', (err) => { clearTimeout(timer); console.error(err.message); process.exit(1); });
NODE
```

Expected:

```text
For Codex, contextTokens is much smaller than tokens.input after compaction.
contextWindowTokens is 258400 for gpt-5.5 when Codex reports that window.
```

- [ ] **Step 7: Request code review**

Use `superpowers:requesting-code-review` against the merge branch.

Reviewer must check:

```text
No Codex context regression.
No EMFILE watcher regression.
World snapshot includes both transcripts and arsenals.
Docker source does not run when source filtering excludes Claude-compatible sources.
Model registry settings still migrate saved configs.
Client renders unit context bars without layout overlap.
```

- [ ] **Step 8: Fix review findings**

If review finds issues, apply `superpowers:receiving-code-review`, fix only substantiated findings, and rerun the focused tests for touched areas plus `npm test` and `npm run build`.

- [ ] **Step 9: Merge or push**

If the merge branch is correct:

```bash
git status --short --branch
git push -u origin codex/upstream-main-merge
```

Then either open a PR or fast-forward/merge to `main` after review.

Expected:

```text
Merge branch pushed and ready for final integration.
```

---

## Self-Review

Spec coverage:

- Upstream features are covered by Tasks 5, 6, 7, and 9.
- Fork compatibility risks are covered by Tasks 2, 3, 4, 5, 6, 8, and 10.
- Full verification and review are covered by Task 10.

Placeholder scan:

- No unresolved marker text, open-ended implementation slots, or unstated test commands are used.
- Conflict resolution tasks specify exact files, exact semantics, and expected tests.

Type consistency:

- `contextWindowTokens` is the shared hero field.
- `contextWindow` remains the normalized fact field.
- `transcripts` and `arsenals` are both `WorldSnapshot` fields.
- `container` stays on `HeroSnapshot` and is passed via `SessionTracker` `extra`.
