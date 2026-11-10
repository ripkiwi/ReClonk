/**
 * Landscape materials. Every pixel of the world is one of these.
 *
 * Values follow the original Clonk Rage material definitions (Material.c4g/*.c4m):
 * clonks can only dig "DigFree" materials, and explosions only clear "BlastFree" ones.
 * This table will move to content/materials/*.json once the mod loader exists.
 */
export const enum Mat {
  Sky = 0,
  Earth = 1,
  Sand = 2,
  Rock = 3,
  Gold = 4,
  Granite = 5,
  Water = 6,
  /**
   * Solid ground of buildings' basements: the original's "Vehicle" material
   * that objects' solid masks put into the landscape. Not drawn (the building
   * draws it), can't be dug or blasted.
   */
  Basement = 7,
  /** Frozen water. Lakes freeze below -10 degrees and thaw above 10. */
  Ice = 8,
  /** Falls instead of rain below 0 degrees, melts above 5. */
  Snow = 9,
}

/** Density at or above which a material blocks movement (C4M_Solid in the original). */
export const SOLID = 50;
/** Density of liquids (C4M_Liquid). */
export const LIQUID = 25;

export type ItemId = 'rock' | 'gold' | 'flint' | 'tflint' | 'superflint' | 'supertflint' | 'teraflint' | 'wood' | 'conkit' | 'meteor' | 'crystal' | 'flag';

export interface Material {
  name: string;
  density: number;
  /** A clonk can dig through it. */
  digFree: boolean;
  /** An explosion clears it. */
  blastFree: boolean;
  /** Blasting it drops this object... */
  blast2Object?: ItemId;
  /** ...one per this many blasted pixels. */
  blast2ObjectRatio?: number;
  /** Blasting turns some of it into this material instead (granite cracks into rock). */
  blastShiftTo?: Mat;
  /** Dark, base and light colour (0xRRGGBB), blended by the texture. */
  colors: [number, number, number];
  /** Texture file in the content pack's materials folder. */
  texture: string;
  /** Chunk shape when a map is zoomed into a landscape (the .c4m Shape): 0 flat, 1 top flat, 2 smooth, 3 rough. */
  shape: 0 | 1 | 2 | 3;
  /** Solid but falls and slides down when nothing holds it (snow; liquids always do). */
  instable?: boolean;
  /** How far a loose pixel of it slides sideways to find somewhere lower (MaxSlide). */
  maxSlide?: number;
  /** How much the wind blows its loose pixels around, 0 to 100 (WindDrift). */
  windDrift?: number;
  /**
   * Turns into another material when it gets too cold or too warm (Below/AboveTempConvert):
   * `dir` 0 works from the top of a patch down, 1 from the bottom up. Up to
   * TempConvStrength + 1 pixels change each time the landscape scan passes.
   */
  belowTemp?: { temp: number; to: Mat; dir: 0 | 1 };
  aboveTemp?: { temp: number; to: Mat; dir: 0 | 1 };
  /** Loose pixels that land in this material turn into it (InMatConvert: snow in water). */
  inMatConvert?: { mat: Mat; to: Mat };
}

/** Pixels converted at once by a temperature change (TempConvStrength). */
export const TEMP_CONV_STRENGTH = 3;

export const MATERIALS: readonly Material[] = [
  { name: 'Sky', density: 0, digFree: false, blastFree: false, colors: [0, 0, 0], texture: 'SMOOTH', shape: 0 },
  {
    name: 'Earth', density: SOLID, digFree: true, blastFree: true,
    colors: [0x7f5f3f, 0x936f4b, 0xab7f5b], texture: 'SMOOTH', shape: 2,
  },
  {
    name: 'Sand', density: SOLID, digFree: true, blastFree: true,
    colors: [0xe0c88c, 0xe0d488, 0xece894], texture: 'SMOOTH2', shape: 2,
  },
  {
    name: 'Rock', density: SOLID, digFree: false, blastFree: true, blast2Object: 'rock', blast2ObjectRatio: 75,
    colors: [0x565656, 0x6a6a6a, 0x7e7e7e], texture: 'ROUGH', shape: 3,
  },
  {
    name: 'Gold', density: SOLID, digFree: false, blastFree: true, blast2Object: 'gold', blast2ObjectRatio: 75,
    colors: [0xe0940c, 0xe8ac10, 0xecc414], texture: 'ROUGH', shape: 3,
  },
  {
    name: 'Granite', density: SOLID, digFree: false, blastFree: false, blastShiftTo: Mat.Rock,
    colors: [0x424242, 0x505050, 0x5a5a5a], texture: 'Rock', shape: 3,
  },
  {
    name: 'Water', density: LIQUID, digFree: false, blastFree: false,
    colors: [0x07238c, 0x07238c, 0x07238c], texture: 'LIQUID', shape: 0,
    windDrift: 30, belowTemp: { temp: -10, to: Mat.Ice, dir: 0 },
  },
  {
    name: 'Basement', density: SOLID, digFree: false, blastFree: false,
    colors: [0x5a5a5a, 0x6e6e6e, 0x828282], texture: 'Rock', shape: 0,
  },
  {
    name: 'Ice', density: SOLID, digFree: true, blastFree: true, maxSlide: 1,
    colors: [0x006ebe, 0x007cfc, 0x0096fa], texture: 'Sponge', shape: 1,
    aboveTemp: { temp: 10, to: Mat.Water, dir: 1 },
  },
  {
    name: 'Snow', density: SOLID, digFree: true, blastFree: true, instable: true, maxSlide: 1, windDrift: 70,
    colors: [0xe6e6e6, 0xf0f0f0, 0xfafafa], texture: 'Spots', shape: 2,
    aboveTemp: { temp: 5, to: Mat.Water, dir: 0 }, inMatConvert: { mat: Mat.Water, to: Mat.Water },
  },
];

/** Background shown where the landscape is empty underground (dug tunnels). */
export const TUNNEL = { colors: [0x523212, 0x5c421e, 0x6a4824] as [number, number, number], texture: 'SMOOTH2' };

/**
 * One entry of the texture map: a material drawn with one of its textures.
 * Maps store these indices, so the same earth can look smooth in one place and
 * rough in another. Ordered like the original's TEXMAP.TXT: a map zooms into
 * the landscape texture by texture in this order, so later entries overlap
 * earlier ones with their ragged edges.
 */
export interface TexEntry {
  /** "Material-Texture", as scenarios name it. */
  name: string;
  mat: Mat;
  /** Texture file in the content pack's materials folder. */
  texture: string;
  /** Chunk shape of the material (tunnels are shaped like earth). */
  shape: 0 | 1 | 2 | 3;
}

const entry = (name: string, mat: Mat, texture: string, shape = MATERIALS[mat].shape): TexEntry => ({ name, mat, texture, shape });

/** The texture map. Index 0 is open sky; tunnels are empty underground space. */
export const TEXMAP: readonly TexEntry[] = [
  entry('Sky', Mat.Sky, 'SMOOTH'),
  entry('Tunnel-Smooth', Mat.Sky, 'SMOOTH2', 2),
  entry('Tunnel-Rough', Mat.Sky, 'ROUGH', 2),
  entry('Water-Liquid', Mat.Water, 'LIQUID'),
  entry('Water-Smooth', Mat.Water, 'LIQUID'),
  entry('Earth-Ridge', Mat.Earth, 'RIDGE'),
  entry('Earth-Smooth', Mat.Earth, 'SMOOTH'),
  entry('Earth-Rough', Mat.Earth, 'ROUGH'),
  entry('Earth-Smooth2', Mat.Earth, 'SMOOTH2'),
  entry('Granite-Rough', Mat.Granite, 'ROUGH'),
  entry('Granite-Ridge', Mat.Granite, 'RIDGE'),
  entry('Granite-Rock', Mat.Granite, 'Rock'),
  entry('Gold-Rough', Mat.Gold, 'ROUGH'),
  entry('Rock-Rough', Mat.Rock, 'ROUGH'),
  entry('Rock-Ridge', Mat.Rock, 'RIDGE'),
  entry('Rock-Rock', Mat.Rock, 'Rock'),
  entry('Sand-Smooth', Mat.Sand, 'SMOOTH'),
  entry('Sand-Smooth2', Mat.Sand, 'SMOOTH2'),
  entry('Sand-Smooth3', Mat.Sand, 'SMOOTH3'),
  entry('Ice-Sponge', Mat.Ice, 'Sponge'),
  entry('Ice-Structure', Mat.Ice, 'Structure'),
  entry('Snow-Spots', Mat.Snow, 'Spots'),
  entry('Snow-Smooth', Mat.Snow, 'SMOOTH'),
  entry('Basement', Mat.Basement, 'Rock'),
];

const TEX_BY_NAME = new Map(TEXMAP.map((t, i) => [t.name.toLowerCase(), i]));

/**
 * The texture map index for "Material-Texture" or a bare "Material" (then
 * `defaultTex` is tried), like the original's GetIndexMatTex. Falls back to the
 * material's own texture; 0 if there's no such material.
 */
export function texIndex(name: string, defaultTex?: string): number {
  const [mat, tex] = name.split('-');
  if (tex) {
    const i = TEX_BY_NAME.get(`${mat}-${tex}`.toLowerCase());
    if (i !== undefined) return i;
  }
  if (defaultTex) {
    const i = TEX_BY_NAME.get(`${mat}-${defaultTex}`.toLowerCase());
    if (i !== undefined) return i;
  }
  const m = MATERIALS.findIndex((x) => x.name.toLowerCase() === mat.toLowerCase());
  return m < 0 ? 0 : DEFAULT_TEX[m];
}

/** Each material's own texture map entry (the original's DefaultMatTex): the one with the material's texture. */
export const DEFAULT_TEX: readonly number[] = MATERIALS.map((m, i) => {
  const t = TEXMAP.findIndex((e) => e.mat === i && e.texture === m.texture && !e.name.startsWith('Tunnel'));
  return t < 0 ? 0 : t;
});
