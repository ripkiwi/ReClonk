import { Rng } from '../core/rng';
import type { GeneratedMap } from '../landscape/generate';
import type { Landscape } from '../landscape/landscape';
import { MATERIALS, type ItemId } from '../landscape/materials';
import { Clonk, NO_CONTROL, type ControlState, type CrewCommand, type CrewInfo } from '../objects/clonk';
import { BASE, BASEMENT, BUILD_PLANS, CLONK, CLONK_KINDS, ITEMS, STRUCTURES, type ClonkKind } from '../objects/defs';
import type { GameObject } from '../objects/gameObject';
import { Item } from '../objects/item';
import { contactCheck, HIT_SPEED_2 } from '../objects/physics';
import { Structure } from '../objects/structure';
import { findPlantSpot, FULL_CON, grassRooted, Plant, plantRooted, PLANTS, TREE, type Grass } from '../objects/vegetation';
import { FIRE } from '../objects/fire';
import { blastBurn, stepFire } from './fire';
import { blastIgnite, igniteOil, stepLiquids, type OilFlame } from './liquids';
import { buildStep, construct, grabOrBuild, grabTarget, pushControl, siteProblem, stepElevator, stepGate } from './buildings';
import { Vehicle, VEHICLES, type VehicleId } from '../objects/vehicle';
import { grabVehicle, stepVehicle, takeOut, vehicleAt, vehicleBottom, vehicleControl } from './vehicles';
import { MagicState, openSpellMenu, spellList, startSpell, stepMagic, stepSorcerer, type SpellId } from './magic';
import { stepRules, takeFlag, type RuleId } from './rules';
import type { Weather } from './weather';

export type WorldEvent =
  | { type: 'explosion'; x: number; y: number; radius: number; tick: number }
  | { type: 'promotion'; clonk: Clonk; rank: number; tick: number }
  | { type: 'collect'; clonk: Clonk; item: Item; tick: number }
  | { type: 'throw'; clonk: Clonk; tick: number }
  /** A bought clonk joined the crew in the field. */
  | { type: 'recruit'; clonk: Clonk; tick: number }
  /** A flying object hit a clonk. */
  | { type: 'hit'; clonk: Clonk; points: number; tick: number }
  /** A clonk swung a punch in a fist fight (it lands half the time). */
  | { type: 'swing'; clonk: Clonk; tick: number }
  /** A punch landed in a fist fight. */
  | { type: 'punch'; clonk: Clonk; target: Clonk; tick: number }
  /** A clonk died; `killer` is the enemy clonk credited with it. */
  | { type: 'death'; clonk: Clonk; killer: Clonk | null; tick: number }
  /** A player has no clonk left standing (last crew standing). */
  | { type: 'eliminated'; player: number; tick: number }
  /** The round's goal is decided: `winner` is the last player standing, or -1 if nobody is. */
  | { type: 'gameOver'; winner: number; tick: number }
  /** A construction site went up, is being worked on (every second), or is finished. */
  | { type: 'construct' | 'building' | 'built'; structure: Structure; tick: number }
  /** A guard tower gate starts moving, an elevator case rides on, something was switched. */
  | { type: 'gate' | 'elevator' | 'click'; x: number; y: number; tick: number }
  /** A clonk took hold of a vehicle or let go of it. */
  | { type: 'grab'; x: number; y: number; tick: number }
  /** A vehicle made a sound: the sail going up or down, the blimp's propeller, something going into the lorry. */
  | { type: 'vehicle'; sound: 'SailUp' | 'SailDown' | 'Propel' | 'Clonk' | 'WoodHit1' | 'WoodHit2' | 'WoodHit3'; x: number; y: number; tick: number }
  /** A lightning bolt came down with a clap of thunder. */
  | { type: 'thunder'; x: number; y: number; tick: number }
  /** A T-flint's fuse was lit. */
  | { type: 'fuse'; x: number; y: number; tick: number }
  /** Something landed hard: a rock, a nugget, wood. */
  | { type: 'itemHit'; item: Item; tick: number }
  /** A clonk's axe bit into a tree. */
  | { type: 'chop'; clonk: Clonk; tick: number }
  /** A tree was felled and tips over. */
  | { type: 'treeDown'; plant: Plant; tick: number }
  /** A blast blew a tuft of grass away. */
  | { type: 'grassBlown'; grass: Grass; x: number; y: number; level: number; tick: number }
  /** Something caught fire; big things with a whoosh (the Inflame sound). */
  | { type: 'inflame'; x: number; y: number; loud: boolean; tick: number }
  /** A fire went out; in water with a hiss (Pshshsh). */
  | { type: 'extinguish'; x: number; y: number; hiss: boolean; tick: number }
  /** A sorcerer's spell went off. */
  | { type: 'magic'; clonk: Clonk; spell: SpellId; tick: number }
  /** A sorcerer took in magic energy, from a crystal or a bolt of lightning. */
  | { type: 'charge'; clonk: Clonk; points: number; tick: number }
  /** A fireball left a flame behind. */
  | { type: 'flame'; x: number; y: number; tick: number }
  /** A flag went up on a building: it's now `player`'s home base (the Trumpet). */
  | { type: 'newBase'; structure: Structure; player: number; tick: number }
  /** Lava and water boiled each other away (Pshshsh, smoke). */
  | { type: 'poof'; x: number; y: number; tick: number }
  /** Acid ate a pixel (smoke, now and then the Corrode sound). */
  | { type: 'corrode'; x: number; y: number; tick: number }
  /** A volcano broke out of the ground, or threw out lava. */
  | { type: 'volcano'; x: number; y: number; tick: number };

/** Extra experience on top of the original's "1 per 5 commands", so promotions come at a fun pace. */
export const EXPERIENCE = {
  /** Picking up a gold nugget for the first time. */
  goldFound: 20,
  /** Each rock or nugget broken loose by a flint you threw. */
  blastedLoose: 2,
};

/** Something to tell a player (bought, sold, can't afford...). The HUD drains these. */
export interface PlayerMessage {
  player: number;
  text: string;
  tick: number;
}

/** What a home base can sell: items, vehicles, and clonks for the crew. */
export type ShopId = ItemId | VehicleId | ClonkKind;

export function isVehicleId(id: string): id is VehicleId {
  return id in VEHICLES;
}

/** True for the clonks a base sells. */
export function isCrewId(id: ShopId): id is ClonkKind {
  return id in CLONK_KINDS;
}

/** Name and price of something in the shop. */
export function shopEntry(id: ShopId): { name: string; value: number } {
  return isCrewId(id) ? CLONK_KINDS[id] : isVehicleId(id) ? VEHICLES[id] : ITEMS[id];
}

/** A player's money and what their home base has in stock to buy. */
export interface PlayerState {
  wealth: number;
  /** How many of each thing the home base can sell. Only listed ones appear in the buy menu. */
  stock: Partial<Record<ShopId, number>>;
}

/**
 * Which of a player's clonks follow the controls, like the original's crew
 * cursor: the leader (camera and HUD follow it) and everyone selected with it.
 */
export interface CrewCursor {
  leader: Clonk | null;
  selected: Set<Clonk>;
}

/** Ticks a thrown or dropped item can't be picked straight back up. */
const NO_COLLECT_TICKS = 20;
/**
 * Damage from flying objects, times the original's. The original's rocks
 * barely scratch; three times as much makes a good throw count.
 */
export const HIT_DAMAGE = 3;

/** How a round is won. 'melee': the last crew standing wins (the original's Melee goal). */
export type Goal = 'none' | 'melee';

/** Controls for a computer player's clonks, one clonk at a time. */
export interface Brain {
  control(c: Clonk): ControlState;
}

/**
 * The whole game state. Advances in fixed ticks from player inputs only, so
 * the same seed and inputs always give the same result.
 */
export class World {
  readonly clonks: Clonk[] = [];
  items: Item[] = [];
  readonly structures: Structure[] = [];
  /** Boats, balloons, blimps and lorries. */
  vehicles: Vehicle[] = [];
  /** Trees and bushes, standing or felled. */
  plants: Plant[] = [];
  /** Tufts of grass, drawn only. */
  grass: Grass[] = [];
  /** Flames on burning oil. */
  flames: OilFlame[] = [];
  readonly players = new Map<number, PlayerState>();
  private readonly cursors = new Map<number, CrewCursor>();
  readonly messages: PlayerMessage[] = [];
  /**
   * Who joins when a player buys a clonk: their best idle crew member or a new
   * recruit. Set by the round, which knows the player's crew. Without it,
   * bought clonks have no name or rank.
   */
  recruit: ((player: number, kind: ClonkKind) => CrewInfo | null) | null = null;
  /** Computer players, by player number. Their clonks follow these instead of the controls. */
  readonly brains = new Map<number, Brain>();
  goal: Goal = 'none';
  /** Players whose crews were wiped out. */
  readonly eliminated = new Set<number>();
  /** Set when the goal is decided: the winning player, or -1 if nobody is left. */
  winner: number | null = null;
  private readonly deaths = new Set<Clonk>();
  /** Spells and their effects: heals, force bridges, fireballs, bolts. */
  readonly magic = new MagicState();
  /** The spells sorcerers can cast (Scenario.txt Magic). None named means all of them. */
  spells: SpellId[] = [];
  /** The scenario's rules (Scenario.txt Rules). */
  readonly rules = new Set<RuleId>();
  /** Each player's captain, for the Kill The Captain rule. */
  readonly captains = new Map<number, Clonk>();
  tick = 0;
  /** Seasons, wind, rain and disasters; null plays without weather (tests). */
  weather: Weather | null = null;
  /** Things that happened this tick, for effects and sound. The renderer drains it. */
  readonly events: WorldEvent[] = [];

  constructor(
    readonly land: Landscape,
    readonly rng: Rng,
  ) {
    land.ignite = (x, y) => igniteOil(this, x, y);
  }

  static fromMap(map: GeneratedMap, seed: number): World {
    const world = new World(map.land, new Rng(seed ^ 0x5eed));
    for (const it of map.items) world.spawnItem(it.id, it.x, it.y);
    for (const p of map.plants) world.addPlant(PLANTS[p.id].id, p.x, p.bottom, p.con, p.dir);
    world.grass = map.grass.map((g) => ({ ...g }));
    return world;
  }

  addPlant(id: keyof typeof PLANTS, x: number, bottom: number, con = FULL_CON, dir: -1 | 1 = 1): Plant {
    const p = new Plant(PLANTS[id], x, bottom, con, dir, this.rng);
    this.plants.push(p);
    return p;
  }

  /** Take away the trees and grass a building put up at the start would stand in. */
  clearPlants(s: Structure): void {
    const l = s.left - 4;
    const r = s.left + s.def.width + 4;
    const b = s.top + s.def.height + 10;
    for (const p of this.plants) {
      const sh = p.shape;
      if (sh.x < r && sh.x + sh.w > l && sh.y < b && p.bottom > s.top) p.removed = true;
    }
    for (const g of this.grass) if (g.x > l && g.x < r && g.y > s.top && g.y < b) g.removed = true;
    this.plants = this.plants.filter((p) => !p.removed);
    this.grass = this.grass.filter((g) => !g.removed);
  }

  /** The tree or felled tree a clonk standing here could chop (Clonk.c4d FindTree, Find_AtPoint). */
  choppableAt(c: Clonk): Plant | null {
    for (const p of this.plants) if (!p.removed && p.isAt(c.x, c.y)) return p;
    return null;
  }

  addClonk(x: number, y: number, owner: number, kind: ClonkKind = 'clonk'): Clonk {
    const c = new Clonk(x, y, owner, kind);
    this.clonks.push(c);
    return c;
  }

  /** A player's clonks, in the order they joined the round (the crew bar order). */
  crewOf(player: number): Clonk[] {
    return this.clonks.filter((c) => c.owner === player);
  }

  /** Players fight each other: every player is an enemy of every other one, like in a melee. */
  hostile(a: number, b: number): boolean {
    return a !== b && a >= 0 && b >= 0;
  }

  /** The player's crew cursor, kept valid: a living leader that's always selected. */
  cursor(player: number): CrewCursor {
    let cur = this.cursors.get(player);
    if (!cur) {
      cur = { leader: null, selected: new Set() };
      this.cursors.set(player, cur);
    }
    for (const c of cur.selected) if (!c.alive) cur.selected.delete(c);
    if (!cur.leader?.alive) {
      // The leader died: pass on to the next living clonk, like the original's cursor.
      const crew = this.crewOf(player);
      const from = cur.leader ? crew.indexOf(cur.leader) : -1;
      const next = [...crew.slice(from + 1), ...crew.slice(0, from + 1)].find((c) => c.alive) ?? null;
      cur.leader = next;
      if (next && cur.selected.size === 0) cur.selected.add(next);
    }
    if (cur.leader) cur.selected.add(cur.leader);
    return cur;
  }

  /** Change which clonks follow a player's controls. */
  crewCommand(player: number, cmd: CrewCommand): void {
    const cur = this.cursor(player);
    const crew = this.crewOf(player);
    const alive = crew.filter((c) => c.alive);
    if (!alive.length) return;
    const only = (c: Clonk): void => {
      for (const s of cur.selected) if (s !== c) s.release();
      cur.leader = c;
      cur.selected = new Set([c]);
    };
    switch (cmd.type) {
      case 'next':
      case 'prev': {
        const i = cur.leader ? alive.indexOf(cur.leader) : -1;
        const step = cmd.type === 'next' ? 1 : -1;
        only(alive[(i + step + alive.length) % alive.length]);
        break;
      }
      case 'pick': {
        const c = crew[cmd.index];
        if (c?.alive) only(c);
        break;
      }
      case 'toggle': {
        const c = crew[cmd.index];
        if (!c?.alive || c === cur.leader) break;
        if (cur.selected.has(c)) {
          cur.selected.delete(c);
          c.release();
        } else cur.selected.add(c);
        break;
      }
      case 'all':
        cur.selected = new Set(alive);
        break;
    }
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
    s.owner = base;
    this.structures.push(s);
    return s;
  }

  /** Put a vehicle in the world, centred on (x, y). */
  addVehicle(id: VehicleId, x: number, y: number, owner = -1): Vehicle {
    const v = new Vehicle(VEHICLES[id], x, y);
    v.owner = owner;
    this.vehicles.push(v);
    return v;
  }

  spawnItem(id: ItemId, x: number, y: number, xdir = 0, ydir = 0, rdir = 0): Item {
    const item = new Item(ITEMS[id], x, y);
    item.xdir = xdir;
    item.ydir = ydir;
    item.rdir = rdir;
    this.items.push(item);
    return item;
  }

  /** Put a new item straight into a clonk's hands, if it has room. */
  give(c: Clonk, id: ItemId): Item | undefined {
    if (c.contents.length >= CLONK.maxContents) return undefined;
    const item = this.spawnItem(id, c.x, c.y);
    item.container = c;
    c.contents.push(item);
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
      item.thrownBy = by.id;
    };

    // Crew commands first, so a newly picked clonk gets this tick's controls.
    for (const [player, ctrl] of controls) {
      if (ctrl.crew) this.crewCommand(player, ctrl.crew);
      const cur = this.cursor(player);
      const leader = cur.leader;
      // Commands count for the leader (the original's cursor clonk).
      if (leader && leader.countCommands(ctrl.commands)) this.promoted(leader);
      // With a group selected, down (or stop twice in classic) gathers it at the leader.
      const gather = leader?.controlStyle === 'classic' ? ctrl.doubleDown : ctrl.pressedDown;
      // Down at a building means working it, not gathering.
      if (leader && gather && cur.selected.size > 1 && leader.action.procedure === 'walk' && !grabTarget(this, leader) && !vehicleAt(this, leader)) {
        for (const c of cur.selected) {
          if (c === leader || c.contained) continue;
          if (c.action.procedure === 'push' || c.action.procedure === 'build') c.letGo();
          c.walkTo(leader.x);
        }
      }
    }

    for (const c of this.clonks) {
      const brain = this.brains.get(c.owner);
      const ctrl = controls.get(c.owner);
      // Only selected clonks follow the controls. The others carry on with
      // what they were doing, or walk over to the leader. A computer player
      // steers each of its clonks.
      const mine = brain ? (c.alive ? brain.control(c) : null) : ctrl && this.cursor(c.owner).selected.has(c) ? ctrl : null;
      if (c.contained) {
        if (c.alive && mine) this.containedControl(c, mine);
        continue;
      }
      const carried = c.carrying;
      // Whether a dig might be the first press of a double dig at a tree.
      if (mine) c.atTree = c.action.procedure === 'walk' && !!this.choppableAt(c);
      if (mine && c.buildMenu !== null) this.buildMenuControl(c, mine);
      else if (mine && c.spellMenu !== null) this.spellMenuControl(c, mine);
      else if (mine?.pressedMagic && c.buildMenu === null && openSpellMenu(this, c)) {
        // The spell menu is open, or the clonk said why not.
      } else if (mine && c.alive && c.action.procedure === 'push' && c.vehicle) {
        vehicleControl(
          this,
          c,
          mine,
          () => c.control({ ...NO_CONTROL, pressedThrow: true }, { throwItem: (item, xdir, ydir) => throwItem(item, xdir, ydir, c), tryEnter: () => false, useItem: () => false, grabOrBuild: () => false }),
          () => this.pushEnter(c),
        );
      } else if (mine && c.alive && c.action.procedure === 'push') pushControl(this, c, mine);
      else if (mine || c.goTo !== null) {
        // Moving on stops building.
        if (mine && (c.action.procedure === 'build' || c.action.procedure === 'chop') && stopsWork(mine)) c.letGo();
        c.control(mine ?? NO_CONTROL, {
          throwItem: (item, xdir, ydir) => throwItem(item, xdir, ydir, c),
          tryEnter: () => this.tryEnter(c),
          useItem: () => this.useItem(c),
          grabOrBuild: () => grabVehicle(this, c) || grabOrBuild(this, c),
        });
      }
      if (c.contained || this.fellOut(c)) continue;
      if (carried && !c.carrying) this.events.push({ type: 'throw', clonk: c, tick: this.tick });
      c.tick(this.land);
      if (c.action.procedure === 'fight') this.fighting(c);
      if (c.action.procedure === 'build') buildStep(this, c);
      if (c.action.procedure === 'chop') this.chopStep(c);
      if (c.buildMenu !== null && (c.action.procedure !== 'walk' || c.carrying?.def.id !== 'conkit')) c.buildMenu = null;
      if (c.spellMenu !== null && !c.readyToMagic) c.spellMenu = null;
      stepSorcerer(this, c);
      const got = c.tryCollect(this.items, this.land) ?? takeFlag(this, c);
      if (got) {
        this.events.push({ type: 'collect', clonk: c, item: got, tick: this.tick });
        if (got.def.id === 'gold' && !got.found) {
          got.found = true;
          if (c.doExperience(EXPERIENCE.goldFound)) this.promoted(c);
        }
      }
    }

    for (const v of this.vehicles) {
      if (v.removed) continue;
      if (v.contained) {
        // Pushed into a building: it comes back out with whoever pushes it, or by itself if they're gone.
        if (!this.clonks.some((c) => c.vehicle === v && c.contained === v.contained && c.alive)) this.pushOut(v);
        continue;
      }
      if (this.fellOut(v)) {
        this.removeVehicle(v);
        continue;
      }
      stepVehicle(this, v);
    }

    // Hostile clonks that run into each other start a fist fight (checked every 5 ticks, like the original).
    if (this.tick % 5 === 0) this.startFights();

    if (this.tick % BASE.healInterval === 0) for (const c of this.clonks) this.healInBase(c);
    for (const s of this.structures) {
      if (s.gone) continue;
      s.tick();
      if (s.liftCase) stepElevator(this, s);
      for (const g of s.gates) stepGate(this, g);
    }
    // The guard tower's door has shut behind them: out onto the roof (DoorClosed).
    for (const c of this.clonks) {
      const s = c.contained;
      if (s?.def.exitTo && s.door === 0) this.exitTo(c, s.x + s.def.exitTo.x, s.y + s.def.exitTo.y);
    }

    // Lit T-flints burn down wherever they are, in hands too.
    for (const item of this.items) {
      if (item.removed || !item.lit) continue;
      if (--item.fuse <= 0) this.blowUp(item);
    }
    for (const item of this.items) {
      if (item.container || item.removed) continue;
      if (this.fellOut(item)) {
        item.removed = true;
        continue;
      }
      const hit = item.tick(this.land);
      if (hit && !item.def.explodeOnHit) this.events.push({ type: 'itemHit', item, tick: this.tick });
      // A T-flint lights on impact (TFlint.c4d Hit).
      if (hit && item.light()) this.events.push({ type: 'fuse', x: item.x, y: item.y, tick: this.tick });
      if (hit && item.def.explodeOnHit) {
        item.removed = true;
        const by = this.thrower(item);
        const level = item.def.explodeOnHit + (item.def.explodeRandom ? this.rng.int(item.def.explodeRandom) : 0);
        const freed = this.explode(item.x, item.y, level, by);
        if (by && freed && by.doExperience(freed * EXPERIENCE.blastedLoose)) this.promoted(by);
      }
    }
    if (this.items.some((i) => i.removed)) this.items = this.items.filter((i) => !i.removed);
    this.objectHits();

    this.stepPlants();
    stepFire(this);
    stepLiquids(this);
    if (this.items.some((i) => i.removed)) this.items = this.items.filter((i) => !i.removed);
    for (const v of this.vehicles) if (v.removed) this.removeVehicle(v);
    if (this.vehicles.some((v) => v.removed)) this.vehicles = this.vehicles.filter((v) => !v.removed);
    if (this.plants.some((p) => p.removed)) this.plants = this.plants.filter((p) => !p.removed);
    this.weather?.step(this);
    stepMagic(this);
    this.land.pxs.step(this.rng);
    this.land.step(this.tick, this.rng);
    stepRules(this);
    for (const fx of this.land.fx) this.events.push({ type: fx.type, x: fx.x, y: fx.y, tick: this.tick });
    this.land.fx.length = 0;
    this.afterDeaths();
    this.tick++;
  }

  /**
   * With an open bottom, whatever falls out of the map is gone, like in the
   * original: a clonk dies (the last enemy who hurt it gets the kill).
   */
  private fellOut(o: Clonk | Item | Vehicle): boolean {
    if (!this.land.bottomOpen || o.y < this.land.height + 20) return false;
    if (o instanceof Clonk && o.alive) this.hurt(o, 1e6, null);
    return true;
  }

  /** Take a vehicle out of the world: its floor goes, and whoever held on lets go. */
  removeVehicle(v: Vehicle): void {
    v.removed = true;
    for (const it of v.contents) it.removed = true;
    v.contents.length = 0;
    v.mask?.remove(this.land);
    v.mask = null;
    for (const c of this.clonks) if (c.vehicle === v) c.letGo();
  }

  /** The clonk that threw an item last, if it's still around. */
  private thrower(item: Item): Clonk | null {
    return item.thrownBy < 0 ? null : (this.clonks.find((c) => c.id === item.thrownBy) ?? null);
  }

  /**
   * Hurt a clonk by `points` and remember who did it, for the kill. Like the
   * original, hurting yourself doesn't take the credit away from an enemy.
   */
  hurt(c: Clonk, points: number, by: Clonk | null): void {
    if (!c.alive) return;
    if (by && (by.owner !== c.owner || !c.lastHurtBy)) c.lastHurtBy = by;
    if (points > 0) c.doEnergy(-points);
  }

  /**
   * Flying objects hit the clonks they pass through (C4GameObjects::CrossCheck):
   * damage grows with the speed between the two and the object's weight, and
   * the clonk gets flung the way the object flies. An object that's still
   * inside a clonk next tick hits again, so a lucky arc can hit many times.
   */
  private objectHits(): void {
    for (const item of this.items) {
      if (item.container || item.removed) continue;
      if (Math.abs(item.xdir) + Math.abs(item.ydir) < HIT_SPEED_2) continue;
      for (const c of this.clonks) {
        if (!c.alive || c.contained) continue;
        // Just thrown: it can't hit the thrower, who may be jumping up after it.
        if (item.noCollect > 0 && item.thrownBy === c.id) continue;
        const dx = item.x - (c.x - CLONK.width / 2);
        const dy = item.y - (c.y - CLONK.height / 2);
        if (dx < 0 || dx >= CLONK.width || dy < 0 || dy >= CLONK.height) continue;
        const rx = item.xdir - c.xdir;
        const ry = item.ydir - c.ydir;
        let energy = Math.round(((rx * rx + ry * ry) * item.def.mass) / 5);
        energy = Math.max(Math.trunc(energy / 3), energy ? 1 : 0);
        const points = Math.trunc(energy / 5) * HIT_DAMAGE;
        this.hurt(c, points, this.thrower(item));
        this.events.push({ type: 'hit', clonk: c, points, tick: this.tick });
        // Flying clonks only get flung again every third tick.
        if (c.alive && (this.tick % 3 === 0 || c.action.procedure !== 'flight')) {
          const k = 50 / Math.max(CLONK.mass, 50);
          c.fling(item.xdir * k, -Math.abs(item.ydir / 2) * k);
        }
      }
    }
  }

  /** Every 5 ticks: a clonk standing in a hostile clonk starts a fist fight with it (OCF_FightReady). */
  private startFights(): void {
    // Nobody fights while swimming.
    const ready = (c: Clonk): boolean => c.alive && !c.contained && !c.action.disabled && c.action.procedure !== 'swim';
    for (const a of this.clonks) {
      if (!ready(a)) continue;
      for (const b of this.clonks) {
        if (b === a || !ready(b) || !this.hostile(a.owner, b.owner)) continue;
        const dx = a.x - (b.x - CLONK.width / 2);
        const dy = a.y - (b.y - CLONK.height / 2);
        if (dx < 0 || dx >= CLONK.width || dy < 0 || dy >= CLONK.height) continue;
        a.startFight(b);
        b.startFight(a);
        this.fightStart(a);
        this.fightStart(b);
        break;
      }
    }
  }

  /** The fight's dice (the Clonk script's Fighting and Punching) and its training. */
  private fighting(c: Clonk): void {
    const target = c.fightTarget;
    if (!target) return;
    if (c.actionEnded === 'Punch') {
      this.events.push({ type: 'swing', clonk: c, tick: this.tick });
      if (this.rng.int(2) === 0) this.punch(c, target);
    }
    if (c.action.name === 'Fight' && c.actionStarted) this.fightStart(c);
    // Fighting trains: 2 experience every 35 ticks.
    if (this.tick % 35 === 0 && c.doExperience(2)) this.promoted(c);
  }

  /** Each round of a fight: half the time the clonk swings a punch. */
  private fightStart(c: Clonk): void {
    if (c.action.name === 'Fight' && this.rng.int(2) === 0) c.setAction('Punch');
  }

  /**
   * A punch lands (ObjectComPunch): 5 points between equals, more for the
   * stronger fighter, up to 10, which knocks the other one over.
   */
  private punch(c: Clonk, target: Clonk): void {
    if (!target.alive || target.action.procedure !== 'fight') return;
    const punch = Math.max(0, Math.min(10, Math.trunc((5 * c.fight) / target.fight)));
    if (!punch) return;
    this.hurt(target, punch, c);
    this.events.push({ type: 'punch', clonk: c, target, tick: this.tick });
    if (!target.alive) return;
    target.comDir = { x: 0, y: 0 };
    if (punch >= 10) target.fling(1.5 * c.dir, -2);
    else target.setAction('GetPunched', 2.5 * c.dir, 0);
  }

  /**
   * Clonks that died this tick: they drop what they carry, and an enemy who
   * hurt them last gets the kill. Then check the goal.
   */
  private afterDeaths(): void {
    for (const c of this.clonks) {
      if (c.alive || this.deaths.has(c)) continue;
      this.deaths.add(c);
      this.dropAll(c);
      const killer = c.lastHurtBy && this.hostile(c.lastHurtBy.owner, c.owner) ? c.lastHurtBy : null;
      if (killer?.info) killer.info.kills = (killer.info.kills ?? 0) + 1;
      this.events.push({ type: 'death', clonk: c, killer, tick: this.tick });
    }
    // A crew is out when it's wiped out in a melee, or when a rule eliminated it.
    if ((this.goal !== 'melee' && !this.eliminated.size) || this.winner !== null) return;
    const players = new Set(this.clonks.map((c) => c.owner));
    if (players.size < 2) return;
    const standing = new Set(this.clonks.filter((c) => c.alive).map((c) => c.owner));
    for (const p of players) {
      if (this.goal !== 'melee' || standing.has(p) || this.eliminated.has(p)) continue;
      this.eliminated.add(p);
      this.events.push({ type: 'eliminated', player: p, tick: this.tick });
    }
    for (const p of this.eliminated) standing.delete(p);
    if (standing.size <= 1) {
      this.winner = standing.size ? [...standing][0] : -1;
      this.events.push({ type: 'gameOver', winner: this.winner, tick: this.tick });
    }
  }

  /**
   * A rule puts a player out of the round (EliminatePlayer): their clonks
   * fall, and nobody gets the kills.
   */
  eliminate(player: number, why = ''): void {
    if (this.eliminated.has(player)) return;
    this.eliminated.add(player);
    if (why) this.say(player, why);
    for (const c of this.crewOf(player)) {
      if (!c.alive) continue;
      c.lastHurtBy = null;
      if (c.contained) this.exit(c);
      this.hurt(c, 1e6, null);
    }
    this.events.push({ type: 'eliminated', player, tick: this.tick });
  }

  private promoted(c: Clonk): void {
    if (c.info) this.events.push({ type: 'promotion', clonk: c, rank: c.info.rank, tick: this.tick });
  }

  /**
   * Blast a hole. Rock and gold veins break into rocks and gold nuggets
   * (one per 75 blasted pixels, like the original), and nearby objects get flung.
   * Returns how many objects (rocks, nuggets) the blast broke loose.
   */
  explode(x: number, y: number, radius: number, by: Clonk | null = null): number {
    this.events.push({ type: 'explosion', x, y, radius, tick: this.tick });
    // A blast sets oil alight.
    blastIgnite(this, x, y);

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
      this.blastDamage(c, x, y, radius, by);
      const k = fling(c);
      if (k > 0.2 && c.alive) c.setAction('Tumble');
    }
    for (const item of this.items) {
      if (item.container || item.removed) continue;
      // Whatever the blast flings counts as thrown by whoever set it off.
      if (fling(item) > 0 && by) item.thrownBy = by.id;
    }
    this.blastHits(x, y, radius, by);
    this.shoveVehicles(x, y, radius);
    for (const s of this.structures) this.blastBasement(s, x, y, radius);
    this.blastPlants(x, y, radius);

    const counts = this.land.blast(x, y, radius, this.rng);
    let freed = 0;
    for (const [mat, count] of counts) {
      const m = MATERIALS[mat];
      if (!m.blast2Object || !m.blast2ObjectRatio) continue;
      const n = Math.floor(count / m.blast2ObjectRatio);
      freed += n;
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
    return freed;
  }

  /**
   * Direct hits (within 5 px of the shape, C4Game::BlastObjects) on loose
   * items and buildings: blast damage, which sets wood and buildings alight
   * once it's enough (C4Object::Blast, BlastIncinerate).
   */
  private blastHits(x: number, y: number, level: number, by: Clonk | null): void {
    for (const item of this.items) {
      if (item.container || item.removed || !item.def.blastIncinerate) continue;
      const f = item.def.graphic.facet;
      if (directHit(x, y, { x: item.x - Math.floor(f.w / 2), y: item.y - Math.floor(f.h / 2), w: f.w, h: f.h })) blastBurn(this, item, level, by);
    }
    for (const s of this.structures) {
      if (!s.gone && directHit(x, y, { x: s.left, y: s.top, w: s.def.width, h: s.def.height })) blastBurn(this, s, level, by);
    }
    for (const v of this.vehicles) {
      if (!v.removed && !v.contained && directHit(x, y, { x: v.left, y: v.top, w: v.def.width, h: v.def.height })) blastBurn(this, v, level, by);
    }
  }

  /**
   * A blast shoves vehicles within `level` pixels away, less the heavier
   * they are (C4Game::BlastObjects: Fling by level minus distance, divided by
   * mass/10 between 4 and 20). Only ones that can be pushed (Grab=1): not a
   * balloon or blimp in flight.
   */
  private shoveVehicles(x: number, y: number, level: number): void {
    for (const v of this.vehicles) {
      if (v.removed || v.contained || v.grab !== 1 || Math.abs(y - v.y) > level || Math.abs(x - v.x) > level) continue;
      const k = Math.max(4, Math.min(20, Math.trunc(v.mass / 10)));
      const side = Math.sign(v.x - x + this.rng.int(3) - 1);
      v.xdir += (side * (level - Math.abs(x - v.x))) / k;
      v.ydir += (-level + Math.abs(y - v.y)) / k;
    }
  }

  /**
   * A direct hit (within 5 px of it, as in C4Game::BlastObjects) damages a
   * basement by the blast's level. At 150 it falls apart into 4 rocks
   * (Basements.c4d) and the ground it replaced comes back.
   */
  private blastBasement(s: Structure, x: number, y: number, level: number): void {
    const b = s.basement;
    if (!b || y - b.y < -5 || y - b.y > b.h - 1 + 10 || x - b.x < -5 || x - b.x > b.w - 1 + 10) return;
    b.damage += level;
    if (b.damage < BASEMENT.breakDamage) return;
    s.basement = null;
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const k = dy * b.w + dx;
        if (!this.land.inBounds(b.x + dx, b.y + dy)) continue;
        this.land.paint(b.x + dx, b.y + dy, b.saved.cells[k], b.saved.tex[k]);
        this.land.setTunnel(b.x + dx, b.y + dy, b.saved.tunnel[k] === 1);
      }
    }
    for (let i = 0; i < BASEMENT.rocks; i++) {
      this.spawnItem('rock', s.x, b.y - 5, (this.rng.int(31) - 15) / 10, -(this.rng.int(16) + 5) / 10, this.rng.int(3) + 1);
    }
  }

  /**
   * Blast damage to a clonk, as in C4Game::BlastObjects: a direct hit (within
   * 5 px of its shape) costs level/3 energy, the shock wave (within `level` px)
   * another level/2.
   */
  private blastDamage(c: Clonk, x: number, y: number, level: number, by: Clonk | null): void {
    if (!c.alive) return;
    const left = c.x - CLONK.width / 2;
    const top = c.y - CLONK.height / 2;
    let points = 0;
    if (y - top >= -5 && y - top <= CLONK.height - 1 + 10 && x - left >= -5 && x - left <= CLONK.width - 1 + 10) {
      points += Math.trunc(level / 3);
    }
    if (Math.abs(y - c.y) <= level && Math.abs(x - c.x) <= level) points += Math.trunc(level / 2);
    if (points) this.hurt(c, points, by);
  }

  /**
   * A blast that only hits objects, not the landscape (C4Game::BlastObjects;
   * lightning strikes with level 5): blast damage, and a shove away from it
   * for whatever is within `level` pixels.
   */
  blastObjects(x: number, y: number, level: number, by: Clonk | null = null): void {
    const shove = (o: GameObject, mass: number, living: boolean): [number, number] | null => {
      if (Math.abs(y - o.y) > level || Math.abs(x - o.x) > level) return null;
      const k = Math.max(4, Math.min(living ? 8 : 20, Math.trunc(mass / 10)));
      const side = Math.sign(o.x - x + this.rng.int(3) - 1);
      return [(side * (level - Math.abs(x - o.x))) / k, (-level + Math.abs(y - o.y)) / k];
    };
    for (const c of this.clonks) {
      if (c.contained || !c.alive) continue;
      this.blastDamage(c, x, y, level, by);
      const v = shove(c, CLONK.mass, true);
      if (v && c.alive) c.fling(c.xdir + v[0], c.ydir + v[1]);
    }
    for (const item of this.items) {
      if (item.container || item.removed) continue;
      const v = shove(item, item.def.mass, false);
      if (!v) continue;
      item.xdir += v[0];
      item.ydir += v[1];
    }
    this.blastHits(x, y, level, by);
    this.shoveVehicles(x, y, level);
    this.blastPlants(x, y, level, by, false);
  }

  private dropAll(c: Clonk): void {
    for (const item of c.contents.splice(0)) {
      item.setPosition(c.x, c.y);
      item.container = null;
      item.noCollect = NO_COLLECT_TICKS;
    }
  }

  say(player: number, text: string): void {
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
    this.enter(c, s);
    return true;
  }

  /**
   * Up while pushing a vehicle whose centre is in a doorway: the clonk goes
   * in and takes it along (ObjectComEnter). In its own base the gold in it is
   * sold (BASEFUNC_AutoSellContents sells the gold in the base's contents'
   * contents too). The original's lorry empties itself into any building
   * (Lorry.c4d Entrance); our buildings don't keep things, so the rest stays in.
   */
  private pushEnter(c: Clonk): boolean {
    const v = c.vehicle;
    if (!v) return false;
    const s = this.structures.find((o) => o.atEntrance(v.x, v.y));
    if (!s) return false;
    if (!this.enter(c, s)) return true;
    v.contained = s;
    v.mask?.remove(this.land);
    v.mask = null;
    v.xdir = v.ydir = 0;
    v.setPosition(s.x, s.y);
    for (const it of v.contents) it.setPosition(s.x, s.y);
    if (s.base !== c.owner) return true;
    const gold = v.contents.filter((it) => it.def.id === 'gold');
    if (!gold.length) return true;
    const p = this.players.get(c.owner);
    if (!p) return true;
    let earned = 0;
    for (const it of gold) {
      takeOut(v, it);
      it.removed = true;
      earned += it.def.value;
    }
    p.wealth = Math.min(BASE.maxWealth, p.wealth + earned);
    this.say(c.owner, `Sold ${gold.length} gold from the ${v.def.name.toLowerCase()} for ${earned} gold`);
    return true;
  }

  /** Go into a building. Returns false if the door stays shut. */
  private enter(c: Clonk, s: Structure): boolean {
    // Enemies can't get into your base (BASEFUNC_RejectEntrance).
    if (s.base >= 0 && this.hostile(s.base, c.owner)) {
      this.say(c.owner, 'Enemy base: the door stays shut');
      return false;
    }
    c.contained = s;
    c.menu = null;
    c.buildMenu = null;
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

  /** Leave a building, pushing out the vehicle it pushed in. */
  exit(c: Clonk): void {
    const s = c.contained;
    if (!s) return;
    const v = c.vehicle?.contained === s ? c.vehicle : null;
    const p = s.exitPoint();
    this.exitTo(c, p.x, p.y);
    s.openDoor();
    if (!v) return;
    this.pushOut(v);
    c.startPushVehicle(v);
  }

  /** A vehicle comes out of the building it was pushed into, standing in the doorway. */
  private pushOut(v: Vehicle): void {
    const s = v.contained;
    if (!s) return;
    v.contained = null;
    const p = s.exitPoint();
    // Its lowest vertex where a clonk's feet would be.
    v.setPosition(p.x, p.y + 9 - vehicleBottom(v));
    v.xdir = v.ydir = 0;
    for (const it of v.contents) it.setPosition(v.x, v.y);
    s.openDoor();
  }

  private exitTo(c: Clonk, x: number, y: number): void {
    c.contained = null;
    c.menu = null;
    c.setPosition(x, y);
    c.setAction('Walk', 0, 0);
  }

  /**
   * Double dig (ObjectComDigDouble): first what the clonk carries gets used
   * (a construction kit opens the menu of buildings it can put up, a T-flint
   * lights), else it chops the tree it stands at.
   */
  private useItem(c: Clonk): boolean {
    // The first press of a double dig has already started digging.
    if (c.action.procedure !== 'walk' && c.action.procedure !== 'dig') return false;
    const item = c.carrying;
    if (item?.def.id === 'conkit') {
      if (c.action.procedure === 'dig') c.setAction('Walk', 0, 0);
      c.buildMenu = 0;
      c.comDir = { x: 0, y: 0 };
      return true;
    }
    if (item?.light()) {
      if (c.action.procedure === 'dig') c.setAction('Walk', 0, 0);
      item.thrownBy = c.id;
      this.events.push({ type: 'fuse', x: c.x, y: c.y, tick: this.tick });
      return true;
    }
    const plant = this.choppableAt(c);
    if (!plant) return false;
    c.startChop(plant);
    return true;
  }

  /**
   * A clonk chopping (DFA_CHOP, C4Object::Chop): every 30 ticks the axe does
   * 10 damage to a standing tree, until it falls; a felled tree gives a piece
   * of wood each time, until there's none left.
   */
  private chopStep(c: Clonk): void {
    const p = c.chopping;
    if (!p || p.removed || p.state === 'falling' || !p.isAt(c.x, c.y)) return c.letGo();
    c.face(p.state === 'standing' ? p.x : c.x);
    if (this.tick % TREE.chopInterval !== 0) return;
    this.events.push({ type: 'chop', clonk: c, tick: this.tick });
    if (p.state === 'standing') {
      p.damage += TREE.chopDamage;
      if (p.damage > p.fellDamage) {
        // It falls away from the clonk chopping it.
        this.fell(p, c.x <= p.x ? 1 : -1);
        c.letGo();
      }
      return;
    }
    if (p.wood > 0) {
      p.wood--;
      const wood = this.spawnItem('wood', c.x + c.dir * 6, c.y - 4, c.dir * (0.3 + this.rng.int(6) / 10), -1.2, this.rng.int(3) + 1);
      // It mustn't knock over the clonk chopping, nor land straight back in its hands.
      wood.thrownBy = c.id;
      wood.noCollect = NO_COLLECT_TICKS;
    }
    if (p.wood <= 0) {
      p.removed = true;
      c.letGo();
    }
  }

  fell(p: Plant, side: -1 | 1): void {
    if (p.state !== 'standing') return;
    p.chopDown(side);
    this.events.push({ type: 'treeDown', plant: p, tick: this.tick });
  }

  /**
   * Trees grow every 35 ticks (C4Object::ExecLife), and every 350 ticks one
   * in 500 seeds a new one nearby (Tree.c4d Seed, Reproduction). A tree whose
   * ground is blasted or dug away falls over; so does grass.
   */
  private stepPlants(): void {
    const land = this.land;
    for (const p of this.plants) {
      if (p.removed) continue;
      if (p.state === 'falling') {
        p.fall(land);
        continue;
      }
      if (p.state !== 'standing') {
        // A dead tree lying around rots away (Tree.c4d IntTreeDecay).
        if (p.burned && !p.fire && p.con < FIRE.rotBelow && (this.tick + p.timerOffset) % FIRE.rotInterval === 0) {
          p.con -= FIRE.rot;
          p.wood = Math.min(p.wood, p.woodAtCon);
          if (p.con <= 0) p.removed = true;
        }
        continue;
      }
      const t = this.tick + p.timerOffset;
      if (t % TREE.growthInterval === 0) {
        // Dead trees don't grow, nor do burning ones (C4Object::ExecLife).
        if (p.con < FULL_CON && !p.burned && !p.fire) p.con = Math.min(FULL_CON, p.con + p.def.growth * 100);
        if (!plantRooted(land, p)) this.fell(p, this.rng.bool() ? 1 : -1);
      }
      // Sway in the wind (Tree.c4d Still and Breeze).
      if (t % 10 === 0 && this.weather) {
        const wind = Math.abs(this.weather.windAt(this, p.x, p.shape.y));
        if (wind > 49 + p.threshold) p.breeze = true;
        else if (wind < 50 + p.threshold) p.breeze = false;
      }
      if (t % TREE.seedInterval === 0 && !p.burned && this.rng.int(TREE.reproductionRate) === 0) this.reproduce(p);
    }
    if (this.tick % TREE.growthInterval === 0) for (const g of this.grass) if (!grassRooted(land, g)) g.removed = true;
    if (this.plants.some((p) => p.removed)) this.plants = this.plants.filter((p) => !p.removed);
    if (this.grass.some((g) => g.removed)) this.grass = this.grass.filter((g) => !g.removed);
  }

  /** A new tree of the same kind nearby, if there aren't too many already (Tree.c4d Reproduction). */
  reproduce(p: Plant): Plant | null {
    const half = TREE.reproductionArea / 2;
    const cy = p.bottom - p.shape.h / 2;
    const near = this.plants.filter((o) => o.state === 'standing' && Math.abs(o.x - p.x) <= half && Math.abs(o.bottom - o.shape.h / 2 - cy) <= half);
    if (near.length >= TREE.maxTrees) return null;
    const spot = findPlantSpot(this.land, this.rng, p.def, { x: Math.round(p.x - half), y: Math.round(cy - half), w: TREE.reproductionArea, h: TREE.reproductionArea });
    if (!spot) return null;
    return this.addPlant(p.def.id, spot.x, spot.bottom, TREE.seedlingCon, this.rng.bool() ? 1 : -1);
  }

  /**
   * A blast hits trees it's right at (C4Game::BlastObjects, direct hit:
   * within 5 pixels of the shape) for its level in damage, and fells them
   * once it's too much (Tree.c4d Damage). Grass within its reach is blown away.
   */
  private blastPlants(x: number, y: number, level: number, by: Clonk | null = null, grass = true): void {
    for (const p of this.plants) {
      if (p.removed || !directHit(x, y, p.bounds)) continue;
      // Ten damage sets a tree alight (BlastIncinerate).
      blastBurn(this, p, level, by);
      if (p.state === 'standing' && p.damage > p.fellDamage) this.fell(p, x <= p.x ? 1 : -1);
    }
    if (!grass) return;
    for (const g of this.grass) {
      if (g.removed || Math.abs(g.y - y) > level || Math.abs(g.x - x) > level) continue;
      g.removed = true;
      this.events.push({ type: 'grassBlown', grass: g, x: g.x, y: g.y, level, tick: this.tick });
    }
  }

  /**
   * A lit T-flint's fuse burnt down (TFlint.c4d BlowUp). In a clonk's hands it
   * goes off right there; inside a building the walls hold the blast and only
   * the clonk gets hurt.
   */
  private blowUp(item: Item): void {
    item.removed = true;
    // In a lorry, it goes off where the lorry is (inside a building, the building takes it).
    if (item.container instanceof Vehicle) {
      const v = item.container;
      takeOut(v, item);
      if (v.contained) return blastBurn(this, v.contained, item.def.fuse?.explode ?? 20, this.thrower(item));
    }
    const holder = item.container instanceof Clonk ? item.container : null;
    if (holder) holder.contents.splice(holder.contents.indexOf(item), 1);
    item.container = null;
    const level = item.def.fuse?.explode ?? 20;
    const by = this.thrower(item) ?? holder;
    if (holder?.contained) {
      // The building takes the blast too, and may catch fire (C4Game::BlastObjects, contained blast).
      blastBurn(this, holder.contained, level, by);
      this.hurt(holder, Math.trunc(level / 3), by);
      return;
    }
    const x = holder ? holder.x : item.x;
    const y = holder ? holder.y : item.y;
    if (holder) this.hurt(holder, Math.trunc(level / 3), by);
    const freed = this.explode(x, y, level, by);
    if (by && freed && by.doExperience(freed * EXPERIENCE.blastedLoose)) this.promoted(by);
  }

  /** The spell menu: left/right choose, up or throw casts, down, dig or the magic key closes it. */
  private spellMenuControl(c: Clonk, ctl: ControlState): void {
    const list = spellList(this);
    const n = list.length;
    let i = Math.min(c.spellMenu ?? 0, n - 1);
    if (ctl.pressedLeft) i = (i + n - 1) % n;
    if (ctl.pressedRight) i = (i + 1) % n;
    c.spellMenu = i;
    c.comDir = { x: 0, y: 0 };
    if (ctl.pressedUp || ctl.pressedThrow) {
      c.spellMenu = null;
      startSpell(this, c, list[i]);
    } else if (ctl.pressedDown || ctl.pressedDig || ctl.pressedMagic) c.spellMenu = null;
  }

  /** The build menu: left/right choose, up or throw builds here, down or dig closes it. */
  private buildMenuControl(c: Clonk, ctl: ControlState): void {
    const n = BUILD_PLANS.length;
    let i = c.buildMenu ?? 0;
    if (ctl.pressedLeft) i = (i + n - 1) % n;
    if (ctl.pressedRight) i = (i + 1) % n;
    c.buildMenu = i;
    if (ctl.pressedUp || ctl.pressedThrow) {
      c.buildMenu = null;
      this.placeSite(c, BUILD_PLANS[i]);
    } else if (ctl.pressedDown || ctl.pressedDig) c.buildMenu = null;
  }

  /**
   * Put up a construction site where the clonk stands, using up its kit, and
   * start building (Conkit.c4d CreateConstructionSite).
   */
  placeSite(c: Clonk, id: string): Structure | null {
    const kit = c.carrying;
    if (kit?.def.id !== 'conkit' || c.action.procedure !== 'walk' || c.contained) return null;
    const bottom = c.y + 10;
    const problem = siteProblem(this, id, c.x, bottom);
    if (problem) {
      this.say(c.owner, problem);
      return null;
    }
    c.contents.splice(c.contents.indexOf(kit), 1);
    kit.removed = true;
    const s = construct(this, id, c.x, bottom, c.owner);
    this.say(c.owner, `Construction: ${s.def.name}`);
    c.startBuild(s);
    return s;
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
      else if (item.def.id === 'flag') this.plantFlag(c, item);
      else this.say(c.owner, 'Sell things in a building with your flag');
    }
  }

  /**
   * Put a flag into a building without one (C4Object::ExecBase): it goes up on
   * the roof and the building becomes the home base of the flag's owner. That's
   * whoever bought it, not whoever carries it: a stolen flag is for selling.
   */
  private plantFlag(c: Clonk, flag: Item): void {
    const s = c.contained!;
    if (!s.def.canBeBase || !s.complete) return this.say(c.owner, 'No flag can go on this building');
    if (s.hasFlag) return this.say(c.owner, 'There is a flag here already');
    if (!this.players.has(flag.owner)) return this.say(c.owner, 'Nobody owns this flag: sell it');
    const i = c.contents.indexOf(flag);
    if (i >= 0) c.contents.splice(i, 1);
    flag.removed = true;
    s.base = flag.owner;
    s.owner = flag.owner;
    s.energy = 0;
    this.events.push({ type: 'newBase', structure: s, player: flag.owner, tick: this.tick });
    if (flag.owner === c.owner) this.say(c.owner, `Your flag flies on the ${s.def.name.toLowerCase()}: a new home base`);
    else this.say(c.owner, `That flag isn't yours: the ${s.def.name.toLowerCase()} is now their base`);
    // The owner's clonks inside are home now; anyone else has to leave (BASEFUNC_RejectEntrance).
    for (const o of this.clonks) if (o.contained === s && this.hostile(s.base, o.owner)) this.exit(o);
  }

  /** What the player's home base can sell, in a fixed order. */
  shopList(player: number): ShopId[] {
    const p = this.players.get(player);
    return p ? (Object.keys(p.stock) as ShopId[]) : [];
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

  private buy(c: Clonk, id: ShopId): void {
    const p = this.players.get(c.owner);
    if (!p) return;
    const def = shopEntry(id);
    if ((p.stock[id] ?? 0) <= 0) return this.say(c.owner, `No ${def.name} left`);
    if (p.wealth < def.value) return this.say(c.owner, `Not enough gold for ${def.name}`);
    if (isVehicleId(id)) return this.buyVehicle(c, p, id);
    if (isCrewId(id)) return this.buyClonk(c, p, id);
    if (c.contents.length >= CLONK.maxContents) return this.say(c.owner, 'Hands full: sell or drop it first');
    p.wealth -= def.value;
    p.stock[id]! -= 1;
    const item = this.spawnItem(id, c.x, c.y);
    item.owner = c.owner;
    item.container = c;
    c.contents.push(item);
    this.say(c.owner, `Bought ${def.name} for ${def.value} gold`);
  }

  /**
   * Buy a clonk (C4Player::MakeCrewMember): the player's best idle crew member
   * comes out of the base, or a new recruit who joins the crew for good.
   */
  private buyClonk(c: Clonk, p: PlayerState, kind: ClonkKind): void {
    const base = c.contained;
    if (!base) return;
    const def = CLONK_KINDS[kind];
    p.wealth -= def.value;
    p.stock[kind]! -= 1;
    const at = base.exitPoint();
    const n = this.addClonk(at.x, at.y, c.owner, kind);
    n.controlStyle = c.controlStyle;
    n.join(this.recruit?.(c.owner, kind) ?? null);
    n.setAction('Walk', 0, 0);
    n.dir = c.dir;
    base.openDoor();
    this.events.push({ type: 'recruit', clonk: n, tick: this.tick });
    this.say(c.owner, n.info ? `${n.info.name} joins you for ${def.value} gold` : `Bought a ${def.name.toLowerCase()} for ${def.value} gold`);
  }

  /**
   * Buy a vehicle. The original puts it into the base, to be pushed out; here
   * it comes out of the door at once, standing on the ground. Where the
   * ground beside the door is higher than the building's floor (a hill, a
   * wall) it comes out above it, so it never starts stuck in the landscape.
   */
  private buyVehicle(c: Clonk, p: PlayerState, id: VehicleId): void {
    const base = c.contained;
    if (!base) return;
    const def = VEHICLES[id];
    p.wealth -= def.value;
    p.stock[id]! -= 1;
    const at = base.exitPoint();
    // Its lowest vertex one pixel above the ground the clonk stands on.
    const bottom = Math.max(...def.vertices.map((v) => v.y));
    const v = this.addVehicle(id, at.x, at.y + 9 - bottom, c.owner);
    for (let up = 1; up <= def.height && contactCheck(this.land, v.vertices, v.x, v.y).count; up++) v.setPosition(v.x, v.y - 1);
    base.openDoor();
    this.say(c.owner, `Bought ${def.name} for ${def.value} gold`);
  }

  /**
   * Energy reload in a home base (C4Object::ExecLife): every 3 ticks a clonk
   * inside its own base gets up to 2 points from the base's energy store. When
   * the store is empty the base buys 100 points for 5 of its owner's gold.
   */
  private healInBase(c: Clonk): void {
    const s = c.contained;
    if (!s || !c.alive || s.base !== c.owner || c.energy >= c.maxEnergy) return;
    if (s.energy <= 0) {
      const p = this.players.get(s.base);
      if (p && p.wealth >= BASE.regenerateEnergyPrice) {
        p.wealth -= BASE.regenerateEnergyPrice;
        s.energy = Math.min(s.def.energy, s.energy + 100 * 1000);
      }
    }
    const transfer = Math.min(BASE.healTransfer, s.energy, c.maxEnergy - c.energy);
    if (transfer <= 0) return;
    s.energy -= transfer;
    c.doEnergy(transfer, true);
  }
}

/** Keys that make a building clonk stop and do something else. */
function stopsWork(c: ControlState): boolean {
  return c.left || c.right || c.pressedUp || c.pressedDown || c.pressedDig || c.pressedThrow || c.pressedUse || c.pressedMagic;
}

/** Is (x, y) a direct hit on the box: within 5 pixels of it, a bit more below and right (C4Game::BlastObjects)? */
function directHit(x: number, y: number, b: { x: number; y: number; w: number; h: number }): boolean {
  const dx = x - b.x;
  const dy = y - b.y;
  return dy >= -5 && dy <= b.h - 1 + 10 && dx >= -5 && dx <= b.w - 1 + 10;
}
