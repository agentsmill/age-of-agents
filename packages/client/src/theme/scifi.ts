import { isometric } from '../game/projection';
import type { ThemeDef } from './types';

/**
 * Motyw sci-fi (izometryczny, docelowo assety acdrnx CC0).
 * Ten sam układ logiczny co fantasy — zmienia się tylko projekcja,
 * nazwy budynków i paleta (marsjańska baza).
 */
export const SCIFI: ThemeDef = {
  id: 'scifi',
  name: 'Station (sci-fi)',
  style: 'iso',
  projection: isometric(64, 32),
  tile: 64,
  // Bohaterowie sci-fi generowani w v3 (canvas 92px, stopa ≈ 0.74) — inna
  // kalibracja niż fantasy (standard 68px). Treść ~42px × 1.0 ≈ render fantasy.
  heroSprite: { scale: 1.0, footAnchor: 0.74 },
  grid: { w: 40, h: 26 },
  buildings: [
    { id: 'citadel', label: 'Command Center', gx: 16.5, gy: 9, w: 4, h: 3, door: { gx: 19.5, gy: 14.5 }, placeholderColor: 0x8c93a8 },
    { id: 'tower', label: 'Laboratory', gx: 4.5, gy: 2, w: 2, h: 3, door: { gx: 6, gy: 7.5 }, placeholderColor: 0x7f77dd },
    { id: 'forge', label: 'Drone Factory', gx: 31, gy: 3, w: 3, h: 2, door: { gx: 33, gy: 7 }, placeholderColor: 0xd85a30 },
    { id: 'library', label: 'Data Archive', gx: 2, gy: 14, w: 3, h: 2, door: { gx: 4.5, gy: 17.5 }, placeholderColor: 0x378add },
    { id: 'mine', label: 'Refinery', gx: 32, gy: 14.5, w: 3, h: 2, door: { gx: 34, gy: 18 }, placeholderColor: 0x5f5e5a },
    { id: 'barracks', label: 'Hangar', gx: 9, gy: 20, w: 3, h: 2, door: { gx: 11, gy: 19.5 }, placeholderColor: 0x1d9e75 },
    { id: 'market', label: 'Spaceport', gx: 26, gy: 20, w: 3, h: 2, door: { gx: 28, gy: 19.5 }, placeholderColor: 0xba7517 },
    { id: 'guild', label: 'Comms Station', gx: 17, gy: 20.5, w: 3, h: 2, door: { gx: 19.5, gy: 20 }, placeholderColor: 0xd4537e },
    // Punti di raccolta sci-fi (cfr. fantasy arena/tavern/garden): holodeck per
    // sessioni attive, mensa per chi aspetta, idroponica per chi ha finito.
    { id: 'holodeck', label: 'Holodeck', gx: 22, gy: 4.5, w: 2, h: 2, door: { gx: 23, gy: 8 }, placeholderColor: 0x1d6eaa },
    { id: 'mess', label: 'Mess Hall', gx: 14, gy: 4.5, w: 2, h: 2, door: { gx: 15, gy: 8 }, placeholderColor: 0x8a6a3a },
    { id: 'hydroponics', label: 'Hydroponics', gx: 14, gy: 22, w: 2, h: 2, door: { gx: 15, gy: 21 }, placeholderColor: 0x2a8a4a },
    // Ulteriori punti di raccolta sci-fi: lounge (NW, spazio sociale) e
    // medbay (NE, recupero). Insieme a holodeck/mess/hydroponics, 5 gathering.
    { id: 'lounge', label: 'Lounge', gx: 7, gy: 6, w: 2, h: 2, door: { gx: 8, gy: 9.5 }, placeholderColor: 0x8a4a7a },
    { id: 'medbay', label: 'Medbay', gx: 28, gy: 6, w: 2, h: 2, door: { gx: 29, gy: 9.5 }, placeholderColor: 0xc04a6a },
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
    // Strade minori verso i punti di raccolta
    ['x-nw', 'door:holodeck'],
    ['x-nw', 'door:mess'],
    ['x-nw', 'door:lounge'],
    ['x-ne', 'door:medbay'],
    ['x-center', 'door:hydroponics'],
  ],
  terrain: { base: 0x8a4b32, alt: 0x93553a, path: 0x5a5e66 },
};
