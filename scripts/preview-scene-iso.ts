// Offline kompozyt sceny IZOMETRYCZNEJ dla wybranego motywu → PNG.
// Replikuje placement silnika (buildIsoTilemap + buildBuildingSprite + scatter).
// Uruchom: npx tsx scripts/preview-scene-iso.ts [fantasy|scifi] [footYOffset]
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildTerrainMap } from '../packages/client/src/game/terrain-map.ts';
import { scatterDecorations, type DecoKind } from '../packages/client/src/game/decorations.ts';
import { SCIFI } from '../packages/client/src/theme/scifi.ts';
import { FANTASY } from '../packages/client/src/theme/fantasy.ts';

const themeId = process.argv[2] === 'fantasy' ? 'fantasy' : 'scifi';
const theme = themeId === 'fantasy' ? FANTASY : SCIFI;
const FOOT_OFF = Number(process.argv[3] ?? 0);
const T = theme.tile;
const dir = `packages/client/public/assets/${themeId}`;
const proj = theme.projection;
const { w, h } = theme.grid;
const map = buildTerrainMap(theme);
const load = (p: string) => PNG.sync.read(readFileSync(join(dir, p)));
const terr: Record<string, PNG> = {
  grass: load('tilemap-iso/grass.png'), dirt: load('tilemap-iso/dirt.png'),
  water: load('tilemap-iso/water.png'), rock: load('tilemap-iso/rock.png'),
};

let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (let gy = 0; gy <= h; gy++) for (let gx = 0; gx <= w; gx++) {
  const p = proj.toScreen(gx, gy);
  minX = Math.min(minX, p.x - T); maxX = Math.max(maxX, p.x + T);
  minY = Math.min(minY, p.y - T); maxY = Math.max(maxY, p.y + T * 2);
}
const W = Math.ceil(maxX - minX), H = Math.ceil(maxY - minY);
const out = new PNG({ width: W, height: H, fill: true });
const OX = -minX, OY = -minY;

function px(x: number, y: number, r: number, g: number, b: number, a: number) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H || a === 0) return;
  const i = (y * W + x) * 4, ia = a / 255, ib = 1 - ia;
  out.data[i] = Math.round(out.data[i] * ib + r * ia);
  out.data[i + 1] = Math.round(out.data[i + 1] * ib + g * ia);
  out.data[i + 2] = Math.round(out.data[i + 2] * ib + b * ia);
  out.data[i + 3] = 255;
}
function blit(src: PNG, ox: number, oy: number, dw: number, dh: number) {
  const sx = src.width / dw, sy = src.height / dh;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const i = (Math.floor(y * sy) * src.width + Math.floor(x * sx)) * 4;
    px(OX + ox + x, OY + oy + y, src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]);
  }
}

const cells: { gx: number; gy: number }[] = [];
for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) cells.push({ gx, gy });
cells.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
for (const { gx, gy } of cells) {
  const src = terr[map[gy][gx]]; if (!src) continue;
  const sc = T / src.width;
  const p = proj.toScreen(gx, gy);
  blit(src, p.x - (src.width * sc) / 2, p.y - (src.height * sc) / 2, src.width * sc, src.height * sc);
}

const DECO_W: Record<DecoKind, number> = { tree: 1.1, rock: 0.8, bush: 0.75, flower: 0.7 };
const decos = scatterDecorations(theme, map);
function objAt(src: PNG, footGx: number, footGy: number, tilesW: number) {
  const sc = (tilesW * T) / src.width, dw = src.width * sc, dh = src.height * sc;
  const p = proj.toScreen(footGx, footGy);
  blit(src, p.x - dw / 2, p.y + FOOT_OFF * T - dh, dw, dh);
}
for (const d of decos) if (d.kind === 'bush' || d.kind === 'flower') objAt(load(`decorations/${d.kind}.png`), d.gx, d.gy, DECO_W[d.kind]);
type Item = { depth: number; draw: () => void };
const items: Item[] = [];
for (const b of theme.buildings) items.push({ depth: b.gx + b.w / 2 + b.gy + b.h, draw: () => objAt(load(`buildings/${b.id}.png`), b.gx + b.w / 2, b.gy + b.h, b.w) });
for (const d of decos) if (d.kind === 'tree' || d.kind === 'rock') items.push({ depth: d.gx + d.gy, draw: () => objAt(load(`decorations/${d.kind}.png`), d.gx, d.gy, DECO_W[d.kind]) });
items.sort((a, b) => a.depth - b.depth);
for (const it of items) it.draw();

mkdirSync('downloads', { recursive: true });
writeFileSync(`downloads/scene-iso-${themeId}.png`, PNG.sync.write(out));
console.log(`scene-iso-${themeId}.png ${W}x${H} (${theme.buildings.length} budynków, ${decos.length} dekoracji, footOff=${FOOT_OFF})`);
