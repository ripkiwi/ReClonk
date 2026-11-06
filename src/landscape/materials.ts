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
}

/** Density at or above which a material blocks movement (C4M_Solid in the original). */
export const SOLID = 50;
/** Density of liquids (C4M_Liquid). */
export const LIQUID = 25;

export type ItemId = 'rock' | 'gold' | 'flint';

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
}

export const MATERIALS: readonly Material[] = [
  { name: 'Sky', density: 0, digFree: false, blastFree: false, colors: [0, 0, 0], texture: 'SMOOTH' },
  {
    name: 'Earth', density: SOLID, digFree: true, blastFree: true,
    colors: [0x7f5f3f, 0x936f4b, 0xab7f5b], texture: 'SMOOTH',
  },
  {
    name: 'Sand', density: SOLID, digFree: true, blastFree: true,
    colors: [0xe0c88c, 0xe0d488, 0xece894], texture: 'SMOOTH2',
  },
  {
    name: 'Rock', density: SOLID, digFree: false, blastFree: true, blast2Object: 'rock', blast2ObjectRatio: 75,
    colors: [0x565656, 0x6a6a6a, 0x7e7e7e], texture: 'ROUGH',
  },
  {
    name: 'Gold', density: SOLID, digFree: false, blastFree: true, blast2Object: 'gold', blast2ObjectRatio: 75,
    colors: [0xe0940c, 0xe8ac10, 0xecc414], texture: 'ROUGH',
  },
  {
    name: 'Granite', density: SOLID, digFree: false, blastFree: false, blastShiftTo: Mat.Rock,
    colors: [0x424242, 0x505050, 0x5a5a5a], texture: 'Rock',
  },
  {
    name: 'Water', density: LIQUID, digFree: false, blastFree: false,
    colors: [0x07238c, 0x07238c, 0x07238c], texture: 'LIQUID',
  },
];

/** Background shown where the landscape is empty underground (dug tunnels). */
export const TUNNEL = { colors: [0x523212, 0x5c421e, 0x6a4824] as [number, number, number], texture: 'SMOOTH2' };
