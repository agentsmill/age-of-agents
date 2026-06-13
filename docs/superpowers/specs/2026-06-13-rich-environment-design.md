# Spec: bogate środowisko — teren autotiling, budynki, dekoracje, większa mapa

Data: 2026-06-13
Status: design zatwierdzony w brainstormingu; **feasibility zweryfikowany** workflowem `rich-terrain-feasibility` (4 agenty, fakty potwierdzone na plikach i rejestrze npm). Oczekuje przeglądu użytkownika przed planami implementacji.

## Cel

Podnieść świat gry z prymitywnych placeholderów (szachownica + budynki-bloki) do **bogatego, generowanego środowiska**: autotilowany teren wielobiomowy, generowane budynki i rozsiane dekoracje, na **większej mapie**. Spójne z Fazą 1 (bohaterowie PixelLab): wszystko to **własne assety PixelLab generowane offline**, runtime tylko je ładuje (twardy inwariant zero-runtime).

Kontynuacja [planu Fazy 1](../plans/2026-06-13-pixellab-assets-phase1.md) i [designu pivotu](2026-06-13-pixellab-assets-design.md).

## Zatwierdzone decyzje (brainstorming wizualny)

- **Poziom: „Bogaty"** — autotiling + dekoracje + generowane budynki + nowy moduł tilemap.
- **Rozmiar mapy fantasy: 40 × 26** (z 26×17, ~2,3× powierzchni).
- **Paleta fantasy — 4 tereny + 4 dekoracje:** `grass` (baza) · `dirt`/ścieżka · `water` · `rock`; dekoracje: drzewa · głazy · krzaki · kwiaty.
- **Paleta sci-fi (kosmiczna) — 4 tereny + 4 dekoracje:** `regolith` (baza) · `plating` · `energy` (świeci) · `crater`; dekoracje: anteny · zbiorniki · meteoryty · kryształy. (Realizacja terenu sci-fi: patrz korekta zakresu niżej.)
- **Układ budynków:** automatyczny re-layout 8 budynków (te same ID/etykiety) + drzwi/węzłów ścieżek pod większą mapę; użytkownik akceptuje pozycje w preview.

## Feasibility (zweryfikowane)

Werdykt: **wykonalne, addytywne, niskie ryzyko.** Projekcja już rozdziela logikę (siatka/ścieżki/depth) od renderu, więc niemal wszystko to warstwa renderu + dane motywu.

- **Render:** `@pixi/tilemap@^5.0.2` (peer `pixi.js >=8.5.0`; nasze `^8.16` spełnia). Klasa `CompositeTilemap` (podklasa `Container`). `import '@pixi/tilemap'` raz na starcie (rejestruje się w rendererze v8).
- **Tileset PixelLab:** `create_topdown_tileset` to system **Wang / dual-grid (16 kafli przy `transition_size < 1.0`)**, generuje **parę terenów** (lower+upper) na tileset. Koszt **1 generacja/tileset**.
- **Budynki/dekoracje:** `create_map_object` — pojedynczy statyczny PNG (przezroczyste tło), 1 generacja/obiekt. **Bez metadanych kotwicy** (definiujemy stopę bottom-center w rendererze). **Obiekty znikają po 8 h** → pobierać i commitować od razu.
- **Koszt całości fantasy:** ~3 tilesety + 8 budynków + ~4 dekoracje ≈ **11–15 generacji** (znikome na subskrypcji; Faza 1 zużyła 16/2000). **Unikać `create_tiles_pro`** (20–40 gen/wywołanie, brak autotilingu).

Pełny brief: wynik workflowu `rich-terrain-feasibility` (sekcje 1–5).

## Zakres i dekompozycja

**Korekta z feasibility:** autotiling Wang/`@pixi/tilemap` pasuje **tylko do kwadratowego top-down (fantasy)**. Izometria sci-fi wymaga osobnego zestawu kafli-rombów i innego lookupu — to oddzielny, trudniejszy wysiłek.

- **Plan A — środowisko fantasy (top-down):** pełny system (logiczna mapa terenu → dual-grid autotiling → `CompositeTilemap`), tileset Wang z PixelLab, 8 budynków `create_map_object`, dekoracje, mapa 40×26 + re-layout + graf ścieżek. **Robimy teraz.**
- **Plan B — środowisko sci-fi (izometria):** palety zaprojektowane, ale teren izo **nie używa** systemu Wang z A. Technika do ustalenia (rekomendacja: generowane kafle-romby per-cel bez płynnych przejść, lub osobny iso-Wang później). Budynki/dekoracje sci-fi przez `create_map_object` (jak A). **Po A.** Tu materializuje się ryzyko izo 2:1 z designu pivotu.

Architektura niżej dotyczy **Planu A**; części niezależne od projekcji (logiczna mapa terenu, loader assetów, budynki/dekoracje jako map-objecty) przejdą do B.

## Architektura (Plan A)

Wydzielone jednostki, każda z jedną odpowiedzialnością; render-warstwa nie dotyka logiki.

### 1. Logiczna mapa terenu (`terrain-map.ts`, nowy)

- Per-komórka logicznej siatki (`grid.w × grid.h`) = enum terenu (`grass|dirt|water|rock`). **Źródło prawdy** — ścieżki, budynki, drogi czytają ją bez zmian.
- **Generowana deterministycznie z ziarna** (szum: plamy biomów — staw, połać kamienia, ziemia wzdłuż dróg), powtarzalna (ten sam świat między sesjami; bez `Math.random()` w wyniku).
- Czysta funkcja `buildTerrainMap(theme) → TerrainId[][]`. Bez Pixi. Testowalna.
- **Ograniczenie z feasibility:** brak prawdziwych styków 3 terenów w jednym narożniku (Wang ich nie generuje) — generator biomów musi ich unikać (rozdzielać tereny pasem bazy).
- **Punkt wkładu użytkownika (learning):** rozkład biomów (gdzie/jak gęsto woda/kamień/ziemia).

### 2. Autotiling dual-grid (`autotile.ts`, nowy)

- Czysta funkcja: logiczna siatka → indeks kafla przejścia per komórka **siatki display**.
- **Dwie siatki:** logiczna (źródło) i display (przesunięta o `(-tile/2, -tile/2)`, o 1 większa w każdej osi — `(w+1)×(h+1)`; każdy kafel display leży na styku 4 komórek logicznych).
- **Maska narożników (zamrożona):** `NW=1, NE=2, SW=4, SE=8`; poza siatką = teren bazowy. `0`=baza, `15`=pełny upper, 1–14=przejścia. 16-elementowy lookup `maska → klatka atlasu`, **zamknięty testem jednostkowym** (jedyny kruchy punkt — zła kolejność = pomieszane przejścia).
- **3+ terenów:** nakładane przebiegi wg priorytetu (przebieg bazy + po jednej warstwie `CompositeTilemap` na parę wyższego priorytetu).
- Bez Pixi/assetów (operuje na indeksach). Testowalna na małej siatce.

### 3. Moduł tilemap (`tilemap.ts`, nowy)

- `loadTilemaps(themeId)` — fetch `/assets/{themeId}/tilemap/index.json` + spritesheety tilesetów (wzorzec jak `sprites.ts`).
- `getTilemap(theme, projection) → Container` — czyta siatkę, uruchamia autotiling, emituje do `CompositeTilemap` (`tilemap.tile(tex, gx*tile - tile/2, gy*tile - tile/2)`). Budowane **raz** na (re)generację mapy, nie per-klatka.
- **Inwariant warstw:** teren w **osobnym kontenerze tła PONIŻEJ `unitLayer`, NIESORTOWANY** (płaska podłoga, nigdy nie wchodzi w `projection.depth`). Budynki+jednostki zostają na jednym `sortableChildren` `unitLayer` z `zIndex = projection.depth(...)`.
- Wpięcie: `view.ts:139` → `await loadTilemaps`; `view.ts:120` → zamiast `drawTerrain` dodaj kontener tilemap **z bramką `theme.style === 'topdown'`** (izo zostaje na `drawTerrain`).

### 4. Budynki — generowane sprite'y (`building-sprites.ts`, nowy)

- `loadBuildingSprites(themeId)` (fetch `/assets/{themeId}/buildings/index.json`) + `getBuildingSprite(id) → Spritesheet|null`.
- `buildBuilding` (`placeholders.ts:55–59`): jeśli sprite → `Sprite` z `anchor(0.5,1)` (stopa, strojona z pikseli jak bohaterowie), `scale` do `def.tile`, pozycja `projection.toScreen(def.gx,def.gy)`, `zIndex = projection.depth(gx+w/2, gy+h)`; inaczej **fallback** na istniejący placeholder. Gra działa przez cały rollout.

### 5. Dekoracje (rozsiew)

- `create_map_object` props (drzewo/głaz/krzak/kwiat). **Deterministyczny rozsiew** `cellHash(gx,gy,salt)` (styl `spotJitter`, bez `Math.random()`) z jitterem subkomórkowym.
- `isDecorable(gx,gy)` wyklucza: footprinty budynków + 1 komórka otuliny; komórki dróg (rasteryzacja `roadSegments()` / dystans < ~0,6 kafla) + drzwi; teren nie-bazowy.
- **Depth:** dekoracje zasłaniające (drzewa/wysokie skały) → `unitLayer`, `zIndex = projection.depth(gx+0.5, gy+0.9)`; płaskie dekale (kwiaty/kamyki) → kontener naziemny poniżej `unitLayer`.
- **Punkt wkładu użytkownika (learning):** progi gęstości/reguły rozsiewu i ziarno.

### Większa mapa + re-layout

- `fantasy.ts:15` `grid` → **40×26**. `fantasy.ts:16–32` — repozycja `gx,gy` + `door.gx,gy` 8 budynków i 5 `crossroads` pod nowe granice. `edges` (33–46) symboliczne — bez zmian. `view.ts` (granice świata/viewport), `pathfind.ts` (graf), drogi (`view.ts:183–189`, `placeholders.ts:45–53`) i `projection.ts` **same się dostrajają** (skala przez `tile`). Jedyna ręczna praca: współrzędne budynków/skrzyżowań — do akceptacji w preview.

### Pipeline assetów (rozszerzenie)

- Nowe drzewa: `/assets/fantasy/tilemap/{index.json, sheety}` i `/assets/fantasy/buildings/{index.json, <id>.json, <id>.png}`; dekoracje analogicznie.
- Packer/manifest rozszerzone o tilesety i map-objecty obok atlasów postaci. Assety commitowane do repo (własne, jak Faza 1).
- Generacja przez MCP **wyłącznie offline**; przy generacji: `get_balance` + `confirm_cost`; obiekty pobierać od razu (znikają po 8 h).

## Twardy inwariant (bez zmian)

ZERO generacji PixelLab w runtime. Generacja tylko offline. Runtime ładuje gotowe tilesety/obiekty/atlasy. `terrain-map`/`autotile` LICZĄ z gotowych assetów — nie generują.

## Plan generacji fantasy (zweryfikowany)

- **Tilesety (model „hub" — trawa stykа się ze wszystkim):** nasza paleta to grass(baza)/dirt/water/rock, więc 3 pary Wang, każda **grass↔X**, spinane wspólnym `lower_base_tile_id` trawy (z `get_topdown_tileset` pierwszego tilesetu) dla spójności bazy: (1) `grass↔water` (woda=lower, `transition_size 0.5`, „mokry brzeg"), (2) `grass↔dirt` (ścieżka, `transition_size 0.25`), (3) `grass↔rock` (kamień, `transition_size 0.25`). Trawa jako hub eliminuje styki 3-terenowe na poziomie pary. Params: `tile_size {32,32}`, `view "high top-down"`, `outline "selective outline"`, `shading "detailed shading"`. = 3 generacje. Render: przebieg bazy (trawa) + 3 warstwy dual-grid wg priorytetu (woda < dirt < rock).
- **Budynki:** 8 × `create_map_object` basic, `view "high top-down"`, ~256×256. = 8 generacji.
- **Dekoracje:** ~4 × `create_map_object`. = ~4 generacje.
- **Razem ≈ 11–15 generacji.**

## Fazowanie (Plan A — z briefu, de-ryzykujące)

1. **Większa siatka + re-layout** (tylko dane, zero nowych zależności) → walidacja ścieżek/dróg/kamery w preview.
2. **Źródło terenu + dual-grid tilemap z PLACEHOLDEROWYM atlasem** (`terrain-map.ts` + `autotile.ts` + `tilemap.ts` + dep `@pixi/tilemap`; prosty kolorowy tileset zastępczy) → walidacja autotilingu BEZ generacji.
3. **Generacja tilesetów PixelLab + lookup + test** (zamrożenie maski→klatki).
4. **Budynki** (`building-sprites.ts` + generacja 8 + fallback).
5. **Dekoracje** (rozsiew + generacja propów).

Każda faza zostawia działającą grę (fallback). Generacja dopiero w 3–5, po sprawdzeniu systemu na placeholderach.

## Punkty wkładu użytkownika (tryb learning)

1. `buildTerrainMap(theme)` — rozkład biomów.
2. Reguły/progi/ziarno rozsiewu dekoracji.
3. Akceptacja re-layoutu budynków/skrzyżowań (40×26) w preview.
4. (bez zmian) `toolToBuilding`, scenariusz demo, progi maszyny stanów, FX/efekt zgonu.

## Ryzyka i otwarte kwestie (zweryfikowane)

- **Izo sci-fi poza autotilingiem** — osobna technika/wysiłek (Plan B); fantasy bramkowane `theme.style==='topdown'`.
- **Lookup maska→klatka** vs kolejność eksportu PixelLab — jedyny cicho-psujący punkt; **zamknąć testem** na realnym sheecie.
- **Brak styków 3-terenowych** w Wang — generator biomów ich unika lub hand-finish (inpainting `create_map_object` z `background_image`).
- **Assety PixelLab efemeryczne (8 h) i bez kotwicy** — pobierać/commitować od razu; stopy definiujemy w silniku.
- **Ręczny re-layout** 40×26 — błędne drzwi psują wizual dróg (logika bezpieczna, wszystko w przestrzeni siatki).
- **Wydajność** większej mapy — `CompositeTilemap` batchuje (limit ~16k kafli/warstwę, daleko powyżej ~1k naszych).

## Niezmienione

Serwer, protokół WS, typy `shared`, logika stanów/projekcji/waypointów (poza re-layoutem), sprite'y bohaterów/peonów z Fazy 1.
