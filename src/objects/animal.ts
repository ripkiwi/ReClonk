// Animals from the original Clonk Rage content (Objects.c4d/Animals.c4d): the
// wipf, the bird, the fish, the shark and the monster. Values follow their
// DefCore.txt and ActMap.txt; their movement is the engine's (C4Object::
// ExecMovement for the WALK, FLIGHT, SWIM, FLOAT, DIG and NONE procedures,
// ContactAction and NoAttachAction). Their behaviour (the scripts' Activity
// timers) is in game/animals.ts. See licenses/clonk_engine_license.txt.

import type { ItemId } from '../landscape/materials';
import { Mat } from '../landscape/materials';
import type { Landscape } from '../landscape/landscape';
import type { Facet } from './defs';
import type { FireState } from './fire';
import { GameObject } from './gameObject';
import { CNAT, FLOAT_ACCEL, SWIM_ACCEL, WALK_ACCEL, attach, physical, type Vertex } from './physics';

export type AnimalId = 'wipf' | 'bird' | 'fish' | 'shark' | 'monster';

/** The engine procedures animals use. */
export type AnimalProcedure = 'walk' | 'flight' | 'swim' | 'float' | 'dig' | 'none' | 'dead';

export interface AnimalAction {
  name: string;
  procedure: AnimalProcedure;
  length: number;
  delay: number;
  /** First frame; the frames run to the right. */
  facet: Facet;
  /** Action after the last frame; 'Hold' stays on it. */
  next: string;
  /** Action when it gets into a liquid (InLiquidAction). */
  inLiquid?: string;
  /** Action played when it turns round (TurnAction). */
  turn?: string;
  /** Radius it digs free around itself (DigFree). */
  digFree?: number;
  /** Can't be steered (ObjectDisabled). */
  disabled?: boolean;
  /** Frames run backwards (Reverse). */
  reverse?: boolean;
}

/** Command directions in the original's numbering (COMD_Stop 0, Up 1, then clockwise to UpLeft 8). */
export type Comd = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const COMD = { Stop: 0, Up: 1, UpRight: 2, Right: 3, DownRight: 4, Down: 5, DownLeft: 6, Left: 7, UpLeft: 8 } as const;
const COMD_VEC: readonly [number, number][] = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export function comdX(c: Comd): number {
  return COMD_VEC[c][0];
}
export function comdY(c: Comd): number {
  return COMD_VEC[c][1];
}

export interface AnimalDef {
  id: AnimalId;
  name: string;
  /** What it fetches in a home base, alive (DefCore Value). */
  value: number;
  mass: number;
  width: number;
  height: number;
  vertices: Vertex[];
  /** Full energy in points (Physical Energy / 1000). */
  energy: number;
  /** Breath in points (Physical Breath / 1000); it suffocates without air (or water, for those that breathe water). */
  breath: number;
  breatheWater: boolean;
  /** Physicals, like the original's (0..100000). */
  physical: { walk: number; jump: number; swim: number; dig: number; float: number };
  /** How deep it floats (DefCore Float): its liquid checks look this far below its centre. */
  float: number;
  /** Con gained every 35 ticks while it grows up, in percent (DefCore Growth / 10). */
  growth: number;
  /** Where it's put at the start (DefCore Placement): running free on the ground, in a liquid, or in the air. */
  placement: 'surface' | 'liquid' | 'air';
  /** Sharks and monsters go for it (DefCore Prey). */
  prey: boolean;
  /** Clonks can pick it up when the Collectible animals rule is on (DefCore Collectible). */
  collectible: boolean;
  /** A burning thing touching it sets it alight one time in this many (ContactIncinerate; 0: it doesn't burn). */
  contactIncinerate: number;
  /** Can't leave the map at the sides and top (BorderBound 7), or only the sides (1). */
  borderTop: boolean;
  /** Acid doesn't hurt it (Physical CorrosionResist). */
  corrosionResist: boolean;
  /** Most of them in an 800-pixel square before they stop having young (MaxAnimalCount), and how rare that is (ReproductionRate). */
  maxCount: number;
  reproductionRate: number;
  file: string;
  sheet: [number, number];
  picture: Facet;
  /** The kind of item it is when a clonk carries it alive. */
  carried?: ItemId;
  /** What it turns into when it dies (ChangeDef to its Dead.c4d): an item to pick up, or a body that rots. */
  dead: { item: ItemId } | { file: string; sheet: [number, number]; facet: Facet; decay: Facet; float: number; decayDelay: number; decayStep: number };
  actions: Record<string, AnimalAction>;
  /** Its first action (after Birth). */
  start: string;
}

const vtx = (xs: number[], ys: number[], cnat: number[]): Vertex[] =>
  // Missing VertexY entries are 0, like the engine reads them.
  cnat.map((c, i) => ({ x: xs[i] ?? 0, y: ys[i] ?? 0, cnat: c, friction: 100 }));

const act = (list: AnimalAction[]): Record<string, AnimalAction> => Object.fromEntries(list.map((a) => [a.name, a]));
const f = (x: number, y: number, w: number, h: number): Facet => ({ x, y, w, h });

export const ANIMALS: Record<AnimalId, AnimalDef> = {
  // Wipf.c4d (WIPF): runs about, jumps, sits, now and then digs a tunnel.
  wipf: {
    id: 'wipf',
    name: 'Wipf',
    value: 15,
    mass: 20,
    width: 24,
    height: 18,
    vertices: vtx([0, 0, -2, 2, -4, 4], [-9, 6, -6, -6], [4, 8, 1, 2, 1, 2]),
    energy: 50,
    breath: 50,
    breatheWater: false,
    physical: { walk: 80000, jump: 35000, swim: 60000, dig: 40000, float: 0 },
    float: 1,
    growth: 1.5,
    placement: 'surface',
    prey: true,
    collectible: true,
    contactIncinerate: 1,
    borderTop: false,
    corrosionResist: false,
    maxCount: 10,
    reproductionRate: 1000,
    file: 'animals/Wipf.png',
    sheet: [496, 72],
    picture: f(432, 0, 64, 64),
    carried: 'wipf',
    dead: { item: 'deadWipf' },
    start: 'Walk',
    actions: act([
      { name: 'Walk', procedure: 'walk', length: 18, delay: 2, facet: f(0, 0, 24, 18), next: 'Walk', turn: 'Turn', inLiquid: 'Swim' },
      { name: 'Turn', procedure: 'none', length: 6, delay: 2, facet: f(0, 18, 24, 18), next: 'Walk' },
      { name: 'Jump', procedure: 'flight', length: 18, delay: 2, facet: f(0, 0, 24, 18), next: 'Hold', inLiquid: 'Swim' },
      { name: 'Tumble', procedure: 'flight', length: 16, delay: 2, facet: f(0, 36, 24, 18), next: 'Hold', inLiquid: 'Swim' },
      { name: 'Swim', procedure: 'swim', length: 18, delay: 5, facet: f(0, 0, 24, 18), next: 'Swim', turn: 'Turn' },
      { name: 'Dig', procedure: 'dig', length: 18, delay: 10, facet: f(0, 0, 24, 18), next: 'Dig', digFree: 9, inLiquid: 'Swim' },
      { name: 'Sit', procedure: 'none', length: 6, delay: 3, facet: f(0, 54, 24, 18), next: 'Sit', inLiquid: 'Swim' },
      { name: 'DigFree', procedure: 'dig', length: 18, delay: 10, facet: f(0, 0, 24, 18), next: 'Walk', digFree: 9, inLiquid: 'Swim' },
    ]),
  },
  // Bird.c4d (BIRD): flies about, turns away from water and fire.
  bird: {
    id: 'bird',
    name: 'Bird',
    value: 10,
    mass: 5,
    width: 28,
    height: 24,
    vertices: vtx([0, 0, -2, 2, -4, 4], [-7, 8, -4, -4, 2, 2], [4, 8, 1, 2, 1, 2]),
    energy: 40,
    breath: 50,
    breatheWater: false,
    physical: { walk: 80000, jump: 35000, swim: 60000, dig: 40000, float: 200 },
    float: 1,
    growth: 1.5,
    placement: 'air',
    prey: false,
    collectible: false,
    contactIncinerate: 1,
    borderTop: true,
    corrosionResist: false,
    maxCount: 10,
    reproductionRate: 2000,
    file: 'animals/Bird.png',
    sheet: [624, 116],
    picture: f(560, 0, 64, 64),
    dead: { item: 'deadBird' },
    start: 'Fly',
    actions: act([
      { name: 'Fly', procedure: 'float', length: 20, delay: 1, facet: f(0, 0, 28, 24), next: 'Fly', turn: 'Turn' },
      { name: 'Turn', procedure: 'float', length: 20, delay: 1, facet: f(0, 24, 28, 24), next: 'Fly' },
      { name: 'Attack', procedure: 'float', length: 20, delay: 1, facet: f(0, 48, 28, 24), next: 'Fly' },
      { name: 'Tumble', procedure: 'none', length: 20, delay: 1, facet: f(0, 72, 28, 24), next: 'Fly', disabled: true, inLiquid: 'Fly' },
    ]),
  },
  // Fish.c4d (FISH): swims about and flees from what moves in the water. Out of it, it flops about and suffocates.
  fish: {
    id: 'fish',
    name: 'Fish',
    value: 10,
    mass: 15,
    width: 16,
    height: 12,
    vertices: vtx([-4, 0, 4], [0, -3, 0, 4], [1, 4, 2, 8]),
    energy: 30,
    breath: 100,
    breatheWater: true,
    physical: { walk: 30000, jump: 30000, swim: 100000, dig: 0, float: 0 },
    float: 1,
    growth: 1.5,
    placement: 'liquid',
    prey: false,
    collectible: true,
    contactIncinerate: 0,
    borderTop: false,
    corrosionResist: false,
    maxCount: 10,
    reproductionRate: 4000,
    file: 'animals/Fish.png',
    sheet: [448, 64],
    picture: f(320, 0, 64, 64),
    carried: 'fish',
    dead: { item: 'deadFish' },
    start: 'Swim',
    actions: act([
      { name: 'Walk', procedure: 'walk', length: 10, delay: 1, facet: f(0, 0, 16, 12), next: 'Walk', inLiquid: 'Swim' },
      { name: 'Swim', procedure: 'swim', length: 20, delay: 1, facet: f(0, 12, 16, 12), next: 'Swim', turn: 'Turn' },
      { name: 'Turn', procedure: 'swim', length: 15, delay: 3, facet: f(0, 36, 16, 12), next: 'Swim' },
      { name: 'Jump', procedure: 'flight', length: 15, delay: 1, facet: f(0, 24, 16, 12), next: 'Hold', inLiquid: 'Swim' },
    ]),
  },
  // Shark.c4d (SHRK): hunts swimming clonks and wipfs and bites them from behind.
  shark: {
    id: 'shark',
    name: 'Shark',
    value: 20,
    mass: 70,
    width: 56,
    height: 22,
    vertices: vtx([-12, 0, 12, -18, -8, 8, 18], [-5, -5, -5, 2, 5, 5, 2, 9], [4, 4, 4, 1, 1, 2, 2, 8]),
    energy: 100,
    breath: 100,
    breatheWater: true,
    physical: { walk: 10000, jump: 1000, swim: 150000, dig: 40000, float: 0 },
    float: -2,
    growth: 7.5,
    placement: 'liquid',
    prey: false,
    collectible: false,
    contactIncinerate: 0,
    borderTop: false,
    corrosionResist: false,
    maxCount: 4,
    reproductionRate: 4000,
    file: 'animals/Shark.png',
    sheet: [1184, 66],
    picture: f(1120, 0, 64, 64),
    dead: { file: 'animals/SharkDead.png', sheet: [120, 64], facet: f(0, 0, 56, 22), decay: f(0, 22, 56, 22), float: 1, decayDelay: 200, decayStep: 4 },
    start: 'Swim',
    actions: act([
      { name: 'Swim', procedure: 'swim', length: 20, delay: 5, facet: f(0, 0, 56, 22), next: 'Swim', turn: 'Turn' },
      { name: 'Turn', procedure: 'swim', length: 20, delay: 3, facet: f(0, 22, 56, 22), next: 'Swim' },
      { name: 'Jaw', procedure: 'swim', length: 20, delay: 1, facet: f(0, 44, 56, 22), next: 'Swim' },
      { name: 'Walk', procedure: 'walk', length: 20, delay: 2, facet: f(0, 0, 56, 22), next: 'Swim', inLiquid: 'Swim' },
      { name: 'Jump', procedure: 'flight', length: 20, delay: 5, facet: f(0, 0, 56, 22), next: 'Swim', inLiquid: 'Swim' },
    ]),
  },
  // Monster.c4d (MONS): stomps about, jumps and growls, and knocks over clonks and wipfs it runs into.
  monster: {
    id: 'monster',
    name: 'Monster',
    value: 35,
    mass: 100,
    width: 48,
    height: 34,
    vertices: vtx([-1, 1, 0, -6, -2, 7, 2], [-7, -7, 12, -3, 6, -3, 6], [5, 6, 8, 1, 1, 2, 2]),
    energy: 250,
    breath: 50,
    breatheWater: false,
    physical: { walk: 71000, jump: 50000, swim: 60000, dig: 40000, float: 0 },
    float: 1,
    growth: 1.5,
    placement: 'surface',
    prey: false,
    collectible: false,
    contactIncinerate: 0,
    borderTop: false,
    corrosionResist: true,
    maxCount: 4,
    reproductionRate: 2000,
    file: 'animals/Monster.png',
    sheet: [816, 136],
    picture: f(576, 68, 64, 64),
    dead: { file: 'animals/MonsterDead.png', sheet: [96, 34], facet: f(0, 0, 48, 34), decay: f(48, 0, 48, 34), float: 8, decayDelay: 180, decayStep: 2 },
    start: 'Walk',
    actions: act([
      { name: 'Walk', procedure: 'walk', length: 16, delay: 5, facet: f(0, 0, 48, 34), next: 'Walk', turn: 'Turn', inLiquid: 'Swim' },
      { name: 'Turn', procedure: 'none', length: 7, delay: 2, facet: f(0, 68, 48, 34), next: 'Walk' },
      { name: 'Jump', procedure: 'flight', length: 17, delay: 1, facet: f(0, 34, 48, 34), next: 'Hold', inLiquid: 'Swim' },
      { name: 'Swim', procedure: 'swim', length: 16, delay: 5, facet: f(0, 0, 48, 34), next: 'Swim', turn: 'Turn' },
      { name: 'LookUp', procedure: 'none', length: 12, delay: 1, facet: f(0, 102, 48, 34), next: 'Look', inLiquid: 'Swim' },
      { name: 'Look', procedure: 'none', length: 1, delay: 15, facet: f(528, 102, 48, 34), next: 'LookAway', inLiquid: 'Swim' },
      { name: 'LookAway', procedure: 'none', length: 12, delay: 1, facet: f(0, 102, 48, 34), next: 'Walk', inLiquid: 'Swim', reverse: true },
    ]),
  },
};

export const ANIMAL_IDS = Object.keys(ANIMALS) as AnimalId[];

/** A dead body that isn't an item (the shark's and the monster's): its Dead action lasts this long before it starts to rot. */
export const DEAD_DELAY = 3000;
/** Con of a newborn (CreateConstruction(..., 40)). */
export const BIRTH_CON = 40;

/** An animal in the world. Movement is the engine's; game/animals.ts makes it behave. */
export class Animal extends GameObject {
  action: AnimalAction;
  phase = 0;
  private phaseDelay = 0;
  /** Facing: -1 left, +1 right. */
  dir: -1 | 1 = -1;
  comd: Comd = COMD.Stop;
  /** Energy and breath, in 1/1000 points like the clonk's. */
  energy: number;
  breath: number;
  alive = true;
  /** How grown up it is, in percent: newborns start at 40 and grow (StretchGrowth). */
  con = 100;
  fire: FireState | null = null;
  /** Blast damage taken (it doesn't matter for animals, but fires and blasts count it). */
  damage = 0;
  /** Counts up to the next Activity call (TimerCall every 35 ticks). */
  timer: number;
  /** Swimming or flying to here (the MoveTo command), or null. */
  target: { x: number; y: number } | null = null;
  /** Ticks before it gives up on the target. */
  targetTicks = 0;
  /** Ticks before a shark can bite again (IntAttackDelay). */
  attackDelay = 0;
  /** Its death has been dealt with: it's a body now. */
  corpse = false;
  /** Ticks since it died, for rotting. */
  deadTicks = 0;
  /** Who hurt it last, credited if it dies. */
  lastHurtBy = -1;
  /** Set when the current action started or started over this tick (StartCall). */
  actionStarted = false;
  /** The action that ran out this tick (EndCall). */
  actionEnded: string | null = null;
  /** A new phase began this tick (PhaseCall). */
  phaseStarted = false;
  private scaled: { con: number; v: Vertex[] } = { con: -1, v: [] };

  constructor(
    readonly def: AnimalDef,
    x: number,
    y: number,
    timerOffset = 0,
  ) {
    super(x, y);
    this.energy = def.energy * 1000;
    this.breath = def.breath * 1000;
    this.action = def.actions[def.start];
    this.timer = timerOffset % 35;
  }

  /** Its vertices, shrunk with its con like the engine's shape (C4Shape::Stretch). */
  get vertices(): readonly Vertex[] {
    if (this.scaled.con !== this.con) {
      const k = this.con / 100;
      this.scaled = { con: this.con, v: this.def.vertices.map((v) => ({ ...v, x: Math.trunc(v.x * k), y: Math.trunc(v.y * k) })) };
    }
    return this.scaled.v;
  }

  get width(): number {
    return Math.max(1, Math.trunc((this.def.width * this.con) / 100));
  }
  get height(): number {
    return Math.max(1, Math.trunc((this.def.height * this.con) / 100));
  }
  get left(): number {
    return this.x - Math.trunc(this.width / 2);
  }
  get top(): number {
    return this.y - Math.trunc(this.height / 2);
  }
  /** Is the point inside its shape? */
  at(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.width && py >= this.top && py < this.top + this.height;
  }

  /** In a liquid, checked at its float depth (C4Object::InLiquid). */
  inLiquid(land: Landscape): boolean {
    return land.isLiquid(this.x, this.y + Math.trunc((this.def.float * this.con) / 100) - 1);
  }

  private get walkSpeed(): number {
    return physical(280, this.def.physical.walk);
  }
  get swimSpeed(): number {
    return physical(160, this.def.physical.swim);
  }
  private get digSpeed(): number {
    return physical(125, this.def.physical.dig);
  }

  has(name: string): boolean {
    return name in this.def.actions;
  }

  /** Switch action (SetAction). Starting the same one again starts it over. */
  setAction(name: string, xdir?: number, ydir?: number): boolean {
    const a = this.def.actions[name];
    if (!a) return false;
    this.action = a;
    this.phase = a.reverse ? a.length - 1 : 0;
    this.phaseDelay = 0;
    this.actionStarted = true;
    if (xdir !== undefined) this.xdir = xdir;
    if (ydir !== undefined) this.ydir = ydir;
    this.tAttach = a.procedure === 'walk' || a.procedure === 'dig' ? CNAT.Bottom : CNAT.None;
    return true;
  }

  /** Turn to face d, playing its turn animation (SetDir with a TurnAction). */
  setDir(d: -1 | 1): void {
    if (d === this.dir) return;
    this.dir = d;
    if (this.action.turn) this.setAction(this.action.turn);
  }

  /** Jump towards where it faces (ObjectComJump). */
  jump(): boolean {
    if (this.action.procedure !== 'walk' || !this.has('Jump')) return false;
    return this.setAction('Jump', this.dir * this.walkSpeed, -physical(1000, this.def.physical.jump));
  }

  /** Knocked away by a hit or a blast (C4Object::Fling): it tumbles if it can, else flies. */
  fling(xdir: number, ydir: number): void {
    if (!this.alive) {
      this.xdir = xdir;
      this.ydir = ydir;
      return;
    }
    if (this.action.procedure === 'swim' || this.action.procedure === 'float') {
      this.xdir += xdir / 2;
      this.ydir += ydir / 2;
      return;
    }
    if (!this.setAction('Tumble', xdir, ydir) && !this.setAction('Jump', xdir, ydir)) {
      this.xdir = xdir;
      this.ydir = ydir;
    }
  }

  /** Change energy by whole points. Returns true if this killed it. */
  doEnergy(points: number, exact = false): boolean {
    if (!this.alive) return false;
    this.energy = Math.max(0, Math.min(this.def.energy * 1000, this.energy + (exact ? points : points * 1000)));
    if (this.energy > 0) return false;
    this.alive = false;
    this.comd = COMD.Stop;
    this.target = null;
    return true;
  }

  /** Is it stuck in solid ground (Stuck)? Set by the last tick. */
  stuck(): boolean {
    return this.isStuck;
  }
  private isStuck = false;

  // ------------------------------------------------------------- simulation

  /** One tick of the engine's procedures, movement, contacts and animation. Returns the CNAT sides it bumped into. */
  tick(land: Landscape): number {
    this.actionStarted = false;
    this.actionEnded = null;
    this.phaseStarted = false;
    if (this.attackDelay > 0) this.attackDelay--;
    if (!this.alive) return this.tickDead(land);
    if (this.action.inLiquid && this.inLiquid(land)) this.setAction(this.action.inLiquid);

    let advance = 1;
    const cx = comdX(this.comd);
    const cy = comdY(this.comd);
    switch (this.action.procedure) {
      case 'walk': {
        const lim = this.walkSpeed;
        if (cx < 0) this.xdir = Math.max(this.xdir - WALK_ACCEL, -lim);
        else if (cx > 0) this.xdir = Math.min(this.xdir + WALK_ACCEL, lim);
        else this.xdir = decel(this.xdir, WALK_ACCEL);
        advance = Math.trunc(Math.abs(this.xdir) * 10);
        if (this.xdir < 0) this.faceQuietly(-1);
        if (this.xdir > 0) this.faceQuietly(1);
        break;
      }
      case 'flight':
        this.ydir += land.gravity;
        break;
      case 'none':
        // Sitting, turning, looking round: it stays put on the ground, and in a liquid it neither sinks nor drifts.
        if (this.inLiquid(land)) {
          this.xdir = decel(this.xdir, SWIM_ACCEL);
          this.ydir = decel(this.ydir, SWIM_ACCEL);
          break;
        }
        this.ydir += land.gravity;
        if (land.isSolid(this.x, this.y + Math.trunc(this.height / 2) + 1)) this.xdir = decel(this.xdir, WALK_ACCEL);
        break;
      case 'float': {
        // Physical Float 100 is 1 pixel a tick (FIXED100).
        const lim = this.def.physical.float / 100;
        this.xdir += cx * FLOAT_ACCEL;
        this.ydir += cy * FLOAT_ACCEL;
        this.xdir = Math.max(-lim, Math.min(lim, this.xdir));
        this.ydir = Math.max(-lim, Math.min(lim, this.ydir));
        break;
      }
      case 'swim': {
        const lim = this.swimSpeed;
        this.xdir += cx * SWIM_ACCEL;
        this.ydir += cy * SWIM_ACCEL;
        if (!cx) this.xdir = decel(this.xdir, SWIM_ACCEL);
        if (!cy) this.ydir = decel(this.ydir, SWIM_ACCEL);
        const fl = Math.trunc((this.def.float * this.con) / 100);
        if (!this.inLiquid(land)) {
          // Just above the liquid: down into it; otherwise it's on land.
          if (land.isLiquid(this.x, this.y + fl)) this.ydir = SWIM_ACCEL;
          else {
            this.onLand();
            break;
          }
        }
        this.xdir = Math.max(-lim, Math.min(lim, this.xdir));
        this.ydir = Math.max(-lim, Math.min(lim, this.ydir));
        // Can't swim up out of the liquid.
        if (!land.isLiquid(this.x, this.y - 2 + fl) && this.ydir < 0) this.ydir = 0;
        if (this.xdir < 0) this.faceQuietly(-1);
        if (this.xdir > 0) this.faceQuietly(1);
        advance = Math.trunc(lim * 10);
        break;
      }
      case 'dig': {
        if (!attach(land, this.vertices, this.x, this.y, CNAT.Bottom)) {
          this.walk();
          break;
        }
        const s = this.digSpeed;
        advance = Math.trunc(s * 40);
        if (cx === 0 && cy === 0) {
          this.xdir = this.ydir = 0;
          advance = 0;
        } else if (cx === 0 && cy < 0) {
          this.xdir = s * this.dir;
          this.ydir = -s / 2;
        } else {
          this.xdir = cx * s;
          this.ydir = cy < 0 ? -s / 2 : cy * s;
        }
        if (this.xdir < 0) this.faceQuietly(-1);
        if (this.xdir > 0) this.faceQuietly(1);
        break;
      }
    }

    if (this.action.digFree) {
      land.dig(Math.floor(this.fx + this.xdir + 0.5), Math.floor(this.fy + this.ydir + 0.5), Math.max(1, Math.trunc((this.action.digFree * this.con) / 100)));
    }

    const speed = Math.abs(this.xdir) + Math.abs(this.ydir);
    const moved = this.doMovement(land);
    this.isStuck = land.isSolid(this.x, this.y);
    let contact = moved.contact;
    contact |= this.borderBound(land);
    if (contact) this.contactAction(contact, speed);
    if (moved.lostAttach && this.tAttach) this.noAttachAction();
    this.animate(advance);
    return contact;
  }

  /** Keep birds inside the map (BorderBound): a contact at the sides and the top. */
  private borderBound(land: Landscape): number {
    if (!this.def.borderTop) return 0;
    let c = 0;
    if (this.y < 0) {
      this.setPosition(this.x, 0);
      if (this.ydir < 0) this.ydir = 0;
      c |= CNAT.Top;
    }
    if (this.x < 0) {
      this.setPosition(0, this.y);
      c |= CNAT.Left;
    }
    if (this.x >= land.width) {
      this.setPosition(land.width - 1, this.y);
      c |= CNAT.Right;
    }
    return c;
  }

  /** Face d without the turn animation (the procedure turns it as it moves). */
  private faceQuietly(d: -1 | 1): void {
    this.dir = d;
  }

  walk(): void {
    if (this.has('Walk')) this.setAction('Walk', 0, 0);
    else this.setAction(this.def.start);
  }

  /** Out of the water: a fish or shark flops about on land, a bird takes off again. */
  private onLand(): void {
    if (this.has('Walk')) this.setAction('Walk');
    else this.setAction(this.def.start);
  }

  /** The engine's ContactAction for animals: landing, and digging into something hard. */
  private contactAction(contact: number, speed: number): void {
    const proc = this.action.procedure;
    if (contact & CNAT.Bottom && proc === 'flight' && this.ydir >= 0) {
      const keep = this.xdir;
      if (this.has('Walk')) {
        this.setAction('Walk');
        this.xdir = speed > 0 ? keep : 0;
      }
    }
    if (proc === 'dig' && contact & (CNAT.Left | CNAT.Right | CNAT.Top)) this.walk();
  }

  /** Walked off a ledge: it falls (ObjectActionJump with its speed). */
  private noAttachAction(): void {
    if (this.action.procedure === 'dig') return this.walk();
    if (this.has('Jump')) this.setAction('Jump');
    else this.tAttach = CNAT.None;
  }

  /** Advance the animation the engine's way: at most one frame a tick, once the delay is used up. */
  private animate(advance: number): void {
    const a = this.action;
    if (!a.delay) return;
    this.phaseDelay += advance;
    if (this.phaseDelay < a.delay) return;
    this.phaseDelay = 0;
    this.phase += a.reverse ? -1 : 1;
    this.phaseStarted = true;
    if (a.reverse ? this.phase >= 0 : this.phase < a.length) return;
    if (a.next === 'Hold') {
      this.phase = a.reverse ? 0 : a.length - 1;
      return;
    }
    this.actionEnded = a.name;
    this.setAction(a.next);
  }

  /** Dead: it falls, floats up in liquids if it's light enough, and rots. */
  private tickDead(land: Landscape): number {
    this.deadTicks++;
    if (this.inLiquid(land) && 'file' in this.def.dead && this.def.dead.float > 0) {
      this.ydir = Math.max(this.ydir - land.gravity, -1);
      this.xdir *= 0.9;
    } else this.ydir += land.gravity;
    this.tAttach = CNAT.None;
    const moved = this.doMovement(land);
    if (moved.contact & CNAT.Bottom) this.xdir = decel(this.xdir, WALK_ACCEL);
    const dead = this.def.dead;
    if ('file' in dead && this.deadTicks > DEAD_DELAY && (this.deadTicks - DEAD_DELAY) % dead.decayDelay === 0) {
      this.con -= dead.decayStep;
      if (this.con <= 0) this.removed = true;
    }
    return moved.contact;
  }

  /** Does it get air (or water) to breathe here (C4Object::ExecLife)? */
  breathes(land: Landscape): boolean {
    if (this.def.breatheWater) return land.get(this.x, this.y) === Mat.Water;
    // Its head: half way up from the centre to the top of its shape (y + Shape.y / 2).
    const y = this.y - Math.trunc(this.height / 4);
    return !land.isSolid(this.x, y) && !land.isLiquid(this.x, y);
  }
}

function decel(v: number, a: number): number {
  if (v < 0) v += a;
  if (v > 0) v -= a;
  return v > -a && v < a ? 0 : v;
}
