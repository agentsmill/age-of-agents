import { describe, expect, it } from 'vitest';
import { awaitingBuilding } from '../src/game/home-building';

describe('awaitingBuilding', () => {
  it('fantasy -> shrine, scifi -> lounge, unknown -> citadel', () => {
    expect(awaitingBuilding('fantasy')).toBe('shrine');
    expect(awaitingBuilding('scifi')).toBe('lounge');
    expect(awaitingBuilding('coś-innego')).toBe('citadel');
  });
});
