import { describe, expect, it } from 'vitest';
import { shouldClearPathForSteer } from '../src/game/steering';

describe('GameView steering decisions', () => {
  it('clears stale paths only when a hero enters thinking', () => {
    expect(shouldClearPathForSteer('thinking', false)).toBe(true);
    expect(shouldClearPathForSteer('thinking', true)).toBe(false);
    expect(shouldClearPathForSteer('working', false)).toBe(false);
    expect(shouldClearPathForSteer('idle', false)).toBe(false);
  });
});
