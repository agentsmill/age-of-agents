# Translate Developer Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate remaining non-English developer-facing repository text to English without changing application behavior, supported locales, or intentional language fixtures.

**Architecture:** This is a behavior-preserving documentation/string cleanup. Work is split by disjoint file ownership so subagents can translate comments, test names, package/script messages, and public validation messages without editing the same files. The main coordinator reviews every slice, runs tests, and commits reviewable chunks.

**Tech Stack:** TypeScript, React, Vite, Fastify, Vitest, npm workspaces.

---

## Current Inventory

Baseline after commit `3d39e90 Translate shared docs to English`.

Primary source/test/script scope:

- Remaining source/test/script files with Polish diacritics outside intentional locale guards: `138`
- Remaining matching lines in that scope: `1,050`
- Client source: `58` files, `508` matching lines
- Client tests: `24` files, `114` matching lines
- Server/shared source: `28` files, `277` matching lines
- Server tests: `18` files, `101` matching lines
- Scripts/docs/package metadata: `10` files, `50` matching lines

Full text-file scope, including historical `docs/superpowers` plans/notes and generated-ish docs:

- Remaining text files with Polish diacritics outside intentional locale guards: `169`
- Remaining matching lines in that wider scope: `2,998`
- Historical docs/manifest/html extras: `31` files, `1,948` matching lines

Intentional exclusions:

- `packages/client/src/i18n.ts`: supported locale strings.
- `packages/client/tests/i18n-base-language.test.ts`: language guard test, including Polish detection comments/regex.
- `packages/server/test/demo-language.test.ts`: language guard test, including Polish detection comments/regex.
- Test fixture inputs where Polish text is intentionally being parsed or accepted, for example prompt-title heuristics in `packages/server/test/title.test.ts`.

## Global Rules

- Translate developer-facing comments, JSDoc, test names, `describe` labels, script console output, package metadata, and public validation errors.
- Do not translate locale content in `i18n.ts`.
- Do not change identifiers, enum/string protocol values, route paths, JSON schemas, regex behavior, file paths, or snapshot semantics.
- Do not use broad word replacement. Translate whole comments/test names manually so the result is idiomatic English.
- Preserve non-ASCII only where it is part of syntax, intentionally tested text, UI locale content, or meaningful symbols already present.
- After each task, run the listed targeted tests, then run `npm test` before final commit.

## Subagent Workflow

Use subagents in this order:

1. Dispatch read-only explorer subagents for the five slices below. Each explorer reports:
   - exact files to edit,
   - exact exclusions to preserve,
   - risky strings that are behavior-affecting,
   - recommended targeted test command.
2. Coordinator reviews reports and updates task file lists if needed.
3. Dispatch one worker subagent per task sequentially, not in parallel for write work, unless file lists are confirmed disjoint.
4. After each worker:
   - run the task-specific command,
   - review `git diff`,
   - fix any mixed-language or awkward English manually,
   - commit the slice if tests pass.
5. After all slices:
   - run `npm test`,
   - run the remaining-language inventory,
   - leave intentional exclusions documented in the final response.

## Task 1: Client Core Source Comments

**Files:**
- Modify: `packages/client/src/game/**/*.ts`
- Modify: `packages/client/src/theme/**/*.ts`
- Modify: `packages/client/src/coverage.ts`
- Modify: `packages/client/src/notifications.ts`
- Modify: `packages/client/src/store.ts`
- Modify: `packages/client/src/util.ts`
- Modify: `packages/client/src/ws.ts`
- Exclude: `packages/client/src/i18n.ts`

- [ ] **Step 1: Inventory client core matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" packages/client/src/game packages/client/src/theme packages/client/src/coverage.ts packages/client/src/notifications.ts packages/client/src/store.ts packages/client/src/util.ts packages/client/src/ws.ts
```

Expected: list of comments/JSDoc and no locale strings.

- [ ] **Step 2: Translate comments manually**

Translate each matched comment/JSDoc to English. Preserve code, string values, regexes, paths, and exported API names exactly.

- [ ] **Step 3: Verify client core**

Run:

```bash
npm run test -w @agent-citadel/client
```

Expected: all client Vitest tests pass.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git diff -- packages/client/src/game packages/client/src/theme packages/client/src/coverage.ts packages/client/src/notifications.ts packages/client/src/store.ts packages/client/src/util.ts packages/client/src/ws.ts
git add packages/client/src/game packages/client/src/theme packages/client/src/coverage.ts packages/client/src/notifications.ts packages/client/src/store.ts packages/client/src/util.ts packages/client/src/ws.ts
git commit -m "Translate client core comments to English"
```

Expected: no whitespace errors; commit contains only client core source translation.

## Task 2: Client HUD Source Comments

**Files:**
- Modify: `packages/client/src/hud/**/*.ts`
- Modify: `packages/client/src/hud/**/*.tsx`
- Modify: `packages/client/src/hud/hud.css`
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/src/mapping-edit.ts`
- Modify: `packages/client/src/mapping-store.ts`
- Modify: `packages/client/src/model-store.ts`
- Modify: `packages/client/src/settings.ts`

- [ ] **Step 1: Inventory client HUD matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" packages/client/src/hud packages/client/src/main.tsx packages/client/src/mapping-edit.ts packages/client/src/mapping-store.ts packages/client/src/model-store.ts packages/client/src/settings.ts
```

Expected: comments/JSDoc and JSX comments. Preserve `title="Language / Język / Lingua"` unless product wants UI text changed.

- [ ] **Step 2: Translate comments manually**

Translate comments and JSDoc to English. Do not change visible UI strings unless they are developer-only labels or validation messages already expected in English.

- [ ] **Step 3: Verify client HUD**

Run:

```bash
npm run test -w @agent-citadel/client
```

Expected: all client Vitest tests pass.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git diff -- packages/client/src/hud packages/client/src/main.tsx packages/client/src/mapping-edit.ts packages/client/src/mapping-store.ts packages/client/src/model-store.ts packages/client/src/settings.ts
git add packages/client/src/hud packages/client/src/main.tsx packages/client/src/mapping-edit.ts packages/client/src/mapping-store.ts packages/client/src/model-store.ts packages/client/src/settings.ts
git commit -m "Translate client HUD comments to English"
```

Expected: no whitespace errors; commit contains only client HUD/source translation.

## Task 3: Server Source Comments

**Files:**
- Modify: `packages/server/src/**/*.ts`
- Exclude already translated: `packages/server/src/mapping-config.ts`, `packages/server/src/model-config.ts`
- Keep intentional Polish stop phrases in `packages/server/src/transcript/title.ts` if they are part of runtime heuristics; translate only surrounding comments.

- [ ] **Step 1: Inventory server source matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" packages/server/src --glob '!packages/server/src/mapping-config.ts' --glob '!packages/server/src/model-config.ts'
```

Expected: comments/JSDoc plus intentional stop-word strings in `transcript/title.ts`.

- [ ] **Step 2: Translate comments manually**

Translate comments and JSDoc to English. Do not change parser heuristics, canonical tool names, log behavior, route paths, or source adapter semantics.

- [ ] **Step 3: Verify server source**

Run:

```bash
npm run test -w @agent-citadel/server
```

Expected: all server Vitest tests pass.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git diff -- packages/server/src
git add packages/server/src
git commit -m "Translate server comments to English"
```

Expected: no whitespace errors; commit contains only server source translation.

## Task 4: Test Names and Test Comments

**Files:**
- Modify: `packages/client/tests/**/*.ts`
- Modify: `packages/server/test/**/*.ts`
- Modify: `packages/server/tests/**/*.ts`
- Exclude: `packages/client/tests/i18n-base-language.test.ts`
- Exclude: `packages/server/test/demo-language.test.ts`
- Preserve intentional Polish fixture strings in prompt/title/parser tests.

- [ ] **Step 1: Inventory test matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" packages/client/tests packages/server/test packages/server/tests --glob '!**/i18n-base-language.test.ts' --glob '!**/demo-language.test.ts'
```

Expected: test names, test comments, and some intentional fixture strings.

- [ ] **Step 2: Translate test names and comments manually**

Translate `describe`/`it` labels and comments to English. Do not translate fixture strings where a Polish prompt or sentence is the test input or expected output.

- [ ] **Step 3: Verify all tests**

Run:

```bash
npm test
```

Expected: server and client tests pass.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git diff -- packages/client/tests packages/server/test packages/server/tests
git add packages/client/tests packages/server/test packages/server/tests
git commit -m "Translate test descriptions to English"
```

Expected: no whitespace errors; commit contains only tests.

## Task 5: Scripts and Docs

**Files:**
- Modify: `scripts/**/*.mjs`
- Modify: `scripts/**/*.ts`
- Modify: `README.md`
- Modify: `packages/client/vite.config.ts`
- `package.json` was already translated in commit `3d39e90`; check only if new matches appear.

- [ ] **Step 1: Inventory script/doc matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" scripts README.md packages/client/vite.config.ts package.json
```

Expected: script comments and console messages. README should already be English except images or metadata.

- [ ] **Step 2: Translate manually**

Translate script comments and console output to English. Preserve command syntax, file paths, package names, and generated asset schema.

- [ ] **Step 3: Verify scripts/docs**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git diff -- scripts README.md packages/client/vite.config.ts package.json
git add scripts README.md packages/client/vite.config.ts package.json
git commit -m "Translate script comments to English"
```

Expected: no whitespace errors; commit contains only scripts/docs/package metadata.

## Task 6: Historical Superpowers Docs (Optional)

**Files:**
- Modify: `docs/superpowers/**/*.md`
- Modify: `docs/index.html`
- Modify: `assets-manifest.json`

- [ ] **Step 1: Inventory historical docs matches**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" docs assets-manifest.json
```

Expected: old planning notes, implementation plans, and manifest/doc metadata. Some entries may describe old Polish prompts or generated screenshots and should be preserved if they document exact historical input.

- [ ] **Step 2: Decide preservation policy**

For each file, choose one of:

- Translate developer prose to English.
- Preserve exact historical prompt/input text when it is evidence, a fixture, or a project note that must remain literal.
- Delete or archive stale generated planning artifacts only if explicitly approved by the user.

- [ ] **Step 3: Translate manually**

Translate prose and headings to English. Preserve literal prompts, command output, paths, asset ids, URLs, and generated file names.

- [ ] **Step 4: Verify docs**

Run:

```bash
npm test
```

Expected: tests pass. No build step is required unless `docs/index.html` changes.

- [ ] **Step 5: Review and commit**

Run:

```bash
git diff --check
git diff -- docs assets-manifest.json
git add docs assets-manifest.json
git commit -m "Translate historical project docs to English"
```

Expected: no whitespace errors; commit contains only docs/history files.

## Final Verification

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 2: Run final inventory**

Run:

```bash
rg -n "[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]" packages scripts README.md package.json --glob '!packages/client/src/i18n.ts' --glob '!**/i18n-base-language.test.ts' --glob '!**/demo-language.test.ts'
```

Expected: only intentional fixture strings remain. Document those exceptions in the final response.

- [ ] **Step 3: Final review**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree after the final commit, with reviewable translation commits in history.
