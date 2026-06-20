import { isometric } from '../game/projection';
import type { ThemeDef } from './types';

/**
 * Fantasy theme (top-down originally, now isometric; eventually Tiny Swords assets).
 * Layout from the approved sketch: central citadel, mage tower NW, forge NE,
 * library W, mine E, barracks SW, market SE.
 */
export const FANTASY: ThemeDef = {
  id: 'fantasy',
  name: 'Citadel (fantasy)',
  style: 'iso',
  projection: isometric(64, 32),
  tile: 64,
  heroSprite: { scale: 0.8, footAnchor: 0.87 },
  grid: { w: 40, h: 26 },
  buildings: [
    { id: 'citadel', label: 'Citadel', gx: 16.5, gy: 9, w: 4, h: 3, door: { gx: 19.5, gy: 14.5 }, placeholderColor: 0x8a8a85 },
    { id: 'tower', label: 'Mage Tower', gx: 4.5, gy: 2, w: 2, h: 3, door: { gx: 6, gy: 7.5 }, placeholderColor: 0x7f77dd },
    { id: 'forge', label: 'Forge', gx: 31, gy: 3, w: 3, h: 2, door: { gx: 33, gy: 7 }, placeholderColor: 0xd85a30 },
    { id: 'library', label: 'Library', gx: 2, gy: 14, w: 3, h: 2, door: { gx: 4.5, gy: 17.5 }, placeholderColor: 0x378add },
    { id: 'mine', label: 'Mine', gx: 32, gy: 14.5, w: 3, h: 2, door: { gx: 34, gy: 18 }, placeholderColor: 0x5f5e5a },
    { id: 'barracks', label: 'Barracks', gx: 9, gy: 20, w: 3, h: 2, door: { gx: 11, gy: 19.5 }, placeholderColor: 0x1d9e75 },
    { id: 'market', label: 'Market', gx: 26, gy: 20, w: 3, h: 2, door: { gx: 28, gy: 19.5 }, placeholderColor: 0xba7517 },
    { id: 'guild', label: 'Guild', gx: 17, gy: 20.5, w: 3, h: 2, door: { gx: 19.5, gy: 20 }, placeholderColor: 0xd4537e },
    // Gathering points distribute sessions across the map (grouped by project:
    // see view.ts -> homeBuilding()). Positioned along the northern and southern
    // edges, away from the citadel plaza.
    { id: 'arena', label: 'Arena', gx: 22, gy: 4.5, w: 2, h: 2, door: { gx: 23, gy: 8 }, placeholderColor: 0xc77728 },
    { id: 'tavern', label: 'Tavern', gx: 14, gy: 4.5, w: 2, h: 2, door: { gx: 15, gy: 8 }, placeholderColor: 0x6b4a2a },
    { id: 'garden', label: 'Garden', gx: 14, gy: 22, w: 2, h: 2, door: { gx: 15, gy: 21 }, placeholderColor: 0x5a8a4f },
    // Fourth/fifth gathering points: bar (NW, between tower and arena) and shrine
    // (NE, between arena and forge). Together with arena/tavern/garden they give
    // 5 thematic gathering spots for distributing different projects on the map.
    { id: 'bar', label: 'Bar', gx: 7, gy: 6, w: 2, h: 2, door: { gx: 8, gy: 9.5 }, placeholderColor: 0x9a4a6a },
    { id: 'shrine', label: 'Shrine', gx: 28, gy: 6, w: 2, h: 2, door: { gx: 29, gy: 9.5 }, placeholderColor: 0xc0a8e0 },
  ],
  crossroads: [
    { id: 'x-center', gx: 19.5, gy: 16.5 },
    { id: 'x-west', gx: 10.5, gy: 12 },
    { id: 'x-east', gx: 29, gy: 12 },
    { id: 'x-nw', gx: 9, gy: 7.5 },
    { id: 'x-ne', gx: 29, gy: 7.5 },
  ],
  edges: [
    ['door:citadel', 'x-center'],
    ['x-center', 'door:barracks'],
    ['x-center', 'door:market'],
    ['x-center', 'door:guild'],
    ['x-center', 'x-west'],
    ['x-center', 'x-east'],
    ['x-west', 'door:library'],
    ['x-west', 'x-nw'],
    ['x-nw', 'door:tower'],
    ['x-east', 'door:mine'],
    ['x-east', 'x-ne'],
    ['x-ne', 'door:forge'],
    // Minor roads toward gathering points.
    ['x-nw', 'door:arena'],
    ['x-nw', 'door:tavern'],
    ['x-nw', 'door:bar'],
    ['x-ne', 'door:shrine'],
    ['x-center', 'door:garden'],
  ],
  terrain: { base: 0x4f7a3a, alt: 0x568344, path: 0xa8916a },
};
