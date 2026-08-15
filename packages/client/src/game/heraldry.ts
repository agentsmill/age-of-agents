import { Container, Graphics } from 'pixi.js';
import type { ProjectArsenal, BuildingId } from '@agent-citadel/shared';
import { BUILDING_FX } from './building-fx';
import { TEAM_COLORS } from './placeholders';

// ─── Deterministic PRNG (mulberry32 seeded via xmur3) ────────────────────────

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 0x100000000;
  };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Create a seeded PRNG from a string. Returns a function → [0, 1). */
function makePrng(seed: string): () => number {
  const hash = xmur3(seed);
  const seedNum = (hash() * 0x100000000) >>> 0;
  return mulberry32(seedNum);
}

/** Stable integer in [0, max) from a string seed, no PRNG state consumed. */
function stableHash(seed: string): number {
  const h = xmur3(seed);
  return (h() * 0x100000000) >>> 0;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CrestInput {
  /** Stable identifier — e.g. projectDir. Drives all randomness. */
  seed: string;
  /** Arsenal: charges derived from connectors/skills/agents/hooks. */
  arsenal?: ProjectArsenal;
  /** Per-building output token counts — drives field tincture and tier. */
  buildingStats?: Partial<Record<BuildingId, number>>;
}

/** The five heraldic division patterns. */
export type DivisionKind = 'plain' | 'per-pale' | 'per-fess' | 'quarterly' | 'per-bend';

/** Bronze/silver/gold rim tier based on total tokens. */
export type TierKind = 'bronze' | 'silver' | 'gold';

/**
 * Fully describes a deterministic crest — everything visual is derived from
 * these values, so the same CrestSpec always renders identically.
 */
export interface CrestSpec {
  /** Primary field color (hex number). */
  fieldColor: number;
  /** Secondary field color for divided shields. */
  fieldColorAlt: number;
  /** How the shield is partitioned. */
  division: DivisionKind;
  /** Rim/border tier. */
  tier: TierKind;
  /** Number of connector pips (lozenges) to draw across the middle band. */
  connectorPips: number;
  /** Whether to draw a chevron (agents present). */
  hasChevron: boolean;
  /** Number of skill stars to draw in upper chief. */
  skillStars: number;
  /** Whether to draw a hook saltire (hooks present). */
  hasSaltire: boolean;
  /** Whether to draw active-session flames. */
  hasFlame: boolean;
}

// ─── Tincture helpers ────────────────────────────────────────────────────────

const DIVISIONS: DivisionKind[] = ['plain', 'per-pale', 'per-fess', 'quarterly', 'per-bend'];

const TIER_COLORS: Record<TierKind, number> = {
  bronze: 0xcd7f32,
  silver: 0xc0c0c0,
  gold: 0xffd700,
};

function dominantBuildingColor(stats: Partial<Record<BuildingId, number>>): number | undefined {
  let bestId: BuildingId | undefined;
  let bestTokens = 0;
  for (const [id, tokens] of Object.entries(stats) as [BuildingId, number][]) {
    if (tokens > bestTokens) {
      bestTokens = tokens;
      bestId = id;
    }
  }
  return bestId !== undefined ? BUILDING_FX[bestId].color : undefined;
}

function totalTokens(stats: Partial<Record<BuildingId, number>>): number {
  return Object.values(stats).reduce((acc, v) => acc + (v ?? 0), 0);
}

function tokenTier(total: number): TierKind {
  if (total >= 100_000) return 'gold';
  if (total >= 20_000) return 'silver';
  return 'bronze';
}

// ─── Public API: deriveCrestSpec ─────────────────────────────────────────────

/**
 * Pure, deterministic: same inputs → same CrestSpec every time.
 * Safe to call with missing/empty arsenal and stats.
 */
export function deriveCrestSpec(input: CrestInput): CrestSpec {
  const { seed, arsenal, buildingStats = {} } = input;
  const rng = makePrng(seed);

  // Field tincture: dominant building color, or stable TEAM_COLORS fallback.
  const domColor = dominantBuildingColor(buildingStats);
  const fieldColor = domColor ?? TEAM_COLORS[stableHash(seed) % TEAM_COLORS.length];

  // Alt field color: a second TEAM_COLORS entry (different index).
  const altIdx = (stableHash(seed + '_alt') + 1) % TEAM_COLORS.length;
  const fieldColorAlt = TEAM_COLORS[altIdx] !== fieldColor
    ? TEAM_COLORS[altIdx]
    : TEAM_COLORS[(altIdx + 1) % TEAM_COLORS.length];

  // Division: deterministic from rng (consume 1 float).
  const divIdx = Math.floor(rng() * DIVISIONS.length);
  const division = DIVISIONS[divIdx];

  // Tier: from total tokens.
  const total = totalTokens(buildingStats);
  const tier = tokenTier(total);

  // Charges from arsenal (clamped so they stay readable at 64–96px).
  const connectors = arsenal?.connectors.length ?? 0;
  const connectorPips = Math.min(connectors, 5);

  const agentCount = arsenal?.agents.length ?? 0;
  const hasChevron = agentCount > 0;

  const skillCount = arsenal?.skills.length ?? 0;
  const skillStars = Math.min(skillCount, 4);

  const hookCount = arsenal?.hooks.length ?? 0;
  const hasSaltire = hookCount > 0;

  const hasFlame = (arsenal?.activeSessions ?? 0) > 0;

  return {
    fieldColor,
    fieldColorAlt,
    division,
    tier,
    connectorPips,
    hasChevron,
    skillStars,
    hasSaltire,
    hasFlame,
  };
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function lighten(color: number, amount: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * (1 + amount)));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * (1 + amount)));
  const b = Math.min(255, Math.floor((color & 0xff) * (1 + amount)));
  return (r << 16) | (g << 8) | b;
}

function darken(color: number, amount: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * (1 - amount));
  const g = Math.floor(((color >> 8) & 0xff) * (1 - amount));
  const b = Math.floor((color & 0xff) * (1 - amount));
  return (r << 16) | (g << 8) | b;
}

/**
 * Draw the classic heater-shield outline as a clip poly (points in local space,
 * centered at 0,0, top edge at -h*0.5, bottom tip at +h*0.5).
 *
 * Heater proportions: width ≈ size, height ≈ size * 1.1.
 * Points: top-left, top-right, bottom-right-curve, tip, bottom-left-curve.
 */
function shieldPoly(size: number): number[] {
  const hw = size / 2;
  const ht = (size * 1.1) / 2;
  return [
    -hw, -ht,          // top-left
     hw, -ht,          // top-right
     hw,  ht * 0.35,   // right shoulder
     0,   ht,          // bottom tip
    -hw,  ht * 0.35,   // left shoulder
  ];
}

/** Fill the entire shield poly with a solid color. */
function fillShield(g: Graphics, size: number, color: number): void {
  g.poly(shieldPoly(size)).fill(color);
}

/** Draw the field with its division pattern (clip to shield poly first). */
function drawDivision(g: Graphics, spec: CrestSpec, size: number): void {
  const hw = size / 2;
  const ht = (size * 1.1) / 2;
  const poly = shieldPoly(size);

  switch (spec.division) {
    case 'plain':
      g.poly(poly).fill(spec.fieldColor);
      break;

    case 'per-pale': {
      // Left half: primary, right half: alt.
      g.poly(poly).fill(spec.fieldColor);
      // Right half clipped to shield: a rectangle that covers right side,
      // intersected visually by drawing the right sub-poly manually.
      g.poly([
        0, -ht,
        hw, -ht,
        hw, ht * 0.35,
        0, ht,
      ]).fill(spec.fieldColorAlt);
      break;
    }

    case 'per-fess': {
      // Top half: primary; bottom half: alt.
      g.poly(poly).fill(spec.fieldColor);
      g.poly([
        -hw, 0,
        hw, 0,
        hw, ht * 0.35,
        0, ht,
        -hw, ht * 0.35,
      ]).fill(spec.fieldColorAlt);
      break;
    }

    case 'quarterly': {
      // Fill full shield then paint two quadrants.
      g.poly(poly).fill(spec.fieldColor);
      // Top-right quadrant
      g.poly([0, -ht, hw, -ht, hw, 0, 0, 0]).fill(spec.fieldColorAlt);
      // Bottom-left quadrant (clipped to heater)
      g.poly([-hw, 0, 0, 0, 0, ht, -hw, ht * 0.35]).fill(spec.fieldColorAlt);
      break;
    }

    case 'per-bend': {
      // Primary fills shield; alt fills lower-right triangle.
      g.poly(poly).fill(spec.fieldColor);
      g.poly([
        hw, -ht,
        hw, ht * 0.35,
        0, ht,
        -hw, ht * 0.35,
      ]).fill(spec.fieldColorAlt);
      break;
    }
  }
}

/** Draw a single lozenge (rotated square) charge centered at (cx, cy). */
function drawLozenge(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill(color);
}

/** Draw a simple 5-pointed star at (cx, cy) with given outer radius. */
function drawStar(g: Graphics, cx: number, cy: number, outerR: number, color: number): void {
  const innerR = outerR * 0.4;
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * i) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  g.poly(pts).fill(color);
}

/** Draw a chevron (inverted V) pointing up in the lower field. */
function drawChevron(g: Graphics, size: number, color: number): void {
  const hw = size / 2;
  const ht = (size * 1.1) / 2;
  const sw = size * 0.1; // stroke width
  const tipY = ht * 0.05;
  const armY = ht * 0.6;
  // Chevron as a thick inverted-V poly (outline shape)
  g.poly([
    -hw * 0.7, armY,
    -hw * 0.7 + sw, armY,
    0, tipY + sw,
    hw * 0.7 - sw, armY,
    hw * 0.7, armY,
    0, tipY,
  ]).fill(color);
}

/** Draw an X saltire (diagonal cross) for hooks. */
function drawSaltire(g: Graphics, size: number, color: number): void {
  const hw = size * 0.35;
  const sw = size * 0.075;
  const ht = (size * 1.1) * 0.35;
  // Two diagonal stripes as quads
  g.poly([
    -hw, -ht,
    -hw + sw, -ht,
    hw, ht,
    hw - sw, ht,
  ]).fill(color);
  g.poly([
    hw - sw, -ht,
    hw, -ht,
    -hw + sw, ht,
    -hw, ht,
  ]).fill(color);
}

/** Draw small flame shapes above the shield for active sessions. */
function drawFlame(g: Graphics, x: number, y: number, size: number, color: number): void {
  const fw = size * 0.08;
  const fh = size * 0.14;
  g.poly([
    x, y - fh,
    x + fw, y - fh * 0.4,
    x + fw * 0.5, y,
    x - fw * 0.5, y,
    x - fw, y - fh * 0.4,
  ]).fill(color);
  // inner lighter tip
  g.poly([
    x, y - fh * 0.65,
    x + fw * 0.4, y - fh * 0.2,
    x - fw * 0.4, y - fh * 0.2,
  ]).fill(lighten(color, 0.5));
}

// ─── Public API: buildCrest ───────────────────────────────────────────────────

/**
 * Build a PixiJS Container rendering the crest described by `spec`.
 *
 * Anchor / size semantics:
 *   - The Container is positioned so that (0, 0) is the VISUAL CENTER of the
 *     shield (horizontally centered; vertically centered including the tip).
 *     The caller sets `container.position.set(x, y)` to place the crest center.
 *   - Default `size` is 80px — the shield spans approximately size × size*1.1 px.
 *   - Everything is drawn relative to (0, 0), so `container.pivot` is not set.
 *     To anchor to the shield top, offset y by +size*0.55 before positioning.
 *   - `container.zIndex` is NOT set; the caller controls draw order.
 *
 * @param spec    A CrestSpec from deriveCrestSpec().
 * @param size    Target width of the shield in px. Default 80.
 * @returns       A Container ready to be added to the stage.
 */
export function buildCrest(spec: CrestSpec, size = 80): Container {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);

  const ht = (size * 1.1) / 2; // half-height of shield

  // ── 1. Field with division pattern ───────────────────────────────────────
  drawDivision(g, spec, size);

  // ── 2. Charges ────────────────────────────────────────────────────────────

  // Charge color: use high-contrast white or dark depending on field brightness.
  const fR = (spec.fieldColor >> 16) & 0xff;
  const fG = (spec.fieldColor >> 8) & 0xff;
  const fB = spec.fieldColor & 0xff;
  const brightness = 0.299 * fR + 0.587 * fG + 0.114 * fB;
  const chargeColor = brightness > 140 ? 0x1a1a17 : 0xf8f4ec;
  const accentColor = brightness > 140 ? darken(spec.fieldColor, 0.5) : lighten(spec.fieldColor, 0.6);

  // Saltire (hooks): drawn first, behind other charges.
  if (spec.hasSaltire) {
    drawSaltire(g, size, accentColor);
  }

  // Chevron (agents): in the lower field.
  if (spec.hasChevron) {
    drawChevron(g, size, chargeColor);
  }

  // Connector pips (lozenges): a row in the fess (middle horizontal band).
  if (spec.connectorPips > 0) {
    const pipR = size * 0.07;
    const totalW = spec.connectorPips * pipR * 2.6;
    const startX = -totalW / 2 + pipR;
    for (let i = 0; i < spec.connectorPips; i++) {
      drawLozenge(g, startX + i * pipR * 2.6, ht * 0.05, pipR, chargeColor);
    }
  }

  // Skill stars: chief area (upper portion of shield).
  if (spec.skillStars > 0) {
    const starR = size * 0.07;
    const totalW = spec.skillStars * starR * 2.8;
    const startX = -totalW / 2 + starR;
    const starY = -ht * 0.55;
    for (let i = 0; i < spec.skillStars; i++) {
      drawStar(g, startX + i * starR * 2.8, starY, starR, chargeColor);
    }
  }

  // ── 3. Shield outline ────────────────────────────────────────────────────
  g.poly(shieldPoly(size)).stroke({ color: 0x1a1a17, width: 2 });

  // ── 4. Tier border / rim ─────────────────────────────────────────────────
  const rimColor = TIER_COLORS[spec.tier];
  const rimW = spec.tier === 'gold' ? 3.5 : spec.tier === 'silver' ? 2.5 : 2;
  g.poly(shieldPoly(size)).stroke({ color: rimColor, width: rimW });

  // Inner rim highlight (gold only — makes the gold tier stand out clearly).
  if (spec.tier === 'gold') {
    const innerPoly = shieldPoly(size * 0.88);
    g.poly(innerPoly).stroke({ color: lighten(rimColor, 0.25), width: 1 });
  }

  // ── 5. Active-session flame above shield tip ──────────────────────────────
  if (spec.hasFlame) {
    const flameColor = 0xff7a1a;
    drawFlame(g, -size * 0.12, -ht - size * 0.04, size, flameColor);
    drawFlame(g,  size * 0.12, -ht - size * 0.04, size, lighten(flameColor, 0.15));
  }

  return container;
}
