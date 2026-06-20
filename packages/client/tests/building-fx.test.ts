import { describe, it, expect } from 'vitest';
import { BUILDING_FX, collectActiveBuildings, FX_ACTIVE_RADIUS } from '../src/game/building-fx';
import { FANTASY } from '../src/theme/fantasy';

describe('BUILDING_FX', () => {
  it('has a style for every building in both themes', () => {
    for (const b of FANTASY.buildings) expect(BUILDING_FX[b.id]).toBeDefined();
  });
});

describe('collectActiveBuildings', () => {
  it('counts only working units near the door', () => {
    const active = collectActiveBuildings([
      { buildingId: 'forge', distToDoor: 1, working: true }, // active
      { buildingId: 'mine', distToDoor: 10, working: true }, // too far
      { buildingId: 'tower', distToDoor: 0.5, working: false }, // not working
    ]);
    expect([...active]).toEqual(['forge']);
  });

  it('deduplicates many workers for the same building', () => {
    const active = collectActiveBuildings([
      { buildingId: 'forge', distToDoor: 1, working: true },
      { buildingId: 'forge', distToDoor: 2, working: true },
    ]);
    expect(active.size).toBe(1);
  });

  it('respects boundary radius', () => {
    expect(collectActiveBuildings([{ buildingId: 'forge', distToDoor: FX_ACTIVE_RADIUS, working: true }]).size).toBe(1);
    expect(collectActiveBuildings([{ buildingId: 'forge', distToDoor: FX_ACTIVE_RADIUS + 0.1, working: true }]).size).toBe(0);
  });

  it('empty input -> empty set', () => {
    expect(collectActiveBuildings([]).size).toBe(0);
  });
});
