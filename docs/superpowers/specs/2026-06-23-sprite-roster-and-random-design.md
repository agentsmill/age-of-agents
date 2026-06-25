# Rozszerzalny pool postaci + losowanie sprite'ów + „all random"

Data: 2026-06-23
Status: zatwierdzony projekt (przed planem implementacji)
Bazuje na: [rejestr modeli](2026-06-19-model-registry-settings-design.md),
[karty spiritów](2026-06-19-model-registry-sprite-cards-design.md),
[heroes sci-fi Faza 2](2026-06-14-scifi-heroes-phase2-design.md),
[wsparcie local LLM](2026-06-22-local-llm-support-design.md)

## 1. Problem

Pula sprite'ów bohaterów to zamknięte 4 rodziny (`opus/sonnet/haiku/fable`,
`SPRITE_IDS` w shared). Modele lokalne (Ollama/llama.cpp/vLLM/oMLX, v0.7.0)
tylko **pożyczają** te sprite'y (llama→sonnet, qwen→haiku…) — nie mają własnej
tożsamości wizualnej. Nie da się też dodać nowej „postaci do wzięcia", a miasta
wyglądają monotonnie, bo jeden model = jeden zawsze ten sam sprite.

User chce:
1. **Dedykowaną postać dla modelu lokalnego** (nawiązanie do cyjanowego
   domku-emblematu `local-llm`).
2. **3 dodatkowe postacie** do wzięcia/podmiany pod dowolny model.
3. **Losowanie**, gdy do jednego modelu pasuje wiele sprite'ów — bez erroru.
4. Globalny tryb **„all random"**: każdy agent losuje z całej puli — dla tych,
   którzy chcą różnorodne miasta.

## 2. Zakres

- `SPRITE_IDS` rośnie z 4 do **8**: `+ local, golem, familiar, oracle`.
- 4 nowe postacie: PixelLab, **oba motywy** (fantasy + sci-fi), **pełne
  animacje** `idle/walk/work` (jakość jak istniejące 4).
- Nowa funkcja `resolveSpriteCandidates(model, cfg): SpriteId[]` (wszystkie
  pasujące, deduplikowane) obok istniejącego `resolveSprite` (first-match,
  zostaje dla miejsc potrzebujących jednej odpowiedzi — np. nazwa w rejestrze,
  miniatura widzianego modelu).
- Wybór sprite'a przy tworzeniu jednostki: gdy >1 kandydat → **`Math.random`**
  (reroll per spawn/odświeżenie).
- Nowy setting **`allRandom: boolean`** + checkbox w panelu ustawień. ON →
  kandydatami jest cała pula `SPRITE_IDS`, mapowanie modeli ignorowane.
- Mapowanie: `local` przejmuje wzorce modeli lokalnych; `golem/familiar/oracle`
  startują **niezmapowane** (puste karty w rejestrze, do wzięcia/podmiany).
- Pipeline assetów rozszerzony **niedestrukcyjnie** (nie gubi istniejących 4).

### Świadomie poza zakresem
- Generyczny user-upload własnej grafiki sprite'a (epik na przyszłość;
  tu pula jest wbudowana, rozszerzana w kodzie + assety w repo).
- Per-sesja stabilność losowania (świadomie odrzucona — user wybrał reroll).
- Tryby animacji `plan/acceptEdits/bypassPermissions` (wciąż Faza 2, fallback
  `<model>-default` bez zmian).

## 3. Architektura — oś tożsamości (shared)

### 3.1 Otwarcie puli — `packages/shared/src/index.ts`
```
export const SPRITE_IDS = ['opus','sonnet','haiku','fable','local','golem','familiar','oracle'] as const;
```
`SpriteId`, `SPRITE_ID_SET`, `isSpriteId`, `validateModelConfig` jadą z nowego
zbioru **bez zmian logiki** (pochodne typu/zbioru). Dodanie idów jest
**wstecznie zgodne**: zapisane configi użytkownika referują sprite po stringu;
nowe idy tylko poszerzają akceptowany zbiór. `upgradeModelConfig` dopisze nowe
domyślne reguły (patrz 3.3) do starszych zapisów.

### 3.2 Kandydaci do losowania — `resolveSpriteCandidates`
```
/** Wszystkie sprite'y pasujące do modelu (w kolejności reguł, bez duplikatów).
 *  Pusto-dopasowane → [fallback.sprite]. Bazuje pod losowanie po stronie klienta. */
export function resolveSpriteCandidates(model: string | undefined, cfg: ModelConfig): SpriteId[]
```
- Iteruje `cfg.sprites`, zbiera `r.sprite` dla każdego `matchModel`, deduplikuje
  zachowując kolejność.
- Brak modelu lub brak dopasowań → `[cfg.fallback.sprite]`.
- `resolveSprite` (first-match) **zostaje** — nadal używany tam, gdzie potrzeba
  jednej deterministycznej odpowiedzi (nazwa modelu w rejestrze, `SpriteThumb`).

### 3.3 Mapowanie domyślne — re-point modeli lokalnych
W `DEFAULT_MODEL_CONFIG.sprites` reguły lokalne wskazują dziś sonnet/haiku/opus/
fable. Przepinamy je na `local`:
`llama, qwen, ministral, mistral, gemma, phi, bielik, glm, lfm → sprite: 'local'`.
`golem/familiar/oracle` **nie dostają** domyślnych reguł (puste karty — user je
przypisuje). Dzięki temu domyślne zachowanie pozostaje sensowne, a losowanie
aktywuje się, gdy user świadomie zmapuje 2+ sprite'y na ten sam wzorzec.

## 4. Architektura — wybór sprite'a przy spawnie (klient)

### 4.1 Punkt wpięcia — `packages/client/src/game/view.ts:461`
Dziś: `getHeroSheet(sessionToArchetypeKey(hero, resolveModelLive(hero.model).sprite))`.
Zmiana: zamiast pojedynczego `.sprite` — wybór z kandydatów:
```
const sprite = pickSpriteLive(hero.model); // patrz 4.2
const sheet = getHeroSheet(sessionToArchetypeKey(hero, sprite));
```
Wybór jest **raz, przy `new Unit`** — `reconcile` reużywa istniejące jednostki
(`if (unit)`), więc w trakcie sesji wygląd jest stabilny. Odświeżenie strony =
nowy `GameView`, pusta `this.units` → wszyscy bohaterowie odtworzeni → reroll.

### 4.2 `pickSpriteLive(model)` — żywy wybór (bliźniak `resolveModelLive`)
W warstwie live-config klienta (tam gdzie `resolveModelLive`/`resolveBuildingLive`):
```
function pickSpriteLive(model: string | undefined): SpriteId {
  const s = getSettingsLive();          // allRandom + ewentualnie themeId
  const candidates = s.allRandom
    ? SPRITE_IDS as readonly SpriteId[]  // cała pula, ignoruje mapowanie
    : resolveSpriteCandidates(model, getModelConfigLive());
  return candidates.length === 1
    ? candidates[0]
    : candidates[Math.floor(Math.random() * candidates.length)];
}
```
- `Math.random` świadomie — reroll per spawn (zgodnie z decyzją usera).
- Brak migotania w trakcie sesji, bo wybór tylko przy tworzeniu jednostki.

### 4.3 Fallback animacji idle (defensywnie) — `Unit`/`sprites`
`Unit` w konstruktorze robi `new AnimatedSprite(sheet.animations.idle)`
([unit.ts:69]) — każdy sprite **musi** mieć `idle`. Przy przełączaniu toru
(`stateToAnimation` → `walk`/`work`) brak danego toru w atlasie = `undefined` →
crash. Mimo że nowe postacie mają pełne animacje, dodajemy strażnika: gdy
`sheet.animations[name]` nie istnieje → użyj `idle`. Chroni przyszłe idle-only
sprite'y i niespójne atlasy.

## 5. Ustawienia — checkbox „all random"

- `allRandom: boolean` w modelu ustawień (domyślnie `false`), persystowany jak
  reszta (`~/.age-of-agents/…` przez istniejący settings I/O).
- Checkbox w `SettingsPanel` (sekcja przy rejestrze modeli / motywie): label
  „All random — losuj wygląd wszystkich agentów (różnorodne miasta)". Hint, że
  odświeżenie przelosowuje.
- Karty rejestru (`ModelRegistryEditor`) renderują się **per `SPRITE_ID`**
  (`groupBySprite` iteruje `SPRITE_IDS`) — 4 nowe rodziny dostają karty
  **automatycznie**. Dokładamy tylko podgląd sprite'a + dopisywanie wzorca
  (helpery `addSpriteModel`/`removeSpriteRule`/`renameSprite` już są).
- Gdy `allRandom` ON, UI rejestru może pokazać subtelną notkę „mapowanie
  ignorowane (all random)".

## 6. Generacja assetów (PixelLab)

Per postać × motyw: `create_character` + `animate_character` dla `idle/walk/work`
→ klatki do `downloads/frames/<key>/<anim>/*.png` (`key = <sprite>-default`) →
`node scripts/pixellab/pack-atlas.mjs <theme>` skleja atlas.

### 6.1 Niedestrukcyjne pakowanie
`pack-atlas.mjs` przebudowuje `index.json` z tego, co jest w `downloads/frames/`
(gitignore), a istniejące 4 tam nie leżą. **Decyzja:** packer czyta istniejący
`index.json` (jeśli jest) i zapisuje **unię** kluczy (stare ∪ nowo spakowane),
zamiast nadpisać listą. Re-run jest wtedy idempotentny i niedestrukcyjny —
spakowanie samego `local` zachowa `opus/sonnet/haiku/fable`. Same pliki
`<key>.png/.json` i tak dotyczą tylko nowych kluczy, więc starych assetów nie
ruszamy.

### 6.2 Stopniowa degradacja
`archetypeKeyChain` spada do `ARCHETYPE_FALLBACK` (`sonnet-default`), więc sprite
bez assetu nie crashuje — pokazuje sonnetowy wygląd. Pozwala wydać **plumbing
przed assetami** (Faza 1).

### 6.3 Koncepty (kreatywne; do drobnych korekt w trakcie generacji)
- `local` — *self-hosted*: fantasy „Strażnik Ogniska" (homunkulus przy
  palenisku, cyjanowe akcenty), sci-fi „Dron Homelabu" (kompaktowy rack-droid,
  cyjanowe diody). Spójny z emblematem domku.
- `golem` — *tank*: fantasy kamienny golem / sci-fi złomowy mech.
- `familiar` — *zwiadowca*: fantasy skrzydlaty chochlik / sci-fi dron zwiadowczy.
- `oracle` — *mistyk*: fantasy zakapturzona wieszczka z kulą / sci-fi
  lewitujący bot sensoryczny.

## 7. Testy

Czyste, jednostkowe (shared + helpery klienta):
- `resolveSpriteCandidates`: wiele dopasowań (kolejność + dedup), brak
  dopasowań → `[fallback]`, brak modelu → `[fallback]`, exact vs pattern.
- `pickSpriteLive`: 1 kandydat → deterministyczny; >1 → indeks z mockowanego
  `Math.random` (0, ~1, granica); `allRandom` ON → cała pula.
- `validateModelConfig`/`isSpriteId`/`upgradeModelConfig`: akceptują nowe idy,
  dopisują re-point reguły lokalne do starych configów.
- Fallback animacji: brak toru `walk` → `idle` (bez wyjątku).
Wizualnie (preview): jednostki dostają zróżnicowane sprite'y; `all random` +
odświeżenie przelosowuje; brak ostrzeżeń w konsoli.

## 8. Fazowanie (pod plan implementacji)

- **Faza 1 — plumbing (bez nowych assetów):** `SPRITE_IDS` +4,
  `resolveSpriteCandidates`, `pickSpriteLive` + wpięcie w `view.ts`, setting
  `allRandom` + checkbox, fallback animacji, re-point reguł lokalnych, testy.
  Nowe sprite'y degradują do `sonnet-default` (działa, choć wygląda jak sonnet).
- **Faza 2 — flagowy `local` end-to-end:** wygeneruj `local` (oba motywy, pełne
  animacje), spakuj, dopisz do `index.json`. Lokalne modele dostają własną twarz.
- **Faza 3 — `golem/familiar/oracle`:** wygeneruj pozostałe 3, spakuj, dopisz.
  Pełna różnorodność i sensowne „all random".

## 9. Ryzyka

- **Generacja to długi/kredytochłonny biegun** (4 postacie × 2 motywy × 3
  animacje). Dopasowanie stylu do istniejących bohaterów to główne ryzyko
  jakości — stąd fazowanie i degradacja do fallbacku.
- **Math.random w kodzie aplikacji jest OK** (to nie skrypt workflow); pojawia
  się tylko przy tworzeniu jednostki, nie w pętli renderu.
