import { isometric } from '../game/projection';
import type { ThemeDef } from './types';

/**
 * Motyw fantasy (top-down, docelowo assety Tiny Swords).
 * Układ jak na zatwierdzonym szkicu: twierdza centralnie, wieża maga NW,
 * kuźnia NE, biblioteka W, kopalnia E, koszary SW, targ SE.
 */
export const FANTASY: ThemeDef = {
  id: 'fantasy',
  name: 'Twierdza (fantasy)',
  style: 'iso',
  projection: isometric(64, 32),
  tile: 64,
  grid: { w: 40, h: 26 },
  buildings: [
    { id: 'citadel', label: 'Twierdza', gx: 16.5, gy: 9, w: 4, h: 3, door: { gx: 19.5, gy: 14.5 }, placeholderColor: 0x8a8a85 },
    { id: 'tower', label: 'Wieża Maga', gx: 4.5, gy: 2, w: 2, h: 3, door: { gx: 6, gy: 7.5 }, placeholderColor: 0x7f77dd },
    { id: 'forge', label: 'Kuźnia', gx: 31, gy: 3, w: 3, h: 2, door: { gx: 33, gy: 7 }, placeholderColor: 0xd85a30 },
    { id: 'library', label: 'Biblioteka', gx: 2, gy: 14, w: 3, h: 2, door: { gx: 4.5, gy: 17.5 }, placeholderColor: 0x378add },
    { id: 'mine', label: 'Kopalnia', gx: 32, gy: 14.5, w: 3, h: 2, door: { gx: 34, gy: 18 }, placeholderColor: 0x5f5e5a },
    { id: 'barracks', label: 'Koszary', gx: 9, gy: 20, w: 3, h: 2, door: { gx: 11, gy: 19.5 }, placeholderColor: 0x1d9e75 },
    { id: 'market', label: 'Targ', gx: 26, gy: 20, w: 3, h: 2, door: { gx: 28, gy: 19.5 }, placeholderColor: 0xba7517 },
    { id: 'guild', label: 'Gildia', gx: 17, gy: 20.5, w: 3, h: 2, door: { gx: 19.5, gy: 20 }, placeholderColor: 0xd4537e },
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
  ],
  terrain: { base: 0x4f7a3a, alt: 0x568344, path: 0xa8916a },
};
