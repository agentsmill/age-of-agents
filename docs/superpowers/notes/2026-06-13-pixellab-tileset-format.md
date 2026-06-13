# PixelLab — format eksportu top-down tileset (Wang dual-grid)

Data: 2026-06-13. Probe: `grass↔water` (`9ff2d08a-...`), 32px, 16 kafli.

## Pobieranie

`get_topdown_tileset(id)` zwraca dwa publiczne URL-e (HTTP 200, bez auth):
- `download_metadata`: `https://api.pixellab.ai/mcp/tilesets/<id>/metadata` (JSON)
- `download_png`: `https://api.pixellab.ai/mcp/tilesets/<id>/image` (PNG)

Plus `base_tile_ids.{lower,upper}` — `lower` (grass) przekazujemy jako `lower_base_tile_id` w kolejnych tilesetach dla spójnej bazy.

## Metadata (kluczowe pola)

- `tile_size: {width,height}` (32).
- `tileset_data.tiles[]` (16 sztuk), każdy:
  - `corners: {NW,NE,SW,SE}` ∈ `"lower"|"upper"` — róg terenu.
  - `bounding_box: {x,y,width,height}` — pozycja kafla w pobranym PNG (128×128 = 4×4 × 32px).
  - `name`: `wang_<idx>` gdzie idx = `NW*8+NE*4+SW*2+SE*1` (konwencja PixelLab).
- `metadata.terrain_prompts.{lower,upper,transition}`.

## Mapowanie na nasz autotiling

Nasza maska: `NW=1, NE=2, SW=4, SE=8` (bit=`upper`) — INNA niż PixelLab (`NW*8+NE*4+SW*2+SE*1`).
Packer (`scripts/pixellab/pack-tileset.mjs`) czyta `corners` → liczy **naszą** maskę → wycina wg `bounding_box` → zapisuje klatkę `t_{naszaMaska}`. Dzięki temu `DUAL_GRID_LOOKUP` w `autotile.ts` jest **tożsamościowy** (`frameForMask(m)=m`), a kruchy punkt „kolejność eksportu" znika (czytamy prawdę z metadanych, nie zgadujemy). Weryfikacja: packer wymaga 16 unikalnych masek (0–15).

## Render

Atlas wyjściowy: `<pair>.png` = 16 kafli 32px w rzędzie (kolumna = maska), `<pair>.json` = klatki `t_0..t_15`, `index.json` = `{pairs, tile}`. Silnik: baza grass (`t_0`) wszędzie + warstwa dual-grid na parę (skala `theme.tile/32`).
