import { Assets, Spritesheet, type SpritesheetData, type Texture } from 'pixi.js';

interface GridAtlasDescriptor {
  image: string;
  size: { w: number; h: number };
  tile: number;
  cols: number;
  prefix: string;
  clips: Record<string, number>;
}

/** Builds a spritesheet from a grid descriptor — fixed-size frames laid out in rows. */
async function loadGridAtlas(base: string, name: string): Promise<Spritesheet> {
  const desc: GridAtlasDescriptor = await (await fetch(`${base}/${name}.json`)).json();
  const tile = desc.tile;
  const frames: SpritesheetData['frames'] = {};
  const animations: NonNullable<SpritesheetData['animations']> = {};
  let i = 0;
  for (const [clip, count] of Object.entries(desc.clips)) {
    const names: string[] = [];
    for (let f = 0; f < count; f++, i++) {
      const id = `${desc.prefix}${clip}${f}`;
      const frame = { x: (i % desc.cols) * tile, y: Math.floor(i / desc.cols) * tile, w: tile, h: tile };
      frames[id] = { frame, sourceSize: { w: tile, h: tile }, spriteSourceSize: { x: 0, y: 0, w: tile, h: tile } };
      names.push(id);
    }
    animations[clip] = names;
  }
  const texture = await Assets.load<Texture>(`${base}/${desc.image}`);
  const sheet = new Spritesheet(texture, { frames, animations, meta: { scale: 1 } });
  await sheet.parse();
  return sheet;
}

const textures = new Map<string, Texture>();
let kingAnim: Spritesheet | null = null;

export async function loadCharacterSprites(themeId: string): Promise<void> {
  textures.clear();
  kingAnim = null;

  try {
    const res = await fetch(`/assets/${themeId}/characters/index.json`);
    if (!res.ok) return;
    const idx: { ids: string[] } = await res.json();
    for (const id of idx.ids) {
      try {
        textures.set(id, await Assets.load<Texture>(`/assets/${themeId}/characters/${id}.png`));
      } catch {
        // Missing single texture should not block the rest of the scene.
      }
    }
  } catch {
    // Theme without character assets is valid.
  }

  try {
    kingAnim = await loadGridAtlas(`/assets/${themeId}/characters`, 'dario-king-anim');
  } catch {
    // King animation atlas is optional; Dario falls back to the static sprite.
  }
}

export function getCharacterTexture(id: string): Texture | null {
  return textures.get(id) ?? null;
}

export function getKingAnimSheet(): Spritesheet | null {
  return kingAnim;
}
