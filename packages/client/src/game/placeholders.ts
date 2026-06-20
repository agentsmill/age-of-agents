import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import type { BuildingDef, NeonStyle, ThemeDef } from '../theme/types';
import type { Projection } from './projection';
import { getBuildingSprite } from './building-sprites';
import { themeRoadCurves, type RoadPoint } from './roads';

/**
 * Programowe placeholdery w duchu pixel-art — gra działa i wygląda
 * spójnie zanim użytkownik pobierze paczki assetów (npm run assets).
 * Po wgraniu assetów te fabryki zostaną podmienione na spritesheety.
 */

export const TEAM_COLORS = [0xe24b4a, 0x378add, 0x1d9e75, 0xef9f27, 0xd4537e, 0x7f77dd, 0x5dcaa5, 0xf0997b];

export function teamColor(index: number): number {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}

/** Kolor drużyny jako string CSS (#rrggbb) — do HUD (kropki w panelach). */
export function teamColorHex(index: number): string {
  return `#${teamColor(index).toString(16).padStart(6, '0')}`;
}

export const labelStyle = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 11,
  fill: 0xf1efe8,
  stroke: { color: 0x1a1a17, width: 3 },
});

export function drawTerrain(theme: ThemeDef, projection: Projection): Graphics {
  if (theme.neon) return drawTerrainNeon(theme, theme.neon, projection);
  const g = new Graphics();
  // Kafel jako wielokąt z czterech rzutowanych narożników:
  // top-down daje kwadraty, izometria romby — jeden kod, obie projekcje.
  for (let gy = 0; gy < theme.grid.h; gy++) {
    for (let gx = 0; gx < theme.grid.w; gx++) {
      const a = projection.toScreen(gx, gy);
      const b = projection.toScreen(gx + 1, gy);
      const c = projection.toScreen(gx + 1, gy + 1);
      const d = projection.toScreen(gx, gy + 1);
      const color = (gx + gy) % 2 === 0 ? theme.terrain.base : theme.terrain.alt;
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(color);
      if ((gx * 7 + gy * 13) % 11 === 0) {
        const mid = projection.toScreen(gx + 0.4, gy + 0.5);
        g.rect(mid.x, mid.y, 3, 3).fill(theme.terrain.alt + 0x0a140a);
      }
    }
  }
  return g;
}

/**
 * Drogi jako organiczne wstęgi o zmiennej szerokości wzdłuż krzywych z roads.ts
 * (te same krzywe sterują pasem 'dirt' w terenie). Offset liczony w przestrzeni
 * SIATKI, a dopiero potem rzutowany — poprawnie oddaje anizotropię izometrii.
 */
export function drawRoads(theme: ThemeDef, projection: Projection): Graphics {
  if (theme.neon) return drawRoadsNeon(theme, theme.neon, projection);
  const g = new Graphics();
  const edge = darken(theme.terrain.path, 0.3);
  for (const curve of themeRoadCurves(theme)) {
    if (curve.length < 2) continue;
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    for (let i = 0; i < curve.length; i++) {
      const p = curve[i];
      const { nx, ny } = gridNormal(curve, i);
      left.push(projection.toScreen(p.gx + nx * p.hw, p.gy + ny * p.hw));
      right.push(projection.toScreen(p.gx - nx * p.hw, p.gy - ny * p.hw));
    }
    const poly: number[] = [];
    for (const pt of left) poly.push(pt.x, pt.y);
    for (let i = right.length - 1; i >= 0; i--) poly.push(right[i].x, right[i].y);
    g.poly(poly).fill(theme.terrain.path);
    g.poly(poly).stroke({ color: edge, width: 1.5, alpha: 0.5 });
    // zaokrąglone końce, by droga nie urywała się ostrym ścięciem
    drawCap(g, left[0], right[0], theme.terrain.path);
    drawCap(g, left[curve.length - 1], right[curve.length - 1], theme.terrain.path);
  }
  return g;
}

/** Jednostkowa normalna do osi drogi w punkcie i (różnica do sąsiadów). */
function gridNormal(curve: RoadPoint[], i: number): { nx: number; ny: number } {
  const a = curve[Math.max(0, i - 1)];
  const b = curve[Math.min(curve.length - 1, i + 1)];
  const tx = b.gx - a.gx;
  const ty = b.gy - a.gy;
  const len = Math.hypot(tx, ty) || 1;
  return { nx: -ty / len, ny: tx / len };
}

/**
 * Zaokrąglony koniec drogi. Promień = połowa szerokości wstęgi W TYM punkcie
 * (z rzutowanych szyn l/r), więc czapka pasuje do wstęgi dla DOWOLNEJ orientacji
 * drogi — w izometrii szerokość ekranowa zależy od kierunku (anizotropia).
 */
function drawCap(g: Graphics, l: { x: number; y: number }, r: { x: number; y: number }, color: number): void {
  const cx = (l.x + r.x) / 2;
  const cy = (l.y + r.y) / 2;
  const rad = Math.hypot(l.x - r.x, l.y - r.y) / 2 || 4;
  g.circle(cx, cy, rad).fill(color);
}

export function buildBuilding(def: BuildingDef, theme: ThemeDef, projection: Projection, label = def.label): Container {
  const tex = getBuildingSprite(def.id);
  if (tex) return buildBuildingSprite(def, theme, projection, tex, label);
  if (theme.neon) return buildNeonBlock(def, theme, theme.neon, projection, label);
  return theme.style === 'iso'
    ? buildIsoBlock(def, theme, projection, label)
    : buildTopdownHouse(def, theme, projection, label);
}

/** Generowany sprite budynku: kotwica w stopie footprintu, skala do szerokości w kaflach. */
function buildBuildingSprite(def: BuildingDef, theme: ThemeDef, projection: Projection, tex: Texture, labelText: string): Container {
  const container = new Container();
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5, 1); // stopa = dolny środek (PixelLab nie daje metadanych kotwicy)
  sprite.scale.set((def.w * theme.tile) / tex.width);
  const foot = projection.toScreen(def.gx + def.w / 2, def.gy + def.h);
  sprite.position.set(foot.x, foot.y);
  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(foot.x, foot.y + 4);
  container.addChild(sprite, label);
  container.zIndex = projection.depth(def.gx + def.w / 2, def.gy + def.h);
  return container;
}

function buildTopdownHouse(def: BuildingDef, theme: ThemeDef, projection: Projection, labelText: string): Container {
  const container = new Container();
  const { tile } = theme;
  const origin = projection.toScreen(def.gx, def.gy);
  const w = def.w * tile;
  const h = def.h * tile;

  const g = new Graphics();
  // korpus
  g.rect(0, h * 0.35, w, h * 0.65).fill(def.placeholderColor);
  g.rect(0, h * 0.35, w, h * 0.65).stroke({ color: 0x1a1a17, width: 2 });
  // dach
  g.poly([0, h * 0.35, w / 2, 0, w, h * 0.35]).fill(darken(def.placeholderColor, 0.35));
  g.poly([0, h * 0.35, w / 2, 0, w, h * 0.35]).stroke({ color: 0x1a1a17, width: 2 });
  // drzwi
  g.rect(w / 2 - tile * 0.18, h - tile * 0.5, tile * 0.36, tile * 0.5).fill(0x2c2c2a);

  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(w / 2, h + 4);

  container.addChild(g, label);
  container.position.set(origin.x, origin.y);
  container.zIndex = projection.depth(def.gx + def.w / 2, def.gy + def.h);
  return container;
}

function buildIsoBlock(def: BuildingDef, theme: ThemeDef, projection: Projection, labelText: string): Container {
  const container = new Container();
  const lift = theme.tile * 0.9; // wysokość bryły w px

  const A = projection.toScreen(def.gx, def.gy);
  const B = projection.toScreen(def.gx + def.w, def.gy);
  const C = projection.toScreen(def.gx + def.w, def.gy + def.h);
  const D = projection.toScreen(def.gx, def.gy + def.h);
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - lift });
  const At = up(A);
  const Bt = up(B);
  const Ct = up(C);
  const Dt = up(D);

  const g = new Graphics();
  // ściana lewa (D-C) i prawa (B-C) — przylegają do dolnego narożnika C
  g.poly([Dt.x, Dt.y, Ct.x, Ct.y, C.x, C.y, D.x, D.y]).fill(darken(def.placeholderColor, 0.45));
  g.poly([Bt.x, Bt.y, Ct.x, Ct.y, C.x, C.y, B.x, B.y]).fill(darken(def.placeholderColor, 0.25));
  // dach
  g.poly([At.x, At.y, Bt.x, Bt.y, Ct.x, Ct.y, Dt.x, Dt.y]).fill(def.placeholderColor);
  g.poly([At.x, At.y, Bt.x, Bt.y, Ct.x, Ct.y, Dt.x, Dt.y]).stroke({ color: 0x1a1a17, width: 2 });
  // świetlik na dachu
  const roofMid = projection.toScreen(def.gx + def.w / 2, def.gy + def.h / 2);
  g.circle(roofMid.x, roofMid.y - lift, theme.tile * 0.14).fill(lighten(def.placeholderColor, 0.4));
  // drzwi przy dolnym narożniku
  g.rect(C.x - 7, C.y - 20, 14, 20).fill(0x2c2c2a);

  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  label.position.set(C.x, C.y + 6);

  container.addChild(g, label);
  container.zIndex = projection.depth(def.gx + def.w * 0.7, def.gy + def.h * 0.7);
  return container;
}

function lighten(color: number, amount: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * (1 + amount)));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * (1 + amount)));
  const b = Math.min(255, Math.floor((color & 0xff) * (1 + amount)));
  return (r << 16) | (g << 8) | b;
}

export function buildUnitBody(color: number, isPeon: boolean, neon?: NeonStyle): Container {
  if (neon) return buildNeonUnit(color, isPeon, neon);
  const container = new Container();
  const scale = isPeon ? 0.72 : 1;
  const g = new Graphics();

  // pierścień drużyny pod stopami
  g.ellipse(0, 2, 11 * scale, 5 * scale).stroke({ color, width: 2 });
  // korpus
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).fill(isPeon ? 0x8a7a5a : 0x6a6a72);
  g.rect(-6 * scale, -16 * scale, 12 * scale, 14 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // głowa
  g.circle(0, -21 * scale, 5.5 * scale).fill(0xeec39a);
  g.circle(0, -21 * scale, 5.5 * scale).stroke({ color: 0x1a1a17, width: 1.5 });
  // hełm/kaptur w kolorze drużyny
  g.rect(-6 * scale, -27 * scale, 12 * scale, 5 * scale).fill(color);
  // proporczyk
  g.moveTo(7 * scale, -26 * scale).lineTo(7 * scale, -6 * scale).stroke({ color: 0x4a3a28, width: 1.5 });
  g.poly([7 * scale, -26 * scale, 15 * scale, -23 * scale, 7 * scale, -20 * scale]).fill(color);

  container.addChild(g);
  return container;
}

function darken(color: number, amount: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * (1 - amount));
  const g = Math.floor(((color >> 8) & 0xff) * (1 - amount));
  const b = Math.floor((color & 0xff) * (1 - amount));
  return (r << 16) | (g << 8) | b;
}

// ─── Neon-glass (#cyberpunk): render proceduralny bez assetów ─────────────────

type Pt = { x: number; y: number };
const flatQuad = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): number[] => [p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y];

/** Maleńki, stabilny hash stringa → 0..999 (wariacja wysokości bryły). */
function neonHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000;
}

/** Podłoga: czarna płyta OLED + świecąca siatka (Tron-grid) z majorami co 4 kafle. */
function drawTerrainNeon(theme: ThemeDef, neon: NeonStyle, projection: Projection): Graphics {
  const g = new Graphics();
  for (let gy = 0; gy < theme.grid.h; gy++) {
    for (let gx = 0; gx < theme.grid.w; gx++) {
      const a = projection.toScreen(gx, gy);
      const b = projection.toScreen(gx + 1, gy);
      const c = projection.toScreen(gx + 1, gy + 1);
      const d = projection.toScreen(gx, gy + 1);
      // Szachownica ledwie widoczna nad czernią — płyta ma być prawie OLED-czarna.
      g.poly(flatQuad(a, b, c, d)).fill((gx + gy) % 2 === 0 ? neon.floor : lighten(neon.floor, 0.5));
      // Linie majorowe (co 4 kafle) jaśniejsze → czytelna „krata" na czerni.
      const major = gx % 4 === 0 || gy % 4 === 0;
      g.poly(flatQuad(a, b, c, d)).stroke({ color: neon.grid, width: major ? 1.4 : 1, alpha: major ? 0.5 : 0.22 });
    }
  }
  return g;
}

/** Drogi: świecące neonowe trasy (szeroka poświata + jasny rdzeń, blend addytywny). */
function drawRoadsNeon(theme: ThemeDef, neon: NeonStyle, projection: Projection): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (const curve of themeRoadCurves(theme)) {
    if (curve.length < 2) continue;
    const pts = curve.map((p) => projection.toScreen(p.gx, p.gy));
    const trace = (): void => {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    };
    trace();
    g.stroke({ color: neon.secondary, width: 11, alpha: 0.1 }); // szeroka poświata (bloom)
    trace();
    g.stroke({ color: neon.primary, width: 5, alpha: 0.22 }); // wewnętrzna poświata
    trace();
    g.stroke({ color: neon.edge, width: 1.6, alpha: 0.85 }); // jasny rdzeń trasy
  }
  return g;
}

// ─── Sylwetki bryły: prawdziwe prymitywy (kostka / ostrosłup / kula / walec) + wieże ──

/** Segment bryły pryzmatycznej: od wysokości y0 do y1, kurczony do środka footprintu
 *  (s = 0 → pełny rzut, 1 → punkt). Stos daje kostkę, ostrosłup, ziggurat, iglicę. */
interface Prism {
  y0: number;
  y1: number;
  s0: number;
  s1: number;
}
const s = (y0: number, y1: number, s0: number, s1: number): Prism => ({ y0, y1, s0, s1 });

/** Definicja kształtu: rodzaj rysowania + zakres wysokości (w kaflach) → różne wysokości. */
interface NeonShape {
  kind: 'prism' | 'sphere' | 'cylinder';
  h: [number, number]; // [min, max] wysokości w kaflach
  prisms?: (L: number) => Prism[]; // tylko kind === 'prism'
  windows: boolean;
  mast: boolean;
}

const NEON_SHAPES = {
  // Czysta KOSTKA — pełna bryła o proporcjach sześcianu (niska, szeroka).
  cube: { kind: 'prism', h: [0.85, 1.25], prisms: (L) => [s(0, L, 0, 0.015)], windows: true, mast: false },
  // OSTROSŁUP — szeroka podstawa zbiegająca się w wierzchołek.
  pyramid: { kind: 'prism', h: [1.15, 1.7], prisms: (L) => [s(0, L * 0.1, 0, 0.02), s(L * 0.1, L, 0.04, 0.93)], windows: false, mast: false },
  // KULA — unosząca się świecąca orb (siatka południków/równoleżników) na pylonie.
  sphere: { kind: 'sphere', h: [0.9, 1.5], windows: false, mast: false },
  // WALEC — okrągła wieża (elipsy + obręcze), zwieńczona masztem.
  cylinder: { kind: 'cylinder', h: [1.4, 2.1], windows: false, mast: true },
  // Smukła IGLICA zwężająca się ku górze (najwyższa sylwetka panoramy).
  spire: { kind: 'prism', h: [1.9, 2.5], prisms: (L) => [s(0, L * 0.5, 0.16, 0.2), s(L * 0.5, L * 0.82, 0.24, 0.36), s(L * 0.82, L, 0.4, 0.93)], windows: true, mast: true },
  // ZIGGURAT schodkowy — sygnaturowy „mainframe".
  zigg: { kind: 'prism', h: [1.3, 1.9], prisms: (L) => [s(0, L * 0.4, 0, 0.12), s(L * 0.4, L * 0.72, 0.16, 0.3), s(L * 0.72, L, 0.34, 0.5)], windows: true, mast: false },
} satisfies Record<string, NeonShape>;

/** Przypisanie kształtu po id budynku (gałąź neonowa = tylko cyberpunk). Reszta → hash. */
const NEON_SHAPE_BY_ID: Record<string, keyof typeof NEON_SHAPES> = {
  citadel: 'zigg',
  tower: 'spire',
  forge: 'cube',
  library: 'sphere',
  mine: 'pyramid',
  barracks: 'cylinder',
  market: 'cube',
  guild: 'sphere',
  holodeck: 'pyramid',
  mess: 'cylinder',
  hydroponics: 'sphere',
  lounge: 'cube',
  medbay: 'pyramid',
};

const SHAPE_KEYS = Object.keys(NEON_SHAPES) as (keyof typeof NEON_SHAPES)[];

/** Cztery narożniki footprintu skurczone ku środkowi (s) i uniesione (lift), w px ekranu. */
function quadAt(def: BuildingDef, projection: Projection, shrink: number, lift: number): { A: Pt; B: Pt; C: Pt; D: Pt } {
  const cx = def.gx + def.w / 2;
  const cy = def.gy + def.h / 2;
  const f = 1 - shrink;
  const c = (gx: number, gy: number): Pt => {
    const p = projection.toScreen(cx + (gx - cx) * f, cy + (gy - cy) * f);
    return { x: p.x, y: p.y - lift };
  };
  return { A: c(def.gx, def.gy), B: c(def.gx + def.w, def.gy), C: c(def.gx + def.w, def.gy + def.h), D: c(def.gx, def.gy + def.h) };
}

/** Siatka świecących okien na ścianie czołowej (czworokąt Bb→Cb→Ct→Bt, bilinearnie). */
function drawWindows(g: Graphics, Bb: Pt, Cb: Pt, Ct: Pt, Bt: Pt, neon: NeonStyle, col: number, seed: number): void {
  const cols = 3;
  const rows = 5;
  const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  for (let r = 0; r < rows; r++) {
    const v = (r + 0.5) / rows;
    const lo = lerp(Bb, Bt, v); // krawędź zewnętrzna na wysokości v
    const hi = lerp(Cb, Ct, v); // krawędź czołowa na wysokości v
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const u = (cIdx + 0.5) / cols;
      if ((seed + r * 7 + cIdx * 13) % 5 === 0) continue; // część okien zgaszona
      const p = lerp(lo, hi, u);
      const lit = (seed + r * 3 + cIdx) % 4 === 0 ? col : neon.edge;
      g.rect(p.x - 1.5, p.y - 2, 3, 3).fill({ color: lit, alpha: 0.85 });
    }
  }
}

/** Świecący punkt szczytowy (halo + rdzeń), opcjonalnie z masztem antenowym. */
function neonBeacon(g: Graphics, apex: Pt, neon: NeonStyle, col: number, tile: number, mast: boolean): void {
  if (mast) {
    const tip: Pt = { x: apex.x, y: apex.y - tile * 0.7 };
    g.moveTo(apex.x, apex.y).lineTo(tip.x, tip.y).stroke({ color: neon.edge, width: 1.4, alpha: 0.7 });
    g.circle(tip.x, tip.y, tile * 0.06).fill({ color: neon.edge, alpha: 0.95 });
  }
  g.circle(apex.x, apex.y, tile * 0.2).fill({ color: col, alpha: 0.45 });
  g.circle(apex.x, apex.y, tile * 0.09).fill({ color: neon.edge, alpha: 0.95 });
}

/** Stos pryzmatów: kostka / ostrosłup / ziggurat / iglica (ściany szklane + krawędzie neon). */
function drawPrismStack(g: Graphics, def: BuildingDef, projection: Projection, shape: NeonShape, L: number, col: number, neon: NeonStyle, seed: number, tile: number): void {
  const prisms = shape.prisms!(L);
  const vert = (b: Pt, t: Pt, w: number, al: number): void => {
    g.moveTo(b.x, b.y).lineTo(t.x, t.y).stroke({ color: neon.edge, width: w, alpha: al });
  };
  let top = quadAt(def, projection, prisms[0].s1, prisms[0].y1);
  for (let i = 0; i < prisms.length; i++) {
    const p = prisms[i];
    const lo = quadAt(def, projection, p.s0, p.y0);
    const hi = quadAt(def, projection, p.s1, p.y1);
    g.poly(flatQuad(hi.D, hi.C, lo.C, lo.D)).fill({ color: col, alpha: 0.16 }); // ściana lewa (szkło)
    g.poly(flatQuad(hi.B, hi.C, lo.C, lo.B)).fill({ color: col, alpha: 0.24 }); // ściana prawa
    vert(lo.C, hi.C, 2, 0.85); // przedni narożnik najjaśniejszy
    vert(lo.B, hi.B, 1.4, 0.5);
    vert(lo.D, hi.D, 1.4, 0.5);
    if (shape.windows && i === 0) drawWindows(g, lo.B, lo.C, hi.C, hi.B, neon, col, seed);
    top = hi;
  }
  g.poly(flatQuad(top.A, top.B, top.C, top.D)).fill({ color: col, alpha: 0.32 }); // dach
  g.poly(flatQuad(top.A, top.B, top.C, top.D)).stroke({ color: lighten(col, 0.6), width: 2, alpha: 0.9 });
  neonBeacon(g, { x: (top.A.x + top.C.x) / 2, y: (top.A.y + top.C.y) / 2 }, neon, col, tile, shape.mast);
}

/** Unosząca się świecąca KULA: koncentryczny rdzeń + siatka równoleżników/południków + pylon. */
function drawSphere(g: Graphics, fx: number, fyG: number, rx: number, L: number, col: number, neon: NeonStyle, tile: number): void {
  const R = rx * 0.92; // promień orbu (px)
  const cy = fyG - L * 0.5 - R; // środek orbu unosi się nad ziemią
  // Pylon + pierścień bazowy.
  g.moveTo(fx, fyG).lineTo(fx, cy + R).stroke({ color: neon.edge, width: 1.4, alpha: 0.45 });
  g.ellipse(fx, fyG, rx * 0.5, rx * 0.25).stroke({ color: col, width: 1, alpha: 0.4 });
  // Rdzeń: koncentryczne kręgi gasnące ku brzegowi (additive → świecąca kula).
  for (let k = 6; k >= 1; k--) g.circle(fx, cy, (R * k) / 6).fill({ color: k <= 2 ? neon.edge : col, alpha: 0.07 });
  // Równoleżniki (poziome elipsy wg profilu kuli).
  for (const lat of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const w = R * Math.sqrt(1 - lat * lat);
    g.ellipse(fx, cy + R * lat, w, w * 0.32).stroke({ color: neon.edge, width: 1, alpha: 0.5 });
  }
  // Południki (obrys + wąska pionowa elipsa).
  g.ellipse(fx, cy, R, R).stroke({ color: lighten(col, 0.5), width: 1.4, alpha: 0.7 });
  g.ellipse(fx, cy, R * 0.42, R).stroke({ color: neon.edge, width: 1, alpha: 0.45 });
  g.circle(fx, cy, R * 0.14).fill({ color: neon.edge, alpha: 0.95 }); // jasny rdzeń
}

/** Okrągła wieża — WALEC: ściana między dwiema elipsami + obręcze + maszt. */
function drawCylinder(g: Graphics, fx: number, fyG: number, rx: number, ry: number, L: number, col: number, neon: NeonStyle, tile: number): void {
  const topY = fyG - L;
  g.poly([fx - rx, fyG, fx - rx, topY, fx + rx, topY, fx + rx, fyG]).fill({ color: col, alpha: 0.2 }); // ściana boczna (szkło)
  g.ellipse(fx, fyG, rx, ry).stroke({ color: col, width: 1, alpha: 0.4 }); // podstawa
  for (const t of [0.3, 0.6]) g.ellipse(fx, fyG - L * t, rx, ry).stroke({ color: col, width: 1, alpha: 0.4 }); // obręcze
  g.moveTo(fx - rx, fyG).lineTo(fx - rx, topY).stroke({ color: neon.edge, width: 1.4, alpha: 0.6 }); // krawędzie pionowe
  g.moveTo(fx + rx, fyG).lineTo(fx + rx, topY).stroke({ color: neon.edge, width: 1.4, alpha: 0.6 });
  g.ellipse(fx, topY, rx, ry).fill({ color: col, alpha: 0.32 }); // czasza
  g.ellipse(fx, topY, rx, ry).stroke({ color: lighten(col, 0.6), width: 2, alpha: 0.9 });
  neonBeacon(g, { x: fx, y: topY }, neon, col, tile, true);
}

/** Świecąca bryła neon-glass o zróżnicowanej sylwetce (kostka / ostrosłup / kula / walec …). */
function buildNeonBlock(def: BuildingDef, theme: ThemeDef, neon: NeonStyle, projection: Projection, labelText: string): Container {
  const container = new Container();
  const col = def.placeholderColor;
  const hash = neonHash(def.id);
  const shape: NeonShape = NEON_SHAPES[NEON_SHAPE_BY_ID[def.id] ?? SHAPE_KEYS[hash % SHAPE_KEYS.length]];
  const L = theme.tile * (shape.h[0] + (hash / 1000) * (shape.h[1] - shape.h[0])); // wysokość z zakresu kształtu

  const g = new Graphics();
  g.blendMode = 'add'; // światło się sumuje → efekt szkła/poświaty

  // Metryki footprintu (środek + pół-osie elipsy wpisanej w romb) — dla kształtów okrągłych.
  const A = projection.toScreen(def.gx, def.gy);
  const B = projection.toScreen(def.gx + def.w, def.gy);
  const C = projection.toScreen(def.gx + def.w, def.gy + def.h);
  const D = projection.toScreen(def.gx, def.gy + def.h);
  const fx = (B.x + D.x) / 2;
  const fyG = (A.y + C.y) / 2;
  const rx = Math.max(8, (B.x - D.x) / 2);
  const ry = Math.max(4, (C.y - A.y) / 2);

  // Poświata gruntu (miękka elipsa u podstawy) — odbicie/bloom na czarnej płycie.
  g.ellipse(fx, fyG, rx + theme.tile * 0.3, ry + theme.tile * 0.18).fill({ color: col, alpha: 0.1 });

  if (shape.kind === 'sphere') drawSphere(g, fx, fyG, rx, L, col, neon, theme.tile);
  else if (shape.kind === 'cylinder') drawCylinder(g, fx, fyG, rx, ry, L, col, neon, theme.tile);
  else drawPrismStack(g, def, projection, shape, L, col, neon, hash, theme.tile);

  const label = new Text({ text: labelText, style: labelStyle });
  label.anchor.set(0.5, 0);
  // Etykieta przy przednim narożniku podstawy (nieuniesionym).
  label.position.set(C.x, C.y + 6);

  container.addChild(g, label);
  container.zIndex = projection.depth(def.gx + def.w * 0.7, def.gy + def.h * 0.7);
  return container;
}

/** Abstrakcyjny świecący awatar: halo u stóp + romb-rdzeń + wiązka światła. */
function buildNeonUnit(color: number, isPeon: boolean, neon: NeonStyle): Container {
  const container = new Container();
  const s = isPeon ? 0.7 : 1;
  const g = new Graphics();
  g.blendMode = 'add';
  g.ellipse(0, 2, 12 * s, 5 * s).fill({ color, alpha: 0.22 }); // halo u stóp
  g.ellipse(0, 2, 12 * s, 5 * s).stroke({ color, width: 1.5, alpha: 0.85 });
  const cy = -16 * s;
  const diamond = [0, cy - 12 * s, 8 * s, cy, 0, cy + 12 * s, -8 * s, cy]; // romb-rdzeń (abstrakcyjny korpus)
  g.poly(diamond).fill({ color, alpha: 0.32 });
  g.poly(diamond).stroke({ color: neon.edge, width: 1.5, alpha: 0.9 });
  g.circle(0, cy, 2.6 * s).fill({ color: neon.edge, alpha: 1 }); // jasny rdzeń
  g.rect(-1 * s, cy - 26 * s, 2 * s, 14 * s).fill({ color, alpha: 0.5 }); // wiązka światła w górę
  container.addChild(g);
  return container;
}
