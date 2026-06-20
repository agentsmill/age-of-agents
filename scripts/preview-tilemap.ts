// Builds the full offline autotiled map (like buildTilemap in the engine) into PNG.
// Run: npx tsx scripts/preview-tilemap.ts
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildTerrainMap, type TerrainId } from '../packages/client/src/game/terrain-map.ts';
import { cornerMask } from '../packages/client/src/game/autotile.ts';
import { FANTASY } from '../packages/client/src/theme/fantasy.ts';

const T = 32;
const dir = 'packages/client/public/assets/fantasy/tilemap';
const PAIRS: { pair: string; upper: TerrainId }[] = [
  { pair: 'water', upper: 'water' },
  { pair: 'dirt', upper: 'dirt' },
  { pair: 'rock', upper: 'rock' },
];

function loadAtlas(pair: string): PNG {
  return PNG.sync.read(readFileSync(join(dir, `${pair}.png`)));
}
const atlases = Object.fromEntries(PAIRS.map((p) => [p.pair, loadAtlas(p.pair)]));

const map = buildTerrainMap(FANTASY);
const { w, h } = FANTASY.grid;
const out = new PNG({ width: (w + 1) * T, height: (h + 1) * T, fill: true });

function blitTile(atlas: PNG, mask: number, dx: number, dy: number) {
  const sx = mask * T;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const si = (y * atlas.width + (sx + x)) * 4;
      if (atlas.data[si + 3] === 0) continue; // skip transparent pixels
      const px = dx * T + x, py = dy * T + y;
      if (px < 0 || py < 0 || px >= out.width || py >= out.height) continue;
      const di = (py * out.width + px) * 4;
      out.data[di] = atlas.data[si]; out.data[di + 1] = atlas.data[si + 1];
      out.data[di + 2] = atlas.data[si + 2]; out.data[di + 3] = 255;
    }
}

const inB = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < w && gy < h;

// grass base (t_0) everywhere
for (let dy = 0; dy <= h; dy++) for (let dx = 0; dx <= w; dx++) blitTile(atlases.water, 0, dx, dy);
// transition layers
for (const { pair, upper } of PAIRS) {
  const isUpper = (gx: number, gy: number) => inB(gx, gy) && map[gy][gx] === upper;
  for (let dy = 0; dy <= h; dy++)
    for (let dx = 0; dx <= w; dx++) {
      const m = cornerMask(dx, dy, isUpper);
      if (m !== 0) blitTile(atlases[pair], m, dx, dy);
    }
}

mkdirSync('downloads', { recursive: true });
writeFileSync('downloads/tilemap-preview.png', PNG.sync.write(out));
console.log(`tilemap-preview.png ${out.width}x${out.height}`);
