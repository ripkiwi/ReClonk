// Clonk behaviour ported from the Clonk Rage engine (C4Object::ExecAction,
// C4Object::ContactAction, C4Object::NoAttachAction, C4ObjectCom.cpp).
// See licenses/clonk_engine_license.txt.

import type { Landscape } from '../landscape/landscape';
import { CLONK, ENERGY_UNIT, type ActionDef } from './defs';
import { GameObject } from './gameObject';
import { experienceForRank, rankForExperience } from '../game/ranks';
import type { Item } from './item';
import type { Structure } from './structure';
import {
  CNAT,
  CORNER_RANGE,
  GRAVITY,
  HIT_SPEED_2,
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
  pressedUp: boolean;
  pressedDown: boolean;
  pressedLeft: boolean;
  pressedRight: boolean;
  pressedThrow: boolean;
  pressedDig: boolean;
  /** Dig pressed twice in quick succession: use what the clonk carries (the original's double dig). */
  pressedUse: boolean;
  /** Down pressed twice in quick succession. */
  doubleDown: boolean;
  /** Change which clonks of the crew follow the controls. */
  crew: CrewCommand | null;
  /** Number of key presses this tick. Every 5th command earns experience, like the original. */
  commands: number;
}

/**
 * Crew selection, like the original's crew cursor: make the next or previous
 * clonk the leader, pick one by its place in the crew, add or remove one from
 * the group, or select the whole crew.
 */
export type CrewCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'all' }
  | { type: 'pick'; index: number }
  | { type: 'toggle'; index: number };

export const NO_CONTROL: ControlState = {
  left: false, right: false, up: false, down: false,
  pressedUp: false, pressedDown: false, pressedLeft: false, pressedRight: false,
  pressedThrow: false, pressedDig: false, pressedUse: false, doubleDown: false, crew: null, commands: 0,
};

/** What the world does for a clonk when the player asks for it. */
export interface ClonkActions {
  throwItem: (item: Item, xdir: number, ydir: number) => void;
  /** Go into a building whose door the clonk stands in. Returns false if there is none. */
  tryEnter: () => boolean;
  /** Use the carried item (double dig). Returns false if there's nothing to use. */
  useItem: () => boolean;
}

/** Walking speed while squaring up in a fist fight (DFA_FIGHT). */
const FIGHT_SPEED = physical(95, CLONK.physical.walk);
/** Fighters stand this far apart, centre to centre (half the shape width plus 2). */
const FIGHT_GAP = CLONK.width / 2 + 2;

export type ControlStyle = 'jumpAndRun' | 'classic';

/** The persistent identity of a clonk while it's in the world (name, rank, experience). */
export interface CrewInfo {
  memberId: string;
  name: string;
  rank: number;
  /** Total experience, including what was earned this round. */
  experience: number;
  /** Experience earned this round. */
  gained: number;
  /** Enemy clonks this one knocked out this round. */
  kills?: number;
  controlCount: number;
  portrait: number;
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
const DIG_SPEED = physical(125, P.dig);

/** Higher ranks train climbing, hangling and swimming towards the maximum at rank 20 (original rule). */
function trained(base: number, rank: number): number {
  const r = Math.max(0, Math.min(20, rank));
  return base + ((100000 - base) * r) / 20;
}

/** Command directions in the original's order, used to rotate the dig direction step by step. */
const COMDIRS: ComDir[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];
const comIndex = (c: ComDir): number => COMDIRS.findIndex((d) => d.x === c.x && d.y === c.y);
/** Speed of a thrown object, sideways and up (ObjectActionThrow). */
export const THROW_SPEED = physical(400, P.throw);
/** A clonk walking to the leader gives up after this many ticks (20 seconds). */
const GO_TO_TICKS = 36 * 20;
/** Close enough to the leader. */
const GO_TO_NEAR = 6;

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
  controlStyle: ControlStyle = 'jumpAndRun';
  /** Set for clonks from a player's crew. */
  info: CrewInfo | null = null;
  /** Walking over to this x position (the crew gathering at its leader), or null. */
  goTo: number | null = null;
  private goToTicks = 0;
  /** The clonk this one is in a fist fight with. */
  fightTarget: Clonk | null = null;
  /** Who hurt this clonk last, credited if it dies (the original's LastEnergyLossCausePlayer). */
  lastHurtBy: Clonk | null = null;
  /** Ticks spent stuck in the ground in mid-air. */
  private stuckTicks = 0;
  /** Set when the current action started or started over this tick (the original's StartCall). */
  actionStarted = false;
  /** The action that just ran out this tick (the original's EndCall). */
  actionEnded: string | null = null;

  constructor(
    x: number,
    y: number,
    /** Player that owns this clonk (shirt colour, control). */
    readonly owner: number,
  ) {
    super(x, y);
    this.setAction('Jump');
  }

  private get rank(): number {
    return this.info?.rank ?? 0;
  }
  /** Full energy: 50 points, plus 5 per rank up to rank 10 (C4PhysicalInfo::PromotionUpdate). */
  get maxEnergy(): number {
    return (50 + 5 * Math.max(0, Math.min(10, this.rank))) * ENERGY_UNIT;
  }
  /** Fighting strength, trained towards the maximum at rank 20 like climbing. */
  get fight(): number {
    return trained(P.fight, this.rank);
  }

  /** Give the clonk its crew identity, starting with full energy for its rank. */
  join(info: CrewInfo | null): void {
    this.info = info;
    this.energy = this.maxEnergy;
  }
  private get scaleSpeed(): number {
    return physical(200, trained(P.scale, this.rank));
  }
  private get hangleSpeed(): number {
    return physical(160, trained(P.hangle, this.rank));
  }
  private get swimSpeed(): number {
    return physical(160, trained(P.swim, this.rank));
  }

  /** Add experience. Returns true if the clonk was promoted. */
  doExperience(n: number): boolean {
    const info = this.info;
    if (!info || n <= 0) return false;
    info.experience += n;
    info.gained += n;
    if (info.experience >= experienceForRank(info.rank + 1)) {
      info.rank = rankForExperience(info.experience);
      return true;
    }
    return false;
  }

  /** Count a player's key presses: every 5th command earns 1 experience. */
  countCommands(n: number): boolean {
    if (!this.info || n <= 0) return false;
    let promoted = false;
    for (let i = 0; i < n; i++) {
      this.info.controlCount++;
      if (this.info.controlCount % 5 === 0) promoted = this.doExperience(1) || promoted;
    }
    return promoted;
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
      this.actionStarted = true;
      if (a.procedure !== 'fight') this.fightTarget = null;
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

  /**
   * Knocked away by a hit or a punch (C4Object::Fling, ObjectActionTumble):
   * tumble off, facing where the blow came from.
   */
  fling(xdir: number, ydir: number): void {
    if (!this.alive) return;
    this.dir = xdir < 0 ? 1 : -1;
    this.comDir = STOP;
    this.tumble(xdir, ydir);
  }

  /** Square up to a hostile clonk (ObjectActionFight). */
  startFight(target: Clonk): void {
    this.setAction('Fight');
    this.fightTarget = target;
    this.comDir = STOP;
    this.goTo = null;
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
    if (this.action.procedure === 'fight') return this.controlFight(c);
    if (this.action.disabled) return;
    if (this.goTo !== null) {
      // Walking over to the leader until the player takes over again.
      if (!takesOver(c)) return this.followGoTo();
      this.goTo = null;
    }
    if (this.controlStyle === 'classic') return this.controlClassic(c, out);
    const held: ComDir = { x: c.left ? -1 : c.right ? 1 : 0, y: c.up ? -1 : c.down ? 1 : 0 };
    switch (this.action.procedure) {
      case 'walk':
        this.comDir = { x: held.x, y: 0 };
        if (c.pressedUp && out.tryEnter()) break;
        if (c.pressedUse && out.useItem()) break;
        if (c.pressedUp) {
          // Clonks always jump forward.
          const tx = held.x !== 0 ? held.x * WALK_SPEED : this.dir * WALK_SPEED;
          this.jump(tx, -JUMP_SPEED);
        } else if (c.pressedDig) {
          // Dig the way the player is pointing, straight down if nowhere.
          this.setAction('Dig', 0, 0);
          this.comDir = held.x !== 0 || held.y !== 0 ? held : { x: 0, y: 1 };
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
        // The clonk keeps digging on its own until dig is pressed again, so it
        // can be left to dig while the player controls another clonk.
        if (c.pressedThrow) {
          this.walk();
          this.throwOrDrop(true, out);
        } else if (c.pressedUse) {
          if (out.useItem()) this.walk();
        } else if (c.pressedDig) this.walk();
        else if (held.x !== 0 || held.y !== 0) this.comDir = held;
        break;
      case 'swim':
        if (c.pressedUp && out.tryEnter()) break;
        this.comDir = held;
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
    }
  }

  /**
   * Classic Clonk controls (C4Object::DirectCom): tap a direction to start walking,
   * tap stop to stop. Separate keys for jump, dig and throw.
   */
  private controlClassic(c: ControlState, out: ClonkActions): void {
    const cd = this.comDir;
    switch (this.action.procedure) {
      case 'walk':
        if (c.pressedLeft) this.comDir = { x: -1, y: 0 };
        if (c.pressedRight) this.comDir = { x: 1, y: 0 };
        if (c.pressedDown) this.comDir = STOP;
        if (c.pressedUp && out.tryEnter()) break;
        if (c.pressedUse && out.useItem()) break;
        if (c.pressedUp) {
          const tx = this.comDir.x !== 0 ? this.comDir.x * WALK_SPEED : this.dir * WALK_SPEED;
          this.jump(tx, -JUMP_SPEED);
        } else if (c.pressedDig) {
          this.setAction('Dig', 0, 0);
          this.comDir = { x: this.dir, y: 1 };
        }
        if (c.pressedThrow) this.throwOrDrop(true, out);
        break;
      case 'flight':
      case 'kneel':
      case 'throw':
        if (c.pressedLeft) this.comDir = { x: -1, y: 0 };
        if (c.pressedRight) this.comDir = { x: 1, y: 0 };
        if (c.pressedDown) this.comDir = STOP;
        if (c.pressedThrow && this.action.procedure === 'flight') this.throwOrDrop(true, out);
        break;
      case 'scale':
        if (c.pressedLeft) {
          if (this.dir === -1) this.comDir = STOP;
          else this.jump(-1, 0);
        }
        if (c.pressedRight) {
          if (this.dir === 1) this.comDir = STOP;
          else this.jump(1, 0);
        }
        if (c.pressedUp) this.comDir = { x: 0, y: -1 };
        if (c.pressedDown) this.comDir = { x: 0, y: 1 };
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
      case 'hangle':
        if (c.pressedLeft) this.comDir = { x: -1, y: 0 };
        if (c.pressedRight) this.comDir = { x: 1, y: 0 };
        if (c.pressedUp) this.comDir = STOP;
        if (c.pressedDown) this.jump(0, 0);
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
      case 'dig': {
        if (c.pressedUse && out.useItem()) {
          this.walk();
          break;
        }
        // Left/right turn the dig direction one step at a time.
        const i = comIndex(cd);
        if (c.pressedLeft && i >= 1 && i <= 6) this.comDir = COMDIRS[i + 1];
        if (c.pressedRight && i >= 2 && i <= 7) this.comDir = COMDIRS[i - 1];
        if (c.pressedDown) this.walk();
        break;
      }
      case 'swim':
        if (c.pressedUp && out.tryEnter()) break;
        if (c.pressedLeft) this.comDir = { x: -1, y: cd.y };
        if (c.pressedRight) this.comDir = { x: 1, y: cd.y };
        if (c.pressedUp) this.comDir = { x: cd.x, y: -1 };
        if (c.pressedDown) this.comDir = { x: cd.x, y: 1 };
        if (c.pressedThrow) this.throwOrDrop(false, out);
        break;
    }
  }

  /**
   * In a fist fight, down backs off (the original's stop) and throw swings a
   * punch right away instead of waiting for the fight's own dice.
   */
  private controlFight(c: ControlState): void {
    this.goTo = null;
    if (c.pressedDown || (this.controlStyle === 'classic' && c.doubleDown)) return this.walk();
    if (c.pressedThrow && this.action.name === 'Fight' && this.phase >= 2) this.setAction('Punch');
  }

  /**
   * The player switched to another clonk. With jump'n'run controls a clonk
   * only walks while a key is held, so it stops; whatever it does on its own
   * (digging) goes on. Classic commands carry on, as in the original.
   */
  release(): void {
    if (this.controlStyle === 'classic' || this.action.procedure === 'dig') return;
    this.comDir = STOP;
  }

  /** Walk over to `x`, for example to gather the crew at its leader. */
  walkTo(x: number): void {
    this.goTo = x;
    this.goToTicks = GO_TO_TICKS;
  }

  /** One tick of walking towards `goTo`: walk, climb what's in the way, swim. */
  private followGoTo(): void {
    const target = this.goTo;
    if (target === null) return;
    const dx = target - this.x;
    if (Math.abs(dx) <= GO_TO_NEAR || --this.goToTicks <= 0) {
      this.goTo = null;
      if (this.action.procedure !== 'scale') this.comDir = STOP;
      return;
    }
    const d = dx < 0 ? -1 : 1;
    switch (this.action.procedure) {
      case 'walk':
      case 'flight':
      case 'kneel':
      case 'throw':
      case 'hangle':
        this.comDir = { x: d, y: 0 };
        break;
      case 'dig':
        this.walk();
        this.comDir = { x: d, y: 0 };
        break;
      case 'scale':
        if (d === this.dir) this.comDir = { x: 0, y: -1 };
        else this.jump(d, 0);
        break;
      case 'swim':
        this.comDir = { x: d, y: -1 };
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
    this.actionStarted = false;
    this.actionEnded = null;
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
        if (up) this.ydir = Math.max(this.ydir - WALK_ACCEL, -this.scaleSpeed);
        else if (cd.y > 0) this.ydir = Math.min(this.ydir + WALK_ACCEL, this.scaleSpeed);
        else this.ydir = decel(this.ydir, WALK_ACCEL);
        advance = Math.floor(Math.abs(this.ydir) * 14);
        this.xdir = 0;
        break;
      }
      case 'hangle':
        if (cd.x < 0) this.xdir = Math.max(this.xdir - WALK_ACCEL, -this.hangleSpeed);
        else if (cd.x > 0) this.xdir = Math.min(this.xdir + WALK_ACCEL, this.hangleSpeed);
        else this.xdir = decel(this.xdir, WALK_ACCEL);
        advance = Math.floor(Math.abs(this.xdir) * 10);
        if (this.xdir < 0) this.setDir(-1);
        if (this.xdir > 0) this.setDir(1);
        this.ydir = 0;
        break;
      case 'flight':
        this.ydir += GRAVITY;
        break;
      case 'fight': {
        // Square up to the opponent: face it and keep a step away (DFA_FIGHT).
        const t = this.fightTarget;
        if (!t || t.action.procedure !== 'fight' || t.contained || this.contained || this.inLiquid(land)) {
          this.walk();
          break;
        }
        if (t.x > this.x) this.setDir(1);
        if (t.x < this.x) this.setDir(-1);
        const at = this.dir === -1 ? t.x + FIGHT_GAP : t.x - FIGHT_GAP;
        this.xdir = towards(this.xdir, this.x === at ? 0 : this.x < at ? FIGHT_SPEED : -FIGHT_SPEED, FIGHT_SPEED);
        if (Math.abs(this.x - t.x) > CLONK.width || Math.abs(this.y - t.y) > CLONK.width) {
          this.walk();
          break;
        }
        this.ydir = 0;
        break;
      }
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
        const swim = this.swimSpeed;
        this.xdir = Math.max(-swim, Math.min(swim, this.xdir));
        this.ydir = Math.max(-swim, Math.min(swim, this.ydir));
        // Can't swim up out of the water.
        if (!land.isLiquid(this.x, this.y - 1) && this.ydir < 0) this.ydir = 0;
        if (this.xdir < 0) this.setDir(-1);
        if (this.xdir > 0) this.setDir(1);
        advance = Math.floor(swim * 10);
        break;
    }

    // Dig out the space ahead.
    if (this.action.digFree) {
      land.dig(Math.floor(this.fx + this.xdir + 0.5), Math.floor(this.fy + this.ydir + 0.5) - 1, this.action.digFree);
    }

    const speed = Math.abs(this.xdir) + Math.abs(this.ydir);
    const goingUp = this.ydir < 0;
    const x0 = this.x;
    const y0 = this.y;
    const moved = this.doMovement(land);
    if (moved.contact) this.contactAction(land, moved.contact, speed, goingUp);
    if (moved.lostAttach && this.tAttach) this.noAttachAction(land);
    this.checkStuck(land, x0 === this.x && y0 === this.y);

    this.animate(advance);
  }

  /**
   * A clonk flung against a lump of earth can get hooked on it in mid-air,
   * unable to fall or move (the original just said "... is stuck"). After a
   * second of that it slips off to the nearest spot it can fall from.
   */
  private checkStuck(land: Landscape, still: boolean): void {
    if (!still || this.action.procedure !== 'flight') {
      this.stuckTicks = 0;
      return;
    }
    if (++this.stuckTicks < 36) return;
    this.stuckTicks = 0;
    const free = (x: number, y: number): boolean =>
      !contactCheck(land, this.vertices, x, y).count && !contactCheck(land, this.vertices, x, y + 1).count;
    for (let r = 1; r <= 16; r++) {
      for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [-r, -r], [r, -r], [0, r], [-r, r], [r, r]]) {
        if (free(this.x + dx, this.y + dy)) {
          this.setPosition(this.x + dx, this.y + dy);
          return;
        }
      }
    }
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
        if (a.next === a.name) {
          this.phase = 0;
          this.actionStarted = true;
        } else if (a.next === 'Hold') {
          this.phase = a.length - 1;
          this.phaseDelay = 0;
          return;
        } else {
          const target = this.fightTarget;
          this.actionEnded = a.name;
          this.setAction(a.next);
          // Punching and reeling go back to the same fight.
          if (this.action.procedure === 'fight') this.fightTarget = target;
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
          // Climb out onto the bank if there's room, else hold on to the wall.
          if (this.cornerScale(land, false)) return;
          if (cd.x === side) return this.scale(side);
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
    this.energy = Math.max(0, Math.min(this.maxEnergy, this.energy + change));
    if (this.energy > 0) return false;
    this.die();
    return true;
  }

  private die(): void {
    this.alive = false;
    this.menu = null;
    this.goTo = null;
    this.fightTarget = null;
    this.comDir = STOP;
    this.setAction('Dead', 0);
  }

  /** Pick up an item if there's room. */
  tryCollect(items: Item[], land: Landscape): Item | null {
    if (this.contents.length >= CLONK.maxContents || this.action.disabled) return null;
    const r = CLONK.collection;
    for (const item of items) {
      if (item.container || item.removed || item.noCollect > 0) continue;
      // Something flying fast hits the clonk instead of landing in its hands (CrossCheck).
      if (Math.abs(item.xdir) + Math.abs(item.ydir) >= HIT_SPEED_2) continue;
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

/** True if the player does something with a clonk that's walking over to the leader (down doesn't count: it's the gather key). */
function takesOver(c: ControlState): boolean {
  return c.left || c.right || c.up || c.pressedThrow || c.pressedDig || c.pressedUse;
}

/** Which surface an action holds on to. */
function attachFor(a: ActionDef, dir: -1 | 1): number {
  switch (a.procedure) {
    case 'walk':
    case 'kneel':
    case 'throw':
    case 'fight':
      return CNAT.Bottom;
    case 'scale':
      return dir === -1 ? CNAT.Left : CNAT.Right;
    case 'hangle':
      return CNAT.Top;
    default:
      return CNAT.None;
  }
}

/** Move `v` towards `target` by at most `step` (the original's Towards). */
function towards(v: number, target: number, step: number): number {
  if (Math.abs(v - target) <= step) return target;
  return v < target ? v + step : v - step;
}

function decel(v: number, a: number): number {
  if (v < 0) v += a;
  if (v > 0) v -= a;
  return v > -a && v < a ? 0 : v;
}
