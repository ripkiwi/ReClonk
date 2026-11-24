import type { Landscape } from '../landscape/landscape';
import type { ItemDef } from './defs';
import type { FireState } from './fire';
import { GameObject } from './gameObject';
import type { TreeNest } from './nest';
import { FLOAT_ACCEL, HIT_SPEED_1 } from './physics';

/** A loose object: rock, gold nugget, flint, wood, meteor. */
export class Item extends GameObject {
  /** Ticks during which a clonk that just threw or dropped this won't pick it straight back up. */
  noCollect = 0;
  /** Id of the clonk that last threw it, credited with what its explosion breaks loose. */
  thrownBy = -1;
  /** Gold only earns experience the first time someone picks it up. */
  found = false;
  /** Ticks left on a lit T-flint's fuse; -1 while it isn't lit. */
  fuse = -1;
  /** How much of it is left, up to 100000: fire burns it away (wood is drawn smaller). */
  con = 100000;
  /** Blast damage taken; enough sets it alight (BlastIncinerate). */
  damage = 0;
  fire: FireState | null = null;
  /** It has burned: wood stays charred (Wood.c4d Incineration). */
  burned = false;
  /**
   * Player it belongs to, or -1. Only flags care: a flag shows its owner's
   * colour and makes a building that owner's base, whoever carries it there.
   * Picking a thing up doesn't change its owner (the original's Collect).
   */
  owner = -1;
  /** Ticks it has been lying about: dead animals rot (DefCore decay). */
  age = 0;
  /** A live animal in a clonk's hands keeps its energy and size (in 1/1000 points and percent). */
  life: { energy: number; con: number } | null = null;
  /** A bird egg lying in a nest: it stays there, brooding (its Nest action). */
  onNest: TreeNest | null = null;
  /** How long a bird egg has brooded, in 35-tick steps (iBreedTime). */
  breed = 0;
  /** Laid by a bird: there's a young bird in it (it counts towards how many birds are about). */
  laid = false;
  /** Ticks before a carried snake can bite again. */
  biteDelay = 0;
  /** Arrows in a pack (PackCount). */
  count = 1;
  /** How much liquid is in a barrel, in pixels (iFillLevel). */
  fill = 0;
  /** An arrow shot from a crossbow, still in flight (its Shot action): it hits what lives on its way. */
  shot = false;
  /** An explosive arrow that was shot: it blows up when it lands (Armed). */
  armed = false;
  /** Where a shot arrow was last tick: it hits whatever is on the line from there (InFlight). */
  lastX = 0;
  lastY = 0;
  /** A shot arrow doesn't hit the clonk who shot it for a few ticks (IntNoArrowHit). */
  noHit: { id: number; until: number } | null = null;
  /** A launched torpedo swims this way while it's in a liquid (its Swim action), and for how long it has. */
  swimDir: -1 | 0 | 1 = 0;
  swimTime = 0;

  constructor(
    /** What it is. A barrel turns into a full one and back (ChangeDef). */
    public def: ItemDef,
    x: number,
    y: number,
  ) {
    super(x, y);
    // A pack comes full (ArrowPack Initialize), and so does a bought barrel of something.
    if (def.pack) this.count = def.pack.max;
    if (def.barrel?.mat !== undefined && def.barrel.mat !== null) this.fill = 200;
  }

  get vertices() {
    return this.def.vertices;
  }

  get lit(): boolean {
    return this.fuse >= 0;
  }

  /** Light a T-flint's fuse (TFlint.c4d Activate). Returns false if it can't be lit or already burns. */
  light(): boolean {
    if (!this.def.fuse || this.lit) return false;
    this.fuse = this.def.fuse.ticks;
    return true;
  }

  /** Is it rotting yet (its Decay action)? */
  get decaying(): boolean {
    return !!this.def.decay && this.age > this.def.decay.after;
  }

  /** A dead animal rots away (Decaying: DoCon(-step) every `every` ticks once it has lain long enough). */
  private rot(): void {
    const d = this.def.decay;
    if (!d || this.container) return;
    this.age++;
    if (this.age <= d.after || (this.age - d.after) % d.every !== 0) return;
    this.con -= d.step * 1000;
    if (this.con <= 0) this.removed = true;
  }

  /** Advance one tick. Returns true if the item hit something hard (flints explode, T-flints light up). */
  tick(land: Landscape): boolean {
    if (this.noCollect > 0) this.noCollect--;
    this.rot();
    // An egg in a nest stays put (FLOAT, attached to the nest).
    if (this.onNest) {
      this.xdir = this.ydir = 0;
      return false;
    }
    const g = land.gravity;
    if (this.swimDir && this.def.swim && this.inLiquid(land)) {
      // A torpedo swims straight on (the SWIM procedure, SwimAccel 0.2), level after 25 ticks.
      const lim = this.def.swim;
      this.xdir = Math.max(-lim, Math.min(lim, this.xdir + this.swimDir * 0.2));
      if (++this.swimTime > 25) this.ydir = 0;
    } else if (this.inLiquid(land)) {
      // Sink slowly through liquids; light things like flags bob up instead (Float).
      this.ydir = this.def.float ? Math.max(this.ydir - g, -1) : Math.min(this.ydir + g, 1);
      this.xdir *= 0.9;
    } else this.ydir += g;
    // Resting objects with ground right below don't need to simulate.
    if (this.xdir === 0 && this.ydir === g && land.isSolid(this.x, this.y + 1)) {
      this.ydir = 0;
      return false;
    }
    const speed = Math.abs(this.xdir) + Math.abs(this.ydir);
    const moved = this.doMovement(land);
    if (!moved.contact) return false;
    if (Math.abs(this.ydir) < FLOAT_ACCEL) this.ydir = 0;
    return speed >= HIT_SPEED_1;
  }
}
