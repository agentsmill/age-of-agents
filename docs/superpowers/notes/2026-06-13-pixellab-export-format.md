# PixelLab - Export Format (Phase 1 Probe)

Date: 2026-06-13. Probe: `fantasy-sonnet-default` (`7b5f9d22-3b0b-4e99-afde-9fd825579bfe`), animation `breathing-idle` (south, 4 frames).

## Facts

- **Frame size:** `size:48` -> canvas **68x68 px**, RGBA, transparent background. Character centered, with **padding under the feet** (feet do NOT reach the bottom edge) -> anchor `anchor.y=1.0` would leave "floating"; tuning in Task 9 (`SPRITE_FOOT_ANCHOR~=0.92`).
- **Directions:** for `n_directions:4` -> `south, east, north, west`. Phase 1 only uses `south` + mirror `scale.x=+/-1`.

## Two Frame Sources

### A. Per-frame URLs from `get_character` - Source of Truth (we use this)

`get_character` lists every animation with explicit frame URLs:
```
.../<project>/<char-id>/animations/<job-id>/<dir>/<N>.png      # 0-indeksowane, bez paddingu: 0.png,1.png,...
```
Frames are public (HTTP 200, no auth). Frame count: `breathing-idle`=4, `walking`=template-dependent, `work` (v3)=`frame_count` (8 for us).

**Why this is the source of truth:** WE queue the animation, so we know its *logical* name (idle/walk/work) independently of the PixelLab label (`get_character` labels by template name, for example `breathing-idle`, not by `animation_name`).

### B. `download` Endpoint (ZIP) - Auxiliary, NOT Used for Packing

```
GET https://api.pixellab.ai/mcp/characters/<id>/download
```
- **HTTP 423** while any animation is still generating (`{"detail":"Character has N animation(s) still being generated"}`). 200 + `application/zip` when complete.
- Struktura: `<name>/rotations/<dir>.png`, `<name>/animations/<label>/<dir>/frame_NNN.png`, `metadata.json`.
- **TRAP:** the animation folder was named `animating` (not my `animation_name`). With 3 animations, names in the ZIP are ambiguous -> unsuitable for automatic mapping to idle/walk/work. Hence source A.

## Normalization -> Packer Input

Packer (`scripts/pixellab/pack-atlas.mjs`) konsumuje:
```
downloads/frames/<key>/<anim>/<NN>.png        # <anim> ∈ idle|walk|work, NN = 2-cyfrowe (00,01,...)
```
Command (per animation, URLs from `get_character`, `<anim>` = our logical name):
```bash
mkdir -p "downloads/frames/<key>/<anim>"
i=0; for url in <frame_url_0> <frame_url_1> ...; do
  curl -sL -o "downloads/frames/<key>/<anim>/$(printf '%02d' $i).png" "$url"; i=$((i+1));
done
```
The packer sorts files lexically; 2-digit padding guarantees frame order up to 16.

## Probe Status (Task 1) - Closed

Format is unambiguous, normalization is defined, and the packer can operate on the `downloads/frames/<key>/<anim>/*.png` layout.
