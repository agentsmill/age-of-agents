import { describe, it, expect } from 'vitest';
import { roadCurve, themeRoadCurves, pointOnRoad } from '../src/game/roads';
import { FANTASY } from '../src/theme/fantasy';
import { SCIFI } from '../src/theme/scifi';

describe('roadCurve', () => {
  it('passes exactly through both nodes (continuity at intersections)', () => {
    const c = roadCurve(2, 3, 10, 7, 1);
    expect(c[0].gx).toBeCloseTo(2);
    expect(c[0].gy).toBeCloseTo(3);
    expect(c[c.length - 1].gx).toBeCloseTo(10);
    expect(c[c.length - 1].gy).toBeCloseTo(7);
  });

  it('is deterministic (same world between calls)', () => {
    expect(roadCurve(2, 3, 10, 7, 5)).toEqual(roadCurve(2, 3, 10, 7, 5));
  });

  it('middle deviates from a straight line (arc, not segment)', () => {
    const c = roadCurve(0, 0, 12, 0, 3);
    const mid = c[Math.floor(c.length / 2)];
    // A straight line would give gy~=0 in the middle; the arc must bend sideways.
    expect(Math.abs(mid.gy)).toBeGreaterThan(0.3);
  });

  it('width is positive and larger at nodes than in the middle', () => {
    const c = roadCurve(0, 0, 14, 0, 2);
    const end = c[0].hw;
    const mid = c[Math.floor(c.length / 2)].hw;
    expect(mid).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(mid);
  });
});

describe('themeRoadCurves', () => {
  it('one curve per graph edge (both themes)', () => {
    expect(themeRoadCurves(FANTASY)).toHaveLength(FANTASY.edges.length);
    expect(themeRoadCurves(SCIFI)).toHaveLength(SCIFI.edges.length);
  });
});

describe('pointOnRoad', () => {
  const curves = themeRoadCurves(FANTASY);
  it('point on road axis is "on the road"', () => {
    const p = curves[0][Math.floor(curves[0].length / 2)];
    expect(pointOnRoad(curves, p.gx, p.gy)).toBe(true);
  });
  it('distant point is not on the road', () => {
    expect(pointOnRoad(curves, -50, -50)).toBe(false);
  });
});
