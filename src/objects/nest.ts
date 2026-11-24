// A bird's nest in a tree (Objects.c4d/Animals.c4d/Bird.c4d/Nest.c4d, NEST):
// the bird builds it in the crown of a grown tree, sits in it, and lays an
// egg there. It hangs in the tree until the tree burns or falls, then it
// drops and rots. See licenses/clonk_engine_license.txt.

import type { Plant } from './vegetation';

export const NEST = {
  file: 'animals/Nest.png',
  sheet: [80, 28] as [number, number],
  /** Its shape at full size (Width, Height, Offset -10,-5). */
  width: 20,
  height: 11,
  /** The Be action's frame, and the Bird action's (a bird sitting in it, drawn 4 px left and 5 up). */
  facet: { x: 0, y: 0, w: 20, h: 11 },
  birdFacet: { x: 0, y: 11, w: 30, h: 16, dx: -4, dy: -5 },
  /** The bird sits this long before it lays (the Bird action's Delay, then Breed). */
  brood: 1000,
  /** Check4Tree runs every 10 ticks (Timer=10). */
  checkInterval: 10,
  /** Decay: 5 frames of 350 ticks, then it's gone. */
  decay: 1750,
  /** It's built from con 50, 10 more every Build (CreateConstruction(NEST, ..., 50), DoCon(10)). */
  startCon: 50,
  buildStep: 10,
};

let nextNestId = 1;

export class TreeNest {
  readonly id = nextNestId++;
  xdir = 0;
  ydir = 0;
  /** How far built, in percent; it's drawn that big (StretchGrowth). */
  con = NEST.startCon;
  /** Be: hanging in the tree; bird: a bird sits in it; decay: fallen, rotting away. */
  state: 'be' | 'bird' | 'decay' = 'be';
  /** Ticks in the current state. */
  time = 0;
  removed = false;

  constructor(
    public x: number,
    public y: number,
    /** The tree it hangs in. */
    readonly tree: Plant,
  ) {}

  get w(): number {
    return Math.max(1, Math.trunc((NEST.width * this.con) / 100));
  }

  get h(): number {
    return Math.max(1, Math.trunc((NEST.height * this.con) / 100));
  }

  contains(px: number, py: number): boolean {
    const left = Math.round(this.x) - Math.trunc(this.w / 2);
    const top = Math.round(this.y) - Math.trunc(this.h / 2);
    return px >= left && px < left + this.w && py >= top && py < top + this.h;
  }

  /** Off the tree: it falls and rots (SetAction("Decay"), SetCategory(C4D_Vehicle)). */
  fall(): void {
    if (this.state === 'decay') return;
    this.state = 'decay';
    this.time = 0;
  }
}
