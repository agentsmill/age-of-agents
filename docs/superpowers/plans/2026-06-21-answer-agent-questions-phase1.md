# Odpowiadanie na pytania agentów — Faza 1 (hooki) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pozwolić użytkownikowi odpowiadać z panelu aplikacji na prompty uprawnień
i akceptować plany w sesjach Claude Code uruchamianych w jego własnym terminalu,
przez rozszerzone hooki Claude Code.

**Architecture:** Rozszerzony command-shim hooka dla zdarzeń `PreToolUse` blokuje
i POST-uje do nowego endpointu `/hooks/decide`. Serwer klasyfikuje wywołanie
(biała lista bezpiecznych narzędzi / reguły / pytanie do użytkownika), a gdy
potrzeba decyzji człowieka — rejestruje `PendingQuestion`, broadcastuje ją po
WebSocket (teraz dwukierunkowym) i czeka na odpowiedź z panelu, po czym odsyła
shimowi JSON decyzji na stdout. Brak odpowiedzi / wyłączony tryb → defer (terminal
pyta normalnie). Cała interaktywność za przełącznikiem **domyślnie OFF**.

**Tech Stack:** TypeScript, Node 22, Fastify, `ws`, React 19 + Zustand, Vitest.
Pakiet `@agent-citadel/shared` jest konsumowany ze źródła (`exports: ./src/index.ts`),
więc nowe typy w `shared` wymagają tylko re-eksportu z `index.ts` (bez build).

**Spec:** [2026-06-21-answer-agent-questions-design.md](../specs/2026-06-21-answer-agent-questions-design.md)

---

## Mapa plików

Nowe:
- `packages/shared/src/pending.ts` — typy protokołu pytań + polityka uprawnień +
  czysta logika klasyfikacji (`evaluatePolicy`, `classifyHookEvent`, walidatory).
- `packages/server/src/permission-policy.ts` — trwałość polityki
  (`~/.age-of-agents/permission-policy.json`), wzorowane na `mapping-config.ts`.
- `packages/server/src/permission-policy-routes.ts` — GET/PUT `/permission-policy`.
- `packages/server/src/pending-registry.ts` — rejestr wiszących pytań + timeouty.
- `packages/server/src/hook-decide.ts` — most: klasyfikacja → rejestr → JSON decyzji.
- `packages/server/test/permission-policy.test.ts`
- `packages/server/test/permission-policy-config.test.ts`
- `packages/server/test/pending-registry.test.ts`
- `packages/server/test/hook-decide.test.ts`
- `packages/server/test/hooks-install.test.ts`
- `packages/client/src/hud/PendingQuestionCard.tsx`
- `packages/client/src/hud/PanelControlToggle.tsx`

Modyfikowane:
- `packages/shared/src/index.ts` — re-eksport `./pending.js`, dodanie zdarzeń do `GameEvent`.
- `packages/server/src/hooks.ts` — kształt JSON decyzji, per-event timeout, shim z gałęzią blokującą, `needsMigration`.
- `packages/server/src/server.ts` — endpoint `/hooks/decide`, routy polityki, inbound WS, wpięcie `PendingRegistry`.
- `packages/client/src/ws.ts` — wysyłka odpowiedzi (`sendAnswer`).
- `packages/client/src/store.ts` — stan `pending` + obsługa nowych zdarzeń.
- `packages/client/src/hud/SidePanel.tsx` — wpięcie `PendingQuestionCard`.
- `packages/client/src/i18n.ts` — klucze tekstów.

---

## Task 1: Shared — typy i czysta logika (klasyfikacja + polityka)

**Files:**
- Create: `packages/shared/src/pending.ts`
- Modify: `packages/shared/src/index.ts` (re-eksport + `GameEvent`)
- Test: `packages/server/test/permission-policy.test.ts`

- [ ] **Step 1: Napisz failing test**

`packages/server/test/permission-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  evaluatePolicy,
  classifyHookEvent,
  isSafeTool,
  validatePermissionPolicy,
  validateQuestionAnswer,
  DEFAULT_PERMISSION_POLICY,
  type PermissionPolicy,
} from '@agent-citadel/shared';

const enabled = (rules: PermissionPolicy['rules'] = []): PermissionPolicy => ({ enabled: true, rules });

describe('isSafeTool', () => {
  it('read-only tools are safe', () => {
    expect(isSafeTool('Read')).toBe(true);
    expect(isSafeTool('Grep')).toBe(true);
  });
  it('mutating tools are not safe', () => {
    expect(isSafeTool('Bash')).toBe(false);
    expect(isSafeTool('Edit')).toBe(false);
  });
});

describe('evaluatePolicy', () => {
  it('safe tool -> allow', () => {
    expect(evaluatePolicy('Read', undefined, enabled(), 's1')).toBe('allow');
  });
  it('unknown risky tool -> pending', () => {
    expect(evaluatePolicy('Bash', 'rm -rf x', enabled(), 's1')).toBe('pending');
  });
  it('global allow rule (any) -> allow', () => {
    const p = enabled([{ tool: 'Bash', match: 'any', decision: 'allow', scope: 'global' }]);
    expect(evaluatePolicy('Bash', 'whatever', p, 's1')).toBe('allow');
  });
  it('prefix rule matches on detail', () => {
    const p = enabled([{ tool: 'Bash', match: 'prefix', value: 'npm ', decision: 'allow', scope: 'global' }]);
    expect(evaluatePolicy('Bash', 'npm test', p, 's1')).toBe('allow');
    expect(evaluatePolicy('Bash', 'rm -rf', p, 's1')).toBe('pending');
  });
  it('session-scoped rule only applies to that session', () => {
    const p = enabled([{ tool: 'Edit', match: 'any', decision: 'allow', scope: 'session:s1' }]);
    expect(evaluatePolicy('Edit', undefined, p, 's1')).toBe('allow');
    expect(evaluatePolicy('Edit', undefined, p, 's2')).toBe('pending');
  });
  it('deny rule wins over safe list', () => {
    const p = enabled([{ tool: 'Read', match: 'any', decision: 'deny', scope: 'global' }]);
    expect(evaluatePolicy('Read', undefined, p, 's1')).toBe('deny');
  });
});

describe('classifyHookEvent', () => {
  const base = { hookEvent: 'PreToolUse' as const, sessionId: 's1' };
  it('disabled policy -> defer', () => {
    expect(classifyHookEvent({ ...base, tool: 'Bash' }, DEFAULT_PERMISSION_POLICY).action).toBe('defer');
  });
  it('AskUserQuestion -> show-question', () => {
    expect(classifyHookEvent({ ...base, tool: 'AskUserQuestion' }, enabled()).action).toBe('show-question');
  });
  it('ExitPlanMode -> ask-plan', () => {
    expect(classifyHookEvent({ ...base, tool: 'ExitPlanMode' }, enabled()).action).toBe('ask-plan');
  });
  it('risky tool, no rule -> ask-permission', () => {
    expect(classifyHookEvent({ ...base, tool: 'Bash', detail: 'rm' }, enabled()).action).toBe('ask-permission');
  });
  it('safe tool -> allow', () => {
    expect(classifyHookEvent({ ...base, tool: 'Read' }, enabled()).action).toBe('allow');
  });
  it('non-PreToolUse -> defer', () => {
    expect(classifyHookEvent({ hookEvent: 'Stop', sessionId: 's1' }, enabled()).action).toBe('defer');
  });
});

describe('validatePermissionPolicy', () => {
  it('accepts a clean policy', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'allow' }] });
    expect(res.ok).toBe(true);
  });
  it('rejects unknown decision', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'maybe' }] });
    expect(res.ok).toBe(false);
  });
  it('rejects prefix rule without value', () => {
    const res = validatePermissionPolicy({ enabled: true, rules: [{ tool: 'Bash', match: 'prefix', decision: 'allow' }] });
    expect(res.ok).toBe(false);
  });
});

describe('validateQuestionAnswer', () => {
  it('accepts allow always', () => {
    expect(validateQuestionAnswer({ id: 'x', decision: { type: 'allow', scope: 'always' } }).ok).toBe(true);
  });
  it('rejects missing id', () => {
    expect(validateQuestionAnswer({ decision: { type: 'allow' } }).ok).toBe(false);
  });
  it('rejects unknown decision type', () => {
    expect(validateQuestionAnswer({ id: 'x', decision: { type: 'nope' } }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Uruchom test — ma FAIL (brak modułu)**

Run: `npm run test -w @agent-citadel/server -- permission-policy`
Expected: FAIL — `evaluatePolicy is not exported` / import error.

- [ ] **Step 3: Stwórz `packages/shared/src/pending.ts`**

```ts
/** Protocol + pure logic for answering agent questions from the panel. */

// ---- Pending question (server -> client) ----

export type PendingQuestionKind =
  | 'tool-permission'
  | 'plan-approval'
  | 'ask-user-question'
  | 'free-text';

export interface PendingQuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  id: string;
  sessionId: string;
  source: 'hook' | 'sdk';
  kind: PendingQuestionKind;
  tool?: string;
  detail?: string;
  options?: PendingQuestionOption[];
  createdAt: string;
}

// ---- Answer (client -> server) ----

export type QuestionDecision =
  | { type: 'allow'; scope?: 'once' | 'always' }
  | { type: 'deny'; reason?: string }
  | { type: 'approve-plan' }
  | { type: 'reject-plan'; reason?: string }
  | { type: 'select'; optionLabels: string[] }
  | { type: 'text'; text: string };

export interface QuestionAnswer {
  id: string;
  decision: QuestionDecision;
}

// ---- Permission policy (data, editable) ----

export type PolicyMatch = 'any' | 'prefix';

export interface PermissionRule {
  tool: string;
  match: PolicyMatch;
  /** Required when match === 'prefix': matched against the tool detail. */
  value?: string;
  decision: 'allow' | 'deny';
  /** 'global' (default) or `session:<id>`. */
  scope?: string;
}

export interface PermissionPolicy {
  /** Master switch. OFF (default) => app stays a passive observer. */
  enabled: boolean;
  rules: PermissionRule[];
}

export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = { enabled: false, rules: [] };

/** Read-only / non-mutating tools that never need a panel decision. */
export const SAFE_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Glob', 'Grep', 'NotebookRead', 'BashOutput', 'TodoWrite', 'LSP', 'ToolSearch',
]);

export function isSafeTool(tool: string): boolean {
  return SAFE_TOOLS.has(tool);
}

/** Whether a rule applies to this session (global rules always apply). */
function ruleInScope(rule: PermissionRule, sessionId: string): boolean {
  if (!rule.scope || rule.scope === 'global') return true;
  return rule.scope === `session:${sessionId}`;
}

function ruleMatches(rule: PermissionRule, tool: string, detail: string | undefined): boolean {
  if (rule.tool !== tool) return false;
  if (rule.match === 'any') return true;
  if (rule.match === 'prefix') return typeof detail === 'string' && !!rule.value && detail.startsWith(rule.value);
  return false;
}

/**
 * Decide a tool-permission outcome from the policy alone:
 *  - explicit rule (deny wins over allow within the same scope set) -> its decision
 *  - safe-list -> allow
 *  - otherwise -> pending (needs a human)
 * Deny rules are checked before the safe-list so a user can block even a safe tool.
 */
export function evaluatePolicy(
  tool: string,
  detail: string | undefined,
  policy: PermissionPolicy,
  sessionId: string,
): 'allow' | 'deny' | 'pending' {
  const applicable = policy.rules.filter((r) => ruleInScope(r, sessionId) && ruleMatches(r, tool, detail));
  if (applicable.some((r) => r.decision === 'deny')) return 'deny';
  if (applicable.some((r) => r.decision === 'allow')) return 'allow';
  if (isSafeTool(tool)) return 'allow';
  return 'pending';
}

// ---- Hook classification (used by the /hooks/decide route) ----

export interface HookDecideInput {
  hookEvent: string;
  tool?: string;
  detail?: string;
  sessionId: string;
}

export type HookClassification =
  | { action: 'defer' }          // print nothing; normal flow / terminal prompt
  | { action: 'allow' }          // auto-allow (safe-list or rule)
  | { action: 'deny' }           // auto-deny (rule)
  | { action: 'ask-permission' } // register tool-permission pending, block
  | { action: 'ask-plan' }       // register plan-approval pending, block
  | { action: 'show-question' }; // AskUserQuestion: display only, defer to terminal

export function classifyHookEvent(input: HookDecideInput, policy: PermissionPolicy): HookClassification {
  if (input.hookEvent !== 'PreToolUse') return { action: 'defer' };
  if (!policy.enabled) return { action: 'defer' };
  const tool = input.tool;
  if (!tool) return { action: 'defer' };
  if (tool === 'AskUserQuestion') return { action: 'show-question' };
  if (tool === 'ExitPlanMode') return { action: 'ask-plan' };
  const outcome = evaluatePolicy(tool, input.detail, policy, input.sessionId);
  if (outcome === 'allow') return { action: 'allow' };
  if (outcome === 'deny') return { action: 'deny' };
  return { action: 'ask-permission' };
}

// ---- Validators (runtime guards for file + WS input) ----

export function validatePermissionPolicy(
  input: unknown,
): { ok: true; config: PermissionPolicy } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Policy must be an object.' };
  const obj = input as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return { ok: false, error: 'Field "enabled" must be a boolean.' };
  if (!Array.isArray(obj.rules)) return { ok: false, error: 'Missing "rules" array.' };
  const rules: PermissionRule[] = [];
  for (let i = 0; i < obj.rules.length; i++) {
    const raw = obj.rules[i];
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `Rule ${i}: not an object.` };
    const r = raw as Record<string, unknown>;
    if (typeof r.tool !== 'string' || !r.tool) return { ok: false, error: `Rule ${i}: "tool" required.` };
    if (r.match !== 'any' && r.match !== 'prefix') return { ok: false, error: `Rule ${i}: "match" must be any|prefix.` };
    if (r.decision !== 'allow' && r.decision !== 'deny') return { ok: false, error: `Rule ${i}: "decision" must be allow|deny.` };
    const rule: PermissionRule = { tool: r.tool, match: r.match, decision: r.decision };
    if (r.match === 'prefix') {
      if (typeof r.value !== 'string' || !r.value) return { ok: false, error: `Rule ${i}: "prefix" requires "value".` };
      rule.value = r.value;
    }
    if (r.scope !== undefined) {
      if (typeof r.scope !== 'string' || !r.scope) return { ok: false, error: `Rule ${i}: "scope" must be a non-empty string.` };
      rule.scope = r.scope;
    }
    rules.push(rule);
  }
  return { ok: true, config: { enabled: obj.enabled, rules } };
}

export function validateQuestionAnswer(
  input: unknown,
): { ok: true; answer: QuestionAnswer } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Answer must be an object.' };
  const obj = input as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return { ok: false, error: 'Missing "id".' };
  const d = obj.decision as Record<string, unknown> | undefined;
  if (typeof d !== 'object' || d === null) return { ok: false, error: 'Missing "decision".' };
  const t = d.type;
  const known = ['allow', 'deny', 'approve-plan', 'reject-plan', 'select', 'text'];
  if (typeof t !== 'string' || !known.includes(t)) return { ok: false, error: `Unknown decision type ${String(t)}.` };
  return { ok: true, answer: { id: obj.id, decision: d as unknown as QuestionDecision } };
}
```

- [ ] **Step 4: Re-eksport + zdarzenia w `index.ts`**

W `packages/shared/src/index.ts`, dodaj re-eksport tuż pod istniejące (linie 1-3):

```ts
export * from './pending.js';
```

Następnie dodaj nowe warianty do `GameEvent` (po linii z `arsenal-updated`, ~118).
Najpierw zaimportuj typy na górze pliku (rozszerz istniejący import jeśli jest, lub
dodaj osobny — `pending.js` jest już re-eksportowany, więc użyj `import type`):

```ts
import type { PendingQuestion } from './pending.js';
```

I rozszerz unię (zamień zamykającą linię `arsenal-updated`):

```ts
  | { type: 'arsenal-updated'; arsenal: ProjectArsenal }
  | { type: 'pending-question'; question: PendingQuestion }
  | { type: 'pending-question-resolved'; id: string };
```

- [ ] **Step 5: Uruchom test — ma PASS**

Run: `npm run test -w @agent-citadel/server -- permission-policy`
Expected: PASS (wszystkie bloki).

- [ ] **Step 6: Type-check shared + server**

Run: `npm run build -w @agent-citadel/shared && npm run build -w @agent-citadel/server`
Expected: bez błędów typów.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/pending.ts packages/shared/src/index.ts packages/server/test/permission-policy.test.ts
git commit -m "feat(shared): pending-question protocol + permission policy logic"
```

---

## Task 2: Server — trwałość polityki uprawnień + routy

**Files:**
- Create: `packages/server/src/permission-policy.ts`
- Create: `packages/server/src/permission-policy-routes.ts`
- Test: `packages/server/test/permission-policy-config.test.ts`

- [ ] **Step 1: Napisz failing test**

`packages/server/test/permission-policy-config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPermissionPolicy,
  savePermissionPolicy,
  invalidatePermissionPolicyCache,
} from '../src/permission-policy.js';
import { DEFAULT_PERMISSION_POLICY, type PermissionPolicy } from '@agent-citadel/shared';

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aoa-pol-')), 'permission-policy.json');
}

beforeEach(() => invalidatePermissionPolicyCache());

describe('loadPermissionPolicy', () => {
  it('missing file -> DEFAULT (disabled)', async () => {
    expect(await loadPermissionPolicy(tmpPath())).toEqual(DEFAULT_PERMISSION_POLICY);
  });
  it('broken JSON -> DEFAULT', async () => {
    const p = tmpPath();
    writeFileSync(p, 'nope');
    expect(await loadPermissionPolicy(p)).toEqual(DEFAULT_PERMISSION_POLICY);
  });
});

describe('savePermissionPolicy', () => {
  it('saves and reloads', async () => {
    const p = tmpPath();
    const policy: PermissionPolicy = { enabled: true, rules: [{ tool: 'Bash', match: 'any', decision: 'allow' }] };
    await savePermissionPolicy(policy, p);
    expect(await loadPermissionPolicy(p)).toEqual(policy);
  });
  it('rejects invalid policy', async () => {
    await expect(
      savePermissionPolicy({ enabled: 'yes' } as unknown as PermissionPolicy, tmpPath()),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/server -- permission-policy-config`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Stwórz `packages/server/src/permission-policy.ts`**

(Wzorowane 1:1 na `mapping-config.ts`: cache po ścieżce, atomowy zapis, fallback.)

```ts
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  DEFAULT_PERMISSION_POLICY,
  validatePermissionPolicy,
  type PermissionPolicy,
} from '@agent-citadel/shared';

/**
 * Persistence for the permission policy that drives panel-based answering.
 * Source of truth: `~/.age-of-agents/permission-policy.json`. Missing or damaged
 * files fall back to DEFAULT_PERMISSION_POLICY (disabled), so the app stays a
 * passive observer until the user explicitly turns the feature on.
 */

export function defaultPolicyPath(): string {
  return join(homedir(), '.age-of-agents', 'permission-policy.json');
}

const cache = new Map<string, PermissionPolicy>();

export function invalidatePermissionPolicyCache(): void {
  cache.clear();
}

export async function loadPermissionPolicy(path = defaultPolicyPath()): Promise<PermissionPolicy> {
  const hit = cache.get(path);
  if (hit) return hit;

  let policy: PermissionPolicy = DEFAULT_PERMISSION_POLICY;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const res = validatePermissionPolicy(parsed);
    if (res.ok) policy = res.config;
  } catch {
    /* missing file / bad JSON -> DEFAULT */
  }
  cache.set(path, policy);
  return policy;
}

export async function savePermissionPolicy(
  policy: PermissionPolicy,
  path = defaultPolicyPath(),
): Promise<PermissionPolicy> {
  const res = validatePermissionPolicy(policy);
  if (!res.ok) throw new Error(res.error);

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(res.config, null, 2), 'utf8');
  await rename(tmp, path);
  cache.set(path, res.config);
  return res.config;
}

/** Append a rule and persist; used by "allow always". Idempotent on exact duplicates. */
export async function addPolicyRule(
  rule: PermissionPolicy['rules'][number],
  path = defaultPolicyPath(),
): Promise<PermissionPolicy> {
  const current = await loadPermissionPolicy(path);
  const exists = current.rules.some(
    (r) => r.tool === rule.tool && r.match === rule.match && r.value === rule.value && r.scope === rule.scope && r.decision === rule.decision,
  );
  if (exists) return current;
  return savePermissionPolicy({ ...current, rules: [...current.rules, rule] }, path);
}
```

- [ ] **Step 4: Stwórz `packages/server/src/permission-policy-routes.ts`**

(Wzorowane na `mapping-routes.ts`.)

```ts
import type { FastifyInstance } from 'fastify';
import { DEFAULT_PERMISSION_POLICY, validatePermissionPolicy, type PermissionPolicy } from '@agent-citadel/shared';
import { loadPermissionPolicy, savePermissionPolicy } from './permission-policy.js';

export interface PermissionPolicyRoutesOptions {
  persist: boolean;
  policyPath?: string;
}

export function registerPermissionPolicyRoutes(app: FastifyInstance, opts: PermissionPolicyRoutesOptions): void {
  app.get('/permission-policy', async () =>
    opts.persist ? loadPermissionPolicy(opts.policyPath) : DEFAULT_PERMISSION_POLICY,
  );

  app.put('/permission-policy', async (request, reply) => {
    if (!opts.persist) {
      const res = validatePermissionPolicy(request.body);
      if (!res.ok) return reply.code(400).send({ error: res.error });
      return res.config;
    }
    try {
      return await savePermissionPolicy(request.body as PermissionPolicy, opts.policyPath);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid policy' });
    }
  });
}
```

- [ ] **Step 5: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/server -- permission-policy-config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/permission-policy.ts packages/server/src/permission-policy-routes.ts packages/server/test/permission-policy-config.test.ts
git commit -m "feat(server): persist + serve permission policy"
```

---

## Task 3: Server — PendingRegistry

**Files:**
- Create: `packages/server/src/pending-registry.ts`
- Test: `packages/server/test/pending-registry.test.ts`

- [ ] **Step 1: Napisz failing test**

`packages/server/test/pending-registry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import type { PendingQuestion } from '@agent-citadel/shared';

function q(id: string, sessionId = 's1'): PendingQuestion {
  return { id, sessionId, source: 'hook', kind: 'tool-permission', tool: 'Bash', detail: 'rm', createdAt: '2026-06-21T00:00:00Z' };
}

describe('PendingRegistry', () => {
  it('broadcasts on ask and resolves with the answered decision', async () => {
    const world = new World();
    const events: string[] = [];
    world.onEvent((e) => events.push(e.type));
    const reg = new PendingRegistry(world);

    const promise = reg.ask(q('a1'), 5000);
    expect(events).toContain('pending-question');
    expect(reg.resolve({ id: 'a1', decision: { type: 'deny', reason: 'no' } })).toBe(true);

    await expect(promise).resolves.toEqual({ type: 'deny', reason: 'no' });
    expect(events).toContain('pending-question-resolved');
  });

  it('returns null on timeout', async () => {
    vi.useFakeTimers();
    const reg = new PendingRegistry(new World());
    const promise = reg.ask(q('a2'), 1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('resolve of unknown id returns false', () => {
    const reg = new PendingRegistry(new World());
    expect(reg.resolve({ id: 'nope', decision: { type: 'allow' } })).toBe(false);
  });

  it('cancelForSession resolves matching questions with null', async () => {
    const reg = new PendingRegistry(new World());
    const p = reg.ask(q('a3', 's9'), 5000);
    reg.cancelForSession('s9');
    await expect(p).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/server -- pending-registry`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Stwórz `packages/server/src/pending-registry.ts`**

```ts
import type { World } from './world.js';
import type { PendingQuestion, QuestionAnswer, QuestionDecision } from '@agent-citadel/shared';

interface Entry {
  question: PendingQuestion;
  resolve: (decision: QuestionDecision | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Tracks questions awaiting a human answer. Each `ask` broadcasts a
 * `pending-question` event and returns a promise that settles when the user
 * answers (via `resolve`), the session is cancelled, or the timeout fires (null).
 */
export class PendingRegistry {
  private entries = new Map<string, Entry>();

  constructor(private world: World) {}

  ask(question: PendingQuestion, timeoutMs: number): Promise<QuestionDecision | null> {
    return new Promise((resolve) => {
      const settle = (decision: QuestionDecision | null) => {
        const entry = this.entries.get(question.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.entries.delete(question.id);
        this.world.emitCustom({ type: 'pending-question-resolved', id: question.id });
        resolve(decision);
      };
      const timer = setTimeout(() => settle(null), timeoutMs);
      this.entries.set(question.id, { question, resolve: settle, timer });
      this.world.emitCustom({ type: 'pending-question', question });
    });
  }

  /** Resolve from a client answer. Returns false if the id is unknown/expired. */
  resolve(answer: QuestionAnswer): boolean {
    const entry = this.entries.get(answer.id);
    if (!entry) return false;
    entry.resolve(answer.decision);
    return true;
  }

  cancelForSession(sessionId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.question.sessionId === sessionId) entry.resolve(null);
    }
  }

  /** Snapshot of currently open questions (for new clients). */
  open(): PendingQuestion[] {
    return [...this.entries.values()].map((e) => e.question);
  }
}
```

- [ ] **Step 4: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/server -- pending-registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pending-registry.ts packages/server/test/pending-registry.test.ts
git commit -m "feat(server): pending-question registry with timeout"
```

---

## Task 4: Server — kształt JSON decyzji + most decyzyjny

**Files:**
- Modify: `packages/server/src/hooks.ts` (dodaj `decisionToHookOutput`)
- Create: `packages/server/src/hook-decide.ts`
- Test: `packages/server/test/hook-decide.test.ts`

- [ ] **Step 1: Napisz failing test**

`packages/server/test/hook-decide.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '../src/world.js';
import { PendingRegistry } from '../src/pending-registry.js';
import { decideHook } from '../src/hook-decide.js';
import { decisionToHookOutput } from '../src/hooks.js';
import type { PermissionPolicy } from '@agent-citadel/shared';

const on = (rules: PermissionPolicy['rules'] = []): PermissionPolicy => ({ enabled: true, rules });

describe('decisionToHookOutput', () => {
  it('allow shape', () => {
    expect(decisionToHookOutput('allow')).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
  });
  it('deny shape with reason', () => {
    expect(decisionToHookOutput('deny', 'nope')).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'nope' },
    });
  });
});

describe('decideHook', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf x' },
    ...over,
  });

  it('disabled policy -> defer ({})', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: { enabled: false, rules: [] }, registry: reg, timeoutMs: 1000, onAlwaysRule: async () => {} });
    expect(out).toEqual({});
  });

  it('safe tool -> allow output', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body({ tool_name: 'Read', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 1000, onAlwaysRule: async () => {} });
    expect(out).toEqual(decisionToHookOutput('allow'));
  });

  it('risky tool, answered allow -> allow output and persists when scope=always', async () => {
    const reg = new PendingRegistry(new World());
    const saved: unknown[] = [];
    const p = decideHook(body(), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async (r) => { saved.push(r); } });
    // simulate the panel answering
    const open = reg.open();
    expect(open).toHaveLength(1);
    reg.resolve({ id: open[0].id, decision: { type: 'allow', scope: 'always' } });
    expect(await p).toEqual(decisionToHookOutput('allow'));
    expect(saved).toEqual([{ tool: 'Bash', match: 'any', decision: 'allow', scope: 'global' }]);
  });

  it('risky tool, timeout -> defer ({})', async () => {
    const reg = new PendingRegistry(new World());
    const out = await decideHook(body(), { policy: on(), registry: reg, timeoutMs: 1, onAlwaysRule: async () => {} });
    expect(out).toEqual({});
  });

  it('plan approve -> allow; plan reject -> defer', async () => {
    const reg = new PendingRegistry(new World());
    const approve = decideHook(body({ tool_name: 'ExitPlanMode', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    reg.resolve({ id: reg.open()[0].id, decision: { type: 'approve-plan' } });
    expect(await approve).toEqual(decisionToHookOutput('allow'));

    const reject = decideHook(body({ tool_name: 'ExitPlanMode', tool_input: {} }), { policy: on(), registry: reg, timeoutMs: 5000, onAlwaysRule: async () => {} });
    reg.resolve({ id: reg.open()[0].id, decision: { type: 'reject-plan' } });
    expect(await reject).toEqual({});
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/server -- hook-decide`
Expected: FAIL (brak `decideHook`/`decisionToHookOutput`).

- [ ] **Step 3: Dodaj `decisionToHookOutput` do `hooks.ts`**

Na końcu `packages/server/src/hooks.ts` dodaj:

```ts
/** Shapes a Claude Code PreToolUse hook decision for stdout / HTTP response. */
export function decisionToHookOutput(
  decision: 'allow' | 'deny',
  reason?: string,
): { hookSpecificOutput: Record<string, unknown> } {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
}
```

- [ ] **Step 4: Stwórz `packages/server/src/hook-decide.ts`**

```ts
import { randomUUID } from 'node:crypto';
import {
  classifyHookEvent,
  type PermissionPolicy,
  type PermissionRule,
  type PendingQuestion,
} from '@agent-citadel/shared';
import type { PendingRegistry } from './pending-registry.js';
import { decisionToHookOutput } from './hooks.js';
import { toolDetail } from './transcript/parser.js';
import type { HookPayload } from './hooks.js';

export interface DecideDeps {
  policy: PermissionPolicy;
  registry: PendingRegistry;
  /** How long to hold the request open waiting for a human (ms). Keep < hook timeout. */
  timeoutMs: number;
  /** Persist an "allow always" rule. */
  onAlwaysRule: (rule: PermissionRule) => Promise<void>;
}

/**
 * Turns a PreToolUse hook payload into the JSON Claude Code should act on.
 * Returns `{}` for "defer" (print nothing -> normal flow / terminal prompt).
 * Anything blocking goes through the PendingRegistry and waits for the panel.
 */
export async function decideHook(
  body: HookPayload,
  deps: DecideDeps,
): Promise<Record<string, unknown>> {
  const sessionId = body.session_id ?? '';
  const tool = body.tool_name;
  const detail = tool ? toolDetail(tool, body.tool_input) : undefined;
  const classification = classifyHookEvent(
    { hookEvent: body.hook_event_name ?? '', tool, detail, sessionId },
    deps.policy,
  );

  switch (classification.action) {
    case 'defer':
    case 'show-question':
      return {};
    case 'allow':
      return decisionToHookOutput('allow');
    case 'deny':
      return decisionToHookOutput('deny', 'Blocked by panel policy');
    case 'ask-permission': {
      const question: PendingQuestion = {
        id: randomUUID(),
        sessionId,
        source: 'hook',
        kind: 'tool-permission',
        tool,
        detail,
        createdAt: new Date().toISOString(),
      };
      const decision = await deps.registry.ask(question, deps.timeoutMs);
      if (!decision) return {}; // timeout / cancelled -> defer
      if (decision.type === 'deny') return decisionToHookOutput('deny', decision.reason);
      if (decision.type === 'allow') {
        if (decision.scope === 'always' && tool) {
          await deps.onAlwaysRule({ tool, match: 'any', decision: 'allow', scope: 'global' });
        }
        return decisionToHookOutput('allow');
      }
      return {}; // unexpected decision shape -> defer
    }
    case 'ask-plan': {
      const question: PendingQuestion = {
        id: randomUUID(),
        sessionId,
        source: 'hook',
        kind: 'plan-approval',
        tool,
        detail,
        createdAt: new Date().toISOString(),
      };
      const decision = await deps.registry.ask(question, deps.timeoutMs);
      if (decision?.type === 'approve-plan') return decisionToHookOutput('allow');
      return {}; // reject / timeout -> defer to terminal (hooks can't reject with feedback)
    }
  }
}
```

Uwaga: `HookPayload` jest już eksportowany z `hooks.ts` (interfejs). Jeśli nie ma
`export`, dodaj słowo `export` przy `interface HookPayload`.

- [ ] **Step 5: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/server -- hook-decide`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/hooks.ts packages/server/src/hook-decide.ts packages/server/test/hook-decide.test.ts
git commit -m "feat(server): hook decision bridge (classify -> registry -> JSON)"
```

---

## Task 5: Server — shim z gałęzią blokującą + per-event timeout + needsMigration

**Files:**
- Modify: `packages/server/src/hooks.ts`
- Test: `packages/server/test/hooks-install.test.ts`

Cel: dla `PreToolUse` shim POST-uje do `/hooks/decide` i CZEKA (drukując decyzję),
a wpis `PreToolUse` w settings ma `timeout: 600`. Pozostałe zdarzenia bez zmian.

- [ ] **Step 1: Napisz failing test**

`packages/server/test/hooks-install.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildHookEntry, DECIDE_TIMEOUT_SEC } from '../src/hooks.js';

describe('buildHookEntry', () => {
  it('PreToolUse uses the long timeout and the deciding shim', () => {
    const entry = buildHookEntry('PreToolUse');
    expect(entry.hooks[0].timeout).toBe(DECIDE_TIMEOUT_SEC);
    expect(entry.hooks[0].command).toContain('/hooks/decide');
    expect(entry.matcher).toBe('*');
  });
  it('Stop uses the fast timeout and no matcher', () => {
    const entry = buildHookEntry('Stop');
    expect(entry.hooks[0].timeout).toBe(1);
    expect(entry.matcher).toBeUndefined();
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/server -- hooks-install`
Expected: FAIL (brak `buildHookEntry`/`DECIDE_TIMEOUT_SEC`).

- [ ] **Step 3: Refaktor `hooks.ts` — wyodrębnij budowę wpisu i shim**

W `packages/server/src/hooks.ts`:

a) Dodaj stałe i URL decyzji obok `HOOK_URL` (~linia 14-17):

```ts
export const DECIDE_URL = `http://localhost:${SERVER_PORT}/hooks/decide`;
/** PreToolUse blocks while the panel answers; give it room (seconds). */
export const DECIDE_TIMEOUT_SEC = 600;
const BLOCKING_EVENTS = new Set(['PreToolUse']);
```

b) Zastąp `hookCommand()` wariantem parametryzowanym zdarzeniem. Blokujący shim
czyta stdin, POST-uje do `/hooks/decide`, czeka i drukuje `hookSpecificOutput`
gdy jest; w razie błędu/braku — milczy (defer). Nie-blokujący jak dotychczas.

```ts
function blockingShim(): string {
  const script = [
    `const url=${JSON.stringify(DECIDE_URL)}`,
    `let body=''`,
    `process.stdin.setEncoding('utf8')`,
    `process.stdin.on('data', c => { body += c })`,
    `process.stdin.on('end', async () => {`,
    `  try {`,
    `    const res = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body, signal: AbortSignal.timeout(${DECIDE_TIMEOUT_SEC * 1000 - 5000}) })`,
    `    const out = await res.json()`,
    `    if (out && out.hookSpecificOutput) process.stdout.write(JSON.stringify(out))`,
    `  } catch {}`,
    `  process.exit(0)`,
    `})`,
  ].join(';');
  return `node -e ${JSON.stringify(script)}`;
}

function fireAndForgetShim(): string {
  const script = [
    `const marker=${JSON.stringify(HOOK_COMMAND_MARKER)}`,
    `const url=${JSON.stringify(HOOK_URL)}`,
    `let body=''`,
    `process.stdin.setEncoding('utf8')`,
    `process.stdin.on('data', c => { body += c })`,
    `process.stdin.on('end', async () => {`,
    `  void marker`,
    `  try {`,
    `    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(300) })`,
    `  } catch {}`,
    `  process.exit(0)`,
    `})`,
    `setTimeout(() => process.exit(0), 600)`,
  ].join(';');
  return `node -e ${JSON.stringify(script)}`;
}
```

Uwaga: oba shimy zawierają marker `age-of-agents-hook-shim` do rozpoznawania
naszych wpisów. Blokujący shim ma marker w `DECIDE_URL`? Nie — `DECIDE_URL` nie
zawiera markera. Dlatego rozpoznawanie naszych wpisów oprzyj na obecności
`HOOK_COMMAND_MARKER` **lub** `DECIDE_URL` (patrz `isOursCommand` niżej), albo
dołóż marker jako komentarz. Najprościej: w blokującym shimie dodaj na początku
`const marker=${JSON.stringify(HOOK_COMMAND_MARKER)};void marker;` — wtedy
`command.includes(HOOK_COMMAND_MARKER)` działa bez zmian. Dodaj tę linię.

c) Wprowadź `buildHookEntry(event)`:

```ts
export function buildHookEntry(event: string): HookEntry {
  const blocking = BLOCKING_EVENTS.has(event);
  const entry: HookEntry = {
    hooks: [{ type: 'command', command: blocking ? blockingShim() : fireAndForgetShim(), timeout: blocking ? DECIDE_TIMEOUT_SEC : 1 }],
  };
  if (MATCHER_EVENTS.has(event)) entry.matcher = '*';
  return entry;
}
```

d) Przepisz `installHooks()` aby używał `buildHookEntry(event)`:

```ts
    if (entries.some(isOursCommand)) continue;
    settings.hooks[event] = entries.filter((entry) => !isOurs(entry));
    settings.hooks[event].push(buildHookEntry(event));
```

e) Rozszerz `isOursCommand` o rozpoznanie blokującego shimu (zawiera `DECIDE_URL`),
na wszelki wypadek:

```ts
function isOursCommand(entry: HookEntry): boolean {
  return entry.hooks?.some(
    (h) => h.type === 'command' && (h.command?.includes(HOOK_COMMAND_MARKER) || h.command?.includes('/hooks/decide')),
  ) ?? false;
}
```

f) `needsMigration`: wykryj nasz `PreToolUse` bez długiego timeoutu (stara instalacja).
W `hooksStatus()` dodaj sprawdzenie po pętli `installed`:

```ts
  // Old installs route PreToolUse through the fire-and-forget shim (timeout 1):
  // they cannot answer from the panel. Flag for reinstall.
  const pre: HookEntry[] = settings.hooks?.PreToolUse ?? [];
  const preStale = pre.some(
    (e) => e.hooks?.some((h) => h.type === 'command' && h.command?.includes(HOOK_COMMAND_MARKER) && (h.timeout ?? 1) < 60),
  );
  return { installed, needsMigration: hasLegacy || (hasAny && !installed) || preStale };
```

- [ ] **Step 4: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/server -- hooks-install`
Expected: PASS.

- [ ] **Step 5: Type-check serwera**

Run: `npm run build -w @agent-citadel/server`
Expected: bez błędów.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/hooks.ts packages/server/test/hooks-install.test.ts
git commit -m "feat(server): blocking PreToolUse shim + per-event hook timeouts"
```

---

## Task 6: Server — wpięcie endpointu /hooks/decide, routów polityki i inbound WS

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/test/hooks-decide-route.test.ts`

- [ ] **Step 1: Napisz failing test (Fastify inject + decyzja po WS)**

`packages/server/test/hooks-decide-route.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { WS_PATH, type GameEvent, type PendingQuestion } from '@agent-citadel/shared';
import { startServer } from '../src/server.js';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

function policyFile(enabled: boolean): string {
  const p = join(mkdtempSync(join(tmpdir(), 'aoa-pol-')), 'permission-policy.json');
  writeFileSync(p, JSON.stringify({ enabled, rules: [] }));
  return p;
}

describe('/hooks/decide', () => {
  it('disabled policy -> {} (defer)', async () => {
    server = await startServer({ port: 0, demo: false, policyPath: policyFile(false) });
    const res = await fetch(`${server.url}/hooks/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm' } }),
    });
    expect(await res.json()).toEqual({});
  });

  it('enabled + WS answer allow -> allow decision', async () => {
    server = await startServer({ port: 0, demo: false, policyPath: policyFile(true) });
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}${WS_PATH}`);
    const pending = new Promise<PendingQuestion>((resolve) => {
      ws.on('message', (data) => {
        const ev = JSON.parse(String(data)) as GameEvent;
        if (ev.type === 'pending-question') resolve(ev.question);
      });
    });
    await new Promise((r) => ws.on('open', r));

    const decide = fetch(`${server.url}/hooks/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm' } }),
    });

    const q = await pending;
    ws.send(JSON.stringify({ type: 'answer', payload: { id: q.id, decision: { type: 'allow' } } }));

    const out = await (await decide).json();
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
    ws.close();
  });
});
```

(Uwaga: `startServer` zyskuje opcjonalne `policyPath` — patrz Step 3.)

- [ ] **Step 2: Uruchom — FAIL**

Run: `npm run test -w @agent-citadel/server -- hooks-decide-route`
Expected: FAIL (brak `/hooks/decide`, brak `policyPath`, brak inbound WS).

- [ ] **Step 3: Edytuj `server.ts`**

a) Rozszerz `StartServerOptions` o `policyPath?: string` (po `webRoot?`):

```ts
  /** Override permission-policy file path (tests). Defaults to ~/.age-of-agents. */
  policyPath?: string;
```

b) Importy (góra pliku):

```ts
import { PendingRegistry } from './pending-registry.js';
import { registerPermissionPolicyRoutes } from './permission-policy-routes.js';
```

c) Utwórz rejestr obok `world` (po `const world = new World();`):

```ts
  const pendingRegistry = new PendingRegistry(world);
```

d) W gałęzi `else` (real mode), po `registerModelRoutes(app, { persist: true })`,
dodaj routy polityki, import mostu i endpoint decyzji:

```ts
    const { decideHook } = await import('./hook-decide.js');
    const { loadPermissionPolicy, addPolicyRule } = await import('./permission-policy.js');
    registerPermissionPolicyRoutes(app, { persist: true, policyPath: opts.policyPath });

    app.post('/hooks/decide', async (request) => {
      const body = (request.body ?? {}) as never;
      // Animate the tool like the regular /hooks channel does.
      const translated = translateHook(body);
      if (translated && claudeWatcher) {
        claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts, translated.cwd);
      }
      const policy = await loadPermissionPolicy(opts.policyPath);
      return decideHook(body, {
        policy,
        registry: pendingRegistry,
        timeoutMs: (DECIDE_TIMEOUT_SEC - 10) * 1000,
        onAlwaysRule: async (rule) => { await addPolicyRule(rule, opts.policyPath); },
      });
    });
```

Dodaj import `DECIDE_TIMEOUT_SEC` do istniejącego importu z `./hooks.js`:

```ts
    const { translateHook, hooksStatus, installHooks, uninstallHooks, DECIDE_TIMEOUT_SEC } = await import('./hooks.js');
```

e) Demo mode: dodaj no-op, żeby shim nie dostawał 404 (obok istniejących demo routów):

```ts
    app.post('/hooks/decide', async () => ({}));
    registerPermissionPolicyRoutes(app, { persist: false });
```

f) Inbound WS: w `wss.on('connection', ...)` dodaj handler wiadomości i wyślij
otwarte pytania nowemu klientowi:

```ts
  wss.on('connection', (socket) => {
    send(socket, { type: 'snapshot', ...world.snapshot() });
    for (const q of pendingRegistry.open()) send(socket, { type: 'pending-question', question: q });
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; payload?: unknown };
        if (msg.type === 'answer') {
          const res = validateQuestionAnswer(msg.payload);
          if (res.ok) pendingRegistry.resolve(res.answer);
        }
      } catch {
        /* ignore malformed client messages */
      }
    });
  });
```

Dodaj import na górze:

```ts
import { WS_PATH, type GameEvent, validateQuestionAnswer } from '@agent-citadel/shared';
```

g) W `close()` dodaj sprzątanie wiszących pytań (best-effort) — opcjonalne, ale
porządne: dla każdego hero brak; pominąć (registry timeouty same wygasną).

- [ ] **Step 4: Uruchom — PASS**

Run: `npm run test -w @agent-citadel/server -- hooks-decide-route`
Expected: PASS (oba przypadki). Jeśli flaky przez realny WS — zwiększ tylko ten test.

- [ ] **Step 5: Pełny zestaw testów serwera + build**

Run: `npm run test -w @agent-citadel/server && npm run build -w @agent-citadel/server`
Expected: wszystko zielone.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/test/hooks-decide-route.test.ts
git commit -m "feat(server): /hooks/decide endpoint + bidirectional WS answers"
```

---

## Task 7: Client — wysyłka odpowiedzi po WS + stan pending w store

**Files:**
- Modify: `packages/client/src/ws.ts`
- Modify: `packages/client/src/store.ts`

(Brak infrastruktury testów klienta — weryfikacja typami + w przeglądarce w Task 9.)

- [ ] **Step 1: `ws.ts` — utrzymaj socket i eksportuj `sendAnswer`**

Zamień zawartość `packages/client/src/ws.ts` na (zachowuje auto-reconnect):

```ts
import { WS_PATH, type GameEvent, type QuestionAnswer } from '@agent-citadel/shared';
import { useWorld } from './store';

let current: WebSocket | undefined;

/** WS connection with auto-reconnect; the snapshot on each connection overwrites state. */
export function connectWorld(): void {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}${WS_PATH}`;
  let retryMs = 1000;

  const open = () => {
    const socket = new WebSocket(url);
    current = socket;
    socket.onopen = () => {
      retryMs = 1000;
      useWorld.getState().setConnected(true);
    };
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as GameEvent;
      useWorld.getState().apply(event);
    };
    socket.onclose = () => {
      if (current === socket) current = undefined;
      useWorld.getState().setConnected(false);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  };

  open();
}

/** Sends a panel answer to a pending agent question. No-op if disconnected. */
export function sendAnswer(answer: QuestionAnswer): void {
  if (current && current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify({ type: 'answer', payload: answer }));
  }
}
```

- [ ] **Step 2: `store.ts` — dodaj stan `pending` i obsługę zdarzeń**

a) Import typu (rozszerz istniejący import z shared):

```ts
import type {
  GameEvent,
  HeroSnapshot,
  MissionSnapshot,
  PeonSnapshot,
  PendingQuestion,
  ProjectArsenal,
  TranscriptLine,
} from '@agent-citadel/shared';
```

b) W interfejsie `WorldStore` dodaj pole (po `arsenal`):

```ts
  /** Open agent questions awaiting a panel answer, keyed by question id. */
  pending: Record<string, PendingQuestion>;
```

c) W stanie początkowym (po `arsenal: {}`):

```ts
  pending: {},
```

d) W `apply`, w `case 'snapshot'` zwróć też `pending: {}` (snapshot resetuje stan;
serwer dośle otwarte pytania osobnymi zdarzeniami `pending-question`):

```ts
            arsenal: Object.fromEntries((event.arsenals ?? []).map((a) => [a.projectDir, a])),
            pending: {},
```

e) Dodaj nowe case'y przed `default:`:

```ts
        case 'pending-question':
          return { pending: { ...state.pending, [event.question.id]: event.question } };
        case 'pending-question-resolved': {
          const pending = { ...state.pending };
          delete pending[event.id];
          return { pending };
        }
```

f) W `case 'hero-removed'` usuń też pending tego hero (po obliczeniu `heroes`):

```ts
        case 'hero-removed': {
          const heroes = { ...state.heroes };
          delete heroes[event.sessionId];
          const pending = Object.fromEntries(
            Object.entries(state.pending).filter(([, q]) => q.sessionId !== event.sessionId),
          );
          if (state.selectedSessionId === event.sessionId) {
            return { heroes, pending, selectedSessionId: undefined, autofollow: false };
          }
          return { heroes, pending };
        }
```

- [ ] **Step 3: Type-check klienta**

Run: `npm run build -w @agent-citadel/client`
Expected: bez błędów typów (TypeScript; build = `tsc` + Vite).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/ws.ts packages/client/src/store.ts
git commit -m "feat(client): pending-question store state + WS answer channel"
```

---

## Task 8: Client — i18n dla nowego UI

**Files:**
- Modify: `packages/client/src/i18n.ts`

- [ ] **Step 1: Dodaj klucze tekstów**

W `packages/client/src/i18n.ts` znajdź obiekty tłumaczeń (en/pl/it) i dodaj do
KAŻDEGO z nich poniższe klucze (wartości odpowiednio per język). Zachowaj istniejący
kształt typu `Ui` — jeśli jest jawny interfejs `Ui`, dodaj tam te pola jako `string`.

EN:
```ts
  pqPermissionTitle: 'Permission request',
  pqPlanTitle: 'Plan ready for approval',
  pqQuestionTitle: 'Agent question',
  pqAllow: 'Allow',
  pqAllowAlways: 'Always allow',
  pqDeny: 'Deny',
  pqApprovePlan: 'Approve',
  pqRejectPlan: 'Reject',
  pqAnswerInTerminal: 'Answer in the terminal',
  pqPanelControl: 'Answer prompts in panel',
  pqPanelControlOn: 'Panel answering: ON',
  pqPanelControlOff: 'Panel answering: OFF',
```

PL:
```ts
  pqPermissionTitle: 'Prośba o uprawnienie',
  pqPlanTitle: 'Plan do akceptacji',
  pqQuestionTitle: 'Pytanie agenta',
  pqAllow: 'Pozwól',
  pqAllowAlways: 'Pozwól zawsze',
  pqDeny: 'Odmów',
  pqApprovePlan: 'Akceptuj',
  pqRejectPlan: 'Odrzuć',
  pqAnswerInTerminal: 'Odpowiedz w terminalu',
  pqPanelControl: 'Odpowiadaj na prompty w panelu',
  pqPanelControlOn: 'Odpowiadanie w panelu: WŁ.',
  pqPanelControlOff: 'Odpowiadanie w panelu: WYŁ.',
```

IT:
```ts
  pqPermissionTitle: 'Richiesta di permesso',
  pqPlanTitle: 'Piano da approvare',
  pqQuestionTitle: 'Domanda dell’agente',
  pqAllow: 'Consenti',
  pqAllowAlways: 'Consenti sempre',
  pqDeny: 'Nega',
  pqApprovePlan: 'Approva',
  pqRejectPlan: 'Rifiuta',
  pqAnswerInTerminal: 'Rispondi nel terminale',
  pqPanelControl: 'Rispondi ai prompt nel pannello',
  pqPanelControlOn: 'Risposta nel pannello: ON',
  pqPanelControlOff: 'Risposta nel pannello: OFF',
```

- [ ] **Step 2: Type-check**

Run: `npm run build -w @agent-citadel/client`
Expected: bez błędów (wszystkie języki mają komplet kluczy).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/i18n.ts
git commit -m "feat(client): i18n strings for pending-question UI"
```

---

## Task 9: Client — karta pytania w panelu + przełącznik trybu

**Files:**
- Create: `packages/client/src/hud/PendingQuestionCard.tsx`
- Create: `packages/client/src/hud/PanelControlToggle.tsx`
- Modify: `packages/client/src/hud/SidePanel.tsx`

- [ ] **Step 1: Stwórz `PendingQuestionCard.tsx`**

```tsx
import { useMemo } from 'react';
import type { PendingQuestion } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { sendAnswer } from '../ws';
import { clip } from '../util';

/** Card shown in the side panel when the selected hero has an open question. */
export function PendingQuestionCard({ sessionId }: { sessionId: string }) {
  const pending = useWorld((s) => s.pending);
  const t = useUi();
  const question: PendingQuestion | undefined = useMemo(
    () => Object.values(pending).find((q) => q.sessionId === sessionId),
    [pending, sessionId],
  );
  if (!question) return null;

  const title =
    question.kind === 'plan-approval' ? t.pqPlanTitle
    : question.kind === 'ask-user-question' ? t.pqQuestionTitle
    : t.pqPermissionTitle;

  return (
    <div
      style={{
        background: '#ef9f2722',
        boxShadow: 'inset 2px 0 0 #ef9f27, inset 0 0 0 1px #00000022',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <b style={{ color: '#ef9f27' }}>{title}</b>
      </div>

      {(question.tool || question.detail) && (
        <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.9, wordBreak: 'break-word' }}>
          {question.tool ? <b>{question.tool}</b> : null}
          {question.detail ? <span> · {clip(question.detail, 120)}</span> : null}
        </div>
      )}

      {question.kind === 'tool-permission' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'allow', scope: 'once' } })}>{t.pqAllow}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'allow', scope: 'always' } })}>{t.pqAllowAlways}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'deny' } })}>{t.pqDeny}</button>
        </div>
      )}

      {question.kind === 'plan-approval' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'approve-plan' } })}>{t.pqApprovePlan}</button>
          <button className="ghost" onClick={() => sendAnswer({ id: question.id, decision: { type: 'reject-plan' } })}>{t.pqRejectPlan}</button>
        </div>
      )}

      {question.kind === 'ask-user-question' && (
        <div style={{ opacity: 0.7, fontSize: 12 }}>{t.pqAnswerInTerminal}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Stwórz `PanelControlToggle.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { PermissionPolicy } from '@agent-citadel/shared';
import { useUi } from '../i18n';

/** Global ON/OFF for panel-based answering. Reads/writes /permission-policy. */
export function PanelControlToggle() {
  const [policy, setPolicy] = useState<PermissionPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useUi();

  useEffect(() => {
    fetch('/permission-policy')
      .then((r) => r.json())
      .then((p: PermissionPolicy) => setPolicy(p))
      .catch(() => setPolicy(null));
  }, []);

  if (!policy) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const next = { ...policy, enabled: !policy.enabled };
      const res = await fetch('/permission-policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (res.ok) setPolicy(await res.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="ghost" disabled={busy} onClick={toggle} title={t.pqPanelControl}>
      {policy.enabled ? t.pqPanelControlOn : t.pqPanelControlOff}
    </button>
  );
}
```

- [ ] **Step 3: Wepnij kartę w `SidePanel.tsx`**

a) Import (po istniejących importach komponentów, ~linia 16):

```tsx
import { PendingQuestionCard } from './PendingQuestionCard';
```

b) Wstaw kartę zaraz pod blokiem statusu (po `</div>` zamykającym blok stanu z
emoji, czyli po linii ~174, przed gridem `StatTile`):

```tsx
      <PendingQuestionCard sessionId={selected} />
```

(`selected` jest tu już zawężone do `string` przez wcześniejszy `if (!selected || !hero) return null;`.)

- [ ] **Step 4: Wepnij przełącznik obok `HooksPanel`**

Znajdź miejsce renderu `<HooksPanel />` (grep) i dodaj obok `<PanelControlToggle />`:

Run: `grep -rn "HooksPanel" packages/client/src`
Następnie w tym pliku dodaj import i komponent obok:

```tsx
import { PanelControlToggle } from './hud/PanelControlToggle'; // dostosuj ścieżkę względną
...
<HooksPanel />
<PanelControlToggle />
```

- [ ] **Step 5: Build klienta**

Run: `npm run build -w @agent-citadel/client`
Expected: bez błędów.

- [ ] **Step 6: Weryfikacja w przeglądarce (preview)**

1. Uruchom dev: `npm run dev` (serwer 8123 + klient 5173).
2. W kliencie włącz „Odpowiadanie w panelu" (przełącznik obok hooków).
3. Zasymuluj pytanie bez realnej sesji — wstrzyknij zdarzenie do store przez konsolę:
   ```js
   __world.getState().apply({ type: 'pending-question', question: { id: 'demo1', sessionId: Object.keys(__world.getState().heroes)[0], source: 'hook', kind: 'tool-permission', tool: 'Bash', detail: 'rm -rf build/', createdAt: new Date().toISOString() } })
   ```
   (Wymaga zaznaczonego bohatera; jeśli brak — uruchom `npm run demo` by mieć bohaterów.)
4. Potwierdź: karta „Prośba o uprawnienie" z `Bash · rm -rf build/` i przyciskami
   Pozwól / Pozwól zawsze / Odmów. Kliknięcie wysyła `answer` (sprawdź w Network/WS),
   karta znika po `pending-question-resolved`.
5. Zrzut ekranu do dowodu.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/hud/PendingQuestionCard.tsx packages/client/src/hud/PanelControlToggle.tsx packages/client/src/hud/SidePanel.tsx
# oraz plik, w którym wpięto PanelControlToggle obok HooksPanel
git commit -m "feat(client): pending-question card + panel-control toggle"
```

---

## Task 10: E2E ręczny + dokumentacja prywatności

**Files:**
- Modify: `README.md` (sekcja Privacy)

- [ ] **Step 1: Test E2E z realną sesją Claude Code**

1. `npm run dev`.
2. W kliencie: zainstaluj/zreinstaluj hooki (przycisk hooków — `needsMigration`
   powinno proponować naprawę po zmianie shimu) i włącz „Odpowiadanie w panelu".
3. W osobnym terminalu uruchom `claude` w katalogu objętym watcherem; poproś o coś
   wymagającego `Bash` (np. „uruchom `ls`").
4. Potwierdź: zamiast promptu w terminalu pojawia się karta w panelu; „Pozwól"
   pozwala wykonać; „Pozwól zawsze" zapisuje regułę (`~/.age-of-agents/permission-policy.json`)
   i kolejne `Bash` nie pytają.
5. Wyłącz przełącznik → terminal znów pyta normalnie (defer). Zamknij appkę w trakcie
   promptu → po ~590 s defer; albo od razu: brak appki → shim milczy → terminal pyta.

- [ ] **Step 2: Zaktualizuj sekcję Privacy w README**

Dodaj akapit (po istniejących punktach Privacy):

```md
- **Optional interactive mode (off by default).** You can let the panel answer
  Claude Code permission prompts and plan approvals via local hooks. It stays
  127.0.0.1-only; with the mode off, Age of Agents remains a passive read-only
  observer. When on, unanswered prompts (timeout or app closed) always fall back
  to the terminal — the app never auto-allows. "Always allow" rules live in
  `~/.age-of-agents/permission-policy.json` (the app never edits `~/.claude/settings.json`).
```

- [ ] **Step 3: Pełny zestaw testów + build całości**

Run: `npm test && npm run build`
Expected: serwer + klient zielone, build przechodzi.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document optional interactive (panel answering) mode"
```

---

## Self-review (wykonane przy pisaniu planu)

- **Pokrycie specu:** §3 (typy+WS+rejestr) → Task 1,3,7; §4.1 (przełącznik+biała
  lista+autorytet) → Task 1,5,6,9; §4.2 (shim) → Task 5; §4.3 (endpoint) → Task 4,6;
  §4.4 (store reguł) → Task 2; §4.5 (plan) → Task 4 (approve=allow, reject=defer);
  §4.6 (AskUserQuestion read-only) → Task 9 (`ask-user-question` branch + defer);
  §4.7 (UI) → Task 9; §6 (prywatność) → Task 10. **Świadome uproszczenia MVP vs spec:**
  `PermissionRequest` pominięty — `ExitPlanMode` obsłużony przez `PreToolUse` (prostsze,
  jednolite); jeśli `allow` na `PreToolUse` nie zatwierdzi planu w praktyce, dołożyć
  hook `PermissionRequest` (Task 5/6) — odnotowane jako ryzyko do weryfikacji w Task 1 E2E.
- **Placeholdery:** brak „TBD/TODO"; każdy krok z kodem ma kod. UI klienta bez
  unit-testów (brak infry test. klienta w repo) — świadomie zastąpione weryfikacją
  w przeglądarce (Task 9 Step 6, Task 10 Step 1).
- **Spójność typów:** `PendingQuestion`, `QuestionAnswer`, `QuestionDecision`,
  `PermissionPolicy`, `PermissionRule`, `classifyHookEvent`, `evaluatePolicy`,
  `decisionToHookOutput`, `decideHook`, `DECIDE_TIMEOUT_SEC`, `buildHookEntry`,
  `sendAnswer`, store `pending` — nazwy użyte spójnie między zadaniami.

## Ryzyka / do potwierdzenia w trakcie

- `PreToolUse allow` vs zatwierdzanie `ExitPlanMode` — zweryfikować empirycznie
  (fallback: `PermissionRequest`).
- Reguły `deny`/`ask` w `~/.claude/settings.json` użytkownika mają pierwszeństwo
  nad `allow` z hooka — przy włączonym trybie zalecić, by nie trzymać tam twardych
  reguł na narzędzia obsługiwane z panelu (nota w UI/README — opcjonalnie).
- Realny WS w teście Task 6 może być wrażliwy na timing — w razie flaky podnieść
  tylko ten przypadek lub przetestować inbound przez bezpośrednie wywołanie handlera.
```
