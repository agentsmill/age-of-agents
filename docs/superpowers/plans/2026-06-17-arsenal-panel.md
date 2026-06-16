# Arsenał projektu (Architect's Hall) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamienić panel „Architect's Hall" (intel beads + graphify) w **Arsenał** — pokazujący efektywny ekwipunek agentów per miasto (skille, konektory MCP, hooki, subagenci; suma projekt ∪ user ∪ plugin z tagiem źródła) z warstwą „użyto w tej sesji" z atrybucji transkryptu.

**Architecture:** Dwie warstwy. **A (statyczna):** serwerowy `ArsenalPoller` czyta config z dysku przez 4 czyste czytniki i emituje nowy event `arsenal-updated` (jak dziś `ProjectIntelPoller`). **B (live):** `parser.ts` wyciąga atrybucję z transkryptu jako nowy `Fact`, `SessionTracker` kumuluje ją w `hero.wielded`, a klient agreguje „użyto" lokalnie z bohaterów miasta — bez nowego eventu. Budujemy **addytywnie** (beads/graphify nietknięte do ostatniego zadania), żeby nie kolidować z agentem pracującym nad graphify.

**Tech Stack:** TypeScript (ESM, NodeNext), Node fs/promises, Vitest, React 19 + zustand, monorepo npm workspaces (`@agent-citadel/{shared,server,client}`).

**Spec:** `docs/superpowers/specs/2026-06-17-arsenal-panel-design.md`
**Beads:** `AgeOfAgents-g0v`
**Worktree/Branch:** `claude/cool-booth-6d1097` (już aktywny)

---

## File Structure

| Plik | Rola | Akcja |
|---|---|---|
| `packages/shared/src/arsenal.ts` | Typy Arsenału (`ProjectArsenal`, `Arsenal*`, `WieldedArsenal`, `ArsenalOrigin`) | Create |
| `packages/shared/src/index.ts` | Re-eksport `./arsenal`; `HeroSnapshot.wielded?`; `GameEvent` `arsenal-updated` | Modify |
| `packages/server/src/arsenal/frontmatter.ts` | Minimalny parser bloku `--- name/description ---` | Create |
| `packages/server/src/arsenal/readers/skills.ts` | `readSkills({workingDir,homeDir})` → `ArsenalSkill[]` | Create |
| `packages/server/src/arsenal/readers/connectors.ts` | `readConnectors(...)` → `ArsenalConnector[]` | Create |
| `packages/server/src/arsenal/readers/hooks.ts` | `readHooks(...)` → `ArsenalHook[]` | Create |
| `packages/server/src/arsenal/readers/agents.ts` | `readAgents(...)` → `ArsenalAgent[]` | Create |
| `packages/server/src/arsenal/arsenal-poller.ts` | `ArsenalPoller` — pętla, fingerprint, emit `arsenal-updated` | Create |
| `packages/server/src/transcript/facts.ts` | Nowy `Fact` kind `attribution` | Modify |
| `packages/server/src/transcript/parser.ts` | Emituj `attribution` z rekordu `assistant` | Modify |
| `packages/server/src/state-machine.ts` | Kumuluj `wielded`, doklejaj do `HeroSnapshot` | Modify |
| `packages/server/src/server.ts` | `ProjectIntelPoller` → `ArsenalPoller` | Modify |
| `packages/client/src/store.ts` | Stan `arsenal`, case `arsenal-updated`, `aggregateWielded` | Modify |
| `packages/client/src/hud/arsenal-select.ts` | Czysta funkcja `aggregateWielded(heroes, projectDir)` | Create |
| `packages/client/src/i18n.ts` | 6 etykiet (arsenal/skills/connectors/hooks/subagents/usedThisSession) | Modify |
| `packages/client/src/hud/ArchitectHall.tsx` | Przepisany panel Arsenału | Modify |
| `packages/server/test/arsenal-*.test.ts` | Testy czytników, pollera, parsera, state-machine | Create |
| `packages/client/tests/arsenal-select.test.ts` | Test agregacji `wielded` | Create |

**Komendy pomocnicze** (z korzenia repo `/Users/mpawelczuk/RTS agents/.claude/worktrees/cool-booth-6d1097`):
- Test serwera (wzorzec): `npm run test -w @agent-citadel/server -- <pattern>`
- Typecheck serwera: `npm run build -w @agent-citadel/server`
- Test klienta (wzorzec): `npm run test -w @agent-citadel/client -- <pattern>`
- Typecheck klienta: `npx tsc --noEmit -p packages/client`
- Pełne testy: `npm test`

**Konwencje:** importy ESM z rozszerzeniem `.js` (NodeNext). Testy: Vitest, nazwy `it()` po polsku (jak w istniejących). Czytniki są **czyste** (przyjmują `homeDir`/`workingDir` jako argumenty → testowalne na katalogach `mkdtemp`, bez dotykania realnego `~`). Każdy czytnik jest odporny na brak plików (→ pusta lista).

---

## Task 1: Typy współdzielone (shared)

**Files:**
- Create: `packages/shared/src/arsenal.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Utwórz `arsenal.ts` z typami**

```ts
/** Skąd pochodzi element arsenału (do plakietki w UI). */
export type ArsenalOrigin = 'project' | 'user' | 'plugin';

export interface ArsenalSkill {
  /** Goła nazwa skilla z frontmattera SKILL.md (np. 'brainstorming'). */
  id: string;
  description?: string;
  origin: ArsenalOrigin;
  /** Gdy origin === 'plugin' — nazwa pluginu wyprowadzona ze ścieżki. */
  pluginName?: string;
}

export interface ArsenalConnector {
  /** Nazwa serwera MCP (klucz w mcpServers), np. 'visualize'. */
  name: string;
  origin: ArsenalOrigin;
  transport?: 'stdio' | 'http' | 'sse';
}

export interface ArsenalHook {
  /** Zdarzenie, np. 'SessionStart', 'PreToolUse'. */
  event: string;
  /** Pełna komenda hooka (UI skraca do basename). */
  command: string;
  origin: ArsenalOrigin;
}

export interface ArsenalAgent {
  name: string;
  description?: string;
  origin: ArsenalOrigin;
}

/** Źródło A — statyczny ekwipunek jednego miasta (zastąpi ProjectIntel). */
export interface ProjectArsenal {
  projectDir: string;
  projectName: string;
  activeSessions: number;
  skills: ArsenalSkill[];
  connectors: ArsenalConnector[];
  hooks: ArsenalHook[];
  agents: ArsenalAgent[];
  refreshedAt: number;
}

/** Źródło B — co bohater REALNIE wyciągnął (distinct sety z atrybucji transkryptu). */
export interface WieldedArsenal {
  skills: string[];
  connectors: string[];
  plugins: string[];
}
```

- [ ] **Step 2: Wepnij w `index.ts` — re-eksport + pola**

W `packages/shared/src/index.ts` dodaj na samej górze pliku (przed komentarzem nagłówkowym) DWIE linie — import do użytku lokalnego (`HeroSnapshot`/`GameEvent` używają tych typów w tym pliku) ORAZ re-eksport dla konsumentów. `export *` NIE wprowadza nazw do lokalnego scope, więc import jest konieczny:

```ts
import type { ProjectArsenal, WieldedArsenal } from './arsenal.js';
export * from './arsenal.js';
```

W interfejsie `HeroSnapshot` (ok. linii 24–51) dodaj pole tuż przed `startedAt`:

```ts
  /** Co ta sesja realnie wyciągnęła z arsenału (z atrybucji transkryptu). */
  wielded?: WieldedArsenal;
```

W unii `GameEvent` (ok. linii 86–97) **dodaj** (NIE usuwaj `project-intel-updated` — to robimy w Task 14):

```ts
  | { type: 'arsenal-updated'; arsenal: ProjectArsenal }
```

- [ ] **Step 3: Typecheck**

Run: `npm run build -w @agent-citadel/shared`
Expected: PASS (brak błędów typów).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/arsenal.ts packages/shared/src/index.ts
git commit -m "feat(shared): typy Arsenału + wielded + event arsenal-updated (AgeOfAgents-g0v)"
```

---

## Task 2: Parser frontmattera (serwer)

**Files:**
- Create: `packages/server/src/arsenal/frontmatter.ts`
- Test: `packages/server/test/arsenal-frontmatter.test.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/arsenal/frontmatter.js';

describe('parseFrontmatter', () => {
  it('wyciąga name i description z bloku ---', () => {
    const md = `---\nname: brainstorming\ndescription: Pomysł w projekt\n---\n# Body`;
    expect(parseFrontmatter(md)).toEqual({ name: 'brainstorming', description: 'Pomysł w projekt' });
  });

  it('toleruje brak frontmattera', () => {
    expect(parseFrontmatter('# tylko body')).toEqual({});
  });

  it('bierze tylko pierwszą wartość po dwukropku i trzyma resztę linii', () => {
    const md = `---\nname: code-review\ndescription: Review a PR: correctness\n---`;
    expect(parseFrontmatter(md)).toEqual({ name: 'code-review', description: 'Review a PR: correctness' });
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-frontmatter`
Expected: FAIL ("Cannot find module '../src/arsenal/frontmatter.js'").

- [ ] **Step 3: Implementacja**

```ts
/** Minimalny parser frontmattera SKILL.md/agentów: blok między pierwszymi --- a ---.
 *  Czyta tylko `name` i `description` (jedna linia = jedna wartość). Bez zależności YAML. */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const m = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (m) {
      const key = m[1] as 'name' | 'description';
      const value = m[2].trim();
      if (value) out[key] = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-frontmatter`
Expected: PASS (3 testy).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/frontmatter.ts packages/server/test/arsenal-frontmatter.test.ts
git commit -m "feat(arsenal): parser frontmattera SKILL.md (AgeOfAgents-g0v)"
```

---

## Task 3: Czytnik skilli (serwer)

**Files:**
- Create: `packages/server/src/arsenal/readers/skills.ts`
- Test: `packages/server/test/arsenal-skills.test.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSkills, pluginNameFromPath } from '../src/arsenal/readers/skills.js';

async function writeSkill(dir: string, name: string, description: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}`);
}

describe('readSkills', () => {
  let home: string;
  let wd: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-home-'));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('czyta skille z projektu, usera i pluginu z tagiem origin', async () => {
    await writeSkill(path.join(wd, '.claude', 'skills', 'local-skill'), 'local-skill', 'projektowy');
    await writeSkill(path.join(home, '.claude', 'skills', 'user-skill'), 'user-skill', 'userowy');
    await writeSkill(path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'superpowers', '5.1.0', 'skills', 'brainstorming'), 'brainstorming', 'pluginowy');

    const skills = await readSkills({ workingDir: wd, homeDir: home });
    const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
    expect(byId['local-skill'].origin).toBe('project');
    expect(byId['user-skill'].origin).toBe('user');
    expect(byId['brainstorming'].origin).toBe('plugin');
    expect(byId['brainstorming'].pluginName).toBe('superpowers');
    expect(byId['user-skill'].description).toBe('userowy');
  });

  it('zwraca pustą listę gdy nic nie ma', async () => {
    expect(await readSkills({ workingDir: wd, homeDir: home })).toEqual([]);
  });

  it('pluginNameFromPath pomija segment wersji', () => {
    expect(pluginNameFromPath('/x/plugins/cache/mkt/superpowers/5.1.0/skills/foo/SKILL.md')).toBe('superpowers');
    expect(pluginNameFromPath('/x/plugins/frontend-design/skills/foo/SKILL.md')).toBe('frontend-design');
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-skills`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalSkill, ArsenalOrigin } from '@agent-citadel/shared';
import { parseFrontmatter } from '../frontmatter.js';

interface Opts { workingDir: string; homeDir: string; }

/** Nazwa pluginu ze ścieżki SKILL.md: segment tuż przed `/skills/`, a jeśli to wersja
 *  (np. '5.1.0') — segment wcześniejszy. */
export function pluginNameFromPath(filePath: string): string {
  const parts = filePath.split(path.sep).filter(Boolean);
  const si = parts.lastIndexOf('skills');
  if (si <= 0) return 'plugin';
  let i = si - 1;
  if (/^\d+\.\d+/.test(parts[i] ?? '')) i -= 1;
  return parts[i] ?? 'plugin';
}

/** Skille z jednego katalogu „skills/<name>/SKILL.md" (jeden poziom). */
async function readOneLevel(skillsDir: string, origin: ArsenalOrigin): Promise<ArsenalSkill[]> {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ArsenalSkill[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(skillsDir, e.name, 'SKILL.md');
    try {
      const fm = parseFrontmatter(await fs.readFile(file, 'utf8'));
      out.push({ id: fm.name ?? e.name, description: fm.description, origin });
    } catch {
      // brak SKILL.md w tym podkatalogu — pomiń
    }
  }
  return out;
}

/** Skille z drzewa pluginów (rekurencyjnie szukamy plików SKILL.md). */
async function readPlugins(pluginsRoot: string): Promise<ArsenalSkill[]> {
  let files: string[] = [];
  try {
    const dirents = await fs.readdir(pluginsRoot, { recursive: true, withFileTypes: true });
    files = dirents
      .filter((d) => d.isFile() && d.name === 'SKILL.md' && !d.parentPath.includes(`${path.sep}node_modules${path.sep}`))
      .map((d) => path.join(d.parentPath, d.name));
  } catch {
    return [];
  }
  const out: ArsenalSkill[] = [];
  for (const file of files) {
    try {
      const fm = parseFrontmatter(await fs.readFile(file, 'utf8'));
      out.push({
        id: fm.name ?? path.basename(path.dirname(file)),
        description: fm.description,
        origin: 'plugin',
        pluginName: pluginNameFromPath(file),
      });
    } catch {
      // pomiń uszkodzony plik
    }
  }
  return out;
}

/** Efektywny zestaw skilli: projekt ∪ user ∪ plugin, dedup po id (projekt > user > plugin). */
export async function readSkills({ workingDir, homeDir }: Opts): Promise<ArsenalSkill[]> {
  const [project, user, plugin] = await Promise.all([
    readOneLevel(path.join(workingDir, '.claude', 'skills'), 'project'),
    readOneLevel(path.join(homeDir, '.claude', 'skills'), 'user'),
    readPlugins(path.join(homeDir, '.claude', 'plugins')),
  ]);
  const seen = new Set<string>();
  const out: ArsenalSkill[] = [];
  for (const s of [...project, ...user, ...plugin]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
```

> Uwaga: `Dirent.parentPath` wymaga Node ≥ 20. Repo używa `fs.readdir(..., { recursive: true })`, dostępnego od Node 20 — zgodne z projektem (`tsx`/ESM).

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-skills`
Expected: PASS (3 testy).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/readers/skills.ts packages/server/test/arsenal-skills.test.ts
git commit -m "feat(arsenal): czytnik skilli (projekt/user/plugin) (AgeOfAgents-g0v)"
```

---

## Task 4: Czytnik konektorów MCP (serwer)

**Files:**
- Create: `packages/server/src/arsenal/readers/connectors.ts`
- Test: `packages/server/test/arsenal-connectors.test.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConnectors } from '../src/arsenal/readers/connectors.js';

describe('readConnectors', () => {
  let home: string;
  let wd: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-home-'));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('łączy .mcp.json (projekt), global i per-projekt z ~/.claude.json', async () => {
    await fs.writeFile(path.join(wd, '.mcp.json'), JSON.stringify({
      mcpServers: { localmcp: { command: 'node', args: ['s.js'] } },
    }));
    await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({
      mcpServers: { globalmcp: { type: 'http', url: 'https://x' } },
      projects: { [wd]: { mcpServers: { projmcp: { command: 'docker' } } } },
    }));

    const conns = await readConnectors({ workingDir: wd, homeDir: home });
    const byName = Object.fromEntries(conns.map((c) => [c.name, c]));
    expect(byName['localmcp']).toEqual({ name: 'localmcp', origin: 'project', transport: 'stdio' });
    expect(byName['globalmcp']).toEqual({ name: 'globalmcp', origin: 'user', transport: 'http' });
    expect(byName['projmcp']).toEqual({ name: 'projmcp', origin: 'project', transport: 'stdio' });
  });

  it('zwraca pustą listę gdy brak configów', async () => {
    expect(await readConnectors({ workingDir: wd, homeDir: home })).toEqual([]);
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-connectors`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalConnector, ArsenalOrigin } from '@agent-citadel/shared';

interface Opts { workingDir: string; homeDir: string; }

function inferTransport(cfg: unknown): ArsenalConnector['transport'] {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const c = cfg as Record<string, unknown>;
  if (c.type === 'http' || c.type === 'sse') return c.type;
  if (typeof c.url === 'string') return 'http';
  if (typeof c.command === 'string') return 'stdio';
  return undefined;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toConnectors(map: unknown, origin: ArsenalOrigin): ArsenalConnector[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map as Record<string, unknown>).map(([name, cfg]) => ({
    name,
    origin,
    transport: inferTransport(cfg),
  }));
}

/** Efektywny zestaw konektorów: .mcp.json (projekt) + ~/.claude.json (global=user, per-projekt=project),
 *  dedup po nazwie z preferencją origin 'project'. */
export async function readConnectors({ workingDir, homeDir }: Opts): Promise<ArsenalConnector[]> {
  const projectMcp = await readJson(path.join(workingDir, '.mcp.json'));
  const userJson = await readJson(path.join(homeDir, '.claude.json'));

  const fromProjectFile = toConnectors(projectMcp?.mcpServers, 'project');
  const fromGlobal = toConnectors(userJson?.mcpServers, 'user');
  const projects = (userJson?.projects as Record<string, { mcpServers?: unknown }> | undefined) ?? {};
  const fromPerProject = toConnectors(projects[workingDir]?.mcpServers, 'project');

  const seen = new Set<string>();
  const out: ArsenalConnector[] = [];
  // Kolejność = preferencja origin: najpierw projektowe (plik + per-projekt), potem global.
  for (const c of [...fromProjectFile, ...fromPerProject, ...fromGlobal]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-connectors`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/readers/connectors.ts packages/server/test/arsenal-connectors.test.ts
git commit -m "feat(arsenal): czytnik konektorów MCP (AgeOfAgents-g0v)"
```

---

## Task 5: Czytnik hooków (serwer)

**Files:**
- Create: `packages/server/src/arsenal/readers/hooks.ts`
- Test: `packages/server/test/arsenal-hooks.test.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHooks } from '../src/arsenal/readers/hooks.js';

describe('readHooks', () => {
  let home: string;
  let wd: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-home-'));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('spłaszcza hooki projektu (event+command, origin)', async () => {
    await fs.mkdir(path.join(wd, '.claude'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'bd prime' }] }] },
    }));
    const hooks = await readHooks({ workingDir: wd, homeDir: home });
    expect(hooks).toEqual([{ event: 'SessionStart', command: 'bd prime', origin: 'project' }]);
  });

  it('zwraca pustą listę gdy brak settings', async () => {
    expect(await readHooks({ workingDir: wd, homeDir: home })).toEqual([]);
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-hooks`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalHook, ArsenalOrigin } from '@agent-citadel/shared';

interface Opts { workingDir: string; homeDir: string; }

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function flattenHooks(settings: Record<string, unknown> | null, origin: ArsenalOrigin): ArsenalHook[] {
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: ArsenalHook[] = [];
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const command = (h as { command?: unknown })?.command;
        if (typeof command === 'string' && command.trim()) out.push({ event, command, origin });
      }
    }
  }
  return out;
}

/** Hooki: projekt (settings.json + settings.local.json) ∪ user (~/.claude/settings.json),
 *  dedup po event+command. */
export async function readHooks({ workingDir, homeDir }: Opts): Promise<ArsenalHook[]> {
  const [proj, projLocal, user] = await Promise.all([
    readJson(path.join(workingDir, '.claude', 'settings.json')),
    readJson(path.join(workingDir, '.claude', 'settings.local.json')),
    readJson(path.join(homeDir, '.claude', 'settings.json')),
  ]);
  const all = [
    ...flattenHooks(proj, 'project'),
    ...flattenHooks(projLocal, 'project'),
    ...flattenHooks(user, 'user'),
  ];
  const seen = new Set<string>();
  const out: ArsenalHook[] = [];
  for (const h of all) {
    const key = `${h.event} ${h.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-hooks`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/readers/hooks.ts packages/server/test/arsenal-hooks.test.ts
git commit -m "feat(arsenal): czytnik hooków (AgeOfAgents-g0v)"
```

---

## Task 6: Czytnik subagentów (serwer)

**Files:**
- Create: `packages/server/src/arsenal/readers/agents.ts`
- Test: `packages/server/test/arsenal-agents.test.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAgents } from '../src/arsenal/readers/agents.js';

describe('readAgents', () => {
  let home: string;
  let wd: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-home-'));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('czyta agentów z .claude/agents (projekt) i frontmatter', async () => {
    await fs.mkdir(path.join(wd, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'agents', 'reviewer.md'), `---\nname: code-reviewer\ndescription: Recenzuje\n---\n# x`);
    const agents = await readAgents({ workingDir: wd, homeDir: home });
    expect(agents).toEqual([{ name: 'code-reviewer', description: 'Recenzuje', origin: 'project' }]);
  });

  it('fallback nazwy = plik bez .md gdy brak frontmattera', async () => {
    await fs.mkdir(path.join(home, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'agents', 'planner.md'), `# bez frontmattera`);
    const agents = await readAgents({ workingDir: wd, homeDir: home });
    expect(agents).toEqual([{ name: 'planner', description: undefined, origin: 'user' }]);
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-agents`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja**

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArsenalAgent, ArsenalOrigin } from '@agent-citadel/shared';
import { parseFrontmatter } from '../frontmatter.js';

interface Opts { workingDir: string; homeDir: string; }

async function readDir(agentsDir: string, origin: ArsenalOrigin): Promise<ArsenalAgent[]> {
  let entries;
  try {
    entries = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ArsenalAgent[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const fm = parseFrontmatter(await fs.readFile(path.join(agentsDir, e.name), 'utf8'));
      out.push({ name: fm.name ?? e.name.replace(/\.md$/, ''), description: fm.description, origin });
    } catch {
      // pomiń
    }
  }
  return out;
}

/** Subagenci: projekt (.claude/agents) ∪ user (~/.claude/agents), dedup po nazwie (projekt > user). */
export async function readAgents({ workingDir, homeDir }: Opts): Promise<ArsenalAgent[]> {
  const [project, user] = await Promise.all([
    readDir(path.join(workingDir, '.claude', 'agents'), 'project'),
    readDir(path.join(homeDir, '.claude', 'agents'), 'user'),
  ]);
  const seen = new Set<string>();
  const out: ArsenalAgent[] = [];
  for (const a of [...project, ...user]) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    out.push(a);
  }
  return out;
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-agents`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/readers/agents.ts packages/server/test/arsenal-agents.test.ts
git commit -m "feat(arsenal): czytnik subagentów (AgeOfAgents-g0v)"
```

---

## Task 7: ArsenalPoller (serwer)

**Files:**
- Create: `packages/server/src/arsenal/arsenal-poller.ts`
- Test: `packages/server/test/arsenal-poller.test.ts`

Wzór: istniejący `packages/server/src/intel/project-intel-poller.ts` (pętla, cache, fingerprint, GC). Różnice: składa `ProjectArsenal` z 4 czytników; `refreshedAt` **wykluczony** z fingerprintu (inaczej emituje co poll).

- [ ] **Step 1: Napisz failing test** (build `ProjectArsenal` + emit tylko przy zmianie)

```ts
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameEvent, HeroSnapshot } from '@agent-citadel/shared';
import { World } from '../src/world.js';
import { ArsenalPoller } from '../src/arsenal/arsenal-poller.js';

function hero(over: Partial<HeroSnapshot>): HeroSnapshot {
  return {
    sessionId: 's1', title: 't', projectDir: 'PD', workingDir: over.workingDir,
    teamColor: 0, state: 'idle', tokens: { input: 0, output: 0 },
    startedAt: '', lastActivityAt: '', ...over,
  } as HeroSnapshot;
}

describe('ArsenalPoller.refreshOnce', () => {
  it('emituje arsenal-updated z efektywnym ekwipunkiem; drugi raz bez zmian = brak emisji', async () => {
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), 'ars-wd-'));
    await fs.mkdir(path.join(wd, '.claude'), { recursive: true });
    await fs.writeFile(path.join(wd, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ command: 'bd prime' }] }] },
    }));

    const world = new World();
    world.upsertHero(hero({ sessionId: 's1', projectDir: 'PD', workingDir: wd, projectName: 'proj' }));

    const events: GameEvent[] = [];
    world.onEvent((e) => { if (e.type === 'arsenal-updated') events.push(e); });

    const poller = new ArsenalPoller(world, os.tmpdir() /* homeDir override */);
    await poller.refreshOnce();
    await poller.refreshOnce();

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('arsenal-updated');
    if (events[0].type === 'arsenal-updated') {
      expect(events[0].arsenal.projectDir).toBe('PD');
      expect(events[0].arsenal.hooks).toContainEqual({ event: 'SessionStart', command: 'bd prime', origin: 'project' });
    }
    await fs.rm(wd, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-poller`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja**

```ts
import os from 'node:os';
import type { ProjectArsenal } from '@agent-citadel/shared';
import type { World } from '../world.js';
import { readSkills } from './readers/skills.js';
import { readConnectors } from './readers/connectors.js';
import { readHooks } from './readers/hooks.js';
import { readAgents } from './readers/agents.js';

const POLL_INTERVAL_MS = 4000;

interface CacheEntry { fingerprint: string; lastSeenMs: number; }

/** Fingerprint BEZ refreshedAt — emitujemy tylko gdy realnie się zmieni. */
function fingerprint(a: ProjectArsenal): string {
  return [
    a.activeSessions,
    a.skills.map((s) => s.id).sort().join(','),
    a.connectors.map((c) => c.name).sort().join(','),
    a.hooks.map((h) => `${h.event}:${h.command}`).sort().join(','),
    a.agents.map((x) => x.name).sort().join(','),
  ].join('|');
}

/**
 * Czyta statyczny „Arsenał" (skille/MCP/hooki/subagenci) z każdego aktywnego projektu
 * i emituje `arsenal-updated`. Zastępuje ProjectIntelPoller (beads/graphify).
 */
export class ArsenalPoller {
  private cache = new Map<string, CacheEntry>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly world: World, private readonly homeDir: string = os.homedir()) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshOnce();
    this.timer = setInterval(() => void this.refreshOnce(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Jeden obieg po wszystkich aktywnych projektach (publiczne dla testów). */
  async refreshOnce(): Promise<void> {
    const projectDirs = this.world.activeProjectDirs();
    for (const dir of projectDirs) {
      try {
        await this.refreshProject(dir);
      } catch (err) {
        console.error('[arsenal] refresh failed for', dir, err);
      }
    }
    // GC: usuń cache katalogów bez aktywnych sesji po 60s.
    const active = new Set(projectDirs);
    for (const dir of [...this.cache.keys()]) {
      if (!active.has(dir) && Date.now() - (this.cache.get(dir)?.lastSeenMs ?? 0) > 60_000) {
        this.cache.delete(dir);
      }
    }
  }

  private async refreshProject(projectDir: string): Promise<void> {
    const heroes = this.world.heroesByProject(projectDir);
    // Pliki czytamy z REALNEGO cwd bohatera (workingDir), fallback na projectDir.
    const workingDir = heroes.find((h) => h.workingDir)?.workingDir ?? projectDir;
    const opts = { workingDir, homeDir: this.homeDir };
    const [skills, connectors, hooks, agents] = await Promise.all([
      readSkills(opts), readConnectors(opts), readHooks(opts), readAgents(opts),
    ]);
    const arsenal: ProjectArsenal = {
      projectDir,
      projectName: heroes[0]?.projectName ?? projectDir.split(/[\\/]/).pop() ?? projectDir,
      activeSessions: heroes.length,
      skills, connectors, hooks, agents,
      refreshedAt: Date.now(),
    };
    const fp = fingerprint(arsenal);
    const prev = this.cache.get(projectDir);
    if (prev && prev.fingerprint === fp) {
      prev.lastSeenMs = Date.now();
      return;
    }
    this.cache.set(projectDir, { fingerprint: fp, lastSeenMs: Date.now() });
    this.world.emitCustom({ type: 'arsenal-updated', arsenal });
  }
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- arsenal-poller`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/arsenal/arsenal-poller.ts packages/server/test/arsenal-poller.test.ts
git commit -m "feat(arsenal): ArsenalPoller (statyczny ekwipunek per miasto) (AgeOfAgents-g0v)"
```

---

## Task 8: Fakt `attribution` w parserze (serwer)

**Files:**
- Modify: `packages/server/src/transcript/facts.ts`
- Modify: `packages/server/src/transcript/parser.ts`
- Test: `packages/server/test/parser.test.ts` (dopisz przypadek)

- [ ] **Step 1: Dodaj kind do `Fact`**

W `packages/server/src/transcript/facts.ts`, w unii `Fact`, dodaj wariant (przed `'awaiting'`):

```ts
  | { kind: 'attribution'; skill?: string; plugin?: string; mcpServer?: string }
```

- [ ] **Step 2: Napisz failing test** (dopisz w `parser.test.ts`)

```ts
  it('wyciąga atrybucję skilla/pluginu/mcp z rekordu assistant', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-17T10:00:00.000Z',
      attributionSkill: 'superpowers:brainstorming',
      attributionPlugin: 'superpowers',
      attributionMcpServer: 'visualize',
      message: { id: 'm1', content: [] },
    });
    const facts = interpretLine(line);
    expect(facts).toContainEqual({
      kind: 'attribution', skill: 'superpowers:brainstorming', plugin: 'superpowers', mcpServer: 'visualize',
    });
  });
```

- [ ] **Step 3: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- parser`
Expected: FAIL (brak faktu `attribution`).

- [ ] **Step 4: Implementacja w `parser.ts`**

W `interpretLine`, w gałęzi `case 'assistant':`, po wypchnięciu faktu `meta` (ok. linii 103–108), dodaj:

```ts
      if (
        typeof record.attributionSkill === 'string' ||
        typeof record.attributionPlugin === 'string' ||
        typeof record.attributionMcpServer === 'string'
      ) {
        facts.push({
          kind: 'attribution',
          skill: typeof record.attributionSkill === 'string' ? record.attributionSkill : undefined,
          plugin: typeof record.attributionPlugin === 'string' ? record.attributionPlugin : undefined,
          mcpServer: typeof record.attributionMcpServer === 'string' ? record.attributionMcpServer : undefined,
        });
      }
```

- [ ] **Step 5: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- parser`
Expected: PASS (wszystkie testy parsera).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/transcript/facts.ts packages/server/src/transcript/parser.ts packages/server/test/parser.test.ts
git commit -m "feat(arsenal): fakt attribution z transkryptu (AgeOfAgents-g0v)"
```

---

## Task 9: Akumulacja `wielded` w SessionTracker (serwer)

**Files:**
- Modify: `packages/server/src/state-machine.ts`
- Test: `packages/server/test/state-machine.test.ts` (dopisz przypadek)

- [ ] **Step 1: Napisz failing test** (dopisz w `state-machine.test.ts`)

Wzoruj się na istniejących testach pliku (konstrukcja `World` + `SessionTracker`). Minimalny przypadek:

```ts
  it('kumuluje wielded z faktów attribution na bohaterze', () => {
    const world = new World();
    const tracker = new SessionTracker(world, 'sX', 'PD');
    tracker.apply({ kind: 'attribution', skill: 'superpowers:brainstorming', mcpServer: 'visualize' });
    tracker.apply({ kind: 'attribution', plugin: 'superpowers' });
    tracker.apply({ kind: 'attribution', skill: 'superpowers:brainstorming' }); // duplikat
    const hero = world.getHero('sX')!;
    expect(hero.wielded).toEqual({
      skills: ['superpowers:brainstorming'],
      connectors: ['visualize'],
      plugins: ['superpowers'],
    });
  });
```

> Sprawdź nagłówek istniejącego `state-machine.test.ts` i dopasuj importy (`World`, `SessionTracker`) oraz sygnaturę konstruktora (`(world, sessionId, projectDir)`).

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/server -- state-machine`
Expected: FAIL (`hero.wielded` undefined).

- [ ] **Step 3: Implementacja**

W `packages/server/src/state-machine.ts`:

a) Import typu na górze:
```ts
import type { ActionEntry, AgentKind, HeroSnapshot, HeroStateKind, WieldedArsenal } from '@agent-citadel/shared';
```

b) Pola w klasie `SessionTracker` (obok innych `private`):
```ts
  private wieldedSkills = new Set<string>();
  private wieldedConnectors = new Set<string>();
  private wieldedPlugins = new Set<string>();
```

c) Helper (metoda prywatna):
```ts
  private wielded(): WieldedArsenal {
    return {
      skills: [...this.wieldedSkills],
      connectors: [...this.wieldedConnectors],
      plugins: [...this.wieldedPlugins],
    };
  }
```

d) W builderze `hero()` dodaj pole do zwracanego obiektu (przed `startedAt`):
```ts
      wielded: this.wielded(),
```

e) Nowy `case` w `apply(fact)` (przed `case 'awaiting':`):
```ts
      case 'attribution': {
        let changed = false;
        if (fact.skill && !this.wieldedSkills.has(fact.skill)) { this.wieldedSkills.add(fact.skill); changed = true; }
        if (fact.mcpServer && !this.wieldedConnectors.has(fact.mcpServer)) { this.wieldedConnectors.add(fact.mcpServer); changed = true; }
        if (fact.plugin && !this.wieldedPlugins.has(fact.plugin)) { this.wieldedPlugins.add(fact.plugin); changed = true; }
        if (changed) this.patch({ wielded: this.wielded() });
        break;
      }
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/server -- state-machine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/state-machine.ts packages/server/test/state-machine.test.ts
git commit -m "feat(arsenal): akumulacja wielded na bohaterze (AgeOfAgents-g0v)"
```

---

## Task 10: Podmiana pollera w server.ts

**Files:**
- Modify: `packages/server/src/server.ts`

Edycja jest izolowana do `server.ts` (nie dotyka `intel/project-intel-poller.ts`) — żeby nie kolidować z agentem od graphify.

- [ ] **Step 1: Podmień import i start**

W `packages/server/src/server.ts`:
- Linia 6: zamień
  ```ts
  import { ProjectIntelPoller } from './intel/project-intel-poller.js';
  ```
  na
  ```ts
  import { ArsenalPoller } from './arsenal/arsenal-poller.js';
  ```
- Ok. linii 69–70: zamień
  ```ts
      // `project-intel-updated` event do klienta (panel "Salonu Architekta").
      new ProjectIntelPoller(world).start();
  ```
  na
  ```ts
      // `arsenal-updated` event do klienta (panel Arsenału).
      new ArsenalPoller(world).start();
  ```

- [ ] **Step 2: Typecheck serwera**

Run: `npm run build -w @agent-citadel/server`
Expected: PASS.

- [ ] **Step 3: Pełne testy serwera (regresja)**

Run: `npm run test -w @agent-citadel/server`
Expected: PASS (wszystkie, w tym nowe arsenal-*).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat(arsenal): podłącz ArsenalPoller zamiast ProjectIntelPoller (AgeOfAgents-g0v)"
```

---

## Task 11: Stan `arsenal` w store (klient)

**Files:**
- Modify: `packages/client/src/store.ts`
- Test: `packages/client/tests/store.test.ts` (dopisz przypadek; jeśli plik nie istnieje — utwórz wg wzoru poniżej)

Zachowujemy `projectIntel` aż do Task 14 (build addytywny). Dodajemy `arsenal` obok.

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it } from 'vitest';
import { useWorld } from '../src/store';
import type { ProjectArsenal } from '@agent-citadel/shared';

function arsenal(over: Partial<ProjectArsenal>): ProjectArsenal {
  return { projectDir: 'PD', projectName: 'p', activeSessions: 1, skills: [], connectors: [], hooks: [], agents: [], refreshedAt: 1, ...over };
}

describe('store arsenal-updated', () => {
  it('zapisuje arsenał per projectDir', () => {
    useWorld.getState().apply({ type: 'arsenal-updated', arsenal: arsenal({ projectDir: 'PD' }) });
    expect(useWorld.getState().arsenal['PD']?.projectName).toBe('p');
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/client -- store`
Expected: FAIL (`arsenal` undefined / brak case).

- [ ] **Step 3: Implementacja w `store.ts`**

a) Import typu:
```ts
import type { /* …istniejące… */ ProjectArsenal } from '@agent-citadel/shared';
```
(dodaj `ProjectArsenal` do istniejącej listy importów z `@agent-citadel/shared`).

b) W interfejsie `WorldStore` dodaj pole (obok `projectIntel`):
```ts
  /** Statyczny Arsenał per projectDir (Źródło A). */
  arsenal: Record<string, ProjectArsenal>;
```

c) W inicjalizacji store (obok `projectIntel: {}`):
```ts
  arsenal: {},
```

d) W `apply`, nowy `case` (obok `project-intel-updated`):
```ts
        case 'arsenal-updated': {
          return { arsenal: { ...state.arsenal, [event.arsenal.projectDir]: event.arsenal } };
        }
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/client -- store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/store.ts packages/client/tests/store.test.ts
git commit -m "feat(arsenal): stan arsenal w store (AgeOfAgents-g0v)"
```

---

## Task 12: Agregacja `wielded` + etykiety i18n (klient)

**Files:**
- Create: `packages/client/src/hud/arsenal-select.ts`
- Test: `packages/client/tests/arsenal-select.test.ts`
- Modify: `packages/client/src/i18n.ts`

- [ ] **Step 1: Napisz failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { HeroSnapshot } from '@agent-citadel/shared';
import { aggregateWielded, bareName } from '../src/hud/arsenal-select';

function hero(over: Partial<HeroSnapshot>): HeroSnapshot {
  return { sessionId: 's', title: 't', projectDir: 'PD', teamColor: 0, state: 'idle', tokens: { input: 0, output: 0 }, startedAt: '', lastActivityAt: '', ...over } as HeroSnapshot;
}

describe('aggregateWielded', () => {
  it('łączy wielded bohaterów danego miasta i normalizuje nazwy skilli', () => {
    const heroes = {
      a: hero({ sessionId: 'a', projectDir: 'PD', wielded: { skills: ['superpowers:brainstorming'], connectors: ['visualize'], plugins: ['superpowers'] } }),
      b: hero({ sessionId: 'b', projectDir: 'PD', wielded: { skills: ['code-review'], connectors: [], plugins: [] } }),
      c: hero({ sessionId: 'c', projectDir: 'OTHER', wielded: { skills: ['x'], connectors: [], plugins: [] } }),
    };
    const w = aggregateWielded(heroes, 'PD');
    expect(new Set(w.skills)).toEqual(new Set(['brainstorming', 'code-review']));
    expect(w.connectors).toEqual(['visualize']);
  });

  it('bareName ucina namespace pluginu', () => {
    expect(bareName('superpowers:brainstorming')).toBe('brainstorming');
    expect(bareName('plain')).toBe('plain');
  });
});
```

- [ ] **Step 2: Uruchom — ma FAILOWAĆ**

Run: `npm run test -w @agent-citadel/client -- arsenal-select`
Expected: FAIL (brak modułu).

- [ ] **Step 3: Implementacja `arsenal-select.ts`**

```ts
import type { HeroSnapshot, WieldedArsenal } from '@agent-citadel/shared';

/** Goła nazwa skilla (ucina namespace pluginu: 'superpowers:brainstorming' → 'brainstorming'). */
export function bareName(id: string): string {
  return id.split(':').pop() ?? id;
}

/** Unia `wielded` bohaterów danego miasta. Skille znormalizowane do gołej nazwy
 *  (pasują do ArsenalSkill.id z frontmattera). Konektory/pluginy 1:1. */
export function aggregateWielded(heroes: Record<string, HeroSnapshot>, projectDir: string): WieldedArsenal {
  const skills = new Set<string>();
  const connectors = new Set<string>();
  const plugins = new Set<string>();
  for (const h of Object.values(heroes)) {
    if (h.projectDir !== projectDir || !h.wielded) continue;
    h.wielded.skills.forEach((s) => skills.add(bareName(s)));
    h.wielded.connectors.forEach((c) => connectors.add(c));
    h.wielded.plugins.forEach((p) => plugins.add(p));
  }
  return { skills: [...skills], connectors: [...connectors], plugins: [...plugins] };
}
```

- [ ] **Step 4: Uruchom — ma PRZEJŚĆ**

Run: `npm run test -w @agent-citadel/client -- arsenal-select`
Expected: PASS (2 testy).

- [ ] **Step 5: Dodaj etykiety i18n**

W `packages/client/src/i18n.ts`:

a) W `interface UiStrings` (obok `symbols/edges/communities`, ok. linii 59–61) dodaj:
```ts
  arsenal: string;
  skills: string;
  connectors: string;
  hooks: string;
  subagents: string;
  usedThisSession: string;
```

b) W `EN` (ok. linii 122) dodaj:
```ts
  arsenal: 'Arsenal',
  skills: 'Skills',
  connectors: 'Connectors',
  hooks: 'Hooks',
  subagents: 'Subagents',
  usedThisSession: 'used',
```

c) W `PL` (ok. linii 185) dodaj:
```ts
  arsenal: 'Arsenał',
  skills: 'Skille',
  connectors: 'Konektory',
  hooks: 'Hooki',
  subagents: 'Subagenci',
  usedThisSession: 'użyto',
```

d) W `IT` (ok. linii 248) dodaj:
```ts
  arsenal: 'Arsenale',
  skills: 'Skill',
  connectors: 'Connettori',
  hooks: 'Hook',
  subagents: 'Subagenti',
  usedThisSession: 'usato',
```

- [ ] **Step 6: Typecheck klienta**

Run: `npx tsc --noEmit -p packages/client`
Expected: PASS (każdy `UiStrings` ma komplet kluczy).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/hud/arsenal-select.ts packages/client/tests/arsenal-select.test.ts packages/client/src/i18n.ts
git commit -m "feat(arsenal): agregacja wielded + etykiety i18n (AgeOfAgents-g0v)"
```

---

## Task 13: Przepisanie panelu na Arsenał (klient)

**Files:**
- Modify: `packages/client/src/hud/ArchitectHall.tsx` (pełne zastąpienie zawartości)

Zachowujemy nazwę pliku i eksport `ArchitectHall` (mniejszy blast radius w `App.tsx`). Styl HUD identyczny jak dotąd (karty `#2a2926`, inset-shadow, font Pixelify, layout absolutny po prawej).

- [ ] **Step 1: Zastąp całą zawartość pliku**

```tsx
import { useMemo, useState, type ReactNode } from 'react';
import type { ArsenalAgent, ArsenalConnector, ArsenalHook, ArsenalSkill, ProjectArsenal } from '@agent-citadel/shared';
import { useWorld } from '../store';
import { useUi } from '../i18n';
import { relTime } from '../util';
import { aggregateWielded } from './arsenal-select';

/**
 * Arsenał: panel boczny pokazujący efektywny ekwipunek agentów wybranego miasta —
 * skille, konektory MCP, hooki, subagenci (projekt ∪ user ∪ plugin, z tagiem źródła),
 * z podświetleniem tego, co bohaterowie REALNIE wyciągnęli w tej sesji (wielded).
 */
export function ArchitectHall() {
  const selected = useWorld((s) => s.selectedProjectDir);
  const arsenal = useWorld((s) => (selected ? s.arsenal[selected] : undefined));
  const heroes = useWorld((s) => s.heroes);
  const t = useUi();

  const wielded = useMemo(() => aggregateWielded(heroes, selected ?? ''), [heroes, selected]);
  const sessionCount = useMemo(
    () => (selected ? Object.values(heroes).filter((h) => h.projectDir === selected).length : 0),
    [heroes, selected],
  );

  if (!selected) return null;

  return (
    <div
      className="hud-panel px"
      style={{ position: 'absolute', top: 60, right: 16, width: 360, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', zIndex: 9, overflow: 'hidden' }}
    >
      <Header arsenal={arsenal} projectDir={selected} sessionCount={sessionCount} title={t.arsenal} />
      {arsenal ? <Body arsenal={arsenal} wielded={wielded} t={t} /> : <EmptyBody />}
    </div>
  );
}

function Header({ arsenal, projectDir, sessionCount, title }: { arsenal: ProjectArsenal | undefined; projectDir: string; sessionCount: number; title: string }) {
  const name = arsenal?.projectName ?? projectDir.split(/[\\/]/).pop() ?? projectDir;
  const refreshed = arsenal ? relTime(new Date(arsenal.refreshedAt).toISOString(), Date.now(), 'now') : '—';
  return (
    <div style={{ padding: '10px 12px', borderBottom: '2px solid #3a3a36', background: '#2a2926', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, color: '#f1efe8', textShadow: '1px 1px 0 #000' }}>🏛️ {name}</span>
        <span style={{ fontSize: 10, color: '#a8a69d' }}>{title} · {refreshed}</span>
      </div>
      <div style={{ fontSize: 11, color: '#a8a69d' }}>👥 {sessionCount} active</div>
    </div>
  );
}

function EmptyBody() {
  return (
    <div style={{ padding: 16, fontSize: 12, color: '#a8a69d', textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
      Scanning project…
      <div style={{ fontSize: 10, marginTop: 8, color: '#6b6a63' }}>
        Reading <code>.claude/</code> skills · MCP · hooks · agents
      </div>
    </div>
  );
}

const ORIGIN_LABEL: Record<string, string> = { project: 'P', user: 'U', plugin: '⧉' };
const ORIGIN_COLOR: Record<string, string> = { project: '#5dcaa5', user: '#85b7eb', plugin: '#f0b56e' };

type Wielded = ReturnType<typeof aggregateWielded>;
type Ui = ReturnType<typeof useUi>;

function Body({ arsenal, wielded, t }: { arsenal: ProjectArsenal; wielded: Wielded; t: Ui }) {
  const usedSkills = new Set(wielded.skills);
  const usedConnectors = new Set(wielded.connectors);
  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Section icon="🪄" label={t.skills} count={arsenal.skills.length}>
        {arsenal.skills.map((s: ArsenalSkill) => (
          <Row key={`sk-${s.id}`} name={s.id} sub={s.description} origin={s.origin} used={usedSkills.has(s.id)} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🔌" label={t.connectors} count={arsenal.connectors.length}>
        {arsenal.connectors.map((c: ArsenalConnector) => (
          <Row key={`co-${c.name}`} name={c.name} sub={c.transport} origin={c.origin} used={usedConnectors.has(c.name)} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🪝" label={t.hooks} count={arsenal.hooks.length}>
        {arsenal.hooks.map((h: ArsenalHook, i) => (
          <Row key={`hk-${h.event}-${i}`} name={h.event} sub={h.command.split(/[\\/]/).pop()} origin={h.origin} used={false} usedLabel={t.usedThisSession} />
        ))}
      </Section>
      <Section icon="🤖" label={t.subagents} count={arsenal.agents.length}>
        {arsenal.agents.map((a: ArsenalAgent) => (
          <Row key={`ag-${a.name}`} name={a.name} sub={a.description} origin={a.origin} used={false} usedLabel={t.usedThisSession} />
        ))}
      </Section>
    </div>
  );
}

function Section({ icon, label, count, children }: { icon: string; label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: '#45443f', color: '#f1efe8', border: 'none', padding: '6px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'Pixelify Sans, system-ui, sans-serif', textShadow: '1px 1px 0 #000' }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{icon} {label}</span>
        <span style={{ marginLeft: 'auto', background: '#2a2926', color: '#a8a69d', padding: '0 5px', fontSize: 10 }}>{count}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
          {count === 0 ? <div style={{ fontSize: 10, color: '#6b6a63', padding: '4px 8px' }}>—</div> : children}
        </div>
      )}
    </div>
  );
}

function Row({ name, sub, origin, used, usedLabel }: { name: string; sub?: string; origin: string; used: boolean; usedLabel: string }) {
  return (
    <div style={{ background: '#2a2926', boxShadow: 'inset 1px 1px 0 #45443f, inset -1px -1px 0 #15140f', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span title={origin} style={{ background: ORIGIN_COLOR[origin] ?? '#888780', color: '#15140f', padding: '0 4px', fontSize: 9, fontWeight: 700 }}>
        {ORIGIN_LABEL[origin] ?? '?'}
      </span>
      <span style={{ color: '#f1efe8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: sub ? 140 : 260 }}>{name}</span>
      {sub && <span style={{ color: '#6b6a63', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sub}</span>}
      {used && <span style={{ marginLeft: 'auto', color: '#5dcaa5', fontSize: 9 }}>● {usedLabel}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck klienta**

Run: `npx tsc --noEmit -p packages/client`
Expected: PASS.

- [ ] **Step 3: Weryfikacja wizualna (preview)**

Uruchom serwer demo + klienta i sprawdź panel w przeglądarce (porty: serwer 8123, klient 5173):

Run (w tle): `npm run demo`
Następnie w preview: otwórz `http://localhost:5173`, kliknij miasto (projekt) na mapie → po prawej pojawia się panel „Arsenał" z 4 zwijanymi sekcjami, plakietkami `P/U/⧉` i — gdy bohater użył skilla/MCP — markerem „● użyto".

Oczekiwane: panel renderuje się w stylu HUD, sekcje zwijają się, liczniki zgadzają się z listami. Brak błędów w konsoli (`preview_console_logs`).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hud/ArchitectHall.tsx
git commit -m "feat(arsenal): panel Arsenału (skille/MCP/hooki/subagenci + used) (AgeOfAgents-g0v)"
```

---

## Task 14: Sprzątanie beads/graphify (GATED)

> **GATE:** Wykonaj DOPIERO po decyzji autora ws. pracy drugiego agenta nad graphify
> (pauza / porzucenie / merge). To zadanie usuwa kod, na którym tamten może pracować.

**Files:**
- Modify: `packages/shared/src/index.ts` (usuń `ProjectIntel`, `BeadsIssue`, `GraphifySummary`, wariant `project-intel-updated` z `GameEvent`)
- Delete: `packages/server/src/intel/project-intel-poller.ts` (+ katalog `intel/` jeśli pusty)
- Modify: `packages/client/src/store.ts` (usuń `projectIntel`, case `project-intel-updated`)
- Delete: testy beads/graphify, jeśli istnieją (`rg -l "project-intel|ProjectIntel|graphify|beads" packages/*/test*`)

- [ ] **Step 1: Usuń typy ze `shared`**

W `packages/shared/src/index.ts` usuń: obie deklaracje `interface ProjectIntel`, obie `interface BeadsIssue`, obie `interface GraphifySummary` oraz powiązane komentarze, a z `GameEvent` usuń linię `| { type: 'project-intel-updated'; intel: ProjectIntel };`.

- [ ] **Step 2: Usuń poller i wpięcie**

```bash
rm packages/server/src/intel/project-intel-poller.ts
rmdir packages/server/src/intel 2>/dev/null || true
```
Upewnij się, że `server.ts` już NIE importuje `ProjectIntelPoller` (zrobione w Task 10).

- [ ] **Step 3: Usuń `projectIntel` ze store klienta**

W `packages/client/src/store.ts` usuń pole `projectIntel` z interfejsu i inicjalizacji oraz `case 'project-intel-updated'` z `apply`.

- [ ] **Step 4: Znajdź i usuń martwe odwołania**

Run: `rg -n "ProjectIntel|project-intel|BeadsIssue|GraphifySummary|projectIntel|graphify|beads" packages/shared packages/server/src packages/client/src`
Expected: brak trafień (poza ewentualnie komentarzami w docs). Usuń pozostałości.

- [ ] **Step 5: Pełny typecheck + testy**

Run: `npm test`
Run: `npx tsc --noEmit -p packages/client`
Expected: PASS oba.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(arsenal): usuń martwy beads/graphify (ProjectIntel) (AgeOfAgents-g0v)"
```

---

## Definition of Done

- [ ] Panel po prawej pokazuje Arsenał wybranego miasta: 4 zwijane sekcje, efektywny zestaw z plakietkami źródła.
- [ ] Skille/MCP użyte w sesji mają marker „● użyto" (z atrybucji transkryptu).
- [ ] `npm test` zielone; `npx tsc --noEmit -p packages/client` zielone; `npm run build -w @agent-citadel/server` zielone.
- [ ] Beads/graphify (`ProjectIntel`) usunięte (po przejściu GATE z Task 14).
- [ ] `bd close AgeOfAgents-g0v` po zmergowaniu.
