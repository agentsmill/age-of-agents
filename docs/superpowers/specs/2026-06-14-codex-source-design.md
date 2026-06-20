# Spec — Faza 1: źródło Codex (wieloagentowość)

Data: 2026-06-14
Status: zatwierdzony do implementacji

## Cel

Wizualizować sesje **Codex** obok Claude w tym samym świecie RTS. Bohater Codeksa
wychodzi z Twierdzy jak każdy inny; jego narzędzia (`exec_command`, `apply_patch`,
`tool_search_call`, `js`, `web.run`...) kierują go do tych samych budynków; **odznaka „C"** odróżnia go od
Claude. Rdzeń gry (maszyna stanów, świat, klient) bez zmian semantycznych —
dokładamy **źródło**, które produkuje `Fact[]`.

Motywacja: „żeby to nie było tylko od Claude Code".

## Decyzje (z brainstormingu)

1. **Zakres fazowy:** najpierw Codex, OpenCode jako osobny cykl spec→plan→impl.
2. **Odróżnienie wizualne:** odznaka/herb przy jednostce + w panelu (pole `agent`
   w `HeroSnapshot`); bez nowych sprite'ów bohaterów.
3. **Architektura:** lekki **rejestr adapterów** (`AgentSource`) — jeden watcher
   na adapter, wspólny `World`.

## Poza zakresem Fazy 1

- **OpenCode** (SQLite + serwer SSE / pluginy) — osobny cykl.
- **Hooki Codeksa** (`codex_hooks`, exec-based) — zostajemy na watcherze plików;
  rollouty JSONL są źródłem prawdy.
- **Pierwotnie:** historyczna atrybucja tokenów per budynek dla Codeksa była
  poza zakresem. **Aktualizacja 2026-06-20:** `/building-stats` skanuje teraz
  zarówno `~/.claude/projects`, jak i `~/.codex/sessions`; dla Codeksa przypisuje
  deltę `token_count.output_tokens` do ostatniego widzianego narzędzia.
- **Peony/subagenci dla Codeksa** — Codex nie ma struktury subagentów; logika
  peonów zostaje, lecz dla Codeksa nieużywana.

## Architektura — szew adapterów

Nowy katalog `packages/server/src/sources/`:

```
sources/types.ts    — AgentKind, ClassifiedFile, interfejs AgentSource
sources/claude.ts   — obecna logika Claude wyjęta tu (root, classify, parseLine=interpretLine)
sources/codex.ts    — nowe: root ~/.codex/sessions, classify rolloutów, parser Codeksa
sources/index.ts    — rejestr: [claudeSource, codexSource]
```

Interfejs:

```ts
export type AgentKind = 'claude' | 'codex'; // | 'opencode' (Faza 2) — w shared

export interface ClassifiedFile {
  kind: 'session' | 'subagent' | 'other';
  sessionId?: string;
  projectDir?: string;
  agentId?: string;          // subagent
  parentSessionId?: string;  // subagent
}

export interface AgentSource {
  id: AgentKind;
  roots(): string[];
  depth?: number;                                  // głębokość chokidar (domyślnie 6)
  classify(path: string, root: string): ClassifiedFile;
  parseLine(line: string): Fact[];                 // czysta funkcja — testowalna
}
```

`watcher.ts`: `TranscriptWatcher` → **`SourceWatcher(source, world, thresholds)`**.
`root`, `classify`, `parseLine` pochodzą z adaptera; reszta (TailRegistry, kolejka,
sweep, peony, applyExternalFacts) bez zmian. Serwer (`index.ts`) startuje **po
jednym watcherze na adapter**; oba piszą do wspólnego `World`. Kanał `/hooks`
zostaje **Claude-only** — serwer trzyma referencję do watchera Claude dla
`applyExternalFacts`.

`SessionTracker` dostaje parametr `agent: AgentKind`, który ląduje w `HeroSnapshot`.
Klucz bohatera = `sessionId` (UUID — kolizje między CLI praktycznie niemożliwe).

### Różnica: ścieżka Codeksa nie koduje projektu

- Claude: `projects/<projekt>/<uuid>.jsonl` — projekt z katalogu (parts.length === 2).
- Codex: `sessions/RRRR/MM/DD/rollout-<ts>-<uuid>.jsonl` — data, nie projekt
  (parts.length === 4).

Stąd: `sessionId` z UUID w nazwie pliku (regex
`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`); `projectName`
z `cwd` w rekordzie `session_meta` (fakt `meta`). Istniejąca ścieżka
`meta.cwd → projectName` w maszynie stanów obsłuży to bez zmian. `projectDir`
Codeksa = pusty / pochodna daty (niewykorzystywany do nazwy).

## Parser Codeksa (`sources/codex.ts`)

Defensywny jak `interpretLine` (nieznany/uszkodzony rekord → `[]`).

| Rekord Codeksa | Fakt |
|---|---|
| `turn_context` → `payload.cwd`, `payload.model` | `meta {cwd, model?}` |
| `session_meta` → `payload.cwd`, `payload.model` | `meta {cwd, model?}`; `model_provider: openai` nie jest nazwą modelu |
| `response_item` / `payload.type='message'` role `user` (po filtrze) | `prompt` |
| `response_item` / `payload.type='message'` role `assistant` (`output_text`) | `assistant-text` |
| `response_item` / `payload.type='reasoning'` | `thinking` |
| `response_item` / `payload.type='function_call'` (`name`,`arguments`) | `tool-start` (nazwa znormalizowana) |
| `response_item` / `payload.type='custom_tool_call'` (`name`,`input`) | `tool-start` (nazwa znormalizowana) |
| `response_item` / `payload.type='tool_search_call'` | `tool-start {tool: ToolSearch}` |
| `response_item` / `payload.type='function_call_output'` (błąd?) | `tool-result {isError}` |
| `event_msg` / `payload.type='token_count'` (`total_token_usage`, `last_token_usage`, `model_context_window`) | `usage-total` |
| `event_msg` / `payload.type='task_complete'` | `turn-end` |

### Nowy wariant faktu: `usage-total`

W `facts.ts`: `{ kind: 'usage-total'; input: number; output: number; context?;
cachedInput?; reasoningOutput?; last? }`.

Powód: `token_count` Codeksa jest **kumulatywny** (suma sesji), a istniejący
`usage` jest **przyrostowy** (delta per wiadomość, dedup po `messageId`).
Maszyna stanów na `usage-total` **ustawia** `tokens` (`{ input, output }`) zamiast
dodawać oraz zapisuje `contextTokens`, kiedy parser dostaje `model_context_window`.
Mała, czysta zmiana — i poprawna dla Codeksa.

### Normalizacja narzędzi (Codex → nazwa kanoniczna)

Robiona w parserze, żeby klient pozostał „głupi" (`toolToBuilding` w shared bez
zmian). Funkcja `codexToolToCanonical(name)`:

- `shell` / `local_shell` / `exec` / `exec_command` / `functions.exec_command` → `Bash` (kopalnia; detekcja `git` z
  `arguments` nadal kieruje na targ)
- `apply_patch` → `Edit` (kuźnia)
- `read_file` / `view_image` / `functions.view_image` → `Read` (biblioteka)
- `web_search` / `web.run` / `search_query` / `image_query` → `WebSearch` (wieża)
- `tool_search_call` / `tool_search_tool` / `tool_search.tool_search_tool` → `ToolSearch`
- `update_plan` / `functions.update_plan` / `create_goal` / `get_goal` / `update_goal`
  / `multi_tool_use.parallel` → `Workflow`
- `functions.request_user_input` → `AskUserQuestion`
- `js` → `mcp__node_repl__js`
- MCP (nazwa serwer__narzędzie / nieznana z separatorem) → `mcp__…` (gildia)
- nieznane narzędzia bez reguły → bez mapowania (twierdza)

`tool-start.detail` z `arguments`/`input` (parsowane JSON lub tekst): dla
`exec_command` — `cmd`; dla `apply_patch` — ścieżka pliku; dla `web.run` —
zapytanie; dla `update_plan` — pierwszy krok planu. Analogicznie do `toolDetail`
Claude.

## Warstwa wizualna (odznaka)

- **shared** (`index.ts`): typ `AgentKind`; pole `agent: AgentKind` w
  `HeroSnapshot` (brak → traktuj jak `'claude'` — zgodność wsteczna).
- **jednostka** (`game/unit.ts`): mały herb rysowany proceduralnie (PixiJS
  `Graphics` tarcza + 1-literowy glif „C") obok `nameTag` — **bez nowych assetów
  PNG**, themable. Claude bez odznaki (lub „A") — do ustalenia w implementacji,
  domyślnie tylko nie-Claude dostaje wyróżnik.
- **karta postaci** (`hud/SidePanel.tsx`, nagłówek ~linia 91): odznaka + etykieta
  agenta przy tytule (obok kropki drużyny).

## Testy

- `sources/codex.test.ts` — parser na syntetycznych liniach rolloutu:
  - prawdziwy prompt (role `user`) vs. wstrzyknięcia (`<environment_context>`,
    `AGENTS.md`, instrukcje permissions, role `developer`) → tylko prawdziwy daje
    `prompt`;
  - `function_call` `shell`/`apply_patch`/`web_search` → poprawna nazwa kanoniczna
    i budynek;
  - `token_count` → `usage-total`;
  - `task_complete` → `turn-end`;
  - nieznany rekord → `[]`.
- Test `classify`: regex UUID z nazwy rolloutu; głębokość ścieżki = 4; pliki nie-
  `rollout-*.jsonl` → `other`.
- Maszyna stanów: `usage-total` ustawia (nie dodaje) tokeny.

Wzorzec z istniejących `parser.test.ts` / `state-machine.test.ts`.

## Punkty wkładu użytkownika (learning)

Pliki z sygnaturą + kontekstem przygotowane; użytkownik dopisuje ~5-10 linii:

1. **`isCodexHumanPrompt(text, role)`** — heurystyka „prawdziwy prompt vs.
   wstrzyknięcia Codeksa" (analog `isHumanPrompt`).
2. **`codexToolToCanonical(name)`** — mapa narzędzie Codeksa → nazwa kanoniczna
   (serce metafory dla tego agenta).

## Ryzyka / uwagi

- Format rolloutu Codeksa różni się między wersjami CLI (`event_msg` vs.
  `response_item`, kształt `token_count`). Parser czyta defensywnie; pola
  opcjonalne, brak → fakt pomijany.
- Brak `turn-end` w starszych wersjach → misja domknie się dopiero przy
  usunięciu bohatera lub kolejnym promptcie. Akceptowalne.
- Kolizja `sessionId` między CLI: UUID, ryzyko pomijalne; gdyby zaszła, dwa
  bohaterowie zlałyby się w jednego (świadomie zaakceptowane w Fazie 1).
