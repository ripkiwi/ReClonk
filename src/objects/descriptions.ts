/**
 * What things are, from the original's DescUS.txt of each object (Clonk Rage
 * content, CC BY-NC 4.0, see public/classic/README.md). Menus show them when
 * an item stays selected for a while (C4Menu tooltips).
 */
import { BUILDING_DESCRIPTIONS } from './buildingDefs';

export const DESCRIPTIONS: Record<string, string> = {
  ...BUILDING_DESCRIPTIONS,
  flint: 'Explodes on contact.',
  tflint: 'Useful in mining, as it will explode with a delay.',
  superflint: 'More powerful than the natural flint.',
  supertflint: 'Extended fusing time. Bigger blast.',
  teraflint: 'Absolute detonation force.',
  rock: 'The most natural of all elements in Clonk.',
  gold: "Miner's desire.",
  wood: 'Needed for construction or as firing material.',
  crystal: 'Holds a magical energy charge.',
  loam: 'Loam can be used to build walls and bridges.',
  metal: 'Needed for a variety of structures. Can also be used to create more resistant walls and bridges.',
  coal: 'Firing fuel.',
  ore: 'Needed to create metal in a foundry.',
  sulphur: 'Base substance for explosives.',
  concrete: 'Serves to create level basements.',
  liquidGranite: 'Harder than concrete.',
  gunpowder: 'Needed to load cannons.',
  earth: "Hit 'dig' again while digging, to create chunks that can be picked up.",
  sand: "Hit 'dig' again while digging to create chunks of sand that can be picked up.",
  ashes: "Hit 'dig' again while digging, to create chunks that can be picked up.",
  ice: 'A piece of frozen water.',
  snowball: 'A light throwing weapon shaped from snow.',
  conkit:
    'Construction kits are used to create new buildings. Sufficient space and level ground are required for the construction site. One or multiple clonks can be assigned to work on a site.',
  flag: 'The flag marks your home base in which you can buy or sell material and reload energy.',
  lorry: 'Useful to transport large amounts of material. Holds up to 50 items.',
  boat: 'To get across small lakes. Grab and push into water to launch, then board and grab the boat to steer.',
  balloon: 'The first means of air travel known to clonks. Unfortunately, it depends on the direction of the wind.',
  blimp: 'Absolute air dominance.',
  clonk: 'A small but robust humanoid being. Witty and nimble, if skillfully controlled.',
  sorcerer: 'Can extract magic energy from crystals without a magic tower.',
  hut: 'A somewhat sturdier home base with solid basement.',
  elevator: 'The elevator will automatically move to pick up waiting clonks, but may also be switched to permanent movement.',
  tower: "Grab to control. 'Left' and 'right' to operate gates.",
};
