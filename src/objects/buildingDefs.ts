// The rest of the original's buildings (Objects.c4d/Structures.c4d): homes,
// castles, statues and the production buildings. Sizes, prices, weights,
// materials, doors, entrances and fire values are the original DefCore.txt and
// ActMap.txt values; solid masks are traced from the SolidMask rectangles of
// each Graphics.png. What production buildings make, and the power they need,
// comes later: for now they can be built, entered and used as storage.

import type { Facet, StructureDef } from './defs';

/** The original's door: OpenDoor is `length` frames of `w` x `h` from (0, y), drawn at `at` (ActMap Facet). */
function door(y: number, w: number, h: number, at: [number, number], length = 10): NonNullable<StructureDef['graphic']['door']> {
  return { x: 0, y, w, h, length, at: { x: at[0], y: at[1] } };
}

interface Spec {
  name: string;
  /** DefCore Width, Height, Offset. */
  size: [number, number, number, number];
  mass: number;
  value: number;
  components: StructureDef['components'];
  /** DefCore Entrance (x, y, w, h). */
  entrance?: [number, number, number, number];
  /** First vertex (where a flag would fly). */
  vertex: [number, number];
  file: string;
  picture?: Facet;
  door?: StructureDef['graphic']['door'];
  /** BASx width, if it #includes a basement. */
  basement?: number;
  basementFile?: string;
  blastIncinerate?: number;
  contactIncinerate?: number;
  /** The burned building (BurnTo): its blast and contact values. */
  burned?: { blastIncinerate: number; contactIncinerate?: number };
  canBeBase?: boolean;
}

function building(id: string, s: Spec, extra: Partial<StructureDef> = {}): StructureDef {
  const [width, height, ox, oy] = s.size;
  return {
    id,
    name: s.name,
    width,
    height,
    offset: { x: ox, y: oy },
    mass: s.mass,
    value: s.value,
    entrance: s.entrance && { x: s.entrance[0], y: s.entrance[1], w: s.entrance[2], h: s.entrance[3] },
    canBeBase: !!s.canBeBase,
    // Every enterable building has the original's Physical Energy=100000.
    energy: s.canBeBase ? 100000 : 0,
    flagVertex: { x: s.vertex[0], y: s.vertex[1] },
    graphic: {
      file: `structures/${s.file}.png`,
      facet: { x: 0, y: 0, w: width, h: height },
      door: s.door,
      picture: s.picture ?? { x: 0, y: 0, w: width, h: height },
    },
    basement: s.basement ? { width: s.basement, height: 8, file: s.basementFile ?? `structures/Basement${s.basement}.png` } : undefined,
    components: s.components,
    blastIncinerate: s.blastIncinerate ?? 0,
    contactIncinerate: s.contactIncinerate,
    burned: s.burned && { file: `structures/${s.file}Burned.png`, ...s.burned },
    ...extra,
  };
}

export const MORE_STRUCTURES: Record<string, StructureDef> = {
  // ------------------------------------------------------------- homes
  // Hut.c4d (bamboo hut): no basement, burns easily.
  bambooHut: building('bambooHut', {
    name: 'Bamboo Hut',
    size: [48, 43, -24, -21],
    mass: 350,
    value: 25,
    components: { wood: 3 },
    entrance: [-9, 3, 19, 19],
    vertex: [-10, -19],
    file: 'Hut',
    door: door(43, 11, 17, [20, 26]),
    canBeBase: true,
    contactIncinerate: 3,
    blastIncinerate: 10,
    burned: { blastIncinerate: 10, contactIncinerate: 3 },
  }),
  // Hut3.c4d (US name "Cabin"): stone walls, a 60 wide basement.
  cabin: building('cabin', {
    name: 'Cabin',
    size: [60, 50, -30, -25],
    mass: 1500,
    value: 45,
    components: { rock: 5, wood: 3 },
    entrance: [2, 4, 17, 21],
    vertex: [14, -17],
    file: 'Hut3',
    door: door(50, 10, 19, [35, 31], 9),
    basement: 60,
    canBeBase: true,
    blastIncinerate: 75,
    burned: { blastIncinerate: 75 },
  }),
  // Igloo.c4d: made of ice, it doesn't burn but melts when it's warm and breaks apart (MaxDamage 50) into 6 lumps of ice.
  igloo: building(
    'igloo',
    {
      name: 'Igloo',
      size: [56, 28, -28, -14],
      mass: 250,
      value: 18,
      components: { ice: 12 },
      entrance: [-28, -4, 23, 18],
      vertex: [-5, -13],
      file: 'Igloo',
      canBeBase: true,
    },
    { melts: true, breaksAt: { damage: 50, into: { ice: 6 } } },
  ),
  // Castle1.c4d (small castle): battlements on the roof (SolidMask), a 68 wide basement (BAS5).
  smallCastle: building(
    'smallCastle',
    {
      name: 'Small Castle',
      size: [68, 40, -34, -20],
      mass: 8000,
      value: 300,
      components: { rock: 8, wood: 3 },
      entrance: [-13, 0, 18, 20],
      vertex: [-30, -20],
      file: 'Castle1',
      door: door(40, 16, 20, [22, 20]),
      basement: 68,
      canBeBase: true,
      blastIncinerate: 120,
      burned: { blastIncinerate: 200 },
    },
    {
      solidMask: [
        ...Array<string>(8).fill('#####..........................................................#####'),
        '.####..........................................................####.',
        '.####..........................................................####.',
        '..###..........................................................###..',
        '......########################################################......',
        '...##############################################################...',
      ],
    },
  ),
  // Castle2.c4d (castle): a walkway on the wall (SolidMask), an 80 wide basement (BAS8) and a small tower (TWR1) on its left.
  castle: building(
    'castle',
    {
      name: 'Castle',
      size: [84, 87, -42, -43],
      mass: 10000,
      value: 400,
      components: { rock: 12, wood: 5 },
      entrance: [-3, 24, 20, 20],
      vertex: [-18, -43],
      file: 'Castle2',
      picture: { x: 84, y: 0, w: 84, h: 87 },
      door: door(87, 20, 22, [40, 65]),
      basement: 80,
      canBeBase: true,
      blastIncinerate: 160,
      burned: { blastIncinerate: 160 },
    },
    {
      maskAt: { x: 0, y: 45 },
      solidMask: [
        ...Array<string>(7).fill('..#####.......................................................................#####.'),
        '...####.......................................................................####..',
        '...####.......................................................................####..',
        '....###.......................................................................###...',
        '........#####################################################################.......',
        '.....###########################################################################....',
      ],
      // CreateObject(TWR1, -23, +44): its bottom level with the castle's.
      annex: { id: 'smallTower', x: -23 },
    },
  ),
  // Castle3.c4d (US name "Dark castle"): two platforms, a 90 wide basement (BAS9).
  darkCastle: building(
    'darkCastle',
    {
      name: 'Dark Castle',
      size: [96, 144, -48, -72],
      mass: 30000,
      value: 600,
      components: { rock: 20, wood: 8, metal: 5 },
      entrance: [-26, 50, 22, 22],
      vertex: [31, -57],
      file: 'Castle3',
      door: door(144, 22, 22, [22, 122]),
      basement: 90,
      canBeBase: true,
      blastIncinerate: 350,
      burned: { blastIncinerate: 350 },
    },
    {
      maskAt: { x: 0, y: 53 },
      solidMask: [
        ...Array<string>(5).fill('.........................#####...........................................#####..................'),
        '..........................####...........................................####...................',
        '..........................####...........................................####...................',
        '...........................###...........................................###....................',
        '...............................#########################################........................',
        '...........................#################################################....................',
        ...Array<string>(14).fill(''),
        ...Array<string>(5).fill('#####....................#####'),
        '.####....................####',
        '.####....................####',
        '..##......................##',
        '.....####################',
        '..##########################',
      ],
      // ContainedLeft / ContainedRight: up to a platform (Exit at -30,+10 and +5,-12), feet on its floor.
      platforms: { left: { x: -30, y: 3 }, right: { x: 5, y: -21 } },
      // The way down from each platform (CSTE at -31,+12 and +5,-11, Entrance -10,-11,14,23): into the castle.
      hatches: [
        { x: -41, y: 1, w: 14, h: 23, through: false },
        { x: -5, y: -22, w: 14, h: 23, through: false },
      ],
    },
  ),
  // Tower1.c4d (small tower): only comes with a castle. Going in takes a clonk up onto its roof (CheckContents: Exit at 0,-10).
  smallTower: building(
    'smallTower',
    {
      name: 'Small Tower',
      size: [35, 42, -20, -20],
      mass: 2500,
      value: 100,
      components: { rock: 6, wood: 3 },
      entrance: [-13, 2, 14, 19],
      vertex: [-16, -20],
      file: 'Tower1',
      door: door(42, 14, 19, [8, 23]),
      blastIncinerate: 150,
      burned: { blastIncinerate: 200 },
    },
    {
      maskAt: { x: 0, y: 10 },
      solidMask: ['....#############################..', '....#############################..'],
      exitTo: { x: -2, y: -20 },
    },
  ),
  // WizardTower.c4d (US name "Magic tower"): a 42 wide basement (BAS2). Sorcerers recharge and research in it (later).
  magicTower: building('magicTower', {
    name: 'Magic Tower',
    size: [40, 82, -20, -41],
    mass: 1000,
    value: 250,
    components: { rock: 4, wood: 2, metal: 2 },
    entrance: [-9, 21, 16, 20],
    vertex: [-2, -41],
    file: 'WizardTower',
    picture: { x: 0, y: 7, w: 40, h: 75 },
    door: door(164, 12, 14, [14, 68]),
    basement: 42,
    blastIncinerate: 100,
    burned: { blastIncinerate: 100 },
  }),

  // ------------------------------------------------------------- statues
  // Idol.c4d / Goldidol.c4d: break apart at 90 damage (the golem's MaxDamage), throwing out what they're made of.
  statue: building(
    'statue',
    { name: 'Statue', size: [22, 32, -11, -16], mass: 100, value: 20, components: { rock: 3 }, vertex: [-5, 15], file: 'Idol' },
    { breaksAt: { damage: 90, into: { rock: 3 } } },
  ),
  goldStatue: building(
    'goldStatue',
    { name: 'Gold Statue', size: [22, 32, -11, -16], mass: 150, value: 50, components: { gold: 4 }, vertex: [-5, 15], file: 'GoldIdol' },
    { breaksAt: { damage: 90, into: { gold: 4 } } },
  ),

  // ------------------------------------------------------------- production (functions later)
  sawmill: building('sawmill', {
    name: 'Sawmill',
    size: [72, 55, -36, -27],
    mass: 3000,
    value: 100,
    components: { wood: 6, metal: 2 },
    entrance: [-1, 3, 20, 25],
    vertex: [-26, -12],
    file: 'Sawmill',
    door: door(55, 21, 23, [35, 32]),
    basement: 72,
    blastIncinerate: 85,
    burned: { blastIncinerate: 150 },
  }),
  foundry: building('foundry', {
    name: 'Foundry',
    size: [70, 52, -35, -26],
    mass: 5000,
    value: 150,
    components: { rock: 6, wood: 3 },
    entrance: [-15, 10, 20, 16],
    vertex: [-29, -4],
    file: 'Foundry',
    door: door(52, 16, 15, [22, 37]),
    basement: 68,
    blastIncinerate: 100,
    burned: { blastIncinerate: 100 },
  }),
  workshop: building('workshop', {
    name: 'Workshop',
    size: [72, 50, -36, -25],
    mass: 4500,
    value: 200,
    components: { wood: 6, metal: 3 },
    entrance: [0, 5, 20, 20],
    vertex: [-21, -19],
    file: 'Workshop',
    door: door(50, 19, 19, [36, 31]),
    basement: 72,
    blastIncinerate: 100,
    burned: { blastIncinerate: 100 },
  }),
  chemicalPlant: building('chemicalPlant', {
    name: 'Chemical Plant',
    size: [48, 57, -24, -28],
    mass: 2500,
    value: 200,
    components: { rock: 5, metal: 3 },
    entrance: [-8, 12, 16, 16],
    vertex: [-18, -10],
    file: 'Chemical',
    door: door(57, 14, 17, [18, 40]),
    basement: 48,
    blastIncinerate: 100,
    burned: { blastIncinerate: 100 },
  }),
  researchLab: building('researchLab', {
    name: 'Research Lab',
    size: [68, 52, -34, -26],
    mass: 3500,
    value: 150,
    components: { wood: 4, metal: 2 },
    entrance: [-6, 5, 24, 22],
    vertex: [-21, -19],
    file: 'Research',
    door: door(52, 24, 20, [28, 32]),
    basement: 68,
    blastIncinerate: 100,
    burned: { blastIncinerate: 100 },
  }),
  powerPlant: building('powerPlant', {
    name: 'Power Plant',
    size: [64, 52, -32, -26],
    mass: 4000,
    value: 180,
    components: { rock: 6, metal: 3 },
    entrance: [2, 10, 20, 16],
    vertex: [-26, -6],
    file: 'PowerPlant',
    door: door(52, 17, 16, [35, 36]),
    basement: 60,
    blastIncinerate: 130,
    burned: { blastIncinerate: 130 },
  }),
  // Windmill.c4d: its wing (Wing.c4d, 80x80) turns with the wind, hung on the windmill's first vertex.
  windmill: building(
    'windmill',
    {
      name: 'Windmill',
      size: [28, 58, -13, -29],
      mass: 900,
      value: 45,
      components: { wood: 4, metal: 1 },
      vertex: [-1, -27],
      file: 'Windmill',
      picture: { x: 30, y: 0, w: 80, h: 94 },
      basement: 26,
      contactIncinerate: 4,
      blastIncinerate: 60,
      burned: { blastIncinerate: 30, contactIncinerate: 4 },
    },
    { wing: { file: 'structures/WindmillWing.png', burnedFile: 'structures/WindmillWingBurned.png', size: 80, at: { x: -1, y: -27 } } },
  ),
  // Pump.c4d: 20 frames of pumping (later, with pipes and power).
  pump: building('pump', {
    name: 'Pump',
    size: [28, 32, -14, -16],
    mass: 400,
    value: 40,
    components: { wood: 3, metal: 1 },
    vertex: [-1, -3],
    file: 'Pump',
    picture: { x: 280, y: 0, w: 28, h: 32 },
    basement: 26,
    blastIncinerate: 50,
    burned: { blastIncinerate: 50 },
  }),
  // Derrick.c4d: its own 28 wide basement (DRBS). Pumps oil (later, with pipes).
  derrick: building('derrick', {
    name: 'Derrick',
    size: [28, 56, -14, -28],
    mass: 900,
    value: 50,
    components: { wood: 4, metal: 2 },
    vertex: [-11, -28],
    file: 'Derrick',
    basement: 28,
    basementFile: 'structures/BasementDerrick.png',
    blastIncinerate: 50,
    burned: { blastIncinerate: 50 },
  }),
  // Anvil.c4d: doesn't burn (BurnTo=NONE). Forging comes later.
  anvil: building('anvil', {
    name: 'Anvil',
    size: [24, 22, -12, -11],
    mass: 100,
    value: 50,
    components: { wood: 1, metal: 2 },
    vertex: [-12, -11],
    file: 'Anvil',
    picture: { x: 0, y: 22, w: 35, h: 35 },
  }),
  // CannonTower.c4d (CTW0): push a combat, artillery or anti-air cannon in and it's mounted on top.
  cannonTower: building('cannonTower', {
    name: 'Cannon Tower',
    size: [42, 44, -21, -22],
    mass: 2000,
    value: 100,
    components: { wood: 4, metal: 5, rock: 3 },
    entrance: [-10, 3, 20, 20],
    vertex: [0, -19],
    file: 'CannonTower',
    picture: { x: 100, y: 0, w: 64, h: 64 },
    door: door(44, 10, 13, [15, 31]),
    basement: 42,
    blastIncinerate: 100,
    burned: { blastIncinerate: 10, contactIncinerate: 3 },
  }),
  // Signal.c4d: a railway signal (for trains, later).
  signal: building('signal', {
    name: 'Signal',
    size: [24, 50, -12, -25],
    mass: 17,
    value: 10,
    components: {},
    vertex: [0, -14],
    file: 'Signal',
    picture: { x: 24, y: 0, w: 24, h: 50 },
  }),
};

/** Buildings that only come with another one, and can't be built on their own. */
export const ANNEX_ONLY = ['smallTower'];

/** The original's descriptions (DescUS.txt); "(comes later)" marks what the building can't do yet. */
export const BUILDING_DESCRIPTIONS: Record<string, string> = {
  bambooHut: 'The smallest and lightest structure that serves as home base. Highly vulnerable to enemy attacks.',
  cabin: 'A safe home base.',
  igloo: 'Even in arctic climate you can set up a base.',
  smallCastle: "The Clonk's home is his castle.",
  castle: 'A large and safe home base featuring a stairway to move vehicles to the top platform.',
  darkCastle: "Ascend to the platforms through commands 'left' and 'right'.",
  smallTower: 'Serves as stairway for buildings with platform.',
  magicTower: 'Converts crystal and lightning strikes to magical energy. Magic clonks can recharge magical energy in the tower. (comes later)',
  statue: 'Remnant of past civilizations.',
  goldStatue: 'Status symbol.',
  sawmill: 'Cuts trees to wood. (comes later)',
  foundry: 'Turns ore and firing fuel into metal. (comes later)',
  workshop: 'Factory for vehicles and heavy weapons. (comes later)',
  chemicalPlant: 'Explosives production facility. (comes later)',
  researchLab: 'Players can research new construction plans here. (comes later)',
  powerPlant: 'Turns coal, oil, or wood into energy. (comes later)',
  windmill: 'Supplies your settlement with energy. (comes later)',
  pump: 'Transports liquids through pipes. (comes later)',
  derrick: 'Pumps liquids from underground reservoirs. (comes later)',
  anvil: 'The anvil produces weapons, construction kits, and numerous other items. (comes later)',
  signal: 'Controls trains. (comes later)',
  cannonTower: 'Fortified tower with a mounted cannon. Push a combat, artillery or anti-air cannon in to mount it.',
};

/** Sizes of the building sprite sheets, for pictures cut out of them in the scenario settings. */
export const STRUCTURE_SHEETS: Record<string, [number, number]> = {
  'structures/Anvil.png': [192, 57],
  'structures/CannonTower.png': [164, 64],
  'structures/Castle1.png': [160, 60],
  'structures/Castle2.png': [200, 121],
  'structures/Castle3.png': [220, 166],
  'structures/CastleEntrance.png': [27, 23],
  'structures/Chemical.png': [140, 74],
  'structures/Derrick.png': [120, 76],
  'structures/Elevator.png': [84, 56],
  'structures/ElevatorCase.png': [24, 28],
  'structures/Foundry.png': [160, 77],
  'structures/GateLeft.png': [12, 24],
  'structures/GateRight.png': [24, 24],
  'structures/GoldIdol.png': [22, 32],
  'structures/Hut.png': [110, 60],
  'structures/Hut2.png': [100, 66],
  'structures/Hut3.png': [100, 69],
  'structures/Idol.png': [22, 32],
  'structures/Igloo.png': [56, 28],
  'structures/PowerPlant.png': [170, 79],
  'structures/Pump.png': [560, 32],
  'structures/Research.png': [500, 90],
  'structures/Sawmill.png': [260, 87],
  'structures/Signal.png': [96, 150],
  'structures/Tower1.png': [140, 61],
  'structures/Tower2.png': [192, 79],
  'structures/Windmill.png': [112, 94],
  'structures/WindmillWing.png': [80, 80],
  'structures/WizardTower.png': [240, 192],
  'structures/Workshop.png': [190, 80],
};
