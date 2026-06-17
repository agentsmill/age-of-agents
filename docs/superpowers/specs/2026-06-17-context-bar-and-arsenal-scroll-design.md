# Spec — Pasek zużycia kontekstu (SidePanel) + scroll Arsenału

Data: 2026-06-17
Status: zatwierdzony do implementacji
Beads: AgeOfAgents-kfr
Baza: main @ 7fe074a (z Arsenałem)

## Cel

Dwa dopracowania HUD:
1. **Pasek zużycia kontekstu** w panelu bohatera (SidePanel) — od rzutu oka widać, jak pełne jest okno kontekstu danego agenta (zielony → żółty → czerwony).
2. **Scroll Arsenału** — gdy projekt ma dużo skilli/MCP/hooków/subagentów, panel przewija się czysto z zawsze widocznymi nagłówkami sekcji.

## Decyzje (z brainstormingu)

1. **Pasek kontekstu żyje w SidePanel (per-bohater)**, nie w Arsenale — zapełnienie kontekstu jest z natury per-sesja, a Arsenał jest per-projekt/miasto.
2. **Dane = BIEŻĄCY rozmiar kontekstu, nie suma kumulatywna.** `hero.tokens.input` to suma po wszystkich turach (≠ zapełnienie okna). Potrzebujemy `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` z **ostatniej** wiadomości.
3. **Pasek pixel-segmentowany**, kolor wg %: zielony ≤10 → żółty ≤50 → coraz bardziej czerwony do 100%.
4. **Graceful:** pokazujemy pasek tylko gdy `contextTokens` znane (źródło Claude). Agenci bez tej telemetrii (Codex/OpenCode/Koda) → brak paska, nic się nie psuje.

## Część 1 — Pasek zużycia kontekstu

### Dane (serwer → protokół)

`HeroSnapshot` (shared) zyskuje:
```ts
  /** Bieżący rozmiar kontekstu z OSTATNIEJ wiadomości (input + cache_read + cache_creation).
   *  ≠ tokens.input (suma kumulatywna). Brak → nie pokazuj paska. */
  contextTokens?: number;
```

Fakt `usage` (server `transcript/facts.ts`) zyskuje opcjonalne pole:
```ts
  | { kind: 'usage'; messageId: string; input: number; output: number; context?: number }
```

`parser.ts` (gałąź `assistant`, obok istniejącego `usage`): policz `context`:
```ts
context: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0),
```

`state-machine.ts` (case `'usage'`): poza dotychczasowym sumowaniem `tokens`, ustaw **najnowszy** kontekst (nadpisuj, nie sumuj):
```ts
if (typeof fact.context === 'number') this.patch({ contextTokens: fact.context });
```
oraz dołóż `contextTokens: this.contextTokens` do buildera `hero()` (pole prywatne `private contextTokens?: number`, ustawiane w case `usage`). Uwaga: `usage` jest deduplikowany po `messageId`; przy odtwarzaniu transkryptu od początku ostatnia przetworzona wiadomość daje aktualny kontekst — poprawnie.

### Logika klienta (czysta, testowalna)

Nowy `packages/client/src/hud/context-bar.ts`:
```ts
/** Okno kontekstu modelu (tokeny). Default 200k; nadpisania dla modeli o większym oknie. */
export function contextWindow(model?: string): number {
  if (model && /1m|200k-1m|\[1m\]/i.test(model)) return 1_000_000;
  return 200_000;
}

/** Procent zapełnienia 0..100 (zaokrąglony). */
export function contextPct(tokens: number, model?: string): number {
  return Math.min(100, Math.round((tokens / contextWindow(model)) * 100));
}

/** Kolor wypełnienia wg %: zielony ≤10 → żółty ≤50 → ku czerwieni do 100. */
export function contextColor(pct: number): string {
  if (pct <= 10) return '#5dcaa5';
  if (pct <= 50) return '#f0d76e';
  if (pct <= 75) return '#f0b56e';
  if (pct <= 90) return '#ef7a6a';
  return '#e24b4a';
}
```

### UI (SidePanel)

Nowy komponent `packages/client/src/hud/ContextBar.tsx` (segmentowany pixel-pasek, 24 bloki, inset-shadow jak w HUD):
- props: `{ tokens: number; model?: string; label: string }`.
- liczy `pct = contextPct(tokens, model)`, `filled = round(24 * pct/100)`, `c = contextColor(pct)`.
- nagłówek: `{label}` po lewej, `{pct}% · {formatK(tokens)} / {formatK(window)}` po prawej (procent w kolorze `c`).
- bloki: `flex:1; height:14px; background: i<filled ? c : '#2a2926'; box-shadow: inset 1px 1px 0 #ffffff22, inset -1px -1px 0 #00000055`.

W `SidePanel.tsx`, pod siatką kafelków (`StatTile` 2×2, ~linia 181), warunkowo:
```tsx
{typeof hero.contextTokens === 'number' && (
  <ContextBar tokens={hero.contextTokens} model={hero.model} label={t.context} />
)}
```

### i18n

Klucz `context` w `UiStrings` + 3 językach: `Context` / `Kontekst` / `Contesto`.

## Część 2 — Scroll Arsenału

W `ArchitectHall.tsx`:
- **Sticky nagłówki sekcji:** przycisk `Section` (nagłówek 🪄/🔌/🪝/🤖 + licznik) dostaje `position: sticky; top: 0; zIndex: 1` — przy przewijaniu zostaje na górze scrolla, licznik zawsze widoczny.
- Body pozostaje jedynym scrollerem (`overflowY: 'auto'`); nagłówek panelu (nazwa + sesje) poza scrollem (bez zmian).

W `hud.css`:
- Cienki pixel-scrollbar dla scrollowanego Body Arsenału (klasa np. `.arsenal-scroll`): `::-webkit-scrollbar { width: 8px }`, kciuk `#45443f`, tor `#2a2926` (paleta HUD). Dodać klasę do scrollowanego diva w Body.

## Poza zakresem

- Mini-pasek kontekstu nad jednostką na mapie (rozważany wariant B — odrzucony, YAGNI teraz).
- Kontekst dla nie-Claude agentów (brak telemetrii cache → brak paska).
- Dokładne okna per-model poza prostą mapą (default 200k wystarcza jako wskaźnik).

## Testy

- `server/test/parser.test.ts`: rekord `assistant` z `usage` zawierającym `cache_creation_input_tokens` → fakt `usage` ma poprawne `context`.
- `server/test/state-machine.test.ts`: dwa fakty `usage` (różne `messageId`) → `hero.contextTokens` = kontekst NAJNOWSZEGO (nie suma).
- `client/tests/context-bar.test.ts`: `contextWindow` (default + 1M), `contextPct` (zaokrąglenie, clamp 100), `contextColor` (progi 10/50/75/90).
- Scroll Arsenału: weryfikacja wizualna (preview) — wstrzyknięcie wielu skilli, sprawdzenie sticky nagłówków + scrollbara.

## File structure

| Plik | Akcja |
|---|---|
| `packages/shared/src/index.ts` | Modify — `HeroSnapshot.contextTokens?` |
| `packages/server/src/transcript/facts.ts` | Modify — `usage` fakt + `context?` |
| `packages/server/src/transcript/parser.ts` | Modify — policz `context` w `usage` |
| `packages/server/src/state-machine.ts` | Modify — `contextTokens` (najnowszy) na bohaterze |
| `packages/client/src/hud/context-bar.ts` | Create — `contextWindow`/`contextPct`/`contextColor` |
| `packages/client/src/hud/ContextBar.tsx` | Create — segmentowany pixel-pasek |
| `packages/client/src/hud/SidePanel.tsx` | Modify — render `<ContextBar>` pod kafelkami |
| `packages/client/src/hud/ArchitectHall.tsx` | Modify — sticky nagłówki sekcji + klasa scrolla |
| `packages/client/src/hud/hud.css` | Modify — pixel-scrollbar Arsenału |
| `packages/client/src/i18n.ts` | Modify — klucz `context` (3 języki) |
| `packages/server/test/parser.test.ts` | Modify — test `context` |
| `packages/server/test/state-machine.test.ts` | Modify — test `contextTokens` |
| `packages/client/tests/context-bar.test.ts` | Create — testy logiki paska |
