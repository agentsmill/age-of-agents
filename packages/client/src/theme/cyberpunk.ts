import { isometric } from '../game/projection';
import type { ThemeDef } from './types';

/**
 * Motyw Cyberpunk — izometryczny, neonowo-szklany sen na jawie (synthwave).
 * W pełni PROCEDURALNY: bez assetów PixelLab → renderer placeholderów rysuje
 * przezroczyste świecące bryły i abstrakcyjne awatary (zob. theme.neon i
 * gałąź neonową w placeholders.ts). Układ logiczny i graf dróg jak w sci-fi.
 */
export const CYBERPUNK: ThemeDef = {
  id: 'cyberpunk',
  name: 'Grid (cyberpunk)',
  style: 'iso',
  projection: isometric(64, 32),
  tile: 64,
  heroSprite: { scale: 1.0, footAnchor: 0.74 }, // nieużywane (brak sprite'ów) — awatary proceduralne
  grid: { w: 40, h: 26 },
  // placeholderColor = neonowy odcień bryły (synthwave: fiolet/róż/cyan/bursztyn).
  buildings: [
    { id: 'citadel', label: 'The Mainframe', gx: 16.5, gy: 9, w: 4, h: 3, door: { gx: 19.5, gy: 14.5 }, placeholderColor: 0xb14bff },
    { id: 'tower', label: 'Uplink', gx: 4.5, gy: 2, w: 2, h: 3, door: { gx: 6, gy: 7.5 }, placeholderColor: 0x05d9e8 },
    { id: 'forge', label: 'Fabricator', gx: 31, gy: 3, w: 3, h: 2, door: { gx: 33, gy: 7 }, placeholderColor: 0xff9e3d },
    { id: 'library', label: 'The Archive', gx: 2, gy: 14, w: 3, h: 2, door: { gx: 4.5, gy: 17.5 }, placeholderColor: 0x4d8cff },
    { id: 'mine', label: 'Daemon Pit', gx: 32, gy: 14.5, w: 3, h: 2, door: { gx: 34, gy: 18 }, placeholderColor: 0xff3caa },
    { id: 'barracks', label: 'Spawn Pool', gx: 9, gy: 20, w: 3, h: 2, door: { gx: 11, gy: 19.5 }, placeholderColor: 0x9b5cff },
    { id: 'market', label: 'The Exchange', gx: 26, gy: 20, w: 3, h: 2, door: { gx: 28, gy: 19.5 }, placeholderColor: 0xffd23d },
    { id: 'guild', label: 'The Nexus', gx: 17, gy: 20.5, w: 3, h: 2, door: { gx: 19.5, gy: 20 }, placeholderColor: 0xff2d95 },
    // Punkty zbiórki (te same id co sci-fi — home-building/awaiting ich używa).
    { id: 'holodeck', label: 'Sim-Deck', gx: 22, gy: 4.5, w: 2, h: 2, door: { gx: 23, gy: 8 }, placeholderColor: 0x6bf0ff },
    { id: 'mess', label: 'Charging Bay', gx: 14, gy: 4.5, w: 2, h: 2, door: { gx: 15, gy: 8 }, placeholderColor: 0xff7ad9 },
    { id: 'hydroponics', label: 'Bio-Vat', gx: 14, gy: 22, w: 2, h: 2, door: { gx: 15, gy: 21 }, placeholderColor: 0x7cff9e },
    { id: 'lounge', label: 'Neon Lounge', gx: 7, gy: 6, w: 2, h: 2, door: { gx: 8, gy: 9.5 }, placeholderColor: 0xc77dff },
    { id: 'medbay', label: 'Repair Bay', gx: 28, gy: 6, w: 2, h: 2, door: { gx: 29, gy: 9.5 }, placeholderColor: 0xff5d73 },
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
    ['x-nw', 'door:holodeck'],
    ['x-nw', 'door:mess'],
    ['x-nw', 'door:lounge'],
    ['x-ne', 'door:medbay'],
    ['x-center', 'door:hydroponics'],
  ],
  terrain: { base: 0x05010a, alt: 0x0a0414, path: 0x3a1a5c },
  neon: {
    primary: 0xff3caa, // hot pink
    secondary: 0xb14bff, // violet
    tertiary: 0xff9e3d, // orange
    edge: 0xffe1ff, // near-white pink
    floor: 0x05010a, // OLED-black z ledwie widocznym fioletem
    grid: 0x9b53ff, // jaśniejszy neonowy fiolet siatki (czytelny na czerni)
  },
};
