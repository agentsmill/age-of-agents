# Design: `ai-of-agents` — instalacja przez npm CLI

Data: 2026-06-14
Status: zatwierdzony do planowania

## Cel

Udostępnić aplikację (dziś monorepo „Agent Citadel") jako jeden publiczny pakiet
npm, który użytkownik uruchamia jedną komendą:

```bash
npx ai-of-agents          # bez instalacji
# albo
npm i -g ai-of-agents && ai-of-agents
```

Komenda startuje serwer obserwujący prawdziwe sesje Claude Code i wypisuje URL
do otwarcia w przeglądarce.

## Stan wyjściowy (co jest dziś)

- Monorepo z npm workspaces: `packages/{shared,server,client}`, wszystkie `private: true`.
- **server**: Fastify + `ws`, uruchamiany przez `tsx` (TypeScript w runtime), port
  8123 (`SERVER_PORT` z `shared`), watcher `~/.claude/projects`, instalacja hooków
  do `~/.claude/settings.json`. Serwuje tylko API + WebSocket — **nie** serwuje klienta.
- **client**: Vite + React 19 + PixiJS v8. W dev Vite serwuje klienta i proxuje
  `/ws`, `/hooks`, `/health`, `/building-stats` na serwer. Assety w
  `packages/client/public/assets/` (własne atlasy PixelLab, małe PNG, w repo).
- **shared**: typy protokołu WS, eksportowane jako `./src/index.ts`.
- Root `build` = `tsc --noEmit` (sam typecheck, **bez emitu JS**) → realnego
  artefaktu do publikacji jeszcze nie ma.
- `agent-citadel` i `ai-of-agents` są wolne na npm; konto npm niezalogowane.

## Decyzje (potwierdzone z użytkownikiem)

1. **Cel dystrybucji**: publiczny npm (każdy może `npx` / `npm i -g`).
2. **Nazwa**: branding „AI of Agents"; slug pakietu i komenda: `ai-of-agents`
   (npm wymaga lowercase, bez spacji).
3. **Zachowanie startu**: realny tryb domyślnie, **bez** auto-otwierania
   przeglądarki — CLI wypisuje URL. Auto-open jako opcjonalna flaga `--open`.
4. **Licencja**: MIT (plik `LICENSE` + `license: "MIT"`).

## Architektura — Podejście A: jeden zbundlowany pakiet CLI

Odrzucone alternatywy:
- **B (3 paczki scoped publikowane osobno)** — wersjonowanie/publikacja 4 pakietów
  bez korzyści dla użytkownika. YAGNI.
- **C (`tsx` w runtime, wysyłka TS)** — `tsx` + TS w `dependencies` = cięższa
  instalacja i wolniejszy start; nietypowe dla publicznego pakietu.

### 1. Kształt pakietu

Publikowany jest **jeden** pakiet `ai-of-agents`, oparty o dzisiejszy root monorepo.
Wewnętrzne `@agent-citadel/shared|server|client` zostają `private` i **nie** trafiają
na npm — przy buildzie ich kod jest wbundlowany do artefaktu. Użytkownik nie widzi
struktury monorepo. Workspaces zostają na potrzeby developmentu.

### 2. Pipeline build (domknięcie luki `tsc --noEmit`)

Nowy `build` produkuje katalog `dist/`:

- **Klient**: `vite build` → `dist/web/` (HTML + JS + statyczne assety z
  `public/assets`). Assety jadą w paczce — są małe i własne, więc bez pobierania
  przy instalacji.
- **Serwer**: `esbuild` zbija `packages/server/src/index.ts` + `shared` w jeden
  `dist/server.js` (format ESM, platform=node, target=node22).
- **CLI**: `esbuild` (lub ten sam krok) buduje `dist/cli.js` — cienki entry z
  parsowaniem flag, który importuje/uruchamia serwer.
- **External**: `fastify`, `@fastify/static`, `ws`, `chokidar` pozostają nie-bundlowane
  i lądują w `dependencies` publikowanego `package.json`. Reszta (nasz kod, typy
  z `shared`) jest wbundlowana → brak zależności od `@agent-citadel/*` u konsumenta.

### 3. Runtime / komenda

- `package.json`: `"bin": { "ai-of-agents": "dist/cli.js", "aioa": "dist/cli.js" }`
  (z shebangiem `#!/usr/bin/env node`, plik wykonywalny). Dwie komendy wskazują na
  ten sam plik — `aioa` to krótszy alias (`npx aioa`).
- `cli.js` parsuje flagi i startuje serwer:
  - domyślnie **realny tryb** (watcher `~/.claude/projects`);
  - `--demo` — tryb demo (sztuczne dane), istnieje już w `index.ts` jako `--demo`;
  - `--port <n>` — port (domyślnie 8123); gdy zajęty, fallback na kolejny wolny;
  - `--open` — otwórz domyślną przeglądarką (opt-in);
  - `--help` — krótka pomoc.
- Serwer rejestruje `@fastify/static` (root = `dist/web`) i serwuje klienta na
  **tym samym porcie** co `/ws`, `/hooks`, `/health`, `/building-stats`. Znika
  proxy Vite — jeden proces.
- Po `listen()` CLI wypisuje:
  `▸ AI of Agents działa: http://localhost:<port>  (Ctrl+C aby zatrzymać)`.

### 4. Metadane do publikacji (`package.json` roota)

- `name: "ai-of-agents"`, usunięte `"private": true`.
- `license: "MIT"` + plik `LICENSE`.
- `version` (start np. `0.1.0`), `description`, `keywords`, `repository`,
  `homepage`, `bugs`.
- `files: ["dist", "LICENSE", "README.md"]` — publikujemy tylko artefakt + meta.
- `engines.node: ">=22"` (już jest).
- `prepublishOnly`: odpala `build` i `test`, by nie wysłać zepsutego pakietu.
- Sprzątanie: `flyctl` przenieść z `dependencies` do `devDependencies` (to CLI
  do deployu, nie runtime aplikacji).

### 5. Publikacja (kroki operacyjne, poza kodem)

1. `npm login` (konto musi istnieć; dziś niezalogowane).
2. `npm publish --access public`.
3. Weryfikacja: `npm view ai-of-agents`, test `npx ai-of-agents@latest` w czystym
   katalogu.
   Wcześniej walidacja lokalna: `npm pack` + inspekcja zawartości tarballa
   (czy `dist/` kompletny, czy nie ma śmieci).

## Świadomie poza zakresem (YAGNI)

- Publikacja 3 osobnych paczek scoped.
- Auto-pobieranie assetów przy instalacji (assety są w repo).
- CI/CD do automatycznej publikacji (np. GitHub Actions on tag).
- „Instalacja jako usługa systemowa" / autostart.
- Cross-platform pakiety binarne (pkg/SEA) — npm wystarcza.

## Kryteria sukcesu

- `npm pack` produkuje tarball zawierający `dist/cli.js`, `dist/server.js`,
  `dist/web/**`, `LICENSE`, `README.md` — i nic zbędnego.
- W czystym katalogu `node <dystrybucja>/dist/cli.js` (lub po `npm i -g .`)
  startuje serwer, serwuje klienta na jednym porcie, wypisuje URL.
- Otwarcie URL pokazuje działającą wizualizację (realny tryb obserwuje
  `~/.claude/projects`; `--demo` pokazuje dane demo).
- Brak zależności od `@agent-citadel/*` ani `tsx` w runtime u konsumenta.
- `tsc --noEmit` (typecheck) i testy przechodzą; `prepublishOnly` to wymusza.

## Otwarte ryzyka / do pilnowania w planie

- **`@fastify/static` + SPA fallback**: ścieżki klienta muszą działać; ustawić
  poprawny root i ewentualny fallback na `index.html`.
- **`esbuild` a dynamiczne `import()`** w `index.ts` (warunkowe ładowanie
  `watcher.js`/`hooks.js` w realnym trybie) — bundler musi je rozwiązać; zweryfikować,
  że tryb realny i demo działają po zbundlowaniu.
- **Ścieżki do assetów w runtime**: serwer ładuje `dist/web` względem lokalizacji
  pliku (`import.meta.url`), nie cwd — inaczej `npx` z innego katalogu się wywali.
- **`chokidar`/`fsevents`** jako external — zostawić w `dependencies`, nie bundlować.
