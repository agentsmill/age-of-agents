# Czytelne nazwy sesji (heurystyka)

Data: 2026-06-14
Status: zaakceptowany (do implementacji)
Inspiracja: RimWorld — gracz ma od razu wiedzieć „co robi ten pionek".

## Problem

W grze bohaterowie/misje nazywają się **pierwszym promptem** sesji
([`state-machine.ts:94`](packages/server/src/state-machine.ts:94)), a ten bywa:
- konwersacyjny i bezwartościowy jako nazwa („ok", „tak", „realizuj plan", „super
  implementuj"),
- albo długi/rozwlekły („W związku z tym, że mam dostęp do sieci sprzedawców…").

Claude w „Recents" pokazuje ładne, zwięzłe tytuły („Map zoom controls"), ale
**research potwierdził, że tego tytułu NIE ma lokalnie**: transkrypty w formacie
desktop/FleetView nie zawierają rekordów `summary`/`ai-title`/`custom-title`
(parser ich szuka — `parser.ts:85-89` — i nigdy nie trafia); `~/.claude/sessions/
<pid>.json` to metadane procesu; `history.jsonl` to log promptów. Tytuł trzeba
więc **wygenerować samemu**.

## Decyzja

**Tylko heurystyka** (bez AI). Powód: cel dystrybucji — aplikacja ma być
instalowalna przez innych (npm/CLI), więc żadnych twardych zależności od maszyny
usera (CLI `claude`, klucz API). Wariant AI (`claude -p`) świadomie odłożony jako
ewentualny późniejszy przyrost (wtedy jako opcjonalna, auto-wykrywana nakładka).

Zakres #1 = sama **nazwa** bohatera/sesji. Bogatsze panele = #2, sterowanie = #3.

## Architektura

### Czyste funkcje (serwer, TDD) — nowy `transcript/title.ts`

- **`isSubstantialPrompt(text): boolean`** — czy prompt to opis zadania, a nie samo
  potwierdzenie. Domyślna reguła: odrzuć dokładne dopasowania z listy-stop
  (po normalizacji: lowercase, bez interpunkcji) — np. `ok, tak, nie, yes, no,
  dawaj, działaj, rób, realizuj, kontynuuj, dalej, next, go, dobra, spoko, dzięki`;
  odrzuć też zbyt krótkie (mniej niż MIN_WORDS słów **i** mniej niż MIN_CHARS
  znaków, np. 3 słowa / 16 znaków). Inaczej — sensowny.
  **WKŁAD USERA (learning):** lista-stop i progi to punkt strojenia — przy
  implementacji zostawię TODO z domyślną regułą i poproszę o ~5 linii dostosowania.
- **`cleanTitle(text, max=40): string`** — pierwsza niepusta linia → zdejmij
  wiodące markery (`# `, `## Zadanie:`, `- `, `* `) → zwiń białe znaki → utnij do
  `max` z „…". (Bez dzielenia na zdania — ryzykowne przy ścieżkach/kodzie.)

### Wpięcie (`state-machine.ts`)

- Nowe pole `firstSubstantialPrompt?: string` (obok istniejącego `firstPrompt`).
- W obsłudze faktu `prompt` (po dedup): `firstPrompt` ustawiany jak dziś, ale przez
  `cleanTitle` (nie `clipTitle`); dodatkowo: jeśli brak `firstSubstantialPrompt`
  **i** `isSubstantialPrompt(text)` → zapisz `cleanTitle(text)`.
- `displayTitle()` — nowy łańcuch priorytetu:
  `explicitTitle ?? firstSubstantialPrompt ?? firstPrompt ?? projectName ?? UUID`.
  - `explicitTitle` ZOSTAJE najwyżej (zadziała, gdyby jakaś wersja Claude jednak
    zapisała `ai-title`/`custom-title` — parser tych przypadków NIE usuwamy).
  - Główna poprawa: konwersacyjny opener przestaje być nazwą — bierzemy pierwszy
    *sensowny* prompt; gdy żadnego nie ma, łagodny fallback jak dotąd.

### Propagacja

Nazwa idzie przez istniejący `HeroSnapshot.title` → etykieta na mapie, portrety,
panel boczny, meta w panelu „Zadania". Treść misji (sam prompt) zostaje bez zmian.

## Przypadki brzegowe

- Sesja bez żadnego sensownego promptu (same „ok/tak") → `firstPrompt` (oczyszczony)
  jako floor; gdy brak jakiegokolwiek promptu → `projectName` → UUID.
- Stabilność: `firstSubstantialPrompt` ustawiany RAZ (pierwszy sensowny) → nazwa nie
  skacze co turę.
- `clipTitle` w state-machine zostaje wyparte przez `cleanTitle`; sprawdzić, czy
  nieużywane → usunąć martwy kod.
- Wejście jest już przefiltrowane przez `isHumanPrompt` (parser), więc `title.ts`
  nie musi powtarzać odsiewania markerów systemowych — ale `cleanTitle` i tak
  zdejmuje wiodące markery markdown.

## Testy (TDD, vitest, serwer)

- `isSubstantialPrompt`: „ok"/„tak"/„realizuj plan" → false; „Dodaj rate-limit do
  panelu"/„napraw zoom mapy" → true; pusty/whitespace → false; case/interpunkcja
  nieistotne.
- `cleanTitle`: wielolinijkowy → pierwsza linia; „# Zadanie: X" → „X"; bardzo długi
  → ucięty z „…"; zwykły krótki → bez zmian.
- Integracja maszyny stanów: ciąg promptów [„ok", „Zaimplementuj X"] → tytuł = „X"
  (nie „ok"); [„ok"] → fallback (projectName/UUID), nie „ok" jako nazwa sensowna.

## Poza zakresem (YAGNI / inne etapy)

- AI-tytuły (`claude -p` / API) — świadomie odłożone.
- Bogatsze panele postaci/budynków (#2), sterowanie z gry (#3).
- Czyszczenie treści misji w panelu „Zadania" (osobno, jeśli zajdzie potrzeba).
