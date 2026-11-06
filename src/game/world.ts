import { Rng } from '../core/rng';
import type { GeneratedMap } from '../landscape/generate';
import type { Landscape } from '../landscape/landscape';
import { MATERIALS, type ItemId } from '../landscape/materials';
import { Clonk, NO_CONTROL, type ControlState } from '../objects/clonk';
import { ITEMS } from '../objects/defs';
import type { GameObject } from '../objects/gameObject';
import { Item } from '../objects/item';

export interface ExplosionEvent {
  type: 'explosion';
  x: number;
  y: number;
  radius: number;
  tick: number;
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
      c.control(controls.get(c.owner) ?? NO_CONTROL, {
        throwItem: (item, xdir, ydir) => throwItem(item, xdir, ydir, c),
      });
      c.tick(this.land);
      c.tryCollect(this.items, this.land);
    }

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
      const k = fling(c);
      if (k > 0.2) c.setAction('Tumble');
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
}
