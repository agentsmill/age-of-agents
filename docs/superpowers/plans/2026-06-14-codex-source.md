# Źródło Codex (wieloagentowość, Faza 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizualizować sesje Codex obok Claude w tym samym świecie RTS — nowe „źródło" produkujące znormalizowane `Fact[]`, plus odznaka odróżniająca agenta.

**Architecture:** Lekki rejestr adapterów `AgentSource` (id, roots, classify, parseLine). Jeden `SourceWatcher` na adapter, oba piszą do wspólnego `World`. Rdzeń gry (maszyna stanów, świat, klient) konsumuje `Fact[]` i nie zna formatu — Codex wpina się przez nowy parser. Odznaka agenta w `HeroSnapshot.agent`.

**Tech Stack:** TypeScript (ESM, node ≥22), Fastify + ws (serwer), chokidar (watcher), Vite + React 19 + PixiJS v8 (klient), Vitest.

Spec: [docs/superpowers/specs/2026-06-14-codex-source-design.md](../specs/2026-06-14-codex-source-design.md)

**Polecenia testów:** `npm run test -w @agent-citadel/server` · `npm run test -w @agent-citadel/client` · build: `npm run build`.

---

## Task 1: shared — typ `AgentKind` i pole `agent`

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Dodaj typ `AgentKind` i pole `agent` w `HeroSnapshot`**

W `packages/shared/src/index.ts`, tuż przed `export type HeroStateKind` dodaj:

```ts
/** Który CLI wygenerował sesję — steruje odznaką bohatera i mapowaniem narzędzi. */
export type AgentKind = 'claude' | 'codex'; // | 'opencode' (Faza 2)
```

W interfejsie `HeroSnapshot`, zaraz po `sessionId: string;` dodaj:

```ts
  /** Pochodzenie sesji (Claude/Codex). Brak → traktuj jak 'claude' (zgodność wsteczna). */
  agent?: AgentKind;
```

- [ ] **Step 2: Zbuduj shared (weryfikacja typów)**

Run: `npm run build -w @agent-citadel/shared`
Expected: build OK, brak błędów TS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): typ AgentKind + pole agent w HeroSnapshot"
```

---

## Task 2: Fakt `usage-total` + `agent` w maszynie stanów

Codex raportuje tokeny **kumulatywnie** (suma sesji), więc potrzebny fakt, który USTAWIA tokeny zamiast dodawać. Przy okazji `SessionTracker` dostaje pochodzenie agenta.

**Files:**
- Modify: `packages/server/src/transcript/facts.ts`
- Modify: `packages/server/src/state-machine.ts`
- Test: `packages/server/test/state-machine.test.ts`

- [ ] **Step 1: Napisz failujące testy**

W `packages/server/test/state-machine.test.ts` dodaj wewnątrz `describe('SessionTracker', …)` dwa testy:

```ts
  it('usage-total USTAWIA tokeny (kumulatywne, nie sumuje)', () => {
    const { world, tracker } = setup();
    tracker.apply({ kind: 'usage-total', input: 100, output: 40 });
    tracker.apply({ kind: 'usage-total', input: 250, output: 90 });
    expect(world.getHero('sesja-1')?.tokens).toEqual({ input: 250, output: 90 });
  });

  it('agent z konstruktora ląduje w HeroSnapshot', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sesja-cx', 'projekt-x', DEFAULT_THRESHOLDS, 'codex');
    tracker.apply({ kind: 'prompt', text: 'Zrób coś', ts: '2026-06-14T10:00:00.000Z' });
    expect(world.getHero('sesja-cx')?.agent).toBe('codex');
  });
```

- [ ] **Step 2: Uruchom testy — mają failować**

Run: `npm run test -w @agent-citadel/server`
Expected: FAIL — `usage-total` nie istnieje w typie `Fact`; piąty arg konstruktora nieobsłużony / `agent` undefined.

- [ ] **Step 3: Dodaj wariant faktu `usage-total`**

W `packages/server/src/transcript/facts.ts`, w unii `Fact`, po linii `| { kind: 'usage'; messageId: string; input: number; output: number }` dodaj:

```ts
  | { kind: 'usage-total'; input: number; output: number }
```

- [ ] **Step 4: Obsłuż `agent` i `usage-total` w `SessionTracker`**

W `packages/server/src/state-machine.ts`:

(a) Zaktualizuj import typu (góra pliku):

```ts
import type { ActionEntry, AgentKind, HeroSnapshot, HeroStateKind } from '@agent-citadel/shared';
```

(b) Dodaj piąty parametr konstruktora (po `thresholds`):

```ts
  constructor(
    private readonly world: World,
    private readonly sessionId: string,
    private readonly projectDir: string,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
    private readonly agent: AgentKind = 'claude',
  ) {}
```

(c) W metodzie `hero()`, w zwracanym obiekcie, po `sessionId: this.sessionId,` dodaj:

```ts
      agent: this.agent,
```

(d) W `apply()`, w `switch (fact.kind)`, po bloku `case 'usage':` (przed `case 'tool-result':`) dodaj:

```ts
      case 'usage-total':
        // Codex: token_count jest kumulatywny → USTAW, nie dodawaj.
        this.tokens = { input: fact.input, output: fact.output };
        this.patch({ tokens: this.tokens });
        break;
```

- [ ] **Step 5: Uruchom testy — mają przejść**

Run: `npm run test -w @agent-citadel/server`
Expected: PASS (wszystkie, w tym dwa nowe).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/transcript/facts.ts packages/server/src/state-machine.ts packages/server/test/state-machine.test.ts
git commit -m "feat(state): fakt usage-total (kumulatywne tokeny) + agent w SessionTracker"
```

---

## Task 3: Interfejs `AgentSource` + ekstrakcja źródła Claude

Wyciągamy logikę specyficzną dla Claude (root, classify, parser) za interfejs, bez zmiany zachowania. Watcher jeszcze tego nie używa (Task 6) — tu tylko tworzymy moduły.

**Files:**
- Create: `packages/server/src/sources/types.ts`
- Create: `packages/server/src/sources/claude.ts`

- [ ] **Step 1: Utwórz `sources/types.ts`**

```ts
import type { AgentKind } from '@agent-citadel/shared';
import type { Fact } from '../transcript/facts.js';

export type { AgentKind };

/** Wynik klasyfikacji pliku przez źródło: sesja (bohater), subagent (peon) lub nieistotny. */
export interface ClassifiedFile {
  kind: 'session' | 'subagent' | 'other';
  sessionId?: string;
  projectDir?: string;
  agentId?: string; // subagent
  parentSessionId?: string; // subagent
}

/**
 * Adapter jednego CLI (Claude/Codex). Watcher jest generyczny — całą wiedzę
 * o lokalizacji i formacie trzyma źródło. parseLine to CZYSTA funkcja (testowalna).
 */
export interface AgentSource {
  id: AgentKind;
  /** Katalog(i) do obserwacji, np. ~/.claude/projects lub ~/.codex/sessions. */
  roots(): string[];
  /** Głębokość chokidar (domyślnie 6). */
  depth?: number;
  classify(path: string, root: string): ClassifiedFile;
  parseLine(line: string): Fact[];
}
```

- [ ] **Step 2: Utwórz `sources/claude.ts` (przeniesiona logika z watchera)**

```ts
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { interpretLine } from '../transcript/parser.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/**
 * Źródło Claude Code: ~/.claude/projects/<projekt>/<uuid>.jsonl (bohaterowie)
 * i <sesja>/subagents/**​/agent-<id>.jsonl (peony).
 */
export const claudeSource: AgentSource = {
  id: 'claude',
  roots: () => [join(homedir(), '.claude', 'projects')],
  depth: 6,
  classify(path: string, root: string): ClassifiedFile {
    const rel = path.slice(root.length + 1);
    const parts = rel.split(sep);
    const file = basename(path, '.jsonl');
    if (parts.length === 2) {
      return { kind: 'session', sessionId: file, projectDir: parts[0] };
    }
    if (parts.includes('subagents') && basename(path).startsWith('agent-')) {
      return { kind: 'subagent', agentId: file.replace(/^agent-/, ''), parentSessionId: parts[1] };
    }
    return { kind: 'other' };
  },
  parseLine: interpretLine,
};
```

- [ ] **Step 3: Sprawdź kompilację (typecheck przez build serwera)**

Run: `npm run build -w @agent-citadel/shared && npm run build -w @agent-citadel/server`
Expected: build OK (nowe pliki kompilują się; nikt ich jeszcze nie importuje — to OK).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/sources/types.ts packages/server/src/sources/claude.ts
git commit -m "refactor(sources): interfejs AgentSource + źródło Claude"
```

---

## Task 4: Parser Codeksa (`sources/codex.ts`)

Czysta funkcja `string → Fact[]` plus helpery klasyfikacji i normalizacji narzędzi. Dwa helpery (`isCodexHumanPrompt`, `codexToolToCanonical`) to miejsca, które łatwo dostroić do własnych sesji.

**Files:**
- Create: `packages/server/src/sources/codex.ts`
- Test: `packages/server/test/codex.test.ts`

- [ ] **Step 1: Napisz failujące testy**

Utwórz `packages/server/test/codex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { interpretCodexLine, codexSource, isCodexHumanPrompt, codexToolToCanonical } from '../src/sources/codex.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('interpretCodexLine', () => {
  it('session_meta daje meta z cwd', () => {
    const facts = interpretCodexLine(
      line({ type: 'session_meta', timestamp: '2026-06-14T10:00:00.000Z', payload: { cwd: '/Users/x/proj', model_provider: 'openai' } }),
    );
    expect(facts).toContainEqual({ kind: 'meta', cwd: '/Users/x/proj', model: 'openai' });
  });

  it('prawdziwy prompt usera → fakt prompt; wstrzyknięcia → nic', () => {
    const userMsg = (text: string) =>
      interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:00.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    expect(userMsg('Dodaj endpoint /health')).toContainEqual({ kind: 'prompt', text: 'Dodaj endpoint /health', ts: '2026-06-14T10:00:00.000Z' });
    expect(userMsg('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>')).toEqual([]);
    expect(userMsg('# AGENTS.md instructions for /x')).toEqual([]);
    // rola developer (instrukcje permissions) → nie prompt
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'normalny tekst' }] } }))).toEqual([]);
  });

  it('reasoning → thinking; assistant output_text → assistant-text', () => {
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:01.000Z', payload: { type: 'reasoning', summary: [] } })))
      .toContainEqual({ kind: 'thinking', ts: '2026-06-14T10:00:01.000Z' });
    expect(interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:02.000Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Zrobione.' }] } })))
      .toContainEqual({ kind: 'assistant-text', text: 'Zrobione.', ts: '2026-06-14T10:00:02.000Z' });
  });

  it('function_call shell/apply_patch/web_search → tool-start z nazwą kanoniczną i detalem', () => {
    const shell = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:03.000Z', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } }));
    expect(shell).toContainEqual({ kind: 'tool-start', tool: 'Bash', detail: 'npm test', messageId: 'c1', ts: '2026-06-14T10:00:03.000Z' });

    const patch = interpretCodexLine(line({ type: 'response_item', timestamp: '2026-06-14T10:00:04.000Z', payload: { type: 'function_call', name: 'apply_patch', call_id: 'c2', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-x\n+y\n*** End Patch' }) } }));
    expect(patch.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'Edit' });

    const web = interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call', name: 'web_search', call_id: 'c3', arguments: JSON.stringify({ query: 'rust async' }) } }));
    expect(web.find((f) => f.kind === 'tool-start')).toMatchObject({ kind: 'tool-start', tool: 'WebSearch', detail: 'rust async' });
  });

  it('token_count → usage-total; task_complete → turn-end', () => {
    expect(interpretCodexLine(line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 300 } } } })))
      .toContainEqual({ kind: 'usage-total', input: 1200, output: 300 });
    expect(interpretCodexLine(line({ type: 'event_msg', timestamp: '2026-06-14T10:05:00.000Z', payload: { type: 'task_complete' } })))
      .toContainEqual({ kind: 'turn-end', ts: '2026-06-14T10:05:00.000Z' });
  });

  it('śmieci i nieznane rekordy → pusta lista', () => {
    expect(interpretCodexLine('to nie json{')).toEqual([]);
    expect(interpretCodexLine(line({ type: 'response_item', payload: { type: 'function_call_output', output: { exit_code: 0 } } }))).toContainEqual({ kind: 'tool-result', isError: false, ts: expect.any(String) });
    expect(interpretCodexLine(line({ type: 'totally_unknown' }))).toEqual([]);
  });
});

describe('helpery (punkty dostrojenia)', () => {
  it('isCodexHumanPrompt: prawda dla zadania, fałsz dla wstrzyknięć/roli', () => {
    expect(isCodexHumanPrompt('Napraw bug', 'user')).toBe(true);
    expect(isCodexHumanPrompt('<environment_context></environment_context>', 'user')).toBe(false);
    expect(isCodexHumanPrompt('Napraw bug', 'developer')).toBe(false);
  });
  it('codexToolToCanonical: mapuje narzędzia Codeksa na nazwy gry', () => {
    expect(codexToolToCanonical('shell')).toBe('Bash');
    expect(codexToolToCanonical('apply_patch')).toBe('Edit');
    expect(codexToolToCanonical('read_file')).toBe('Read');
    expect(codexToolToCanonical('web_search')).toBe('WebSearch');
    expect(codexToolToCanonical('pencil__draw')).toBe('mcp__pencil__draw');
  });
});

describe('codexSource.classify', () => {
  const root = '/Users/x/.codex/sessions';
  it('rollout → sesja z sessionId z UUID nazwy', () => {
    const p = `${root}/2026/02/07/rollout-2026-02-07T01-14-55-019c3573-9d33-7fc2-8fc8-56cebffe1d6b.jsonl`;
    expect(codexSource.classify(p, root)).toEqual({ kind: 'session', sessionId: '019c3573-9d33-7fc2-8fc8-56cebffe1d6b', projectDir: '' });
  });
  it('plik nie-rollout → other', () => {
    expect(codexSource.classify(`${root}/2026/02/07/notes.jsonl`, root).kind).toBe('other');
  });
});
```

- [ ] **Step 2: Uruchom testy — mają failować**

Run: `npm run test -w @agent-citadel/server`
Expected: FAIL — moduł `../src/sources/codex.js` nie istnieje.

- [ ] **Step 3: Zaimplementuj `sources/codex.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Fact } from '../transcript/facts.js';
import type { AgentSource, ClassifiedFile } from './types.js';

/** Skraca tekst (jak w parserze Claude). */
function clip(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ─────────────────────────────────────────────────────────────────
 * PUNKT DOSTROJENIA 1 — heurystyka „prawdziwy prompt vs. wstrzyknięcia".
 * Codex wstrzykuje jako rolę 'user': AGENTS.md, <environment_context>,
 * instrukcje permissions itp. Konserwatywnie: tylko rola 'user' i bez
 * jawnych markerów systemowych. Dostrój listę pod swoje sesje.
 * ───────────────────────────────────────────────────────────────── */
export function isCodexHumanPrompt(text: string, role: string | undefined): boolean {
  if (role !== 'user') return false; // 'developer'/'system' to nie prompty człowieka
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return false; // <environment_context>, <permissions…>, <INSTRUCTIONS>
  if (t.startsWith('# AGENTS.md')) return false;
  if (t.includes('<environment_context>') || t.includes('AGENTS.md instructions')) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────────
 * PUNKT DOSTROJENIA 2 — narzędzie Codeksa → nazwa kanoniczna gry.
 * Nazwa kanoniczna trafia do toolToBuilding (shared), więc steruje tym,
 * do którego budynku maszeruje jednostka. To serce metafory dla Codeksa.
 * ───────────────────────────────────────────────────────────────── */
export function codexToolToCanonical(name: string): string {
  switch (name) {
    case 'shell':
    case 'local_shell':
    case 'exec':
      return 'Bash'; // kopalnia (git w argumentach → targ, jak u Claude)
    case 'apply_patch':
      return 'Edit'; // kuźnia
    case 'read_file':
    case 'view_image':
      return 'Read'; // biblioteka
    case 'web_search':
      return 'WebSearch'; // wieża
    case 'update_plan':
      return 'update_plan'; // brak mapowania → twierdza
    default:
      // Narzędzia MCP Codeksa: 'serwer__narzędzie' albo 'serwer.narzędzie'.
      if (name.includes('__')) return `mcp__${name}`;
      if (name.includes('.')) return `mcp__${name.replace(/\./g, '__')}`;
      return name; // nieznane → twierdza (fallback w toolToBuilding)
  }
}

/** Detal do dymka z argumentów function_call (analog toolDetail Claude). */
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
  if (name === 'shell' || name === 'local_shell' || name === 'exec') {
    const cmd = Array.isArray(args.command) ? args.command.join(' ') : str(args.command);
    // pomiń typowy wrapper 'bash -lc' aby pokazać sedno komendy
    return cmd ? clip(cmd.replace(/^bash\s+-lc\s+/, ''), 60) : undefined;
  }
  if (name === 'web_search') return str(args.query);
  if (name === 'apply_patch') {
    const patch = str(args.input) ?? '';
    const m = patch.match(/\*\*\* (?:Update|Add|Delete) File: (.+)/);
    return m ? m[1].split('/').pop() : undefined;
  }
  return str(args.path) ?? str(args.file_path);
}

/** Czy wynik function_call wskazuje błąd (best-effort — formaty się różnią). */
function codexOutputIsError(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as any;
    if (typeof o.exit_code === 'number') return o.exit_code !== 0;
    if (o.success === false) return true;
  }
  return false;
}

/** Wyciąga kumulatywne użycie tokenów z payloadu token_count (kilka kształtów). */
function extractCodexUsage(payload: any): { input: number; output: number } | undefined {
  const u = payload?.info?.total_token_usage ?? payload?.total_token_usage ?? payload;
  if (!u || typeof u !== 'object') return undefined;
  const input = Number(u.input_tokens ?? u.input ?? 0);
  const output = Number(u.output_tokens ?? u.output ?? 0);
  if (!input && !output) return undefined;
  return { input, output };
}

function handleMessage(payload: any, ts: string, facts: Fact[]): void {
  const role = typeof payload.role === 'string' ? payload.role : undefined;
  const blocks: any[] = Array.isArray(payload.content) ? payload.content : [];
  for (const b of blocks) {
    const text = typeof b?.text === 'string' ? b.text : '';
    if (!text) continue;
    if (b.type === 'input_text' && isCodexHumanPrompt(text, role)) {
      facts.push({ kind: 'prompt', text: clip(text), ts });
    } else if (b.type === 'output_text' && role === 'assistant' && text.trim()) {
      facts.push({ kind: 'assistant-text', text: clip(text), ts });
    }
  }
}

/**
 * Parsuje jedną linię rolloutu Codeksa → Fakty. Nieznany/uszkodzony rekord → [].
 * Format zmienia się między wersjami CLI — czytamy defensywnie.
 */
export function interpretCodexLine(line: string): Fact[] {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (!record || typeof record !== 'object') return [];
  const ts: string = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString();
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : undefined;
  const facts: Fact[] = [];

  switch (record.type) {
    case 'session_meta':
      if (payload) facts.push({ kind: 'meta', cwd: str(payload.cwd), model: str(payload.model) ?? str(payload.model_provider) });
      break;

    case 'turn_context': {
      if (payload) {
        const cwd = str(payload.cwd);
        const model = str(payload.model);
        if (cwd || model) facts.push({ kind: 'meta', cwd, model });
      }
      break;
    }

    case 'response_item': {
      if (!payload) break;
      switch (payload.type) {
        case 'message':
          handleMessage(payload, ts, facts);
          break;
        case 'reasoning':
          facts.push({ kind: 'thinking', ts });
          break;
        case 'function_call': {
          const name = str(payload.name);
          if (name) {
            facts.push({
              kind: 'tool-start',
              tool: codexToolToCanonical(name),
              detail: codexToolDetail(name, payload.arguments),
              messageId: str(payload.call_id) ?? `codex-${ts}`,
              ts,
            });
          }
          break;
        }
        case 'function_call_output':
          facts.push({ kind: 'tool-result', isError: codexOutputIsError(payload.output), ts });
          break;
      }
      break;
    }

    case 'event_msg': {
      if (!payload) break;
      if (payload.type === 'token_count') {
        const u = extractCodexUsage(payload);
        if (u) facts.push({ kind: 'usage-total', input: u.input, output: u.output });
      } else if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        facts.push({ kind: 'turn-end', ts });
      }
      break;
    }
  }

  return facts;
}

/**
 * Źródło Codex: ~/.codex/sessions/RRRR/MM/DD/rollout-<ts>-<uuid>.jsonl.
 * Ścieżka koduje DATĘ, nie projekt — projectName bierze się z cwd w session_meta.
 */
export const codexSource: AgentSource = {
  id: 'codex',
  roots: () => [join(homedir(), '.codex', 'sessions')],
  depth: 6,
  classify(path: string): ClassifiedFile {
    const file = path.split('/').pop() ?? '';
    if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) return { kind: 'other' };
    const m = file.match(UUID_RE);
    if (!m) return { kind: 'other' };
    return { kind: 'session', sessionId: m[0], projectDir: '' };
  },
  parseLine: interpretCodexLine,
};
```

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `npm run test -w @agent-citadel/server`
Expected: PASS (cały plik codex.test.ts zielony).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sources/codex.ts packages/server/test/codex.test.ts
git commit -m "feat(sources): parser i źródło Codex (rollouty JSONL → Fakty)"
```

---

## Task 5: Rejestr źródeł

**Files:**
- Create: `packages/server/src/sources/index.ts`

- [ ] **Step 1: Utwórz rejestr**

```ts
import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import type { AgentSource } from './types.js';

/** Wszystkie aktywne źródła agentów. OpenCode dojdzie tu w Fazie 2. */
export const SOURCES: AgentSource[] = [claudeSource, codexSource];
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/sources/index.ts
git commit -m "feat(sources): rejestr źródeł (Claude + Codex)"
```

---

## Task 6: Watcher generyczny (`SourceWatcher`)

Zamiana zaszytego pod Claude `TranscriptWatcher` na sterowany adapterem `SourceWatcher`. Zachowanie (tail, kolejka, sweep, peony, hooki) bez zmian — tylko root/classify/parseLine/agent biorą się ze źródła.

**Files:**
- Modify: `packages/server/src/watcher.ts`

- [ ] **Step 1: Przepisz nagłówek i konstruktor**

Zastąp górę pliku (importy + deklarację klasy + konstruktor) tak, by importować typy źródła i przyjmować `AgentSource`. Zamień blok od `import` do końca konstruktora:

```ts
import { watch, type FSWatcher } from 'chokidar';
import { sep } from 'node:path';
import type { PeonSnapshot } from '@agent-citadel/shared';
import { TailRegistry } from './transcript/tail.js';
import { DEFAULT_THRESHOLDS, SessionTracker, type StateThresholds } from './state-machine.js';
import type { AgentSource, ClassifiedFile } from './sources/types.js';
import type { World } from './world.js';

/** Sesje starsze niż to okno ignorujemy przy starcie (historia, nie żywe). */
const LIVE_WINDOW_MS = 10 * 60_000;
/** Większe pliki tail-ujemy od końca zamiast odtwarzać całą historię. */
const REPLAY_MAX_BYTES = 2 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 15_000;

interface PeonEntry {
  peon: PeonSnapshot;
  lastWriteMs: number;
}

/**
 * Obserwuje korzeń(e) jednego źródła (Claude/Codex): główne transkrypty sesji
 * (bohaterowie) i — jeśli źródło je rozpoznaje — subagentów (peony).
 * Cała wiedza o lokalizacji i formacie pochodzi z AgentSource.
 */
export class SourceWatcher {
  private tails = new TailRegistry();
  private trackers = new Map<string, SessionTracker>();
  private peons = new Map<string, PeonEntry>();
  private watcher?: FSWatcher;
  private sweepTimer?: NodeJS.Timeout;
  private queue = Promise.resolve();
  private readonly roots: string[];

  constructor(
    private readonly world: World,
    private readonly source: AgentSource,
    private readonly thresholds: StateThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.roots = source.roots();
  }

  get id() {
    return this.source.id;
  }
```

- [ ] **Step 2: Zaktualizuj `start()` na wiele korzeni i głębokość ze źródła**

Zamień ciało `start()` (sygnatura bez zmian) na:

```ts
  start(): void {
    this.watcher = watch(this.roots, {
      depth: this.source.depth ?? 6,
      ignoreInitial: false,
      alwaysStat: true,
      // Ignorujemy tylko POTWIERDZONE pliki bez .jsonl (bez stats nie wolno —
      // ucięlibyśmy traversal drzewa).
      ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.jsonl'),
    });
    const enqueue = (path: string, stats?: { mtimeMs?: number; size?: number }, initial = false) => {
      this.queue = this.queue
        .then(() => this.handleFile(path, stats, initial))
        .catch((err) => console.error('[watcher]', this.source.id, path, err));
    };
    this.watcher.on('add', (path, stats) => enqueue(path, stats, true));
    this.watcher.on('change', (path, stats) => enqueue(path, stats, false));
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }
```

- [ ] **Step 3: `applyExternalFacts` — dołóż agenta źródła do nowego trackera**

Zamień w `applyExternalFacts` linię tworzącą tracker:

```ts
      tracker = new SessionTracker(this.world, sessionId, projectDir, this.thresholds);
```

na:

```ts
      tracker = new SessionTracker(this.world, sessionId, projectDir, this.thresholds, this.source.id);
```

- [ ] **Step 4: Zamień `classify()` na delegację do źródła**

Usuń całą prywatną metodę `classify(path)` (tę z `parts.length === 2` itd.) i wstaw w jej miejsce:

```ts
  private rootFor(path: string): string | undefined {
    return this.roots.find((r) => path === r || path.startsWith(r + sep));
  }

  private classify(path: string): ClassifiedFile {
    const root = this.rootFor(path);
    if (!root) return { kind: 'other' };
    return this.source.classify(path, root);
  }
```

- [ ] **Step 5: Zaktualizuj `handleFile()` — użyj pól ClassifiedFile, parseLine i agenta źródła**

W `handleFile`, w bloku `if (target.kind === 'session')`, zamień:

```ts
      let tracker = this.trackers.get(target.sessionId);
      if (!tracker) {
        tracker = new SessionTracker(this.world, target.sessionId, target.projectDir, this.thresholds);
        this.trackers.set(target.sessionId, tracker);
      }
      for (const line of lines) {
        for (const fact of interpretLine(line)) tracker.apply(fact);
      }
    } else {
      this.applyPeonLines(target.agentId, target.parentSessionId, lines);
    }
```

na:

```ts
      const sessionId = target.sessionId!;
      let tracker = this.trackers.get(sessionId);
      if (!tracker) {
        tracker = new SessionTracker(this.world, sessionId, target.projectDir ?? '', this.thresholds, this.source.id);
        this.trackers.set(sessionId, tracker);
      }
      for (const line of lines) {
        for (const fact of this.source.parseLine(line)) tracker.apply(fact);
      }
    } else {
      this.applyPeonLines(target.agentId!, target.parentSessionId!, lines);
    }
```

- [ ] **Step 6: `applyPeonLines` — użyj parsera źródła**

W `applyPeonLines` zamień `for (const fact of interpretLine(line)) {` na:

```ts
      for (const fact of this.source.parseLine(line)) {
```

- [ ] **Step 7: Build serwera (typecheck)**

Run: `npm run build -w @agent-citadel/shared && npm run build -w @agent-citadel/server`
Expected: build OK. (Import `interpretLine`/`basename`/`join`/`homedir` zniknął z watchera — upewnij się, że nie ma martwych importów; powyższy blok importów Step 1 już ich nie zawiera.)

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/watcher.ts
git commit -m "refactor(watcher): SourceWatcher sterowany adapterem AgentSource"
```

---

## Task 7: Serwer — po jednym watcherze na źródło

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Podmień import i utworzenie watchera**

W `packages/server/src/index.ts`, w bloku `else` (tryb nie-demo), zamień:

```ts
  const { TranscriptWatcher } = await import('./watcher.js');
  const { translateHook, hooksInstalled, installHooks, uninstallHooks } = await import('./hooks.js');
  const { getBuildingStats } = await import('./building-stats.js');
  const watcher = new TranscriptWatcher(world);
```

na:

```ts
  const { SourceWatcher } = await import('./watcher.js');
  const { SOURCES } = await import('./sources/index.js');
  const { translateHook, hooksInstalled, installHooks, uninstallHooks } = await import('./hooks.js');
  const { getBuildingStats } = await import('./building-stats.js');
  const watchers = SOURCES.map((source) => new SourceWatcher(world, source));
  // Hooki HTTP są kanałem Claude → kierujemy je do watchera Claude.
  const claudeWatcher = watchers.find((w) => w.id === 'claude') ?? watchers[0];
```

- [ ] **Step 2: Skieruj `/hooks` na watcher Claude**

W handlerze `app.post('/hooks', …)` zamień:

```ts
    if (translated) watcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts);
```

na:

```ts
    if (translated) claudeWatcher.applyExternalFacts(translated.sessionId, translated.projectDir, translated.facts);
```

- [ ] **Step 3: Wystartuj wszystkie watchery w `onReady`**

Zamień blok `app.addHook('onReady', …)`:

```ts
  app.addHook('onReady', async () => {
    watcher.start();
    app.log.info('Watcher transkryptów: obserwuję ~/.claude/projects');
  });
```

na:

```ts
  app.addHook('onReady', async () => {
    for (const w of watchers) w.start();
    app.log.info(`Watchery źródeł aktywne: ${watchers.map((w) => w.id).join(', ')}`);
  });
```

- [ ] **Step 4: Build serwera**

Run: `npm run build -w @agent-citadel/shared && npm run build -w @agent-citadel/server`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): uruchom watcher per źródło, hooki → Claude"
```

---

## Task 8: Klient — odznaka agenta (mapa + panel)

**Files:**
- Modify: `packages/client/src/game/unit.ts`
- Modify: `packages/client/src/game/view.ts:341`
- Modify: `packages/client/src/hud/SidePanel.tsx`

- [ ] **Step 1: `unit.ts` — import typu i parametr `agent`**

W `packages/client/src/game/unit.ts` zamień import z shared:

```ts
import type { HeroStateKind } from '@agent-citadel/shared';
```

na:

```ts
import type { AgentKind, HeroStateKind } from '@agent-citadel/shared';
```

Dodaj kolor marki Codeksa pod istniejącymi stałymi (po `SPRITE_FOOT_ANCHOR`):

```ts
/** Kolor odznaki Codeksa (zielony OpenAI). Claude nie dostaje odznaki. */
const CODEX_BADGE = 0x10a37f;
```

- [ ] **Step 2: `unit.ts` — dodaj `agent` do konstruktora i narysuj odznakę**

W konstruktorze dodaj parametr `agent` na końcu listy (po `sheet?`):

```ts
    sheet?: Spritesheet | null,
    agent: AgentKind = 'claude',
```

Na końcu konstruktora, tuż przed `this.syncScreen();`, dodaj:

```ts
    const badge = buildAgentBadge(agent);
    if (badge) this.container.addChild(badge);
```

Na końcu pliku (po klasie, obok funkcji `clip`) dodaj fabrykę odznaki:

```ts
/** Mała odznaka pochodzenia agenta (tylko nie-Claude). Rysowana proceduralnie — bez assetów. */
function buildAgentBadge(agent: AgentKind): Container | undefined {
  if (agent === 'claude') return undefined;
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 7).fill({ color: CODEX_BADGE }).stroke({ color: 0x0b0b0a, width: 1.5 });
  c.addChild(g);
  const letter = new Text({ text: 'C', style: { ...labelStyle, fontSize: 9, fill: 0xffffff } });
  letter.anchor.set(0.5);
  c.addChild(letter);
  c.position.set(10, -30); // przy głowie, prawy-górny róg jednostki
  return c;
}
```

- [ ] **Step 3: `view.ts` — przekaż `hero.agent` do jednostki**

W `packages/client/src/game/view.ts:341` zamień:

```ts
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection, sheet);
```

na:

```ts
        unit = new Unit(hero.sessionId, hero.teamColor, false, clipName(hero.title), door, this.theme.projection, sheet, hero.agent ?? 'claude');
```

- [ ] **Step 4: `SidePanel.tsx` — etykieta agenta w nagłówku**

W `packages/client/src/hud/SidePanel.tsx` zamień import z shared:

```ts
import { toolToBuilding, type BuildingId, type HeroStateKind, type TranscriptLine } from '@agent-citadel/shared';
```

na:

```ts
import { toolToBuilding, type AgentKind, type BuildingId, type HeroStateKind, type TranscriptLine } from '@agent-citadel/shared';
```

Pod `BUILDING_EMOJI` (po jego klamrze zamykającej) dodaj:

```ts
/** Etykieta + kolor odznaki agenta w panelu. */
const AGENT_BADGE: Record<AgentKind, { label: string; color: string } | undefined> = {
  claude: undefined, // domyślny agent — bez odznaki, żeby nie zaśmiecać
  codex: { label: 'Codex', color: '#10a37f' },
};
```

W nagłówku karty, zaraz po `<strong className="px" …>{hero.title}</strong>` (linia ~93), dodaj chip:

```tsx
            {(() => {
              const badge = AGENT_BADGE[hero.agent ?? 'claude'];
              return badge ? (
                <span
                  className="px"
                  style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${badge.color}33`, color: badge.color, border: `1px solid ${badge.color}66`, verticalAlign: 'middle' }}
                >
                  {badge.label}
                </span>
              ) : null;
            })()}
```

- [ ] **Step 5: Build + testy klienta**

Run: `npm run build -w @agent-citadel/client && npm run test -w @agent-citadel/client`
Expected: build OK, testy zielone (zmiany nie dotykają testowanych modułów gry).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/game/unit.ts packages/client/src/game/view.ts packages/client/src/hud/SidePanel.tsx
git commit -m "feat(client): odznaka agenta Codex na jednostce i w panelu"
```

---

## Task 9: Weryfikacja end-to-end

**Files:** brak (uruchomienie).

- [ ] **Step 1: Pełny build i testy**

Run: `npm run build && npm run test`
Expected: build wszystkich paczek OK; testy serwera i klienta zielone.

- [ ] **Step 2: Uruchom serwer w trybie produkcyjnym i sprawdź logi**

Run: `npm run dev` (lub sam serwer). 
Expected w logach: `Watchery źródeł aktywne: claude, codex`. Brak crasha gdy `~/.codex/sessions` istnieje.

- [ ] **Step 3: Wygeneruj świeżą sesję Codeksa i potwierdź bohatera**

Uruchom `codex` w dowolnym projekcie i wydaj jedno polecenie (np. „wypisz pliki"). W ciągu ~kilku sekund w grze powinien pojawić się bohater z **odznaką „C"**, nazwą z pierwszego promptu i ruchem do budynku narzędzia (`shell` → kopalnia). Kliknięcie → panel pokazuje chip „Codex" i model.

> Uwaga: liczy się sesja świeższa niż `LIVE_WINDOW_MS` (10 min) — stare rollouty są pomijane do czasu kolejnego zapisu.

- [ ] **Step 4: Commit (jeśli zaszły poprawki z weryfikacji)**

```bash
git add -A && git commit -m "test(codex): weryfikacja e2e źródła Codex"
```

---

## Self-review (wykonane przy pisaniu planu)

- **Pokrycie specu:** szew adapterów (T3,T5,T6), parser Codeksa + tool/prompt helpery (T4), fakt `usage-total` kumulatywny (T2), pole `agent` (T1) + odznaka mapa/panel (T8), różnica ścieżka-data→cwd (T4 classify + meta), testy (T2,T4), weryfikacja (T9). Poza zakresem (OpenCode, hooki Codeksa, building-stats Codeksa, peony Codeksa) — świadomie nieujęte.
- **Brak placeholderów:** każdy krok ma pełny kod i komendę z oczekiwanym wynikiem.
- **Spójność typów:** `AgentKind` (shared) używany w `facts`/`state-machine`/`sources/types`/`unit`/`SidePanel`; `interpretCodexLine`/`codexSource`/`isCodexHumanPrompt`/`codexToolToCanonical` eksportowane z `codex.ts` i tak importowane w teście; `SourceWatcher` z getterem `id` używany w `index.ts`; piąty arg `SessionTracker(..., agent)` spójny w watcherze i teście.
