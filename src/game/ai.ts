import { NO_CONTROL, THROW_SPEED, type Clonk, type ControlState } from '../objects/clonk';
import { MATERIALS } from '../landscape/materials';
import { CLONK } from '../objects/defs';
import type { Item } from '../objects/item';
import type { Brain, World } from './world';

/** What a computer clonk is up to. */
interface Mind {
  /** The enemy it's after. */
  target: Clonk | null;
  /** Ticks until it looks around for the nearest enemy again. */
  retarget: number;
  /** The loose or buried object it's going for. */
  item: Item | null;
  /** Ticks spent digging for `item`, to give up on hopeless digs. */
  digTicks: number;
  /** For noticing that it's stuck against something. */
  lastX: number;
  lastY: number;
  stuck: number;
  /** Ticks left of trying another way after getting stuck, and which way. */
  detour: number;
  detourSide: number;
  /** Things it gave up on getting to. */
  skip: Set<Item>;
  /** Wants to get somewhere this tick (so standing still means stuck). */
  want: boolean;
  /** Times it got stuck lately; a few in a row and it digs its way out. */
  escapes: number;
  /** Ticks moving freely since it last got stuck. */
  free: number;
  /** Ticks left of digging its way towards `digTo`, out of a pit or through a hill. */
  digOut: number;
  digTo: { x: number; y: number };
  /** Closest it got to where it's going, and ticks since it last got closer. */
  best: number;
  slow: number;
  /** How often it went round in circles: each time it tries another way out. */
  loops: number;
  /** Ticks spent aiming without a good throw; then it closes in instead. */
  aim: number;
  rush: number;
  /** Which shore it's swimming for (0: not in the water), and ticks since it last stood on dry land. */
  swimSide: number;
  wet: number;
}

/** How far a computer clonk looks for things to pick up. */
const ITEM_RANGE = 360;
/** How far it looks for buried things to dig out. */
const DIG_RANGE = 260;
/** Gives up digging for something after this long. */
const DIG_TICKS = 36 * 12;
/** Computer crews don't attack in the first three seconds. */
const CALM_TICKS = 36 * 3;
/** How far ahead it works out where a throw goes. */
const THROW_TICKS = 140;

/**
 * A computer player's crew, playing the way people play a melee: grab a
 * flint or rock (dig one out if none is lying around), get in range, throw
 * when the arc would hit, jump to throw further, and slug it out when an
 * enemy gets too close. It only uses the controls a player has, and its
 * dice come from the world's random numbers, so a round plays out the same
 * way every time.
 */
export class CrewAI implements Brain {
  private readonly minds = new Map<Clonk, Mind>();

  constructor(
    private readonly world: World,
    readonly player: number,
  ) {}

  control(c: Clonk): ControlState {
    const w = this.world;
    const out: ControlState = { ...NO_CONTROL };
    let m = this.minds.get(c);
    if (!m) {
      m = { target: null, retarget: 0, item: null, digTicks: 0, lastX: c.x, lastY: c.y, stuck: 0, detour: 0, detourSide: 0, skip: new Set(), want: false, escapes: 0, free: 0, digOut: 0, digTo: { x: c.x, y: c.y }, best: Infinity, slow: 0, loops: 0, aim: 0, rush: 0, swimSide: 0, wet: 0 };
      this.minds.set(c, m);
    }
    // Out of buildings: the fight is outside.
    if (c.contained) {
      out.pressedDown = true;
      return out;
    }
    const proc = c.action.procedure;
    // In a fist fight it swings now and then, like a player hammering the key.
    if (proc === 'fight') {
      if (c.action.name === 'Fight' && w.rng.int(8) === 0) out.pressedThrow = true;
      return out;
    }
    if (c.action.disabled) return out;

    if (--m.retarget <= 0 || !this.valid(m.target)) {
      m.target = this.nearestEnemy(c);
      m.retarget = 36 + w.rng.int(36);
    }
    const t = m.target;

    // Something's flying at it: jump out of the way, sometimes.
    if (proc === 'walk' && this.incoming(c) && w.rng.int(5) === 0) {
      out.pressedUp = true;
      return out;
    }

    m.want = false;
    if (proc === 'dig') {
      this.dig(c, m, out);
      this.unstick(c, m, out);
      return out;
    }

    if (c.carrying) {
      m.item = null;
      // A moment's calm at the start, so a player can get their bearings.
      if (t && w.tick >= CALM_TICKS) m.want = this.attack(c, m, t, out);
    } else {
      if (!this.validItem(c, m.item)) m.item = this.nearestItem(c, t, m.skip);
      if (m.item) this.fetch(c, m, out);
      else if (t) {
        // Nothing to throw: go and punch.
        if (proc === 'swim') this.swimAshore(c, m, t, out);
        else this.hold(out, Math.sign(t.x - c.x));
        m.want = true;
      }
    }
    this.unstick(c, m, out);
    return out;
  }

  /**
   * Has something to throw: get in range and throw when the arc hits.
   * Returns true if it's trying to get somewhere.
   */
  private attack(c: Clonk, m: Mind, t: Clonk, out: ControlState): boolean {
    const w = this.world;
    const proc = c.action.procedure;
    const dx = t.x - c.x;
    const side = Math.sign(dx) || c.dir;
    const facing = side === c.dir;
    if ((proc === 'walk' || proc === 'flight') && facing && w.rng.int(3) === 0 && this.throwHits(c, t)) {
      out.pressedThrow = true;
      m.aim = 0;
      return false;
    }
    if (m.rush > 0) {
      // No clear throw for a while: go in and slug it out.
      m.rush--;
      this.hold(out, side);
      return true;
    }
    if (proc === 'flight') {
      this.hold(out, side);
      return true;
    }
    if (proc === 'swim') {
      this.swimAshore(c, m, t, out);
      return true;
    }
    const dist = Math.abs(dx);
    // Each clonk of the crew keeps its own distance, so they don't bunch up and hit each other.
    const crew = this.world.crewOf(this.player);
    const range = 36 + (crew.indexOf(c) % 3) * 24;
    if (dist > range + 30 || Math.abs(t.y - c.y) > 50) this.hold(out, side);
    else if (dist < range - 16) this.hold(out, -side); // Too close to throw: back off.
    else if (!facing) this.hold(out, side);
    else {
      if (++m.aim > 100) {
        m.aim = 0;
        m.rush = 90;
      }
      if (proc === 'walk' && dist > 44 && w.rng.int(30) === 0) {
        // A jump carries the throw further.
        this.hold(out, side);
        out.pressedUp = true;
      }
      return false;
    }
    return true;
  }

  /** Go and pick something up: walk to it, jump up to it, or dig it out. */
  private fetch(c: Clonk, m: Mind, out: ControlState): void {
    const item = m.item!;
    const dx = item.x - c.x;
    const dy = item.y - c.y;
    const loose = !this.world.land.isSolid(item.x, item.y);
    m.want = true;
    if (Math.abs(dx) > 10 && (loose || dy < 40)) return this.hold(out, Math.sign(dx));
    if (dy < -14) {
      // Above: jump for it.
      if (c.action.procedure === 'walk') out.pressedUp = true;
      return this.hold(out, Math.sign(dx));
    }
    if (loose && dy <= 14) return this.hold(out, Math.sign(dx));
    // Below, or in the ground: dig to it.
    if (c.action.procedure === 'walk') {
      this.steer(c, item, out);
      out.pressedDig = true;
      m.digTicks = 0;
    }
  }

  /**
   * Digging: towards the object it's after, or up and out of a pit. Stops
   * when the object is in hand or out of reach.
   */
  private dig(c: Clonk, m: Mind, out: ControlState): void {
    if (m.digOut > 0) {
      if (--m.digOut === 0) out.pressedDig = true;
      else this.steer(c, m.digTo, out);
      return;
    }
    const item = m.item;
    if (c.carrying || !item || !this.validItem(c, item) || ++m.digTicks > DIG_TICKS) {
      if (item && !c.carrying) m.skip.add(item);
      if (!c.carrying) m.item = null;
      out.pressedDig = true;
      return;
    }
    this.steer(c, item, out);
  }

  /**
   * In the water: swim to the shore and climb out. Towards the enemy if
   * it's on land, otherwise to the nearer shore; if that shore can't be
   * climbed, the other one.
   */
  private swimAshore(c: Clonk, m: Mind, t: Clonk, out: ControlState): void {
    const { land } = this.world;
    if (!m.swimSide) {
      m.swimSide = Math.sign(t.x - c.x) || c.dir;
      if (t.action.procedure === 'swim' || Math.abs(t.x - c.x) < 40) {
        const shore = (d: number): number => {
          for (let i = 1; i < 400; i++) if (!land.isLiquid(c.x + d * i, c.y)) return i;
          return 400;
        };
        m.swimSide = shore(-1) < shore(1) ? -1 : 1;
      }
    }
    this.hold(out, m.swimSide);
    out.up = true;
  }

  /** Hold the direction keys pointing at something. */
  private steer(c: Clonk, to: { x: number; y: number }, out: ControlState): void {
    const dx = to.x - c.x;
    const dy = to.y - c.y;
    const x = Math.abs(dx) > 6 ? Math.sign(dx) : 0;
    const y = Math.abs(dy) > 6 ? Math.sign(dy) : 0;
    out.left = x < 0;
    out.right = x > 0;
    out.up = y < 0;
    out.down = y > 0 || (x === 0 && y === 0);
  }

  private hold(out: ControlState, side: number): void {
    out.left = side < 0;
    out.right = side > 0;
  }

  /**
   * Getting nowhere (walking into a wall, hanging on to an overhang): try
   * another way for a moment: jump, or head the other way.
   */
  private unstick(c: Clonk, m: Mind, out: ControlState): void {
    const proc = c.action.procedure;
    if (m.detour > 0) {
      m.detour--;
      out.left = out.right = out.up = out.down = false;
      out.pressedThrow = out.pressedDig = false;
      this.hold(out, m.detourSide);
      if (proc === 'walk' && m.detour % 12 === 0) out.pressedUp = true;
      return;
    }
    const trying = m.want || proc === 'scale' || proc === 'hangle' || proc === 'flight' || proc === 'dig';
    if (trying && Math.abs(c.x - m.lastX) + Math.abs(c.y - m.lastY) < 1) m.stuck++;
    else m.stuck = 0;
    m.lastX = c.x;
    m.lastY = c.y;
    if (m.stuck === 0 && ++m.free > 300) m.escapes = 0;

    // Splashing about without getting out of the water: try the other shore.
    if (proc === 'walk') {
      m.wet = 0;
      m.swimSide = 0;
    } else if (m.swimSide && ++m.wet > 240) {
      m.wet = 0;
      m.swimSide = -m.swimSide;
      m.detour = 60;
      m.detourSide = m.swimSide;
    }
    if (m.stuck === 18 && proc === 'walk') out.pressedUp = true;

    // Going round in circles (climbing, falling, climbing...) without getting closer.
    const goal = m.item ?? m.target;
    if (m.want && goal && proc !== 'dig') {
      const d = Math.abs(goal.x - c.x) + Math.abs(goal.y - c.y);
      if (d < m.best - 4) {
        m.best = d;
        m.slow = 0;
      } else m.slow++;
    } else {
      m.best = Infinity;
      m.slow = 0;
    }
    // Hanging from a ceiling only gets in the way: let go.
    if (m.slow > 200 && proc === 'hangle') out.pressedDown = true;
    if (m.slow > 200 && proc === 'walk') {
      m.slow = 0;
      m.best = Infinity;
      if (m.item) m.skip.add(m.item);
      // Dig straight there instead. If that didn't help either (rock in the
      // way), dig up and over, first back the way it came, then the other way.
      const loop = m.loops++ % 3;
      const side = Math.sign(goal!.x - c.x) || 1;
      const to = loop === 0 ? { x: goal!.x, y: Math.min(goal!.y, c.y + 10) } : { x: c.x + (loop === 1 ? -side : side) * 40, y: c.y - 70 };
      return this.digTowards(c, m, to, out);
    }

    if (m.stuck > 36) {
      m.stuck = 0;
      m.free = 0;
      if (proc === 'hangle') out.pressedDown = true;
      // Whatever it was going for is out of reach from here.
      if (m.item) m.skip.add(m.item);
      m.item = null;
      if (++m.escapes >= 2 && proc === 'walk') {
        // Stuck again and again: dig up and out, towards the enemy.
        m.escapes = 0;
        const side = m.target ? Math.sign(m.target.x - c.x) || 1 : c.dir;
        return this.digTowards(c, m, { x: c.x + side * 60, y: c.y - 40 }, out);
      }
      m.detour = 30 + this.world.rng.int(40);
      m.detourSide = out.left ? 1 : out.right ? -1 : -c.dir;
      if (proc === 'dig') out.pressedDig = true;
    }
  }

  /** Start digging towards a spot for a while (through a hill, out of a pit). */
  private digTowards(c: Clonk, m: Mind, to: { x: number; y: number }, out: ControlState): void {
    m.digTo = to;
    m.digOut = 150;
    out.left = out.right = out.up = out.down = false;
    out.pressedUp = out.pressedThrow = false;
    this.steer(c, to, out);
    out.pressedDig = true;
  }

  private valid(t: Clonk | null): t is Clonk {
    return !!t && t.alive && !t.contained;
  }

  private nearestEnemy(c: Clonk): Clonk | null {
    let best: Clonk | null = null;
    let bestD = Infinity;
    for (const o of this.world.clonks) {
      if (!this.valid(o) || !this.world.hostile(c.owner, o.owner)) continue;
      const d = Math.abs(o.x - c.x) + Math.abs(o.y - c.y) * 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private validItem(c: Clonk, item: Item | null): item is Item {
    return !!item && !item.removed && !item.container && Math.abs(item.x - c.x) < ITEM_RANGE * 1.5;
  }

  /**
   * The best thing to pick up: loose objects first, then buried ones close
   * by. Prefers flints, and things that aren't right next to an enemy.
   */
  private nearestItem(c: Clonk, enemy: Clonk | null, skip: Set<Item>): Item | null {
    const { land } = this.world;
    // Forget old give-ups now and then: the ground changes.
    if (skip.size && this.world.rng.int(400) === 0) skip.clear();
    let best: Item | null = null;
    let bestD = Infinity;
    for (const item of this.world.items) {
      // A burning T-flint is best left alone.
      // Flags are for players to steal and sell; the computer leaves them be.
      if (item.container || item.removed || item.noCollect > 0 || item.lit || item.def.id === 'flag' || skip.has(item)) continue;
      if (Math.abs(item.xdir) + Math.abs(item.ydir) > 0.5) continue;
      const dx = Math.abs(item.x - c.x);
      const dy = item.y - c.y;
      const buried = land.isSolid(item.x, item.y);
      // Stuck in rock or gold: no way to dig it out.
      if (buried && !MATERIALS[land.get(item.x, item.y)].digFree) continue;
      if (dx > (buried ? DIG_RANGE : ITEM_RANGE) || dy < -60) continue;
      let d = dx + Math.abs(dy) * (buried ? 3 : 1.5);
      if (buried) d += 120;
      if (!item.def.explodeOnHit) d += 60;
      if (item.def.id === 'gold' || item.def.id === 'wood') d += 60;
      if (enemy && Math.abs(enemy.x - item.x) < 30) d += 80;
      // Leave it to a crew mate who's already going for it.
      for (const [o, m] of this.minds) if (o !== c && o.alive && m.item === item) d += 150;
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  /** True if an enemy's thrown object is flying at this clonk. */
  private incoming(c: Clonk): boolean {
    for (const item of this.world.items) {
      if (item.container || Math.abs(item.xdir) + Math.abs(item.ydir) < 2) continue;
      const dx = c.x - item.x;
      if (Math.abs(dx) > 50 || Math.abs(c.y - item.y) > 40 || Math.sign(dx) !== Math.sign(item.xdir)) continue;
      const by = this.world.clonks.find((o) => o.id === item.thrownBy);
      if (by && this.world.hostile(by.owner, c.owner)) return true;
    }
    return false;
  }

  /**
   * Work out where a throw would go right now (same speed and gravity as a
   * real throw), guessing that the target keeps going the way it's going.
   * Flints only count if they blow up away from the thrower; nothing counts
   * if it would hit the thrower's own crew first.
   */
  private throwHits(c: Clonk, t: Clonk): boolean {
    const { land } = this.world;
    const blast = c.carrying?.def.explodeOnHit ?? 0;
    const flint = blast > 0;
    let x = c.x;
    let y = c.y - 11;
    const vx = THROW_SPEED * c.dir;
    let vy = -THROW_SPEED;
    let hit = false;
    const inside = (o: { x: number; y: number }, px: number, py: number): boolean => {
      const dx = px - (o.x - CLONK.width / 2);
      const dy = py - (o.y - CLONK.height / 2);
      return dx >= 0 && dx < CLONK.width && dy >= 0 && dy < CLONK.height;
    };
    for (let i = 1; i <= THROW_TICKS; i++) {
      vy += land.gravity;
      x += vx;
      y += vy;
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px >= land.width || py >= land.height) return false;
      if (land.isSolid(px, py)) {
        if (!flint) return hit;
        const safe = Math.max(28, blast + 10);
        const away = Math.abs(px - c.x) > safe || Math.abs(py - c.y) > safe;
        const near = Math.abs(px - t.x) < 16 && Math.abs(py - t.y) < 18;
        return away && (hit || near);
      }
      const lead = Math.min(i, 24);
      const at = { x: t.x + t.xdir * lead, y: t.y + (t.action.procedure === 'flight' ? t.ydir * lead : 0) };
      if (inside(at, px, py)) hit = true;
      for (const o of this.world.clonks) {
        if (o !== c && o.owner === c.owner && o.alive && !o.contained && inside(o, px, py)) return false;
      }
      if (hit && !flint) return true;
    }
    return hit && !flint;
  }
}
