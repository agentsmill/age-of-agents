import { describe, it, expect } from 'vitest';
import { biomeEdges, type TerrainId } from '../src/game/terrain-map';

describe('biomeEdges', () => {
  // 3x3: center grass, east water, south rock
  const map: TerrainId[][] = [
    ['grass', 'grass', 'grass'],
    ['grass', 'grass', 'water'],
    ['grass', 'rock', 'grass'],
  ];

  it('returns only differing cardinal neighbors', () => {
    const e = biomeEdges(map, 1, 1);
    const biomes = e.map((x) => x.biome).sort();
    expect(biomes).toEqual(['rock', 'water']);
  });

  it('cell in uniform area has no edges', () => {
    expect(biomeEdges(map, 0, 0)).toEqual([]);
  });

  it('directions point to the correct neighbor', () => {
    const e = biomeEdges(map, 1, 1);
    const water = e.find((x) => x.biome === 'water')!;
    expect([water.dgx, water.dgy]).toEqual([1, 0]);
    const rock = e.find((x) => x.biome === 'rock')!;
    expect([rock.dgx, rock.dgy]).toEqual([0, 1]);
  });

  it('does not go outside map bounds', () => {
    expect(() => biomeEdges(map, 2, 2)).not.toThrow();
  });
});
