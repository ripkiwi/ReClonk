import type { ItemId } from '../landscape/materials';
import type { MapOptions } from '../landscape/generate';

/**
 * A scenario: the map, what each clonk starts with, and how many clonks a player brings.
 * Scenarios are plain data so they can later live in JSON files and come from mods.
 */
export interface ScenarioDef {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  seed: number;
  map: Partial<MapOptions>;
  /** How many clonks of the player's crew take part. */
  crewSize: number;
  /** What each clonk carries at the start. */
  startItems: ItemId[];
  /** Start next to your own hut with your flag (gold, healing, buying and selling). */
  homeBase: boolean;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'goldmine',
    title: 'Gold Mine',
    description:
      'Rolling hills full of rock and gold veins. Dig down, find flints in the earth, blast the gold veins loose and sell the nuggets at your hut. Watch out for the lake.',
    width: 1400,
    height: 640,
    seed: 1337,
    map: {},
    crewSize: 1,
    startItems: ['flint'],
    homeBase: true,
  },
  {
    id: 'minor-melee',
    title: 'Minor Melee',
    description:
      'A pretty flat stretch of land with flints everywhere: lying around, and buried just below the surface. Grab one and let it fly.',
    width: 1000,
    height: 480,
    seed: 4242,
    map: {
      hilliness: 0.12,
      rockVeins: 0.6,
      goldVeins: 0.4,
      lake: false,
      buried: { flint: 90, rock: 10, gold: 4 },
      onSurface: { flint: 45 },
    },
    crewSize: 3,
    startItems: ['flint'],
    homeBase: false,
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
