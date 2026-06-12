import { topdown } from '../game/projection';
import type { ThemeDef } from './types';

/**
 * Motyw fantasy (top-down, docelowo assety Tiny Swords).
 * Układ jak na zatwierdzonym szkicu: twierdza centralnie, wieża maga NW,
 * kuźnia NE, biblioteka W, kopalnia E, koszary SW, targ SE.
 */
export const FANTASY: ThemeDef = {
  id: 'fantasy',
  name: 'Twierdza (fantasy)',
  projection: topdown(48),
  tile: 48,
  grid: { w: 26, h: 17 },
  buildings: [
    { id: 'citadel', label: 'Twierdza', gx: 11, gy: 6, w: 4, h: 3, door: { gx: 13, gy: 9.6 }, placeholderColor: 0x8a8a85 },
    { id: 'tower', label: 'Wieża Maga', gx: 3, gy: 1.5, w: 2, h: 3, door: { gx: 4, gy: 5 }, placeholderColor: 0x7f77dd },
    { id: 'forge', label: 'Kuźnia', gx: 20, gy: 2, w: 3, h: 2, door: { gx: 21.5, gy: 4.6 }, placeholderColor: 0xd85a30 },
    { id: 'library', label: 'Biblioteka', gx: 1.5, gy: 9, w: 3, h: 2, door: { gx: 3, gy: 11.5 }, placeholderColor: 0x378add },
    { id: 'mine', label: 'Kopalnia', gx: 21, gy: 9.5, w: 3, h: 2, door: { gx: 22.5, gy: 12 }, placeholderColor: 0x5f5e5a },
    { id: 'barracks', label: 'Koszary', gx: 6, gy: 13, w: 3, h: 2, door: { gx: 7.5, gy: 12.6 }, placeholderColor: 0x1d9e75 },
    { id: 'market', label: 'Targ', gx: 17, gy: 13, w: 3, h: 2, door: { gx: 18.5, gy: 12.6 }, placeholderColor: 0xba7517 },
    { id: 'guild', label: 'Gildia', gx: 11.5, gy: 13.5, w: 3, h: 2, door: { gx: 13, gy: 13.1 }, placeholderColor: 0xd4537e },
  ],
  crossroads: [
    { id: 'x-center', gx: 13, gy: 11 },
    { id: 'x-west', gx: 7, gy: 8 },
    { id: 'x-east', gx: 19, gy: 8 },
    { id: 'x-nw', gx: 6, gy: 5 },
    { id: 'x-ne', gx: 19, gy: 5 },
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
  ],
  terrain: { base: 0x4f7a3a, alt: 0x568344, path: 0xa8916a },
};
