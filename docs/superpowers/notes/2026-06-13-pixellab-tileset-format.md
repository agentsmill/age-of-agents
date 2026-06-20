# PixelLab - Top-down Tileset Export Format (Wang Dual-grid)

Date: 2026-06-13. Probe: `grass<->water` (`9ff2d08a-...`), 32px, 16 tiles.

## Downloading

`get_topdown_tileset(id)` returns two public URLs (HTTP 200, no auth):
- `download_metadata`: `https://api.pixellab.ai/mcp/tilesets/<id>/metadata` (JSON)
- `download_png`: `https://api.pixellab.ai/mcp/tilesets/<id>/image` (PNG)

Plus `base_tile_ids.{lower,upper}`; pass `lower` (grass) as `lower_base_tile_id` in subsequent tilesets for a consistent base.

## Metadata (Key Fields)

- `tile_size: {width,height}` (32).
- `tileset_data.tiles[]` (16 items), each:
  - `corners: {NW,NE,SW,SE}` in `"lower"|"upper"` - terrain corner.
  - `bounding_box: {x,y,width,height}` - tile position in the downloaded PNG (128x128 = 4x4 x 32px).
  - `name`: `wang_<idx>` where idx = `NW*8+NE*4+SW*2+SE*1` (PixelLab convention).
- `metadata.terrain_prompts.{lower,upper,transition}`.

## Mapping to Our Autotiling

Our mask: `NW=1, NE=2, SW=4, SE=8` (bit=`upper`) - DIFFERENT from PixelLab (`NW*8+NE*4+SW*2+SE*1`).
Packer (`scripts/pixellab/pack-tileset.mjs`) reads `corners` -> calculates **our** mask -> cuts by `bounding_box` -> writes frame `t_{ourMask}`. This keeps `DUAL_GRID_LOOKUP` in `autotile.ts` **identity-based** (`frameForMask(m)=m`), and the brittle "export order" problem disappears (we read truth from metadata instead of guessing). Verification: the packer requires 16 unique masks (0-15).

## Render

Output atlas: `<pair>.png` = 16 32px tiles in one row (column = mask), `<pair>.json` = frames `t_0..t_15`, `index.json` = `{pairs, tile}`. Engine: grass base (`t_0`) everywhere + dual-grid layer per pair (scale `theme.tile/32`).
