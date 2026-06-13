# Spec: pełny pivot na PixelLab — assety Agent Citadel

Data: 2026-06-13
Status: design zatwierdzony w brainstormingu, oczekuje na przegląd specu przed planem implementacji.

## Cel

Zastąpić proceduralne placeholdery (`packages/client/src/game/placeholders.ts`)
oraz pobierane paczki Tiny Swords / acdrnx **własnymi assetami generowanymi w
PixelLab**. Pełny pivot: oba motywy (fantasy top-down, sci-fi izometria),
jednostki + budynki + teren. Własne assety mogą trafić do repo — znosi to
ograniczenie licencyjne z notatek projektu.

## TWARDY INWARIANT: zero generacji w runtime

Cała generacja PixelLab to **jednorazowy pass offline**. W czasie działania gry:

- Klient **tylko ładuje** spakowane atlasy z `packages/client/public/assets/`.
- `sessionToArchetypeKey(hero)` **wybiera** spośród gotowych assetów — nie generuje.
- Serwer i klient **nie znają** MCP ani PixelLab. Żadnego wywołania API przy
  spawnie bohatera/peona.
- Zależność od PixelLab istnieje **wyłącznie** w offline'owej ścieżce
  `npm run assets` (regeneracja/repack). Nie jest warunkiem uruchomienia gry.

## Roster (klient, bez zmian w serwerze)

`HeroSnapshot` już niesie `model`, `permissionMode` itd. do klienta, więc cały
wybór archetypu jest po stronie klienta.

### Bohaterowie — `model` × `permissionMode` zapieczone w sprite

- `model`: `opus | sonnet | haiku | fable` (4)
- `permissionMode`: `default | plan | acceptEdits | bypassPermissions` (4)
- Klucz atlasu: `${model}-${mode}` (np. `opus-plan`) → **16 atlasów/motyw**.
- 2 motywy → **32 atlasy bohaterów**.
- Fallback dla nieznanej kombinacji: `sonnet-default`.
- Generacja: 4 bazy `model` przez `create_character`; pozostałe 12 kombinacji
  przez `create_character_state` (spójna tożsamość/proporcje).

### Peony — 1 robotnik/motyw

- Fantasy: chłop/tragarz. Sci-fi: dron serwisowy. Razem 2 atlasy.
- Kolor drużyny: istniejący pierścień pod stopami (silnik), sprite neutralny.

## Stany → animacje

Generujemy **idle / walk / work** na każdą postać (1 kierunek = front/south;
renderer odbija poziomo przez `scale.x = ±1`).

- `stateToAnimation(state)` (wkład learning):
  - `working` → `work`
  - ruch po waypointach / `returning` → `walk`
  - `idle | thinking | awaiting-input | error | sleeping` → `idle`
- Bogactwo stanów daje silnik nakładkami (aura dla `thinking`, `!` dla
  `awaiting-input`, `✶` dla `error`, `zzz` + przygaszenie dla `sleeping`) — już
  istnieją w `unit.ts`, bez generacji.
- **Zgon/zniknięcie** = efekt silnika (zanik + istniejące fajerwerki /
  rozsypanie pikseli). Brak animacji śmierci per postać.

## Budynki (16 = 8 ID × 2 motywy)

ID: `citadel, tower, forge, library, mine, barracks, market, guild`
(etykiety per motyw już w `theme/fantasy.ts` i `theme/scifi.ts`).

- Statyczne sprite'y.
- Fantasy (top-down): `create_map_object` w widoku top-down, kotwica w stopie
  footprintu.
- Sci-fi (izo): obiekt w 3/4 kotwiczony w dolnym narożniku (jak `buildIsoBlock`,
  narożnik C). **Ryzyko**: brak natywnego widoku 2:1 izo w PixelLab → strojenie
  skali, akceptacja lekkiego 3/4 zamiast ścisłej izometrii.
- „Aktywność" przy pracy = FX z istniejącej `fxLayer` (dym/poświata), bez
  dodatkowej generacji.

## Teren — nowa ścieżka renderowania kafli

- Fantasy: `create_topdown_tileset` (Wang, corner-based autotiling).
- Sci-fi: `create_isometric_tile`.
- Nowy moduł tilemap w `view.ts` zastępuje `drawTerrain` (dziś poly-fill
  szachownica). Wyraźnie wydzielony lift — własny moduł, własny test wizualny.

## Format i loader (Pixi v8)

- **Atlas PNG + JSON** (format Pixi/TexturePacker z polem `animations`).
  - Per-postać dla bohaterów/peona — ładowane leniwie (tylko archetypy obecne na
    mapie; rzadko wszystkie 16 naraz).
  - Per-motyw dla budynków + kafli (zawsze obecne).
- Nowy `packages/client/src/game/sprites.ts`:
  - `Assets.load` atlasów; API: `getHeroSprite(key)`, `getPeonSprite()`,
    `getBuildingTexture(id)`, `getTileset()`.
- `unit.ts`: `buildUnitBody` → `new AnimatedSprite(sheet.animations[anim])`,
  `anchor.set(0.5, 1)` zrównane ze stopą placeholdera (`y≈2`), `scale.x=±1`,
  `zIndex = projection.depth(...)` bez zmian.
- **Fallback**: brak atlasu danego klucza → `unit.ts` wraca na `buildUnitBody`.
  Gra działa przez cały rollout.
- `TextureStyle.defaultOptions.scaleMode = 'nearest'` już ustawione (view.ts:55).

## Pipeline — `npm run assets` (nowa rola)

- `assets-manifest.json` przebudowany: zamiast URL-i itch → lista **encji
  PixelLab** (id postaci/obiektów/tilesetów) + klucz logiczny (motyw, typ, klucz
  archetypu, animacja).
- Skrypt: pobiera przez API / download-link → pakuje w atlasy Pixi do
  `public/assets/<motyw>/...` → pisze indeks loadera.
- **Spakowane atlasy commitowane do repo** (własne assety). Skrypt = narzędzie
  regeneracji, nie warunek uruchomienia gry.
- Alternatywa źródła: klon git-projektu PixelLab (`list_projects` daje clone
  URL) — do potwierdzenia po naprawie tokena.

## Fazowanie generacji (~150 jobów łącznie)

- **Faza 0 (BLOKER — użytkownik):** napraw token MCP `pixellab` → `get_balance`
  bez 401.
- **Faza 1 (fantasy, dowód słuszności):** 4 bazy `model` + idle/walk/work →
  atlasy → wpięcie `sprites.ts` + fallback w `unit.ts` → walidacja 1 bohatera
  (render / animacja / odbicie / kotwica). Pozostałe 12 kluczy na fallbacku.
- **Faza 2 (fantasy pełne):** 12 wariantów `permissionMode`
  (`create_character_state`) + peon fantasy + 8 budynków fantasy
  (`create_map_object`) + tileset Wang + moduł tilemap.
- **Faza 3 (sci-fi):** 16 bohaterów + peon + 8 budynków izo + kafle izometryczne.
  Tu materializuje się ryzyko budynków izo.
- **Faza 4 (szlif):** FX aktywności budynków, efekt zgonu/zaniku, odświeżenie
  scenariusza demo pod nowe sprite'y.

## Punkty wkładu użytkownika (tryb learning)

1. `sessionToArchetypeKey(hero)` — `model` × `permissionMode` → klucz atlasu
   (klient, siostra `toolToBuilding`).
2. `stateToAnimation(state)` — `HeroStateKind` → `'idle' | 'walk' | 'work'`.
3. Istniejący `toolToBuilding` — zostaje własnością użytkownika.
4. Progi/efekty: FX aktywności budynku, parametry efektu zaniku.
5. Scenariusz demo (`packages/server/src/demo/scenario.ts`) — zostaje.

## Znane ryzyka i otwarte kwestie

- **401 tokena** — blokuje całą generację (Faza 0).
- **Izo-budynki 2:1** — kompromis 3/4; strojenie przy Fazie 3.
- **Tilemap to nowy kod** w `view.ts` — osobny moduł, osobna walidacja.
- **Wolumen 4×4** (32 bohaterów + animacje) — mitygacja: fazy + fallback;
  możliwy późniejszy downscope `permissionMode` do nakładki, jeśli koszt zaboli.
- **Dokładny format eksportu PixelLab** (atlas vs surowe klatki) — potwierdzić
  przy implementacji i pod niego dostroić pakowanie w `npm run assets`.

## Niezmienione

- Serwer (watcher transkryptów, hooki, maszyna stanów, progi „zrównoważone").
- Protokół WS i typy w `packages/shared`.
- Logika ścieżek / projekcji / waypointów.
