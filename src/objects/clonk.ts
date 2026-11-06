// Clonk behaviour ported from the Clonk Rage engine (C4Object::ExecAction,
// C4Object::ContactAction, C4Object::NoAttachAction, C4ObjectCom.cpp).
// See licenses/clonk_engine_license.txt.

import type { Landscape } from '../landscape/landscape';
import { CLONK, ENERGY_UNIT, type ActionDef } from './defs';
import { GameObject } from './gameObject';
import type { Item } from './item';
import type { Structure } from './structure';
import {
  CNAT,
  CORNER_RANGE,
  GRAVITY,
  HIT_SPEED_3,
  HIT_SPEED_4,
  SWIM_ACCEL,
  WALK_ACCEL,
  attach,
  contactCheck,
  physical,
} from './physics';

/** What a player is doing with the controls this tick. */
export interface ControlState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Pressed this tick (not just held). */
  pressedLeft: boolean;
  pressedRight: boolean;
  pressedUp: boolean;
  pressedDown: boolean;
  pressedThrow: boolean;
}

export const NO_CONTROL: ControlState = {
  left: false, right: false, up: false, down: false,
  pressedLeft: false, pressedRight: false, pressedUp: false, pressedDown: false, pressedThrow: false,
};

/** What the world does for a clonk when the player asks for it. */
export interface ClonkActions {
  throwItem: (item: Item, xdir: number, ydir: number) => void;
  /** Go into a building whose door the clonk stands in. Returns false if there is none. */
  tryEnter: () => boolean;
}

/** Command direction: where the player wants the clonk to go, as a unit-ish vector. */
interface ComDir {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}
const STOP: ComDir = { x: 0, y: 0 };

const P = CLONK.physical;
const WALK_SPEED = physical(280, P.walk);
const JUMP_SPEED = physical(1000, P.jump);
const SCALE_SPEED = physical(200, P.scale);
const HANGLE_SPEED = physical(160, P.hangle);
const DIG_SPEED = physical(125, P.dig);
const SWIM_SPEED = physical(160, P.swim);
const THROW_SPEED = physical(400, P.throw);

export class Clonk extends GameObject {
  readonly vertices = CLONK.vertices;
  action: ActionDef = CLONK.actions.Walk;
  /** Animation frame within the current action. */
  phase = 0;
  private phaseDelay = 0;
  /** Facing: -1 left, +1 right. */
  dir: -1 | 1 = 1;
  comDir: ComDir = STOP;
  readonly contents: Item[] = [];
  /** Health, in 1/1000 points (see ENERGY_UNIT). Zero means dead. */
  energy = CLONK.energy;
  alive = true;
  /** The building the clonk is inside, if any. Contained clonks are hidden and don't move. */
  contained: Structure | null = null;
  /** Selected line of the open buy menu, or null when it's closed. */
  menu: number | null = null;

  constructor(
    x: number,
    y: number,
    /** Player that owns this clonk (shirt colour, control). */
    readonly owner: number,
  ) {
    super(x, y);
    this.setAction('Jump');
  }

  get carrying(): Item | undefined {
    return this.contents[0];
  }

  // ---------------------------------------------------------------- actions

  setAction(name: string, xdir?: number, ydir?: number): void {
    const a = CLONK.actions[name];
    if (!a) return;
    if (a !== this.action) {
      this.action = a;
      this.phase = 0;
      this.phaseDelay = 0;
    }
    if (xdir !== undefined) this.xdir = xdir;
    if (ydir !== undefined) this.ydir = ydir;
    this.tAttach = attachFor(a, this.dir);
  }

  private setDir(d: -1 | 1): void {
    this.dir = d;
    this.tAttach = attachFor(this.action, d);
  }

  private walk(): void {
    this.setAction('Walk', 0, 0);
  }

  private jump(xdir: number, ydir: number): void {
    this.setAction('Jump', xdir, ydir);
  }

  private scale(d: -1 | 1): void {
    this.setDir(d);
    this.setAction('Scale', 0, 0);
  }

  private hangle(d: -1 | 1): void {
    this.setDir(d);
    this.setAction('Hangle', 0, 0);
  }

  private tumble(xdir: number, ydir: number): void {
    this.setAction('Tumble', xdir, ydir);
  }

  /** Climb over the top of a wall or out of water. */
  private cornerScale(land: Landscape, scaling: boolean): boolean {
    const ok = (rx: number, ry: number): boolean =>
      (contactCheck(land, this.vertices, this.x + rx * this.dir, this.y - ry).cnat &
        (CNAT.Top | CNAT.Left | CNAT.Right | CNAT.Bottom)) === 0;
    let found: [number, number] | null = null;
    if (scaling) {
      for (let rx = CORNER_RANGE; rx >= 1 && !found; rx--)
        for (let ry = CORNER_RANGE; ry >= 1 && !found; ry--) if (ok(rx, ry)) found = [rx, ry];
    } else {
      for (let r = 2; r <= CORNER_RANGE && !found; r++) if (ok(r, r)) found = [r, r];
    }
    if (!found) return false;
    this.setAction('KneelUp', 0, 0);
    this.setPosition(this.x + found[0] * this.dir, this.y - found[1]);
    return true;
  }

  // --------------------------------------------------------------- controls

  /** Apply a player's controls. Hold a direction to move; see README for the key layout. */
  control(c: ControlState, out: ClonkActions): void {
    if (this.action.disabled) return;
    const held: ComDir = { x: c.left ? -1 : c.right ? 1 : 0, y: c.up ? -1 : c.down ? 1 : 0 };
    switch (this.action.procedure) {
      case 'walk':
        this.comDir = { x: held.x, y: 0 };
        if (c.pressedUp && out.tryEnter()) break;
        if (c.pressedUp) {
          // Clonks always jump forward.
          const tx = held.x !== 0 ? held.x * WALK_SPEED : this.dir * WALK_SPEED;
          this.jump(tx, -JUMP_SPEED);
        } else if (c.pressedDown) {
          this.setAction('Dig', 0, 0);
          this.comDir = { x: held.x, y: 1 };
        }
        if (c.pressedThrow) this.throwOrDrop(true, out);
        break;
      case 'flight':
      case 'kneel':
      case 'throw':
        this.comDir = { x: held.x, y: 0 };
        if (c.pressedThrow && this.action.procedure === 'flight') this.throwOrDrop(true, out);
        break;
      case 'scale': {
        const away = this.dir === -1 ? c.right : c.left;
        if (away) {
          this.jump(-this.dir, 0);
          break;
        }
        const toward = this.dir === -1 ? c.left : c.right;
        this.comDir = c.up || toward ? { x: 0, y: -1 } : c.down ? { x: 0, y: 1 } : STOP;
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
      }
      case 'hangle':
        this.comDir = { x: held.x, y: 0 };
        if (c.pressedDown) this.jump(0, 0);
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
      case 'dig':
        if (c.pressedThrow) {
          this.walk();
          this.throwOrDrop(true, out);
        } else if (held.x === 0 && held.y === 0) this.walk();
        else this.comDir = held;
        break;
      case 'swim':
        if (c.pressedUp && out.tryEnter()) break;
        this.comDir = held;
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
    }
  }

  private throwOrDrop(throwIt: boolean, out: Pick<ClonkActions, 'throwItem'>): void {
    const item = this.contents.shift();
    if (!item) return;
    if (throwIt) {
      if (this.action.procedure === 'walk') this.setAction('Throw', 0, 0);
      item.setPosition(this.x, this.y - 11);
      out.throwItem(item, THROW_SPEED * this.dir, -THROW_SPEED);
    } else {
      item.setPosition(this.x, this.y);
      out.throwItem(item, 0, 0);
    }
  }

  // ------------------------------------------------------------- simulation

  /** One tick: procedure physics, digging, movement, reactions, animation. */
  tick(land: Landscape): void {
    if (this.action.inLiquid && this.inLiquid(land)) this.setAction(this.action.inLiquid);

    let advance = 1;
    const cd = this.comDir;
    switch (this.action.procedure) {
      case 'walk':
        if (cd.x < 0) this.xdir = Math.max(this.xdir - WALK_ACCEL, -WALK_SPEED);
        else if (cd.x > 0) this.xdir = Math.min(this.xdir + WALK_ACCEL, WALK_SPEED);
        else this.xdir = decel(this.xdir, WALK_ACCEL);
        advance = Math.floor(Math.abs(this.xdir) * 10);
        if (this.xdir < 0) this.setDir(-1);
        if (this.xdir > 0) this.setDir(1);
        break;
      case 'kneel':
      case 'throw':
        this.ydir = 0;
        if (this.action.procedure === 'throw') this.xdir = 0;
        break;
      case 'scale': {
        // Pushing towards the wall means "climb up".
        const up = cd.y < 0 || (cd.x !== 0 && cd.x === this.dir);
        if (up) this.ydir = Math.max(this.ydir - WALK_ACCEL, -SCALE_SPEED);
        else if (cd.y > 0) this.ydir = Math.min(this.ydir + WALK_ACCEL, SCALE_SPEED);
        else this.ydir = decel(this.ydir, WALK_ACCEL);
        advance = Math.floor(Math.abs(this.ydir) * 14);
        this.xdir = 0;
        break;
      }
      case 'hangle':
        if (cd.x < 0) this.xdir = Math.max(this.xdir - WALK_ACCEL, -HANGLE_SPEED);
        else if (cd.x > 0) this.xdir = Math.min(this.xdir + WALK_ACCEL, HANGLE_SPEED);
        else this.xdir = decel(this.xdir, WALK_ACCEL);
        advance = Math.floor(Math.abs(this.xdir) * 10);
        if (this.xdir < 0) this.setDir(-1);
        if (this.xdir > 0) this.setDir(1);
        this.ydir = 0;
        break;
      case 'flight':
        this.ydir += GRAVITY;
        break;
      case 'dead':
        this.ydir += GRAVITY;
        if (land.isSolid(this.x, this.y + 10)) this.xdir = decel(this.xdir, WALK_ACCEL);
        break;
      case 'dig': {
        if (!attach(land, this.vertices, this.x, this.y, CNAT.Bottom)) {
          this.walk();
          break;
        }
        const s = DIG_SPEED;
        advance = Math.floor(s * 40);
        if (cd.x === 0 && cd.y === 0) {
          this.xdir = this.ydir = 0;
          advance = 0;
        } else if (cd.x === 0 && cd.y < 0) {
          this.xdir = s * this.dir;
          this.ydir = -s / 2;
        } else {
          this.xdir = cd.x * s;
          this.ydir = cd.y < 0 ? -s / 2 : cd.y * s;
        }
        if (this.xdir < 0) this.setDir(-1);
        else if (this.xdir > 0) this.setDir(1);
        break;
      }
      case 'swim':
        this.xdir += cd.x * SWIM_ACCEL;
        this.ydir += cd.y * SWIM_ACCEL;
        if (cd.x === 0 && cd.y === 0) {
          this.xdir = decel(this.xdir, SWIM_ACCEL);
          this.ydir = decel(this.ydir, SWIM_ACCEL);
        }
        if (!this.inLiquid(land)) {
          if (land.isLiquid(this.x, this.y + 1)) this.ydir = SWIM_ACCEL;
          else {
            this.walk();
            break;
          }
        }
        this.xdir = Math.max(-SWIM_SPEED, Math.min(SWIM_SPEED, this.xdir));
        this.ydir = Math.max(-SWIM_SPEED, Math.min(SWIM_SPEED, this.ydir));
        // Can't swim up out of the water.
        if (!land.isLiquid(this.x, this.y - 1) && this.ydir < 0) this.ydir = 0;
        if (this.xdir < 0) this.setDir(-1);
        if (this.xdir > 0) this.setDir(1);
        advance = Math.floor(SWIM_SPEED * 10);
        break;
    }

    // Dig out the space ahead.
    if (this.action.digFree) {
      land.dig(Math.floor(this.fx + this.xdir + 0.5), Math.floor(this.fy + this.ydir + 0.5) - 1, this.action.digFree);
    }

    const speed = Math.abs(this.xdir) + Math.abs(this.ydir);
    const goingUp = this.ydir < 0;
    const moved = this.doMovement(land);
    if (moved.contact) this.contactAction(land, moved.contact, speed, goingUp);
    if (moved.lostAttach && this.tAttach) this.noAttachAction(land);

    this.animate(advance);
  }

  private animate(advance: number): void {
    const a = this.action;
    this.phaseDelay += advance;
    while (this.phaseDelay >= a.delay) {
      this.phaseDelay -= a.delay;
      const reverse = a.procedure === 'scale' && this.ydir > 0;
      this.phase += reverse ? -1 : 1;
      if (this.phase < 0) this.phase = a.length - 1;
      if (this.phase >= a.length) {
        if (a.next === a.name) this.phase = 0;
        else if (a.next === 'Hold') {
          this.phase = a.length - 1;
          this.phaseDelay = 0;
          return;
        } else {
          this.setAction(a.next);
          if (a.next === 'Walk') this.comDir = STOP;
          return;
        }
      }
    }
  }

  private contactAction(land: Landscape, contact: number, speed: number, goingUp: boolean): void {
    const proc = this.action.procedure;
    if (proc === 'dead') return;
    const disabled = !!this.action.disabled;
    const cd = this.comDir;

    if (contact & CNAT.Bottom) {
      switch (proc) {
        case 'flight': {
          if (goingUp) break;
          if (speed >= HIT_SPEED_4 || disabled) return this.setAction('FlatUp', 0, 0);
          if (speed >= HIT_SPEED_3) return this.setAction('KneelDown', 0, 0);
          // Land and keep running.
          const keep = this.xdir;
          this.walk();
          this.xdir = keep;
          return;
        }
        case 'scale':
          if (cd.y <= 0) {
            this.cornerScale(land, true);
            return;
          }
          return this.walk();
        case 'dig':
          // Digging diagonally down onto something hard: carry on sideways.
          if (cd.y > 0 && cd.x !== 0) {
            this.comDir = { x: cd.x, y: 0 };
            break;
          }
          return this.walk();
        case 'swim':
          if (!land.isLiquid(this.x, this.y - 1)) this.cornerScale(land, false);
          return;
      }
    }

    if (contact & CNAT.Top) {
      switch (proc) {
        case 'walk':
          return this.walk();
        case 'scale':
          if (cd.y < 0 || cd.x === this.dir) return this.hangle(this.dir === -1 ? 1 : -1);
          break;
        case 'flight':
          if (speed >= HIT_SPEED_3 || disabled) {
            this.tumble(0, 0);
            break;
          }
          return this.hangle(this.dir);
        case 'dig':
          return this.walk();
        case 'hangle':
          this.comDir = STOP;
          break;
      }
    }

    for (const side of [-1, 1] as const) {
      if (!(contact & (side === -1 ? CNAT.Left : CNAT.Right))) continue;
      switch (proc) {
        case 'flight':
          if (speed >= HIT_SPEED_3 || disabled) {
            this.tumble(-side * 1.5, 0);
            break;
          }
          return this.scale(side);
        case 'walk':
          if (cd.x === side) return this.scale(side);
          if (cd.x === -side) this.jump(this.xdir / 2, this.ydir);
          return;
        case 'swim':
          if (cd.x === side) return this.scale(side);
          this.cornerScale(land, false);
          return;
        case 'hangle':
          this.scale(side);
          return;
        case 'dig':
          return this.walk();
      }
    }
  }

  private noAttachAction(land: Landscape): void {
    const proc = this.action.procedure;
    if (proc === 'scale') {
      const cd = this.comDir;
      if (cd.y < 0 || cd.x === this.dir) {
        if (this.cornerScale(land, true)) return;
      }
      if (cd.x === 0 && cd.y === 0) return this.jump(-this.dir, 0);
    }
    // Walked off a ledge, lost grip, etc.: fall.
    this.jump(this.xdir, this.ydir);
  }

  /**
   * Change energy by `points` (whole points, like DoEnergy without fExact).
   * Returns true if this killed the clonk.
   */
  doEnergy(points: number, exact = false): boolean {
    if (!this.alive) return false;
    const change = exact ? points : points * ENERGY_UNIT;
    this.energy = Math.max(0, Math.min(CLONK.energy, this.energy + change));
    if (this.energy > 0) return false;
    this.die();
    return true;
  }

  private die(): void {
    this.alive = false;
    this.menu = null;
    this.comDir = STOP;
    this.setAction('Dead', 0);
  }

  /** Pick up an item if there's room. */
  tryCollect(items: Item[], land: Landscape): Item | null {
    if (this.contents.length >= CLONK.maxContents || this.action.disabled) return null;
    const r = CLONK.collection;
    for (const item of items) {
      if (item.container || item.removed || item.noCollect > 0) continue;
      const dx = item.x - this.x;
      const dy = item.y - this.y;
      if (dx >= r.x && dx < r.x + r.w && dy >= r.y && dy < r.y + r.h) {
        // Items still buried in solid ground can't be picked up.
        if (land.isSolid(item.x, item.y)) continue;
        item.container = this;
        item.xdir = item.ydir = 0;
        this.contents.push(item);
        return item;
      }
    }
    return null;
  }
}

/** Which surface an action holds on to. */
function attachFor(a: ActionDef, dir: -1 | 1): number {
  switch (a.procedure) {
    case 'walk':
    case 'kneel':
    case 'throw':
      return CNAT.Bottom;
    case 'scale':
      return dir === -1 ? CNAT.Left : CNAT.Right;
    case 'hangle':
      return CNAT.Top;
    default:
      return CNAT.None;
  }
}

function decel(v: number, a: number): number {
  if (v < 0) v += a;
  if (v > 0) v -= a;
  return v > -a && v < a ? 0 : v;
}
