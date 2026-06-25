# Odpowiadanie na pytania agentów w panelu — projekt

Data: 2026-06-21
Status: szkic do przeglądu
Repo: `age-of-agents` (d. Agent Citadel)

## 1. Cel

Umożliwić użytkownikowi **odpowiadanie z poziomu panelu aplikacji** na pytania,
które agent zadaje w trakcie sesji — zamiast przełączać się do terminala. Dotyczy
przede wszystkim Claude Code; Codex/OpenCode są poza zakresem tej iteracji.

Dwa scenariusze, które chcemy obsłużyć:

1. **Sesje uruchamiane przez użytkownika w jego własnym terminale** (`claude ...`).
   Appka tylko je obserwuje. Chcemy mimo to odpowiadać na prompty uprawnień i
   akceptować plany z panelu. → realizowane **hookami Claude Code** (Faza 1).
2. **Sesje uruchamiane z poziomu aplikacji** (wybór folderu + wpisanie promptu).
   Appka jest właścicielem procesu i ma pełną kontrolę interaktywną, w tym
   odpowiedzi na `AskUserQuestion`. → realizowane przez **Claude Agent SDK** (Faza 2).

Obie fazy zasilają **to samo UI** „oczekujące pytanie" w panelu.

## 2. Stan obecny (ograniczenia wyjściowe)

- Aplikacja jest **czysto read-only**: serwer tail-uje transkrypty JSONL → buduje
  `Fact` → maszyna stanów → broadcast po WebSocket.
- **WebSocket jest jednokierunkowy** (serwer→klient). Jedyny istniejący kanał
  klient→serwer to `POST /hooks` (zdarzenia hooków Claude Code). Patrz
  `packages/server/src/server.ts`.
- **Stan `awaiting-input` już istnieje**: `state-machine.ts` wykrywa
  `AskUserQuestion`/`ExitPlanMode` i zapala `!` nad bohaterem. Czyli appka już
  *wykrywa* czekanie — brakuje jej kanału, by *odpowiedzieć*.
- **Hook to dziś cichy command-shim** (`hooks.ts`): `timeout: 1` s, shim kończy po
  ~600 ms i **nie wypisuje nic na stdout** → Claude Code nie dostaje decyzji.
  Migracja z hooka HTTP (commit `030763f`) była celowa: HTTP spamił błędami przy
  zamkniętej appce. Tę właściwość („cisza, gdy appka zamknięta") **zachowujemy**.

### Ustalone fakty techniczne (z rozpoznania)

Hooki Claude Code:
- `PreToolUse` może zwrócić na stdout decyzję:
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow|deny|ask","permissionDecisionReason":"..."}}`.
- `allow` **pre-empuje** prompt w terminalu (z zastrzeżeniem: reguły `deny`/`ask`
  w `~/.claude/settings.json` mają pierwszeństwo nad `allow` hooka).
- `command`/`http` hook timeout: domyślnie **600 s**, jednostka: sekundy.
  Hook **może blokować** przez ten czas.
- `http` hook **może zwrócić decyzję synchronicznie w ciele odpowiedzi 2xx**
  (ten sam format JSON co stdout).
- `PermissionRequest` (matcher `ExitPlanMode`) potrafi auto-akceptować plan
  (`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`),
  ale **nie ma** udokumentowanej formy `deny` z uzasadnieniem.
- **`AskUserQuestion` jest NIEodpowiadalne hookami** — hook nie potrafi wstrzyknąć
  wyniku narzędzia. Można je tylko `allow`/`deny`/`ask` lub wykryć. Pełna odpowiedź
  dopiero przez SDK (Faza 2).

Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`):
- `query({ prompt, options })`; `prompt` może być `AsyncIterable<SDKUserMessage>`
  (streaming input — można dosyłać kolejne wiadomości do żywej sesji).
- `canUseTool(toolName, input, opts) => Promise<PermissionResult>` przechwytuje
  **wszystkie** narzędzia; zwraca `{behavior:"allow", updatedInput?}` lub
  `{behavior:"deny", message, interrupt?}`. Jest **async** — może czekać na
  kliknięcie człowieka. Obejmuje też `AskUserQuestion`.
- Sygnał gotowości: komunikat systemowy `session_state_changed`
  (`idle | running | requires_action`).
- `permissionMode`: `default | acceptEdits | plan | bypassPermissions`.
- Sesja odpalona przez SDK i tak zapisuje transkrypt → **automatycznie pojawia
  się jako bohater** w istniejącej wizualizacji (watcher bez zmian).
- Auth: z `~/.claude` (jak Claude Code CLI).

## 3. Architektura wspólna: „oczekujące pytanie" + kanał odpowiedzi

Wprowadzamy jeden, niezależny od źródła model żądania decyzji i jeden kanał
odpowiedzi. Oba tory (hooki i SDK) tylko go zasilają.

### 3.1 Typy współdzielone (`packages/shared`)

```ts
// Co dokładnie czeka na decyzję użytkownika.
type PendingQuestionKind =
  | 'tool-permission'   // PreToolUse / canUseTool — Pozwól/Odmów
  | 'plan-approval'     // ExitPlanMode — Akceptuj/(Odrzuć)
  | 'ask-user-question' // AskUserQuestion — wybór wielokrotny (tylko SDK odpowiada)
  | 'free-text';        // przyszłość: dosłanie zwykłej wiadomości

interface PendingQuestion {
  id: string;                 // requestId — korelacja
  sessionId: string;          // do którego bohatera należy
  source: 'hook' | 'sdk';     // skąd przyszło (determinuje dozwolone akcje)
  kind: PendingQuestionKind;
  tool?: string;              // np. "Bash"
  detail?: string;            // np. "rm -rf build/" — gotowy do pokazania
  options?: { label: string; description?: string }[]; // dla ask-user-question
  createdAt: string;          // ISO
}

// Odpowiedź klienta (panel → serwer, po WS).
interface QuestionAnswer {
  id: string;
  decision:
    | { type: 'allow'; scope?: 'once' | 'always' } // always => zapis reguły
    | { type: 'deny'; reason?: string }
    | { type: 'approve-plan' }
    | { type: 'reject-plan'; reason?: string }
    | { type: 'select'; optionLabels: string[] }   // ask-user-question (SDK)
    | { type: 'text'; text: string };              // free-text (SDK)
}
```

Nowe zdarzenia `GameEvent` (serwer→klient): `pending-question`
(dodaje/aktualizuje), `pending-question-resolved` (usuwa po odpowiedzi/timeout).

### 3.2 Kanał klient→serwer

WebSocket przestaje być jednokierunkowy. Serwer dodaje
`socket.on('message', ...)` i obsługuje wiadomości klienta:
- `{type:'answer', payload: QuestionAnswer}` — rozwiązuje wiszące żądanie.

Uzasadnienie: WS już jest otwarty per klient, niesie snapshoty i jest tani w
dwukierunkowości. Alternatywę (osobny `POST /answer`) odrzucamy — gorsza
korelacja z konkretnym klientem i więcej stanu.

### 3.3 Rejestr wiszących żądań (serwer)

`PendingRegistry`: `Map<id, { resolve, reject, timeout, question }>`.
- Tor hooków: trzyma otwarte `reply` (HTTP) shima; `resolve` = odesłanie decyzji
  JSON i zamknięcie odpowiedzi.
- Tor SDK: trzyma `resolve` promisy `canUseTool`.
W obu przypadkach: na `answer` z WS → znajdź po `id` → `resolve`.

## 4. Faza 1 — hooki (sesje z terminala)

### 4.1 Przełącznik i model autorytetu uprawnień

`PreToolUse` odpala się przed **każdym** narzędziem i hook nie wie, czy Claude i
tak by zapytał. Blokowanie na każdym wywołaniu zamroziłoby agenta nawet przy
bezpiecznym `Read`. Dlatego dla **zarządzanych** sesji appka staje się autorytetem
uprawnień:

- **Globalny przełącznik „Odpowiadaj na prompty w panelu", domyślnie OFF.**
  Gdy OFF → shim pozostaje fire-and-forget (dzisiejsze zachowanie, deklaracja
  read-only nienaruszona). Gdy ON → logika poniżej. (Opcjonalnie override
  per-sesja w panelu bohatera.)
- **Biała lista bezpiecznych narzędzi** (auto-`allow`, bez blokady): `Read`,
  `Glob`, `Grep`, `NotebookRead`, `TodoWrite`, `BashOutput` itp. (lista do
  dostrojenia). Cel: zero spamu na operacjach read-only.
- **Reguły „zawsze pozwól"** ze store'a (4.4) → auto-`allow` bez pytania.
- **Pozostałe ryzykowne narzędzia** (`Bash`, `Edit`, `Write`, `WebFetch`,
  `Task`, …) → **blokada + pytanie w panelu**.
- **`AskUserQuestion`/`ExitPlanMode`**: patrz 4.5–4.6.

### 4.2 Zmiany w shimie (`hooks.ts`)

Shim dostaje dwa tryby zależnie od zdarzenia:
- **`PreToolUse`, `PermissionRequest`** (blokujące): POST hook-JSON do serwera i
  **czekaj** na odpowiedź (do `timeout` z settings). Wypisz zwrócony JSON na
  stdout. Jeśli serwer nieosiągalny / błąd / brak decyzji → wypisz `ask` (lub nic)
  → terminal pyta normalnie. **Nigdy auto-allow przy braku odpowiedzi.**
- **Pozostałe** (`SessionStart`, `UserPromptSubmit`, `PostToolUse`,
  `Notification`, `Stop`): bez zmian — fire-and-forget.

`HOOK_EVENTS` rozszerzamy o `PermissionRequest`. Wpisy `PreToolUse`/
`PermissionRequest` dostają `timeout: 600`; reszta zostaje `timeout: 1`.
`installHooks()` musi to rozróżniać (dziś nadaje wszystkim ten sam wpis).

Migracja istniejących instalacji: `hooksStatus().needsMigration` wykrywa stary
shim bez długiego timeoutu i proponuje reinstalację.

### 4.3 Serwer: endpoint decyzji

`POST /hooks` rozbudowany (lub nowy `POST /hooks/decide`): dla
`PreToolUse`/`PermissionRequest` przy włączonym przełączniku:
1. Zastosuj politykę (biała lista / store reguł) — jeśli rozstrzyga, odpowiedz od
   razu decyzją JSON (bez angażowania panelu).
2. W przeciwnym razie: zarejestruj `PendingQuestion`, **nie odpowiadaj jeszcze**,
   broadcastuj `pending-question` do klientów, trzymaj `reply` otwarte.
3. Po `answer` z WS → odeślij `permissionDecision` (`allow`/`deny`) wynikający z
   `QuestionAnswer`; przy `scope:'always'` zapisz regułę do store'a.
4. Bezpiecznik serwera: własny timeout < timeout hooka (np. 590 s) → odeślij `ask`.

### 4.4 Store reguł „zawsze pozwól"

Plik `~/.age-of-agents/permission-policy.json` (spójny z istniejącym katalogiem
configów: `tool-mapping.json`, `model-config.json`).

```jsonc
{
  "rules": [
    { "tool": "Bash", "match": "prefix", "value": "npm ", "decision": "allow" },
    { "tool": "Edit", "match": "any", "decision": "allow", "scope": "session:abc123" }
  ]
}
```

- Zakres: globalny lub `session:<id>`.
- Dopasowanie: `any` (całe narzędzie) lub `prefix` (po `detail`, np. komenda Bash).
- Świadomy wybór anty-fałszerstwa: appka NIE modyfikuje `~/.claude/settings.json`
  (odwracalność, brak kolizji z regułami usera). Reguły żyją po stronie appki i
  działają tylko, gdy przełącznik ON.

### 4.5 Akceptacja planu (`ExitPlanMode`)

Hook `PermissionRequest` matcher `ExitPlanMode`. „Akceptuj" → `behavior: allow`.
„Odrzuć" jest słabe (brak `deny` z feedbackiem) → MVP: przycisk „Odrzuć" odsyła
`ask` (plan pojawia się w terminalu, gdzie można odrzucić z komentarzem) + nota
w UI. Pełne odrzucenie z uzasadnieniem dopiero w SDK (Faza 2).

### 4.6 `AskUserQuestion` w sesjach z terminala

Niewykonalne hookami. Panel **pokazuje** pytanie i opcje (read-only, z transkryptu
/ z `PreToolUse`), z plakietką „odpowiedz w terminalu". Hook zwraca `ask`.

### 4.7 UI panelu (Faza 1)

W panelu bohatera, nad „live activity", karta gdy `state==='awaiting-input'` lub
jest `PendingQuestion`:
- Nagłówek: ikona ⚠ + typ („Prośba o uprawnienie" / „Plan do akceptacji").
- Kontekst: `tool` + `detail` (monospace, obcięte).
- Akcje wg `kind`/`source`:
  - `tool-permission`: **Pozwól**, **Pozwól zawsze**, **Odmów**.
  - `plan-approval`: **Akceptuj**, **Odrzuć** (→ terminal w Fazie 1).
  - `ask-user-question` (hook): tylko podgląd + „odpowiedz w terminalu".
- Po odpowiedzi karta znika (`pending-question-resolved`), `!` gaśnie.

## 5. Faza 2 — uruchamianie agentów z appki (SDK)

### 5.1 Okno „Uruchom agenta"

Wyzwalane przyciskiem (np. w pasku miast / HUD). Pola:
- **Folder roboczy (cwd)** — picker. Implementacja: endpoint `GET /fs/list?dir=`
  (serwer listuje katalogi, bez czytania plików) zasila prosty wybór ścieżki;
  ostatnio używane zapamiętane.
- **Prompt** — textarea.
- **Model** — z istniejącego rejestru modeli (`model-config.json`).
- **Permission mode** — drop-down `default | acceptEdits | plan | bypassPermissions`
  (decyzja: wybór per uruchomienie).

### 5.2 Integracja SDK (serwer)

Nowy moduł `packages/server/src/sources/claude-sdk.ts` (lub `runner/`):
- `@anthropic-ai/claude-agent-sdk` jako **optionalDependency** (jak
  `better-sqlite3`) — brak pakietu = przycisk „Uruchom" wyłączony z podpowiedzią.
- `query({ prompt: inputStream(), options: { cwd, model, permissionMode, canUseTool } })`.
- `inputStream()` — async generator zasilany kolejką wiadomości użytkownika
  (dosyłanie tur z panelu).
- `canUseTool` → rejestruje `PendingQuestion(source:'sdk')` i czeka na `answer`;
  mapuje `QuestionAnswer` → `PermissionResult` (`allow`/`deny`/`updatedInput` dla
  `AskUserQuestion`).
- Konsumpcja strumienia: `session_state_changed` → aktualizacja stanu bohatera;
  `requires_action` koreluje z otwartymi `PendingQuestion`.
- Cykl życia: rejestr żywych sesji SDK; zatrzymywanie/anulowanie; sprzątanie przy
  zamknięciu serwera.

### 5.3 Wizualizacja

Sesja SDK pisze transkrypt do `~/.claude/projects/...`, więc istniejący watcher
podniesie ją jak każdą inną — bohater pojawia się bez zmian w warstwie gry.
(Do rozważenia: znacznik „uruchomione z appki", analogicznie do odznaki 🐳.)

### 5.4 UI panelu (Faza 2)

Ta sama karta „oczekujące pytanie", ale `source:'sdk'` odblokowuje:
- `ask-user-question`: realne przyciski opcji (wybór → `select`).
- `plan-approval`: pełne **Odrzuć z uzasadnieniem**.
- pole **dosłania wiadomości** do żywej sesji (`free-text`).

## 6. Bezpieczeństwo i prywatność

To rozszerza appkę z read-only na taką, która **może zezwolić na wykonanie
narzędzia**. Zasady:
- Serwer nadal **tylko 127.0.0.1**.
- Przełącznik Fazy 1 **domyślnie OFF**; bez niego zachowanie i deklaracje bez zmian.
- **Bezpieczny fallback wszędzie**: brak/niejasna odpowiedź → `ask` (terminal
  decyduje), **nigdy** auto-allow.
- Reguły „zawsze pozwól" są jawne, wylistowane i kasowalne w UI; nie ruszamy
  `~/.claude/settings.json`.
- `bypassPermissions` w Fazie 2 wymaga wyraźnego potwierdzenia w oknie startu.
- Aktualizacja sekcji Privacy w `README.md` (nowy, opt-in tryb interaktywny).

## 7. Strategia testów

- **shared**: serializacja `PendingQuestion`/`QuestionAnswer`.
- **server (unit)**:
  - `PendingRegistry`: rozwiązywanie, timeout, anulowanie.
  - polityka uprawnień: biała lista, dopasowanie reguł (`any`/`prefix`), zakresy.
  - shim: tryb blokujący vs fire-and-forget; fallback `ask` przy błędzie/zamknięciu.
  - mapowanie `QuestionAnswer` → decyzja hooka / `PermissionResult` SDK.
- **server (integ)**: sztuczny `POST /hooks` (PreToolUse) → broadcast → `answer`
  WS → poprawny JSON decyzji w odpowiedzi HTTP.
- **client**: render karty wg `kind`/`source`; wysyłka `answer` po kliknięciu.
- SDK: cienki adapter za interfejsem, testowalny na mocku strumienia (bez
  realnych wywołań modelu).

## 8. Poza zakresem (na teraz)

- Codex i OpenCode (inne mechanizmy; „dłuższe zadanie" wg ustaleń).
- Odpowiadanie na `AskUserQuestion` w sesjach z terminala (niewykonalne hookami).
- Modyfikacja `~/.claude/settings.json` regułami uprawnień.

## 9. Otwarte kwestie / przyszłość

- Dokładna biała lista bezpiecznych narzędzi (dostroić empirycznie).
- Powiadomienia desktopowe przy nowym `PendingQuestion` (hook `Notification`).
- Czy pokazywać „uruchomione z appki" jako odznakę bohatera.
- Wersjonowanie/wydanie: feature flag → wydanie minor po Fazie 1, kolejne po Fazie 2.

## 10. Kolejność realizacji (wstępna)

1. Wspólne typy (`shared`) + dwukierunkowy WS + `PendingRegistry`.
2. Faza 1: shim blokujący + endpoint decyzji + polityka/store + karta UI
   (uprawnienia → plan → „zawsze pozwól").
3. Wydanie minor (feature OFF domyślnie; włączane przełącznikiem).
4. Faza 2: okno „Uruchom agenta" + adapter SDK + rozszerzenie karty UI.
5. Wydanie minor.
