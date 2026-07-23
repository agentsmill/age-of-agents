import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaypointGraph } from '../src/game/pathfind';
import { topdown } from '../src/game/projection';
import type { ThemeDef } from '../src/theme/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WaypointGraph', () => {
  it('warns when no route exists between nodes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme: ThemeDef = {
      id: 'fantasy',
      name: 'Test',
      style: 'topdown',
      projection: topdown(1),
      tile: 1,
      heroSprite: { scale: 1, footAnchor: 1 },
      grid: { w: 4, h: 4 },
      buildings: [
        { id: 'citadel', label: 'Citadel', gx: 0, gy: 0, w: 1, h: 1, door: { gx: 0, gy: 0 }, placeholderColor: 0 },
        { id: 'forge', label: 'Forge', gx: 2, gy: 0, w: 1, h: 1, door: { gx: 2, gy: 0 }, placeholderColor: 0 },
      ],
      crossroads: [],
      edges: [],
      terrain: { base: 0, alt: 0, path: 0 },
    };

    const route = new WaypointGraph(theme).route('door:citadel', 'door:forge');

    expect(route).toEqual([{ id: 'door:forge', gx: 2, gy: 0 }]);
    expect(warn).toHaveBeenCalledWith('[pathfind] No route from door:citadel to door:forge');
  });
});
