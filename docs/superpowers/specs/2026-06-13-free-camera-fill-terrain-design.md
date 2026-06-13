# Swobodna kamera + teren wypełniający ekran

Data: 2026-06-13
Status: zaakceptowany (do planu implementacji)

## Problem

Mapa sci‑fi/fantasy (oba motywy izometryczne, siatka 40×26) renderuje się jako
**diament** na środku ekranu. Prostokątny viewport ma przez to 4 trójkątne rogi
bez kafli → widać czarną pustkę (tło Pixi `0x1a1a17`). Dodatkowo:

- Pinch/scroll na trackpadzie **zoomuje całą stronę** (HUD też się skaluje),
  zamiast przybliżać samą mapę.
- Brak **widocznych kontrolek** zoomu — nie wiadomo, jak przybliżać poza kółkiem.

Cel: teren ma wypełniać cały ekran (brak czarnych rogów), a kamera ma działać
„jak w grze" — swobodny zoom mapy, niezależny od reszty interfejsu, z widocznymi
przyciskami.

## Decyzja kierunkowa

**Wariant A — zmiany tylko w renderowaniu.** Siatka rozgrywki zostaje 40×26;
budynki, drogi, jednostki, pathfinding, dekoracje — bez zmian. Rozszerzamy
wyłącznie renderer terenu izometrycznego, żeby pokrył cały prostokąt świata.

Odrzucone: powiększanie realnej siatki (np. 60×46) — rusza layout i pathfinding,
a i tak nie usuwa rogów diamentu (większy diament = większy bbox z pustymi rogami).

### Kluczowa geometria

W projekcji izometrycznej (`toScreen: sx=(gx−gy)·tileW/2, sy=(gx+gy)·tileH/2`):

- prostokąt indeksów siatki rzutuje się na **diament** na ekranie,
- diament indeksów rzutuje się na **prostokąt** na ekranie.

Żeby wypełnić prostokątny obszar ekranu kaflami izo, trzeba więc renderować
**diamentowy zakres** komórek — w tym komórki o ujemnych i nadmiarowych indeksach.
Wyznaczamy je odwracając projekcję dla 4 rogów prostokąta świata:

```
gx = sx/tileW + sy/tileH
gy = sy/tileH − sx/tileW
```

Iterujemy bbox indeksów wyznaczony z tych 4 rogów (z paddingiem ±1) i renderujemy
każdą komórkę, której diament przecina prostokąt świata (culling reszty).

Szum terenu (`fbm` w `terrain-map.ts`) jest zdefiniowany dla dowolnych (gx,gy),
więc rozszerzony teren wygląda jak naturalna kontynuacja — bez nowych assetów.

## Architektura zmian

### a) Renderer terenu izo — `tilemap-iso.ts` + `terrain-map.ts`

- **`terrainAt(theme, gx, gy): TerrainId`** — wydzielona czysta funkcja biomu z
  szumu, działa dla dowolnych współrzędnych. Drogi/`dirt` tylko w obrębie siatki
  rozgrywki (poza nią — naturalna trawa/woda/skała = „dzika ziemia").
- `buildTerrainMap` (tablica 0..w, 0..h) **zostaje** — używają jej dekoracje
  (`scatterDecorations`) i ewentualnie inni konsumenci rozgrywki. Powinna zostać
  zaimplementowana na bazie `terrainAt`, żeby uniknąć duplikacji logiki biomów.
- `biomeEdges` przełączone na `terrainAt` (zamiast indeksowania tablicy), żeby
  działało też na granicach (brak problemu z zakresem tablicy).
- **`buildIsoTilemap(theme, worldRect)`** — przyjmuje prostokąt świata i renderuje
  wszystkie kafle go pokrywające (diamentowy zakres + culling).
  - Feather/AO (zmiękczanie styków biomów) **tylko** w obrębie siatki 40×26.
  - Rogi „dzikiej ziemi" — zwykłe kafle z tintem, bez feather → koszt sprite'ów
    pod kontrolą (~2× obecnej liczby, nie ~5×).

### b) Kamera — `view.ts`

- **Granice świata** = bbox diamentu rozgrywki + margines (`WORLD_MARGIN`, tunable,
  np. 3–4 kafle „dzikiej ziemi" wokół). Teren wypełnia dokładnie ten prostokąt;
  `buildIsoTilemap` dostaje ten sam prostokąt.
- **`clampZoom`**: `minScale` = **cover** (`Math.max(screenW/worldW, screenH/worldH)`)
  — teren zawsze pokrywa ekran (koniec letterboxa). `maxScale` podbity (np. 4–5)
  na bliskie podejście. Zoom kółkiem centrowany na kursorze (domyślne w pixi‑viewport).
- **`clamp`** do granic świata zostaje — kamera nie wyjeżdża poza teren.
- **Auto‑dopasowanie** (`refit`) tylko przy pierwszym wejściu; przy resize
  przelicza clamp/minScale, ale nie resetuje pozycji/zoomu użytkownika.

### c) Blokada zoomu strony — nowy `game/camera-guards.ts`

Funkcja `installCameraGuards(host): () => void` (zwraca cleanup):

- `host.style.touchAction = 'none'`.
- Non‑passive listenery z `preventDefault`:
  - `wheel` gdy `event.ctrlKey` (pinch trackpada w Chrome/Firefox),
  - `gesturestart` / `gesturechange` / `gestureend` (pinch w Safari).
- `document.body.style.overscrollBehavior = 'none'`.

Wpięte w `GameCanvas`/`GameView.init`, sprzątane w cleanup. Zoom trafia tylko do
viewportu mapy; HUD (warstwa DOM) pozostaje w skali 1:1.

### d) Kontrolki zoomu — nowy `hud/ZoomControls.tsx`

- Panel `hud-panel` z przyciskami `+` / `−` / `⤢` (przybliż / oddal / wycentruj‑dopasuj).
- Wywołuje kamerę przez `getGameView()` (jak `Minimap`), nowe metody w `GameView`:
  - `zoomBy(factor: number)` — np. ×1.25 / ×0.8, z animacją, w granicach clampZoom.
  - `resetView()` — wraca do dopasowania całej mapy i centruje.
- Pozycja: prawy‑dolny róg nad minimapą (tunable). Dodany w `App.tsx`.

## Przepływ danych

`GameView.init` liczy `worldRect` (bbox + margines) → przekazuje do
`buildIsoTilemap(theme, worldRect)` (render terenu) **oraz** do `Viewport`
(worldWidth/Height, clamp, clampZoom cover). Logika gry dalej operuje na siatce
40×26 — bez wiedzy o rozszerzonym terenie. Kontrolki HUD i blokady zoomu sięgają
kamery przez `getGameView()` / `installCameraGuards`.

## Obsługa błędów / przypadki brzegowe

- Brak kafli izo (`hasIsoTiles()===false`) → fallback `drawTerrain` jak dotąd;
  wypełnienie rogów dotyczy ścieżki z kaflami. (Do rozważenia: rozszerzyć też
  `drawTerrain`, ale to fallback — niski priorytet.)
- Aspekt ekranu vs świata: przy `cover` na osi nadmiarowej kamera daje się
  przesuwać (clamp), na osi ograniczającej teren wypełnia ekran — brak pustki.
- Zmiana motywu/języka przebudowuje scenę (istniejący mechanizm) — `worldRect`
  liczony od nowa.
- Wydajność: feather ograniczony do siatki rozgrywki; gdyby liczba sprite'ów
  rogów była problemem — fallback na `@pixi/tilemap` (już w zależnościach) dla
  warstwy tła. Najpierw mierzymy, potem optymalizujemy.

## Testy

- Jednostkowe (`vitest`, bez Pixi):
  - `terrainAt` deterministyczne i zgodne z dawnym `buildTerrainMap` w obrębie 0..w,0..h.
  - geometria: zakres indeksów z odwróconej projekcji **pokrywa** zadany prostokąt
    (każdy róg prostokąta ma kafel; brak dziur na siatce testowej).
- Wizualnie (przeglądarka, oba motywy): brak czarnych rogów przy zoomie out/pan do
  krawędzi; pinch trackpada nie zooma strony; kontrolki `+/−/⤢` działają;
  zoom kółkiem centruje na kursorze.

## Poza zakresem (YAGNI)

- Rozsiewanie dekoracji na „dzikim" marginesie (czysto kosmetyczne — można dodać później).
- Parallax/tło kosmosu (odrzucone na rzecz wypełnienia terenem).
- Zmiany layoutu budynków / rozmiaru siatki rozgrywki.
