# PixelLab — format eksportu (probe Fazy 1)

Data: 2026-06-13. Probe: `fantasy-sonnet-default` (`7b5f9d22-3b0b-4e99-afde-9fd825579bfe`), animacja `breathing-idle` (south, 4 klatki).

## Fakty

- **Rozmiar klatki:** `size:48` → canvas **68×68 px**, RGBA, przezroczyste tło. Postać wyśrodkowana, z **paddingiem pod stopami** (stopy NIE sięgają dolnej krawędzi) → kotwica `anchor.y=1.0` zostawiłaby „lewitację"; strojenie w Task 9 (`SPRITE_FOOT_ANCHOR≈0.92`).
- **Kierunki:** dla `n_directions:4` → `south, east, north, west`. Faza 1 używa tylko `south` + odbicie `scale.x=±1`.

## Dwa źródła klatek

### A. Per-frame URL-e z `get_character` — ŹRÓDŁO PRAWDY (używamy tego)

`get_character` listuje każdą animację z jawnymi URL-ami klatek:
```
.../<project>/<char-id>/animations/<job-id>/<dir>/<N>.png      # 0-indeksowane, bez paddingu: 0.png,1.png,...
```
Klatki są publiczne (HTTP 200, bez auth). Liczba klatek: `breathing-idle`=4, `walking`=zależne od template, `work` (v3)=`frame_count` (u nas 8).

**Dlaczego to źródło prawdy:** to MY kolejkujemy animację, więc znamy jej *logiczną* nazwę (idle/walk/work) niezależnie od etykiety PixelLab (`get_character` etykietuje po nazwie template, np. `breathing-idle`, nie po `animation_name`).

### B. Endpoint `download` (ZIP) — pomocniczy, NIE używamy do pakowania

```
GET https://api.pixellab.ai/mcp/characters/<id>/download
```
- **HTTP 423** dopóki jakakolwiek animacja się generuje (`{"detail":"Character has N animation(s) still being generated"}`). 200 + `application/zip` gdy komplet.
- Struktura: `<name>/rotations/<dir>.png`, `<name>/animations/<label>/<dir>/frame_NNN.png`, `metadata.json`.
- **PUŁAPKA:** folder animacji nazywał się `animating` (nie moja `animation_name`). Przy 3 animacjach nazwy w ZIP są niejednoznaczne → nie nadaje się do automatycznego mapowania na idle/walk/work. Stąd wybór źródła A.

## Normalizacja → wejście packera

Packer (`scripts/pixellab/pack-atlas.mjs`) konsumuje:
```
downloads/frames/<key>/<anim>/<NN>.png        # <anim> ∈ idle|walk|work, NN = 2-cyfrowe (00,01,...)
```
Komenda (per animacja, URL-e z `get_character`, `<anim>` = nasza logiczna nazwa):
```bash
mkdir -p "downloads/frames/<key>/<anim>"
i=0; for url in <frame_url_0> <frame_url_1> ...; do
  curl -sL -o "downloads/frames/<key>/<anim>/$(printf '%02d' $i).png" "$url"; i=$((i+1));
done
```
Packer sortuje pliki leksykalnie — 2-cyfrowe paddowanie gwarantuje kolejność klatek do 16.

## Status probe’a (Task 1) — ZAMKNIĘTY

Format jednoznaczny, normalizacja zdefiniowana, packer może działać na układzie `downloads/frames/<key>/<anim>/*.png`.
