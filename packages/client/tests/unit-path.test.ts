import { describe, expect, it } from 'vitest';
import { Unit } from '../src/game/unit';
import { topdown } from '../src/game/projection';

describe('Unit path control', () => {
  it('clears an active path', () => {
    const unit = new Unit('session-1', 0, false, 'Hero', { gx: 0, gy: 0 }, topdown(1));

    unit.setPath([{ id: 'target', gx: 1, gy: 0 }]);
    expect(unit.moving).toBe(true);

    unit.clearPath();
    expect(unit.moving).toBe(false);
  });
});
