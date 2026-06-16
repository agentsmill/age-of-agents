# Spec — Architect's Hall → Arsenał projektu

Data: 2026-06-17
Status: zatwierdzony do implementacji

## Cel

Przekuć panel „Architect's Hall" (dziś: abstrakcyjny intel beads + graphify per
projekt) w **Arsenał projektu** — panel pokazujący, **w co wyposażeni są agenci
w danym mieście**: skille, konektory MCP, hooki, subagenci. Zamiast statystyk
grafu kodu (rozwiązanie w poszukiwaniu problemu) pokazujemy ekwipunek agenta —
koncept natywnie RTS-owy (drzewko techu / loadout jednostki) i uniwersalny: każdy
projekt Claude Code ma `.claude/`, MCP-y, hooki, subagentów.

Motywacja (z brainstormingu, słowa autora): „fajnie widzimy projekty, gdzie były
skille, konektory i inne elementy, które są częścią agenta". To jest złoto —
beads/graphify nim nie były.

## Decyzje (z brainstormingu)

1. **Kasujemy generyczny „host na wtyczki".** Był przedwczesną abstrakcją dla
   feature'u o niepotwierdzonej wartości. Budujemy jedną konkretną, wartościową
   rzecz; gdyby kiedyś trzeba było piątą sekcję — wystarczy prosty rejestr w kodzie.
2. **Kasujemy beads + graphify jako „intel".** Abstrakcyjne staty (liczba węzłów,
   god-nodes) mówią mało widzowi RTS. Cała machineria `ProjectIntel` znika.
3. **Dwie warstwy danych, obie z realnych, zweryfikowanych źródeł:**
   - **A — statyczny config (ekwipunek):** co projekt *ma*. Czytane z dysku.
   - **B — atrybucja z transkryptu (log walki):** czego agent *faktycznie użył*.
     Live, per-bohater, agregowane per miasto.
4. **Zakres = efektywny, z tagiem źródła.** Suma `projekt ∪ user ∪ plugin` — to,
   czym agenci w mieście realnie dysponują — z plakietką pochodzenia (`P`/`U`/plugin).
   Panel zawsze ma treść (projekt bywa chudy; bogactwo jest na poziomie user/plugin).
5. **Trigger bez zmian:** panel pokazuje się po wybraniu miasta (`selectedProjectDir`).
6. **Budowa addytywna** (patrz „Ryzyko / kolejność") — żeby nie kolidować z agentem
   pracującym równolegle nad graphify.

## Zweryfikowane źródła danych

### Źródło A — statyczna konfiguracja (czytane z dysku)

| Sekcja | Skąd | Pole |
|---|---|---|
| 🪄 Skille | `<workingDir>/.claude/skills/*/SKILL.md`, `~/.claude/skills/*/SKILL.md`, `~/.claude/plugins/*/**/skills/*/SKILL.md` | frontmatter `name`, `description` |
| 🔌 Konektory MCP | `<workingDir>/.mcp.json` (`mcpServers`), `~/.claude.json` (`mcpServers` + `projects[<dir>].mcpServers`) | klucz = nazwa serwera; `command`/`url` → transport |
| 🪝 Hooki | `<workingDir>/.claude/settings.json` + `settings.local.json`, `~/.claude/settings.json` | `hooks[event][].hooks[].command` |
| 🤖 Subagenci | `<workingDir>/.claude/agents/*.md`, `~/.claude/agents/*.md` | frontmatter `name`, `description` |

Uwagi sprawdzone na realnym środowisku:
- `workingDir` to **realny cwd** bohatera (pole z transkryptu); `projectDir` dla
  źródła Claude jest *zakodowaną* nazwą folderu (`~/.claude/projects/<enc>`), więc
  pliki czytamy z `workingDir` (fallback `projectDir`) — tak jak robił to poller intelu.
- Liczby narzędzi per serwer MCP **nie ma** w configu (wymaga live-handshake) → poza v1.
- Poziom user/plugin (`~/.claude`) zmienia się rzadko → czytany raz i cache'owany,
  odświeżany co N obiegów pollera lub po zmianie mtime.

### Źródło B — atrybucja z transkryptu (parsowane z pliku sesji)

Rekordy `assistant` w `~/.claude/projects/<enc>/<sessionId>.jsonl` niosą pola:
`attributionSkill`, `attributionPlugin`, `attributionMcpServer`, `attributionMcpTool`.
Rekordy `type:"system"` (`subtype:"stop_hook_summary"`) niosą `hookInfos[].command`
+ `hookCount`. Zweryfikowane na żywej sesji (pokazywało `skill: superpowers:brainstorming`,
`mcp: visualize`, `tools: read_me/show_widget`). Watcher **już tail-uje** te pliki —
dokładamy tylko ekstrakcję pól.

## Architektura

### Shared (`packages/shared/src/`)

Nowy `arsenal.ts` (re-eksport z `index.ts`). **Usuwamy** `ProjectIntel`,
`BeadsIssue`, `GraphifySummary` oraz wariant `project-intel-updated` z `GameEvent`.

```ts
export type ArsenalOrigin = 'project' | 'user' | 'plugin';

export interface ArsenalSkill     { id: string; description?: string; origin: ArsenalOrigin; pluginName?: string; }
export interface ArsenalConnector { name: string; origin: ArsenalOrigin; transport?: 'stdio' | 'http' | 'sse'; }
export interface ArsenalHook      { event: string; command: string; origin: ArsenalOrigin; }
export interface ArsenalAgent     { name: string; description?: string; origin: ArsenalOrigin; }

/** Źródło A — statyczny ekwipunek miasta (zastępuje ProjectIntel). */
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

/** Źródło B — co bohater REALNIE wyciągnął (distinct sety z atrybucji). */
export interface WieldedArsenal { skills: string[]; connectors: string[]; plugins: string[]; }
```

Zmiany w istniejących typach:
- `HeroSnapshot` zyskuje opcjonalne `wielded?: WieldedArsenal`.
- `GameEvent`: `| { type: 'arsenal-updated'; arsenal: ProjectArsenal }` zamiast `project-intel-updated`.

### Serwer (`packages/server/src/`)

Katalog `intel/` → `arsenal/`:

```
arsenal/arsenal-poller.ts        — zastępuje project-intel-poller.ts (pętla 4s, fingerprint, emit-on-change)
arsenal/readers/skills.ts        — skan katalogów skilli + frontmatter
arsenal/readers/connectors.ts    — parse .mcp.json + ~/.claude.json
arsenal/readers/hooks.ts         — parse settings.json (projekt + user)
arsenal/readers/agents.ts        — skan .claude/agents + frontmatter
arsenal/frontmatter.ts           — minimalny parser bloku --- (name/description), bez zależności YAML
arsenal/user-config.ts           — czytanie + cache poziomu ~/.claude (user/plugin)
```

`arsenal-poller.ts` zachowuje kontrakt obecnego pollera: iteruje `world.activeProjectDirs()`,
dla każdego składa `ProjectArsenal` z czterech czytników (projekt z `workingDir`
+ cache'owany user/plugin), liczy fingerprint, emituje `arsenal-updated` tylko przy zmianie.

`transcript/parser.ts` — nowy `Fact` kind `attribution`:
```ts
| { kind: 'attribution'; skill?: string; plugin?: string; mcpServer?: string }
```
emitowany gdy rekord `assistant` ma którekolwiek z pól `attribution*`. Hooki użyte:
z rekordu `system`/`hookInfos`. `state-machine.ts` kumuluje distinct sety per sesja
i dokleja `wielded` do `HeroSnapshot`.

`server.ts:70`: `new ProjectIntelPoller(world).start()` → `new ArsenalPoller(world).start()`.

### Klient (`packages/client/src/`)

- `store.ts`: `projectIntel: Record<string, ProjectIntel>` → `arsenal: Record<string, ProjectArsenal>`;
  reducer case `arsenal-updated`. Warstwa „wielded" liczona **czysto po stronie klienta**:
  selektor unii `heroes[].wielded` dla bohaterów z `projectDir === selected` (klient już ma `heroes`).
- `hud/ArchitectHall.tsx` → przepisany na panel Arsenału (zachować pixel-styl HUD:
  karty `#2a2926`, inset-shadow, font Pixelify, ten sam layout absolutny po prawej).
  Struktura: nagłówek (nazwa + 4 liczniki + aktywne sesje) → 4 zwijane sekcje
  (Skille / Konektory / Hooki / Subagenci). Wiersz = ikona + nazwa + **plakietka źródła**
  (`P`/`U`/plugin) + **podświetlenie „użyto"** gdy nazwa ∈ zagregowany `wielded` miasta.
  Stany pusty/ładowanie jak dziś.
- `i18n.ts`: 4 nowe etykiety (skille/konektory/hooki/subagenci) we wszystkich językach (pl/en/it…).

```
Klient agreguje „wielded" lokalnie — brak nowego eventu dla warstwy B.
Nowy event arsenal-updated obsługuje wyłącznie warstwę A (statyczny config).
```

**Dopasowanie „użyto" (uwaga implementacyjna):** `attributionSkill` bywa
namespace'owane (`superpowers:brainstorming`), a `name` z frontmattera bywa gołe
(`brainstorming`). Aby podświetlenie nie chybiało, porównujemy po **gołej nazwie po
prawej stronie `:`** (`id.split(':').pop()`) zarówno dla skilli listowanych, jak i
użytych. Konektory MCP (`attributionMcpServer` = nazwa serwera, np. `visualize`)
dopasowują się 1:1 do `ArsenalConnector.name`.

## Zakres v1 vs poza v1

**v1 (must):** czytniki 4 sekcji (efektywne + origin), panel per-miasto, plakietki źródła.
**v1 (should):** atrybucja → „użyto w tej sesji" dla skilli + MCP (mała zmiana w parserze, to dusza feature'u).
**Poza v1:** liczba narzędzi per MCP (live-handshake), drill-down per pojedynczy bohater, licznik odpaleń hooków, warstwa B dla subagentów/hooków.

## Testy

Vitest w istniejących `packages/server/tests` + `packages/client/tests`:
- każdy czytnik (skills/connectors/hooks/agents) na fixture'owych katalogach,
- ekstrakcja atrybucji w `parser.ts` (rekord `assistant` z polami `attribution*`, rekord `system`/`hookInfos`),
- fingerprint pollera (emit tylko przy zmianie),
- kliencka agregacja `wielded` (unia per miasto, deduplikacja).
- Testy beads/graphify — usuwamy wraz z kodem.

## Ryzyko / kolejność (kolizja z agentem od graphify)

Inny agent pracuje równolegle nad graphify. Ten design kasuje machinerię beads/graphify.
Aby zminimalizować kolizję, **budujemy addytywnie**:
1. Dodaj typy `arsenal.ts`, event `arsenal-updated`, `arsenal/` poller, czytniki, atrybucję w parserze (beads/graphify zostają nietknięte).
2. Przełącz `ArchitectHall.tsx` na Arsenał, store na `arsenal`, serwer na `ArsenalPoller`.
3. **Na końcu** usuń martwy beads/graphify (`ProjectIntel`, `project-intel-updated`, `project-intel-poller.ts`, widoki Beads/Graphify, ich testy).

Los pracy drugiego agenta nad graphify — decyzja autora (pauza / porzucenie / merge przed krokiem 3).

## Nazewnictwo / motyw

Komponent: `ArchitectHall.tsx` (zostaje nazwa pliku — mniejszy blast radius w `App.tsx`),
w UI etykieta „Arsenał" (lub per `themeId`: fantasy „Zbrojownia", sci-fi „Loadout"). Metafora:
skille = zdolności, MCP = sojusznicze gildie, hooki = pułapki/automaty, subagenci = jednostki.
