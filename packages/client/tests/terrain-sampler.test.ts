import { describe, it, expect } from 'vitest';
import { buildTerrainMap, terrainSampler, TERRAINS } from '../src/game/terrain-map';
import { SCIFI } from '../src/theme/scifi';
import { FANTASY } from '../src/theme/fantasy';

describe('terrainSampler', () => {
  it('zgodny z buildTerrainMap w obrębie siatki (scifi)', () => {
    const map = buildTerrainMap(SCIFI);
    const sample = terrainSampler(SCIFI);
    for (let gy = 0; gy < SCIFI.grid.h; gy++)
      for (let gx = 0; gx < SCIFI.grid.w; gx++) expect(sample(gx, gy)).toBe(map[gy][gx]);
  });

  it('zgodny z buildTerrainMap w obrębie siatki (fantasy)', () => {
    const map = buildTerrainMap(FANTASY);
    const sample = terrainSampler(FANTASY);
    for (let gy = 0; gy < FANTASY.grid.h; gy++)
      for (let gx = 0; gx < FANTASY.grid.w; gx++) expect(sample(gx, gy)).toBe(map[gy][gx]);
  });

  it('zwraca prawidłowy teren poza siatką (ujemne/nadmiarowe indeksy)', () => {
    const sample = terrainSampler(SCIFI);
    for (const [gx, gy] of [
      [-5, -5],
      [-1, 10],
      [45, 30],
      [100, 100],
      [-20, 40],
    ]) {
      expect(TERRAINS).toContain(sample(gx, gy));
    }
  });

  it('poza siatką nie ma ścieżek (dirt tylko wzdłuż dróg w obrębie rozgrywki)', () => {
    const sample = terrainSampler(SCIFI);
    // Daleko od układu dróg — dirt nie powinien się pojawić.
    for (const [gx, gy] of [
      [-15, -15],
      [60, 50],
    ]) {
      expect(sample(gx, gy)).not.toBe('dirt');
    }
  });

  it('deterministyczny', () => {
    const a = terrainSampler(SCIFI);
    const b = terrainSampler(SCIFI);
    expect(a(-3, 7)).toBe(b(-3, 7));
    expect(a(99, 1)).toBe(b(99, 1));
  });
});
