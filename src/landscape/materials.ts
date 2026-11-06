/**
 * Landscape materials. Every pixel of the world is one of these.
 *
 * This table will move to content/materials/*.json once the mod loader
 * exists, so mods can add their own materials.
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

export type Behaviour = 'empty' | 'solid' | 'loose' | 'liquid';

export interface Material {
  name: string;
  behaviour: Behaviour;
  /** Can a clonk dig through it? */
  diggable: boolean;
  /** Base colour as 0xRRGGBB. */
  color: number;
}

export const MATERIALS: readonly Material[] = [
  { name: 'Sky', behaviour: 'empty', diggable: false, color: 0x9fd3f0 },
  { name: 'Earth', behaviour: 'solid', diggable: true, color: 0x7a5232 },
  { name: 'Sand', behaviour: 'loose', diggable: true, color: 0xd8bb6a },
  { name: 'Rock', behaviour: 'solid', diggable: true, color: 0x7d7d7d },
  { name: 'Gold', behaviour: 'solid', diggable: true, color: 0xf2c230 },
  { name: 'Granite', behaviour: 'solid', diggable: false, color: 0x4a4550 },
  { name: 'Water', behaviour: 'liquid', diggable: false, color: 0x2f6fd0 },
];
