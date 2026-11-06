import { Rng } from '../core/rng';
import type { GeneratedMap } from '../landscape/generate';
import type { Landscape } from '../landscape/landscape';
import { MATERIALS, type ItemId } from '../landscape/materials';
import { Clonk, NO_CONTROL, type ControlState } from '../objects/clonk';
import { BASE, CLONK, ITEMS, STRUCTURES } from '../objects/defs';
import type { GameObject } from '../objects/gameObject';
import { Item } from '../objects/item';
import { Structure } from '../objects/structure';

export interface ExplosionEvent {
  type: 'explosion';
  x: number;
  y: number;
  radius: number;
  tick: number;
}

/** Something to tell a player (bought, sold, can't afford...). The HUD drains these. */
export interface PlayerMessage {
  player: number;
  text: string;
  tick: number;
}

/** A player's money and what their home base has in stock to buy. */
export interface PlayerState {
  wealth: number;
  /** How many of each item the home base can sell. Only listed items appear in the buy menu. */
  stock: Partial<Record<ItemId, number>>;
}

/** Ticks a thrown or dropped item can't be picked straight back up. */
const NO_COLLECT_TICKS = 20;

/**
 * The whole game state. Advances in fixed ticks from player inputs only, so
 * the same seed and inputs always give the same result.
 */
export class World {
  readonly clonks: Clonk[] = [];
  items: Item[] = [];
  readonly structures: Structure[] = [];
  readonly players = new Map<number, PlayerState>();
  readonly messages: PlayerMessage[] = [];
  tick = 0;
  /** Things that happened this tick, for effects and sound. The renderer drains it. */
  readonly events: ExplosionEvent[] = [];

  constructor(
    readonly land: Landscape,
    readonly rng: Rng,
  ) {}

  static fromMap(map: GeneratedMap, seed: number): World {
    const world = new World(map.land, new Rng(seed ^ 0x5eed));
    for (const it of map.items) world.spawnItem(it.id, it.x, it.y);
    return world;
  }

  addClonk(x: number, y: number, owner: number): Clonk {
    const c = new Clonk(x, y, owner);
    this.clonks.push(c);
    return c;
  }

  addPlayer(id: number, start: Partial<PlayerState> = {}): PlayerState {
    const p: PlayerState = { wealth: start.wealth ?? 0, stock: { ...start.stock } };
    this.players.set(id, p);
    return p;
  }

  /** Put up a building centred on (x, y). Give a player to plant their flag on it. */
  addStructure(id: string, x: number, y: number, base = -1): Structure {
    const s = new Structure(STRUCTURES[id], x, y);
    if (base >= 0 && s.def.canBeBase) s.base = base;
    this.structures.push(s);
    return s;
  }

  spawnItem(id: ItemId, x: number, y: number, xdir = 0, ydir = 0, rdir = 0): Item {
    const item = new Item(ITEMS[id], x, y);
    item.xdir = xdir;
    item.ydir = ydir;
    item.rdir = rdir;
    this.items.push(item);
    return item;
  }

  /** Advance one tick. `controls` maps a clonk's owner to that player's input. */
  step(controls: ReadonlyMap<number, ControlState>): void {
    const throwItem = (item: Item, xdir: number, ydir: number, by: Clonk): void => {
      item.container = null;
      item.xdir = xdir;
      item.ydir = ydir;
      item.rdir = xdir === 0 ? 0 : 1 + this.rng.int(3);
      item.noCollect = NO_COLLECT_TICKS;
      item.thrownBy = by.owner;
    };

    for (const c of this.clonks) {
      const ctl = controls.get(c.owner) ?? NO_CONTROL;
      if (c.contained) {
        if (c.alive) this.containedControl(c, ctl);
        continue;
      }
      c.control(ctl, {
        throwItem: (item, xdir, ydir) => throwItem(item, xdir, ydir, c),
        tryEnter: () => this.tryEnter(c),
      });
      if (c.contained) continue;
      c.tick(this.land);
      c.tryCollect(this.items, this.land);
    }

    if (this.tick % BASE.healInterval === 0) for (const c of this.clonks) this.healInBase(c);
    for (const s of this.structures) s.tick();

    for (const item of this.items) {
      if (item.container || item.removed) continue;
      const hit = item.tick(this.land);
      if (hit && item.def.explodeOnHit) {
        item.removed = true;
        this.explode(item.x, item.y, item.def.explodeOnHit);
      }
    }
    if (this.items.some((i) => i.removed)) this.items = this.items.filter((i) => !i.removed);

    this.land.step(this.tick, this.rng);
    this.tick++;
  }

  /**
   * Blast a hole. Rock and gold veins break into rocks and gold nuggets
   * (one per 75 blasted pixels, like the original), and nearby objects get flung.
   */
  explode(x: number, y: number, radius: number): void {
    this.events.push({ type: 'explosion', x, y, radius, tick: this.tick });

    // Fling everything nearby away from the blast.
    const reach = radius + 8;
    const fling = (o: GameObject): number => {
      const dx = o.x - x;
      const dy = o.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) return 0;
      const d = Math.sqrt(d2) || 1;
      const k = (reach - d) / reach;
      o.xdir += (dx / d) * 3 * k;
      o.ydir += (dy / d) * 3 * k - 1.5 * k;
      return k;
    };
    for (const c of this.clonks) {
      if (c.contained) continue;
      this.blastDamage(c, x, y, radius);
      const k = fling(c);
      if (k > 0.2 && c.alive) c.setAction('Tumble');
    }
    for (const item of this.items) if (!item.container && !item.removed) fling(item);

    const counts = this.land.blast(x, y, radius, this.rng);
    for (const [mat, count] of counts) {
      const m = MATERIALS[mat];
      if (!m.blast2Object || !m.blast2ObjectRatio) continue;
      const n = Math.floor(count / m.blast2ObjectRatio);
      for (let i = 0; i < n; i++) {
        this.spawnItem(
          m.blast2Object,
          x,
          y,
          (this.rng.int(61) - 30) / 10,
          (this.rng.int(61) - 40) / 10,
          this.rng.int(3) + 1,
        );
      }
    }
  }

  /**
   * Blast damage to a clonk, as in C4Game::BlastObjects: a direct hit (within
   * 5 px of its shape) costs level/3 energy, the shock wave (within `level` px)
   * another level/2.
   */
  private blastDamage(c: Clonk, x: number, y: number, level: number): void {
    if (!c.alive) return;
    const left = c.x - CLONK.width / 2;
    const top = c.y - CLONK.height / 2;
    let points = 0;
    if (y - top >= -5 && y - top <= CLONK.height - 1 + 10 && x - left >= -5 && x - left <= CLONK.width - 1 + 10) {
      points += Math.trunc(level / 3);
    }
    if (Math.abs(y - c.y) <= level && Math.abs(x - c.x) <= level) points += Math.trunc(level / 2);
    if (points && c.doEnergy(-points)) this.dropAll(c);
  }

  private dropAll(c: Clonk): void {
    for (const item of c.contents.splice(0)) {
      item.setPosition(c.x, c.y);
      item.container = null;
      item.noCollect = NO_COLLECT_TICKS;
    }
  }

  private say(player: number, text: string): void {
    this.messages.push({ player, text, tick: this.tick });
  }

  /** The building whose door a clonk is standing in. */
  structureAt(c: Clonk): Structure | undefined {
    return this.structures.find((s) => s.atEntrance(c.x, c.y));
  }

  /** True if the clonk is inside its own player's home base. */
  inOwnBase(c: Clonk): boolean {
    return !!c.contained && c.contained.base === c.owner;
  }

  /** Up in a doorway goes in (ObjectComUp: enter beats jumping). */
  private tryEnter(c: Clonk): boolean {
    const s = this.structureAt(c);
    if (!s) return false;
    c.contained = s;
    c.menu = null;
    c.comDir = { x: 0, y: 0 };
    c.xdir = c.ydir = 0;
    c.setPosition(s.x, s.y);
    s.openDoor();
    // A home base buys any gold that's carried in (BASEFUNC_AutoSellContents).
    if (s.base === c.owner) {
      for (const item of [...c.contents]) if (item.def.id === 'gold') this.sell(c, item);
    }
    return true;
  }

  private exit(c: Clonk): void {
    const s = c.contained;
    if (!s) return;
    const p = s.exitPoint();
    c.contained = null;
    c.menu = null;
    c.setPosition(p.x, p.y);
    c.setAction('Walk', 0, 0);
    s.openDoor();
  }

  /**
   * Controls while inside a building, like C4Object::ContainedControl:
   * down leaves, up opens the buy menu in your own base, throw sells what you carry.
   * In the buy menu: left/right choose, up or throw buys, down closes it.
   */
  private containedControl(c: Clonk, ctl: ControlState): void {
    const own = this.inOwnBase(c);
    if (c.menu !== null) {
      const list = this.shopList(c.owner);
      if (!own || list.length === 0) {
        c.menu = null;
        return;
      }
      if (ctl.pressedLeft) c.menu = (c.menu + list.length - 1) % list.length;
      if (ctl.pressedRight) c.menu = (c.menu + 1) % list.length;
      c.menu = Math.min(c.menu, list.length - 1);
      if (ctl.pressedUp || ctl.pressedThrow) this.buy(c, list[c.menu]);
      else if (ctl.pressedDown) c.menu = null;
      return;
    }
    if (ctl.pressedDown) this.exit(c);
    else if (ctl.pressedUp) {
      if (!own) this.say(c.owner, c.contained!.hasFlag ? 'Not your base' : 'No flag here: nothing to buy');
      else if (this.shopList(c.owner).length === 0) this.say(c.owner, 'Nothing to buy');
      else c.menu = 0;
    } else if (ctl.pressedThrow) {
      const item = c.carrying;
      if (!item) return;
      if (own) this.sell(c, item);
      else this.say(c.owner, 'Sell things in a building with your flag');
    }
  }

  /** Items the player's home base can sell, in a fixed order. */
  shopList(player: number): ItemId[] {
    const p = this.players.get(player);
    return p ? (Object.keys(p.stock) as ItemId[]) : [];
  }

  private sell(c: Clonk, item: Item): void {
    const p = this.players.get(c.owner);
    if (!p) return;
    const i = c.contents.indexOf(item);
    if (i >= 0) c.contents.splice(i, 1);
    item.removed = true;
    p.wealth = Math.min(BASE.maxWealth, p.wealth + item.def.value);
    if (item.def.rebuy) p.stock[item.def.id] = (p.stock[item.def.id] ?? 0) + 1;
    this.say(c.owner, `Sold ${item.def.name} for ${item.def.value} gold`);
  }

  private buy(c: Clonk, id: ItemId): void {
    const p = this.players.get(c.owner);
    if (!p) return;
    const def = ITEMS[id];
    if ((p.stock[id] ?? 0) <= 0) return this.say(c.owner, `No ${def.name} left`);
    if (p.wealth < def.value) return this.say(c.owner, `Not enough gold for ${def.name}`);
    if (c.contents.length >= CLONK.maxContents) return this.say(c.owner, 'Hands full: sell or drop it first');
    p.wealth -= def.value;
    p.stock[id]! -= 1;
    const item = this.spawnItem(id, c.x, c.y);
    item.container = c;
    c.contents.push(item);
    this.say(c.owner, `Bought ${def.name} for ${def.value} gold`);
  }

  /**
   * Energy reload in a home base (C4Object::ExecLife): every 3 ticks a clonk
   * inside its own base gets up to 2 points from the base's energy store. When
   * the store is empty the base buys 100 points for 5 of its owner's gold.
   */
  private healInBase(c: Clonk): void {
    const s = c.contained;
    if (!s || !c.alive || s.base !== c.owner || c.energy >= CLONK.energy) return;
    if (s.energy <= 0) {
      const p = this.players.get(s.base);
      if (p && p.wealth >= BASE.regenerateEnergyPrice) {
        p.wealth -= BASE.regenerateEnergyPrice;
        s.energy = Math.min(s.def.energy, s.energy + 100 * 1000);
      }
    }
    const transfer = Math.min(BASE.healTransfer, s.energy, CLONK.energy - c.energy);
    if (transfer <= 0) return;
    s.energy -= transfer;
    c.doEnergy(transfer, true);
  }
}
