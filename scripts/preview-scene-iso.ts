// Offline ISOMETRIC scene composite for the selected theme -> PNG.
// Replicates engine placement (buildIsoTilemap + buildBuildingSprite + scatter).
// Run: npx tsx scripts/preview-scene-iso.ts [fantasy|scifi]
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildTerrainMap, biomeEdges } from '../packages/client/src/game/terrain-map.ts';
import { themeRoadCurves } from '../packages/client/src/game/roads.ts';
import { scatterDecorations, type DecoKind } from '../packages/client/src/game/decorations.ts';
import { BUILDING_FX } from '../packages/client/src/game/building-fx.ts';
import { SCIFI } from '../packages/client/src/theme/scifi.ts';
import { FANTASY } from '../packages/client/src/theme/fantasy.ts';

const themeId = process.argv[2] === 'fantasy' ? 'fantasy' : 'scifi';
const theme = themeId === 'fantasy' ? FANTASY : SCIFI;
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
function blit(src: PNG, ox: number, oy: number, dw: number, dh: number, tint = 1, alpha = 1) {
  const sx = src.width / dw, sy = src.height / dh;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const i = (Math.floor(y * sy) * src.width + Math.floor(x * sx)) * 4;
    px(OX + ox + x, OY + oy + y, src.data[i] * tint, src.data[i + 1] * tint, src.data[i + 2] * tint, src.data[i + 3] * alpha);
  }
}

// mirror tilemap-iso.ts: tint jitter + boundary outline + neighbor feathering
const FEATHER_ALPHA = 0.45, FEATHER_SCALE = 0.7, FEATHER_OFFSET = 0.28, BOUNDARY_SHADE = 0.94;
const jitter01 = (gx: number, gy: number) => 0.95 + ((((gx * 73856093) ^ (gy * 19349663)) >>> 0) % 100) / 1000;
const cells: { gx: number; gy: number }[] = [];
for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) cells.push({ gx, gy });
cells.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
for (const { gx, gy } of cells) {
  const src = terr[map[gy][gx]]; if (!src) continue;
  const sc = T / src.width;
  const p = proj.toScreen(gx, gy);
  const j = jitter01(gx, gy);
  const edges = biomeEdges(map, gx, gy);
  blit(src, p.x - (src.width * sc) / 2, p.y - (src.height * sc) / 2, src.width * sc, src.height * sc, j * (edges.length ? BOUNDARY_SHADE : 1));
  for (const e of edges) {
    const nsrc = terr[e.biome]; if (!nsrc) continue;
    const fsc = (T / nsrc.width) * FEATHER_SCALE, fw = nsrc.width * fsc, fh = nsrc.height * fsc;
    const np = proj.toScreen(gx + e.dgx, gy + e.dgy);
    const fx = p.x + (np.x - p.x) * FEATHER_OFFSET, fy = p.y + (np.y - p.y) * FEATHER_OFFSET;
    blit(nsrc, fx - fw / 2, fy - fh / 2, fw, fh, j, FEATHER_ALPHA);
  }
}

// --- roads: variable-width ribbon along curves (mirror placeholders.drawRoads) ---
function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}
function fillQuad(poly: { x: number; y: number }[], r: number, g: number, b: number, a: number) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minx = Math.floor(Math.min(...xs));
  const maxx = Math.ceil(Math.max(...xs));
  const miny = Math.floor(Math.min(...ys));
  const maxy = Math.ceil(Math.max(...ys));
  for (let y = miny; y <= maxy; y++)
    for (let x = minx; x <= maxx; x++) if (pointInPoly(x + 0.5, y + 0.5, poly)) px(x, y, r, g, b, a);
}
// rounded road end - mirror placeholders.drawCap (radius = half the ribbon width)
function fillDisc(l: { x: number; y: number }, rr: { x: number; y: number }, r: number, g: number, b: number) {
  const cx = (l.x + rr.x) / 2, cy = (l.y + rr.y) / 2, rad = Math.hypot(l.x - rr.x, l.y - rr.y) / 2;
  const R = Math.ceil(rad);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= rad * rad) px(cx + x, cy + y, r, g, b, 255);
}
const pathC = theme.terrain.path;
const pr = (pathC >> 16) & 0xff;
const pg = (pathC >> 8) & 0xff;
const pb = pathC & 0xff;
for (const curve of themeRoadCurves(theme)) {
  if (curve.length < 2) continue;
  const L: { x: number; y: number }[] = [];
  const R: { x: number; y: number }[] = [];
  for (let i = 0; i < curve.length; i++) {
    const c = curve[i];
    const a = curve[Math.max(0, i - 1)];
    const d = curve[Math.min(curve.length - 1, i + 1)];
    const tx = d.gx - a.gx;
    const ty = d.gy - a.gy;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const lp = proj.toScreen(c.gx + nx * c.hw, c.gy + ny * c.hw);
    const rp = proj.toScreen(c.gx - nx * c.hw, c.gy - ny * c.hw);
    L.push({ x: OX + lp.x, y: OY + lp.y });
    R.push({ x: OX + rp.x, y: OY + rp.y });
  }
  for (let i = 0; i < curve.length - 1; i++) fillQuad([L[i], L[i + 1], R[i + 1], R[i]], pr, pg, pb, 255);
  const last = curve.length - 1;
  fillDisc(L[0], R[0], pr, pg, pb);
  fillDisc(L[last], R[last], pr, pg, pb);
}

const DECO_W: Record<DecoKind, number> = { tree: 1.1, rock: 0.8, bush: 0.75, flower: 0.7 };
const decos = scatterDecorations(theme, map);
function objAt(src: PNG, footGx: number, footGy: number, tilesW: number) {
  const sc = (tilesW * T) / src.width, dw = src.width * sc, dh = src.height * sc;
  const p = proj.toScreen(footGx, footGy);
  blit(src, p.x - dw / 2, p.y - dh, dw, dh);
}
for (const d of decos) if (d.kind === 'bush' || d.kind === 'flower') objAt(load(`decorations/${d.kind}.png`), d.gx, d.gy, DECO_W[d.kind]);
type Item = { depth: number; draw: () => void };
const items: Item[] = [];
for (const b of theme.buildings) items.push({ depth: b.gx + b.w / 2 + b.gy + b.h, draw: () => objAt(load(`buildings/${b.id}.png`), b.gx + b.w / 2, b.gy + b.h, b.w) });
for (const d of decos) if (d.kind === 'tree' || d.kind === 'rock') items.push({ depth: d.gx + d.gy, draw: () => objAt(load(`decorations/${d.kind}.png`), d.gx, d.gy, DECO_W[d.kind]) });
items.sort((a, b) => a.depth - b.depth);
for (const it of items) it.draw();

// --- building activity FX (Task 3): glow + particles above "working" buildings ---
// Static preview of the dynamic effect. Active buildings: env FX_ACTIVE="forge,tower,..."
const ACTIVE = (process.env.FX_ACTIVE ?? 'forge,tower,mine,market').split(',');
function add(x: number, y: number, r: number, g: number, b: number, a: number) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  out.data[i] = Math.min(255, out.data[i] + r * a);
  out.data[i + 1] = Math.min(255, out.data[i + 1] + g * a);
  out.data[i + 2] = Math.min(255, out.data[i + 2] + b * a);
  out.data[i + 3] = 255;
}
function glowDisc(cx: number, cy: number, rad: number, r: number, g: number, b: number, peak: number) {
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++) {
      const d = Math.hypot(x, y * 2); // iso flattening
      if (d > rad) continue;
      add(cx + x, cy + y, r, g, b, peak * (1 - d / rad) ** 2);
    }
}
let seed = 1234;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const b of theme.buildings) {
  if (!ACTIVE.includes(b.id)) continue;
  const style = BUILDING_FX[b.id];
  const bpng = load(`buildings/${b.id}.png`);
  const bhgt = bpng.height * ((b.w * T) / bpng.width);
  const foot = proj.toScreen(b.gx + b.w / 2, b.gy + b.h);
  const ax = OX + foot.x, ay = OY + foot.y - bhgt * 0.78;
  const cr = (style.color >> 16) & 0xff, cg = (style.color >> 8) & 0xff, cb = style.color & 0xff;
  glowDisc(ax, ay, T * 0.55, cr, cg, cb, style.glow * 1.6);
  for (let i = 0; i < 30; i++) {
    const t = rnd();
    const col = rnd() < 0.3 ? style.spark : style.color;
    const mr = (col >> 16) & 0xff, mg = (col >> 8) & 0xff, mb = col & 0xff;
    const mx = ax + (rnd() - 0.5) * style.spread, my = ay - t * style.rise * 1.4;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(mx + dx, my + dy, mr, mg, mb, 0.9 * (1 - t));
  }
}

mkdirSync('downloads', { recursive: true });
writeFileSync(`downloads/scene-iso-${themeId}.png`, PNG.sync.write(out));
console.log(`scene-iso-${themeId}.png ${W}x${H} (${theme.buildings.length} buildings, ${decos.length} decorations)`);
