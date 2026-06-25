# Sprite Roster + Random Selection + All-Random Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the hero sprite pool to 8 families, give local LLMs a dedicated character, randomly pick among sprites that match the same model, and add an "all random" settings toggle for diverse cities.

**Architecture:** The identity axis lives in `@agent-citadel/shared` (pure, unit-tested from the server package). A new `resolveSpriteCandidates` returns every sprite a model matches; a pure `pickSprite(candidates, rng)` chooses one. The client wires a `pickSpriteLive` (twin of `resolveModelLive`) into the one place a hero unit is created (`view.ts:461`), so selection happens once per `Unit` (reroll on page refresh). New characters are PixelLab assets packed by the existing offline atlas pipeline.

**Tech Stack:** TypeScript, Vitest, Pixi.js, Zustand (client stores), PixelLab MCP (asset generation), Node `pngjs` packer.

## Global Constraints

- Code comments and developer-facing strings in **English** (project convention). User-facing UI strings are localized in `i18n.ts` (en/pl/it).
- Tests live in `packages/server/test/*.test.ts` and import shared logic from `@agent-citadel/shared`. The client has **no jsdom test env** — do not add client unit tests; verify client wiring with `npm run build:web` (runs `tsc --noEmit`) and the preview.
- Sprite assets: PNG spritesheet of 68×68 frames + TexturePacker JSON named `<key>__<anim>_NN`, per theme under `packages/client/public/assets/<theme>/heroes/`, listed in that theme's `index.json`. Themes: `fantasy`, `scifi`.
- `SpriteId` is derived from `SPRITE_IDS` (single source of truth, `packages/shared/src/index.ts`).
- Random selection uses `Math.random` (allowed — this is app runtime, not a workflow script). Selection must occur only at `Unit` creation, never per render frame.
- Ship straight to `main` with conventional-commit messages; do not open PRs.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/shared/src/index.ts` | `SPRITE_IDS` +4; re-point local rules to `local`; `resolveSpriteCandidates`; `pickSprite` | 1 |
| `packages/server/test/sprite-roster.test.ts` (new) | Tests for SPRITE_IDS membership + local re-point | 1 |
| `packages/server/test/sprite-candidates.test.ts` (new) | Tests for `resolveSpriteCandidates` + `pickSprite` | 1 |
| `packages/client/src/theme/models.ts` | Re-export the two new shared functions | 1 |
| `packages/client/src/model-store.ts` | `pickSpriteLive(model)` (honors all-random + tie random) | 1 |
| `packages/client/src/game/view.ts` | Use `pickSpriteLive` at unit creation | 1 |
| `packages/client/src/settings.ts` | `allRandom` state + `setAllRandom` + localStorage key | 1 |
| `packages/client/src/i18n.ts` | `allRandomLabel` / `allRandomHint` (type + en/pl/it) | 1 |
| `packages/client/src/hud/SettingsPanel.tsx` | "All random" checkbox in the Models tab | 1 |
| `scripts/pixellab/pack-atlas.mjs` | Merge new keys into existing `index.json` (non-destructive) | 2 |
| `packages/client/public/assets/{fantasy,scifi}/heroes/local-default.{png,json}` + `index.json` | `local` character assets | 2 |
| `…/heroes/{golem,familiar,oracle}-default.{png,json}` + `index.json` | 3 more characters | 3 |

**Note (graceful degradation):** After Phase 1, `local/golem/familiar/oracle` have no atlas, so `archetypeKeyChain` falls back to `sonnet-default` ([archetype.ts:38](../../../packages/client/src/game/archetype.ts)). The app runs; new families just look like Sonnet until their assets land in Phases 2–3. Phase 1 is therefore verified by tests + build, not by visible variety.

---

## Phase 1 — Plumbing (no new assets)

### Task 1: Extend SPRITE_IDS and re-point local families to `local`

**Files:**
- Modify: `packages/shared/src/index.ts:418` (SPRITE_IDS), `:515-523` (local sprite rules)
- Test: `packages/server/test/sprite-roster.test.ts` (create)

**Interfaces:**
- Produces: `SPRITE_IDS` now includes `'local' | 'golem' | 'familiar' | 'oracle'`; `DEFAULT_MODEL_CONFIG` maps local model patterns to `sprite: 'local'`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/sprite-roster.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SPRITE_IDS, resolveSprite, resolveModel, DEFAULT_MODEL_CONFIG } from '@agent-citadel/shared';

describe('sprite roster', () => {
  it('includes the four new sprite families', () => {
    expect(SPRITE_IDS).toEqual(expect.arrayContaining(['local', 'golem', 'familiar', 'oracle']));
  });

  it('maps local model families to the dedicated local sprite', () => {
    expect(resolveSprite('llama3.2:latest', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('qwen3:8b', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('mistral:7b', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
    expect(resolveSprite('SpeakLeash/bielik-11b-v3.0-instruct', DEFAULT_MODEL_CONFIG).sprite).toBe('local');
  });

  it('keeps Claude families on their own sprites', () => {
    expect(resolveSprite('claude-opus-4-8[1m]', DEFAULT_MODEL_CONFIG).sprite).toBe('opus');
    expect(resolveSprite('claude-sonnet-4-6', DEFAULT_MODEL_CONFIG).sprite).toBe('sonnet');
  });

  it('preserves local family display names (re-point is sprite-only)', () => {
    expect(resolveModel('llama3.2:latest', DEFAULT_MODEL_CONFIG).displayName).toBe('Llama');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @agent-citadel/server -- sprite-roster`
Expected: FAIL — `SPRITE_IDS` does not contain the new ids; `resolveSprite('llama…').sprite` is `'sonnet'`, not `'local'`.

- [ ] **Step 3: Extend SPRITE_IDS**

In `packages/shared/src/index.ts:418`, replace:
```ts
export const SPRITE_IDS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
```
with:
```ts
export const SPRITE_IDS = ['opus', 'sonnet', 'haiku', 'fable', 'local', 'golem', 'familiar', 'oracle'] as const;
```

- [ ] **Step 4: Re-point local model rules to `local`**

In `packages/shared/src/index.ts:515-523`, replace the nine local-family rules with (only `sprite` changes; patterns and display names stay):
```ts
    // Local model families (Ollama/llama.cpp/vLLM/oMLX) — dedicated 'local' sprite.
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local', displayName: 'Llama' },
    { match: { kind: 'pattern', pattern: 'qwen' }, sprite: 'local', displayName: 'Qwen' },
    { match: { kind: 'pattern', pattern: 'ministral' }, sprite: 'local', displayName: 'Ministral' },
    { match: { kind: 'pattern', pattern: 'mistral' }, sprite: 'local', displayName: 'Mistral' },
    { match: { kind: 'pattern', pattern: 'gemma' }, sprite: 'local', displayName: 'Gemma' },
    { match: { kind: 'pattern', pattern: 'phi' }, sprite: 'local', displayName: 'Phi' },
    { match: { kind: 'pattern', pattern: 'bielik' }, sprite: 'local', displayName: 'Bielik' },
    { match: { kind: 'pattern', pattern: 'glm' }, sprite: 'local', displayName: 'GLM' },
    { match: { kind: 'pattern', pattern: 'lfm' }, sprite: 'local', displayName: 'LFM' },
```

- [ ] **Step 5: Run the new test + the full server suite**

Run: `npm test -w @agent-citadel/server -- sprite-roster`
Expected: PASS.
Run: `npm test -w @agent-citadel/server`
Expected: PASS — including `local-llm-sprites.test.ts` (asserts display names, unaffected) and `model-config.test.ts` (asserts the gpt-5.5 rule + fallback, unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/server/test/sprite-roster.test.ts
git commit -m "feat(shared): add local/golem/familiar/oracle sprites; local models -> local"
```

---

### Task 2: `resolveSpriteCandidates` + `pickSprite` (pure)

**Files:**
- Modify: `packages/shared/src/index.ts` (insert after `resolveSprite`, ~line 477)
- Test: `packages/server/test/sprite-candidates.test.ts` (create)

**Interfaces:**
- Consumes: `matchModel`, `ModelConfig`, `SpriteId` (existing exports).
- Produces:
  - `resolveSpriteCandidates(model: string | undefined, cfg: ModelConfig): SpriteId[]` — every matching sprite, in rule order, de-duplicated; `[cfg.fallback.sprite]` when none match or no model.
  - `pickSprite(candidates: readonly SpriteId[], rng?: () => number): SpriteId` — `candidates[0]` when length ≤ 1, else `candidates[floor(rng()*length)]`; `rng` defaults to `Math.random`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/sprite-candidates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  resolveSpriteCandidates,
  pickSprite,
  DEFAULT_MODEL_CONFIG,
  type ModelConfig,
} from '@agent-citadel/shared';

const MULTI: ModelConfig = {
  sprites: [
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local' },
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'golem' },
    { match: { kind: 'pattern', pattern: 'llama' }, sprite: 'local' }, // duplicate sprite
  ],
  windows: [],
  fallback: { sprite: 'sonnet', contextWindow: 200_000 },
};

describe('resolveSpriteCandidates', () => {
  it('returns all matching sprites in order, de-duplicated', () => {
    expect(resolveSpriteCandidates('llama3.2:latest', MULTI)).toEqual(['local', 'golem']);
  });

  it('falls back when nothing matches', () => {
    expect(resolveSpriteCandidates('nope-xyz', MULTI)).toEqual(['sonnet']);
  });

  it('falls back when model is undefined', () => {
    expect(resolveSpriteCandidates(undefined, MULTI)).toEqual(['sonnet']);
  });

  it('single match returns one candidate (default config)', () => {
    expect(resolveSpriteCandidates('claude-opus-4-8', DEFAULT_MODEL_CONFIG)).toEqual(['opus']);
  });
});

describe('pickSprite', () => {
  it('returns the only candidate without calling rng', () => {
    let called = false;
    const rng = () => { called = true; return 0; };
    expect(pickSprite(['golem'], rng)).toBe('golem');
    expect(called).toBe(false);
  });

  it('picks the first when rng is 0', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0)).toBe('local');
  });

  it('picks the last when rng approaches 1', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0.999)).toBe('oracle');
  });

  it('picks the middle for a mid rng', () => {
    expect(pickSprite(['local', 'golem', 'oracle'], () => 0.5)).toBe('golem');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @agent-citadel/server -- sprite-candidates`
Expected: FAIL — `resolveSpriteCandidates` / `pickSprite` are not exported.

- [ ] **Step 3: Implement both functions**

In `packages/shared/src/index.ts`, immediately after `resolveSprite` (the function ending at line 477), insert:
```ts
/** Identity axis (multi): every sprite the model matches, in rule order, de-duplicated.
 *  Empty/no-match -> [fallback.sprite]. Basis for client-side random selection. */
export function resolveSpriteCandidates(model: string | undefined, cfg: ModelConfig): SpriteId[] {
  const out: SpriteId[] = [];
  if (model) {
    for (const r of cfg.sprites) {
      if (matchModel(model, r.match) && !out.includes(r.sprite)) out.push(r.sprite);
    }
  }
  return out.length ? out : [cfg.fallback.sprite];
}

/** Pick one sprite from candidates. <=1 -> the single (rng untouched); else rng-indexed.
 *  rng defaults to Math.random; injected in tests for determinism. */
export function pickSprite(candidates: readonly SpriteId[], rng: () => number = Math.random): SpriteId {
  if (candidates.length <= 1) return candidates[0];
  return candidates[Math.floor(rng() * candidates.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @agent-citadel/server -- sprite-candidates`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/server/test/sprite-candidates.test.ts
git commit -m "feat(shared): resolveSpriteCandidates + pickSprite for random sprite choice"
```

---

### Task 3: Client wiring — `pickSpriteLive` into unit creation

**Files:**
- Modify: `packages/client/src/theme/models.ts` (re-export)
- Modify: `packages/client/src/model-store.ts` (add `pickSpriteLive`)
- Modify: `packages/client/src/game/view.ts:13` (import), `:461` (use)

**Interfaces:**
- Consumes: `resolveSpriteCandidates`, `pickSprite`, `SPRITE_IDS`, `SpriteId` (shared via `../theme/models`); `useSettings().allRandom` (added in Task 4 — for now reference it; the property exists after Task 4, so do Task 4 before building, or temporarily default — see Step 3 note); `useModels().models`.
- Produces: `pickSpriteLive(model: string | undefined): SpriteId`.

> **Ordering note:** This task references `useSettings.getState().allRandom`, added in Task 4. Implement Task 4 **before** running the build in Step 5, or the `tsc` check fails on the missing property. (Tasks 3 and 4 may be committed together if executing inline.)

- [ ] **Step 1: Re-export the new shared functions**

In `packages/client/src/theme/models.ts`, add `resolveSpriteCandidates,` and `pickSprite,` to the value re-export block (the one exporting `resolveSprite`):
```ts
export {
  SPRITE_IDS,
  isSpriteId,
  matchModel,
  resolveSprite,
  resolveSpriteCandidates,
  pickSprite,
  resolveContextWindow,
  resolveModel,
  DEFAULT_MODEL_CONFIG,
  upgradeModelConfig,
  validateModelConfig,
} from '@agent-citadel/shared';
```

- [ ] **Step 2: Add `pickSpriteLive` to the model store**

In `packages/client/src/model-store.ts`, extend the existing import from `./theme/models` to include the new names and `SPRITE_IDS` / `SpriteId`:
```ts
import {
  resolveModel,
  resolveSpriteCandidates,
  pickSprite,
  SPRITE_IDS,
  DEFAULT_MODEL_CONFIG,
  upgradeModelConfig,
  validateModelConfig,
  type ModelConfig,
  type ResolvedModel,
  type SpriteId,
} from './theme/models';
```
Add an import for the settings store near the top:
```ts
import { useSettings } from './settings';
```
Then add, next to `resolveModelLive` (after line 105):
```ts
/** Live sprite choice for a hero at spawn. With all-random ON, draws from the whole
 *  pool (mapping ignored); otherwise from the model's matching sprites, picking one at
 *  random on a tie. Reroll happens per Unit creation (i.e. on page refresh). Twin of
 *  resolveModelLive. */
export function pickSpriteLive(model: string | undefined): SpriteId {
  const candidates = useSettings.getState().allRandom
    ? SPRITE_IDS
    : resolveSpriteCandidates(model, useModels.getState().models);
  return pickSprite(candidates);
}
```

- [ ] **Step 3: Wire it into unit creation**

In `packages/client/src/game/view.ts:13`, change:
```ts
import { resolveModelLive } from '../model-store';
```
to:
```ts
import { resolveModelLive, pickSpriteLive } from '../model-store';
```
In `packages/client/src/game/view.ts:461`, change:
```ts
        const sheet = getHeroSheet(sessionToArchetypeKey(hero, resolveModelLive(hero.model).sprite));
```
to:
```ts
        const sheet = getHeroSheet(sessionToArchetypeKey(hero, pickSpriteLive(hero.model)));
```
(Leave the `resolveModelLive(hero.model).contextWindow` use at line 478 unchanged.)

- [ ] **Step 4: (Do Task 4 now if not already, so `allRandom` exists.)**

- [ ] **Step 5: Typecheck + build**

Run: `npm run build:web`
Expected: PASS — `tsc --noEmit` clean, vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/theme/models.ts packages/client/src/model-store.ts packages/client/src/game/view.ts
git commit -m "feat(client): pickSpriteLive — random sprite choice at unit creation"
```

---

### Task 4: "All random" setting + checkbox

**Files:**
- Modify: `packages/client/src/settings.ts`
- Modify: `packages/client/src/i18n.ts` (type at ~line 100; en ~252; pl ~404; it ~556)
- Modify: `packages/client/src/hud/SettingsPanel.tsx`

**Interfaces:**
- Produces: `useSettings().allRandom: boolean`, `useSettings().setAllRandom(v: boolean): void`; UI strings `t.allRandomLabel`, `t.allRandomHint`.

- [ ] **Step 1: Add `allRandom` to the settings store**

In `packages/client/src/settings.ts`:
1. In the `SettingsStore` interface, add after `barCollapsed`:
```ts
  /** When true, every agent draws a random sprite from the whole pool (ignores model→sprite mapping). */
  allRandom: boolean;
```
and add to the actions:
```ts
  setAllRandom(allRandom: boolean): void;
```
2. Add a storage key next to the others:
```ts
const ALL_RANDOM_KEY = 'agent-citadel.all-random';
```
3. In the `create(...)` initializer, add the initial value (after `barCollapsed`):
```ts
  allRandom: localStorage.getItem(ALL_RANDOM_KEY) === '1',
```
4. Add the action (after `setBarCollapsed`):
```ts
  setAllRandom: (allRandom) => {
    localStorage.setItem(ALL_RANDOM_KEY, allRandom ? '1' : '0');
    set({ allRandom });
  },
```

- [ ] **Step 2: Add i18n strings (type + three languages)**

In `packages/client/src/i18n.ts`:
1. In the UI type block, next to `tabModels: string;` (line ~100), add:
```ts
  allRandomLabel: string;
  allRandomHint: string;
```
2. In the **en** object, next to `tabModels: 'Models',` (line ~252), add:
```ts
  allRandomLabel: 'All random sprites',
  allRandomHint: 'Every agent gets a random look from the whole pool. Refresh reshuffles the city.',
```
3. In the **pl** object, next to `tabModels: 'Modele',` (line ~404), add:
```ts
  allRandomLabel: 'Losowe sprite\'y',
  allRandomHint: 'Każdy agent dostaje losowy wygląd z całej puli. Odświeżenie przelosowuje miasto.',
```
4. In the **it** object, next to `tabModels: 'Modelli',` (line ~556), add:
```ts
  allRandomLabel: 'Sprite casuali',
  allRandomHint: 'Ogni agente riceve un aspetto casuale dall\'intero set. L\'aggiornamento rimescola la città.',
```

- [ ] **Step 3: Add the checkbox to the Models tab**

In `packages/client/src/hud/SettingsPanel.tsx`:
1. Add an import:
```ts
import { useSettings } from '../settings';
```
2. Inside the component (after `const t = useUi();`), add:
```ts
  const allRandom = useSettings((s) => s.allRandom);
  const setAllRandom = useSettings((s) => s.setAllRandom);
```
3. Replace the final content line (`{tab === 'buildings' ? <BuildingReactionsEditor /> : <ModelRegistryEditor />}`) with:
```tsx
        {tab === 'buildings' ? (
          <BuildingReactionsEditor />
        ) : (
          <>
            <label
              className="px"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '4px 0 10px' }}
            >
              <input
                type="checkbox"
                checked={allRandom}
                onChange={(e) => setAllRandom(e.target.checked)}
              />
              <span>
                🎲 {t.allRandomLabel}
                <span style={{ display: 'block', opacity: 0.7, fontSize: 11 }}>{t.allRandomHint}</span>
              </span>
            </label>
            <ModelRegistryEditor />
          </>
        )}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/settings.ts packages/client/src/i18n.ts packages/client/src/hud/SettingsPanel.tsx
git commit -m "feat(client): all-random sprites toggle in settings (Models tab)"
```

- [ ] **Step 6: Phase 1 verification (preview, optional but recommended)**

Start the dev server (`npm run dev` or the agentcraft start skill), open settings → Models, toggle "All random". With no new assets yet, all sprites resolve to `sonnet-default`, so the world won't visibly change — confirm instead: no console errors, the checkbox persists across refresh (localStorage), and `tsc`/tests are green. Visible variety arrives in Phases 2–3.

---

## Phase 2 — The `local` character (flagship)

### Task 5: Non-destructive `index.json` packing

**Files:**
- Modify: `scripts/pixellab/pack-atlas.mjs` (final index.json write, lines 71-77)

**Interfaces:**
- Produces: running `node scripts/pixellab/pack-atlas.mjs <theme>` now writes the **union** of pre-existing `index.json` keys and freshly packed keys (sorted), instead of overwriting with only the freshly packed set.

- [ ] **Step 1: Replace the index.json write block**

In `scripts/pixellab/pack-atlas.mjs`, replace lines 71-77:
```js
const keys = existsSync(framesRoot)
  ? readdirSync(framesRoot).filter((k) => existsSync(join(framesRoot, k)))
  : [];
const packed = keys.map(packCharacter).filter(Boolean);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ keys: packed }, null, 2));
console.log(`Packed ${packed.length} atlases into ${outDir}:`, packed.join(', '));
```
with:
```js
const keys = existsSync(framesRoot)
  ? readdirSync(framesRoot).filter((k) => existsSync(join(framesRoot, k)))
  : [];
const packed = keys.map(packCharacter).filter(Boolean);
mkdirSync(outDir, { recursive: true });

// Non-destructive: merge freshly packed keys with whatever index.json already lists,
// so packing one new character never drops the existing atlases (their frames are not
// in downloads/frames). Idempotent: re-running with the same frames is a no-op union.
const idxPath = join(outDir, 'index.json');
let existing = [];
if (existsSync(idxPath)) {
  try { existing = JSON.parse(readFileSync(idxPath, 'utf8')).keys ?? []; } catch { existing = []; }
}
const merged = [...new Set([...existing, ...packed])].sort();
writeFileSync(idxPath, JSON.stringify({ keys: merged }, null, 2));
console.log(`Packed ${packed.length} atlas(es); index.json now lists ${merged.length}:`, merged.join(', '));
```
(`readFileSync` is already imported at line 8.)

- [ ] **Step 2: Verify it is non-destructive on an empty frames set**

With `downloads/frames` absent/empty (the existing 4 atlases' frames are not tracked), run:
Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: `index.json now lists 4: fable-default, haiku-default, opus-default, sonnet-default` — the four existing keys are **preserved**, not wiped.
Run: `git diff --stat packages/client/public/assets/fantasy/heroes/index.json`
Expected: no change (same four keys, sorted).

- [ ] **Step 3: Commit**

```bash
git add scripts/pixellab/pack-atlas.mjs
git commit -m "fix(assets): pack-atlas merges into existing index.json (non-destructive)"
```

---

### Task 6: Generate + pack the `local` character (both themes)

> Generative task (PixelLab MCP) — not classic TDD. Each theme needs its own frames because the art differs per theme. The atlas key is `local-default`.

**Files:**
- Create: `packages/client/public/assets/fantasy/heroes/local-default.{png,json}`
- Create: `packages/client/public/assets/scifi/heroes/local-default.{png,json}`
- Modify: both `heroes/index.json` (via the packer)
- Scratch: `downloads/frames/local-default/{idle,walk,work}/*.png` (gitignored)

**Interfaces:**
- Consumes: Task 5's non-destructive packer; the 68×68 frame convention; `SPRITE_IDS` already includes `local` (Task 1).

- [ ] **Step 1: Generate the fantasy `local` character with animations**

Use the PixelLab MCP `create_character` (idle/walk/work animations, top-down view, matching the existing hero style — small 64px-ish character, single-color outline). Concept — *self-hosted hearth-keeper*: a small cloaked homunculus tending a hearth, cyan accents (ties to the `local-llm` cyan house emblem). Mirror the generation parameters used for the existing heroes (inspect an existing character via `mcp__pixellab__get_character` / `list_characters` to match view, canvas size, and animation set).

- [ ] **Step 2: Download fantasy frames into the packer layout**

Save each animation's frames to `downloads/frames/local-default/idle/*.png`, `…/walk/*.png`, `…/work/*.png` (zero-padded order, e.g. `00.png`, `01.png`). Frame canvas should match the existing 68×68 (the packer centers smaller frames, but keep close).

- [ ] **Step 3: Pack the fantasy atlas**

Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: output lists `local-default` among the keys; creates `packages/client/public/assets/fantasy/heroes/local-default.png` + `.json`; `index.json` now has 5 keys.
Run: `file packages/client/public/assets/fantasy/heroes/local-default.png`
Expected: `PNG image data … RGBA`.

- [ ] **Step 4: Repeat for sci-fi (clear scratch frames first)**

Remove the fantasy scratch frames so they don't leak into the sci-fi sheet:
Run: `rm -rf downloads/frames/local-default`
Generate the sci-fi `local` character — concept *homelab droid*: a compact rack-server droid with cyan status LEDs — download its frames to `downloads/frames/local-default/{idle,walk,work}/`, then:
Run: `node scripts/pixellab/pack-atlas.mjs scifi`
Expected: `packages/client/public/assets/scifi/heroes/local-default.png` + `.json` created; sci-fi `index.json` has 5 keys.

- [ ] **Step 5: Verify in the preview**

Start the dev server. With a local model session present (or by temporarily mapping a visible model to `local` in settings → Models), confirm the new character renders in both themes and animates (idle, and walk while moving). Check the console: no `[heroes]` atlas warnings for `local-default`.

- [ ] **Step 6: Commit**

```bash
git add packages/client/public/assets/fantasy/heroes/local-default.png \
        packages/client/public/assets/fantasy/heroes/local-default.json \
        packages/client/public/assets/fantasy/heroes/index.json \
        packages/client/public/assets/scifi/heroes/local-default.png \
        packages/client/public/assets/scifi/heroes/local-default.json \
        packages/client/public/assets/scifi/heroes/index.json
git commit -m "feat(assets): dedicated 'local' character for local LLMs (fantasy + scifi)"
```

---

## Phase 3 — Three free-agent characters

### Task 7: Generate + pack `golem`, `familiar`, `oracle`

> Same generative procedure as Task 6, repeated for three characters. They ship **unmapped** (no default rules) — available to assign/swap in settings → Models, and they activate the random tie-break when a user maps two sprites to the same pattern, or whenever "All random" is on. Concepts (both themes each, full idle/walk/work):
> - `golem` — tank: fantasy stone golem / sci-fi scrap mech.
> - `familiar` — scout: fantasy winged imp / sci-fi recon drone.
> - `oracle` — mystic: fantasy hooded seer with an orb / sci-fi floating sensor bot.

**Files (per character `<key>` ∈ {golem, familiar, oracle}, with `<key>-default` as atlas key):**
- Create: `packages/client/public/assets/{fantasy,scifi}/heroes/<key>-default.{png,json}`
- Modify: both `heroes/index.json` (via packer)
- Scratch: `downloads/frames/<key>-default/{idle,walk,work}/*.png`

- [ ] **Step 1: `golem` — fantasy**

Generate the fantasy stone-golem character (idle/walk/work) per Task 6 Step 1's approach; download frames to `downloads/frames/golem-default/{idle,walk,work}/`.
Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: `golem-default` packed; fantasy `index.json` grows by one.

- [ ] **Step 2: `golem` — sci-fi**

Run: `rm -rf downloads/frames/golem-default`
Generate the sci-fi scrap-mech character; download frames; then:
Run: `node scripts/pixellab/pack-atlas.mjs scifi`
Expected: sci-fi `golem-default` packed.

- [ ] **Step 3: `familiar` — fantasy**

Generate the fantasy winged-imp character; download frames to `downloads/frames/familiar-default/{idle,walk,work}/`.
Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: `familiar-default` packed.

- [ ] **Step 4: `familiar` — sci-fi**

Run: `rm -rf downloads/frames/familiar-default`
Generate the sci-fi recon-drone character; download frames; then:
Run: `node scripts/pixellab/pack-atlas.mjs scifi`
Expected: sci-fi `familiar-default` packed.

- [ ] **Step 5: `oracle` — fantasy**

Generate the fantasy hooded-seer character; download frames to `downloads/frames/oracle-default/{idle,walk,work}/`.
Run: `node scripts/pixellab/pack-atlas.mjs fantasy`
Expected: `oracle-default` packed; fantasy `index.json` now lists all 8 keys.

- [ ] **Step 6: `oracle` — sci-fi**

Run: `rm -rf downloads/frames/oracle-default`
Generate the sci-fi floating-sensor-bot character; download frames; then:
Run: `node scripts/pixellab/pack-atlas.mjs scifi`
Expected: sci-fi `index.json` now lists all 8 keys.

- [ ] **Step 7: Verify variety in the preview**

Start the dev server. In settings → Models, map two sprites to the same model pattern (e.g. add `golem` and `familiar` to a pattern that matches a running session) and refresh a few times — confirm the session's look rerolls between them with no errors. Toggle "All random" and refresh — confirm a mix of all 8 families appears across heroes. Check the console for no atlas warnings.

- [ ] **Step 8: Commit**

```bash
git add packages/client/public/assets/fantasy/heroes/golem-default.* \
        packages/client/public/assets/fantasy/heroes/familiar-default.* \
        packages/client/public/assets/fantasy/heroes/oracle-default.* \
        packages/client/public/assets/scifi/heroes/golem-default.* \
        packages/client/public/assets/scifi/heroes/familiar-default.* \
        packages/client/public/assets/scifi/heroes/oracle-default.* \
        packages/client/public/assets/fantasy/heroes/index.json \
        packages/client/public/assets/scifi/heroes/index.json
git commit -m "feat(assets): golem/familiar/oracle free-agent characters (fantasy + scifi)"
```

---

## Final verification (after all phases)

- [ ] Run: `npm test` — full server + client suites green.
- [ ] Run: `npm run build` — client + server build clean.
- [ ] Preview: "All random" off → local models show the `local` character; on → mixed pool; refresh reshuffles; no console atlas warnings.
- [ ] Push to `main` (`git pull --rebase && git push && git status`).

---

## Self-Review notes

- **Spec coverage:** §3.1 SPRITE_IDS → Task 1; §3.2 candidates → Task 2; §3.3 re-point → Task 1; §4.1–4.2 wiring/pickSpriteLive → Task 3; §4.3 animation fallback → **already satisfied** by [unit.ts:205](../../../packages/client/src/game/unit.ts) `if (track && …)` guard (verified in Task 6/7 Step 5/7, no code task needed); §5 all-random + settings cards → Task 4 (cards auto-render per `SPRITE_ID` via existing `groupBySprite`, no code change); §6 assets/non-destructive packing → Tasks 5–7; §7 tests → Tasks 1–2; §8 phasing → Phase structure.
- **`upgradeModelConfig` interaction (expected, not a bug):** a user who already saved a config keeps their old local→sonnet/haiku rules (same `match` ⇒ not re-appended by `sameModelMatch`). Only default/new users get `local` out of the box. Acceptable per spec §3.1.
- **No client unit tests** by design (no jsdom env); client wiring verified via `tsc`/build/preview.
