import { describe, it, expect } from 'vitest';
import { peonSpawnScatter } from '../src/game/scatter';

describe('peonSpawnScatter', () => {
  it('scatters SEQUENTIAL ids (agent-1..agent-8) - different positions, not one point', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `agent-${i + 1}`);
    const pts = ids.map(peonSpawnScatter);
    const keys = new Set(pts.map((p) => `${p.dx.toFixed(3)},${p.dy.toFixed(3)}`));
    expect(keys.size).toBe(8); // all different (otherwise sprite stack = "2 instead of 8")
    let min = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        min = Math.min(min, Math.hypot(pts[i].dx - pts[j].dx, pts[i].dy - pts[j].dy));
      }
    expect(min).toBeGreaterThan(0.4); // clearly distinguishable (in tiles)
  });

  it('is deterministic', () => {
    expect(peonSpawnScatter('agent-3')).toEqual(peonSpawnScatter('agent-3'));
  });

  it('stays near Hangar door (radius ~0.9-1.8 tiles)', () => {
    for (const id of ['a', 'xyz', 'agent-42', 'wf_abc-1', '8f3a9b2c-1234']) {
      const r = Math.hypot(...Object.values(peonSpawnScatter(id)));
      expect(r).toBeGreaterThanOrEqual(0.9);
      expect(r).toBeLessThanOrEqual(1.8);
    }
  });
});
