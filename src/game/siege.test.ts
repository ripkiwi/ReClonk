import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { VEHICLES, type Vehicle, type VehicleId } from '../objects/vehicle';
import { arrowCount, engineOf, itemValue, SIEGE } from './siege';
import { World } from './world';

const GROUND = 100;
/** A lake from x 300 to 460, its top at y 105, 80 deep. */
const LAKE = { x0: 300, x1: 460, top: 105, bottom: 185 };

function flatWorld(lake = false): World {
  const land = new Landscape(520, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 520; x++) land.set(x, y, Mat.Earth);
  if (lake) {
    for (let y = GROUND; y < LAKE.bottom; y++) {
      for (let x = LAKE.x0; x < LAKE.x1; x++) land.set(x, y, y < LAKE.top ? Mat.Sky : Mat.Water);
    }
  }
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 200, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);

function onGround(world: World, id: VehicleId, x: number): Vehicle {
  const bottom = Math.max(...VEHICLES[id].vertices.map((v) => v.y));
  const v = world.addVehicle(id, x, GROUND - 1 - bottom, 0);
  run(world, 2);
  return v;
}

function clonkAt(world: World, x: number, y = GROUND - 10): Clonk {
  const c = world.addClonk(x, y, 0);
  run(world, 10);
  return c;
}

function grab(world: World, c: Clonk): void {
  tap(world, { down: true, pressedDown: true });
  run(world, 1);
  expect(c.vehicle).not.toBeNull();
}

/** Put what the clonk is given into the vehicle it holds (throw). */
function load(world: World, c: Clonk, id: Parameters<World['give']>[1]): void {
  world.give(c, id);
  tap(world, { pressedThrow: true });
  expect(c.carrying).toBeFalsy();
}

describe('Catapult', () => {
  it('is loaded, tensed with up held and throws far, then charges back up', () => {
    const world = flatWorld();
    const cat = onGround(world, 'catapult', 100);
    cat.dir = 1;
    const c = clonkAt(world, 100);
    grab(world, c);
    load(world, c, 'rock');
    expect(cat.contents.map((o) => o.def.id)).toEqual(['rock']);
    // Holding down tenses it (jump'n'run AimDown): one frame every 8 ticks.
    run(world, 8 * 6 + 2, { down: true });
    expect(cat.phase).toBe(6);
    const rock = cat.contents[0];
    tap(world, { pressedThrow: true });
    expect(cat.action).toBe('Fire');
    run(world, 8);
    expect(rock.container).toBeNull();
    expect(rock.xdir).toBeGreaterThan(5);
    expect(rock.ydir).toBeLessThan(-8);
    expect(cat.action).toBe('Charge');
    run(world, 40);
    expect(cat.action).toBe('Ready');
    expect(cat.phase).toBe(6);
  });

  it('classic keys: dig tenses a step, up eases off', () => {
    const world = flatWorld();
    const cat = onGround(world, 'catapult', 100);
    const c = clonkAt(world, 100);
    grab(world, c);
    c.controlStyle = 'classic';
    expect(c.vehicle).toBe(cat);
    tap(world, { pressedDig: true });
    tap(world, { pressedDig: true });
    expect(cat.phase).toBe(2);
    tap(world, { pressedUp: true });
    expect(cat.phase).toBe(1);
  });
});

describe('Cannon', () => {
  it('needs gunpowder: it shoots the rock and uses up one gunpowder', () => {
    const world = flatWorld();
    const can = onGround(world, 'cannon', 100);
    can.dir = 1;
    const c = clonkAt(world, 100);
    grab(world, c);
    load(world, c, 'rock');
    // Only a rock: click, and the menu of what's in it opens (dig closes it).
    tap(world, { pressedThrow: true });
    expect(can.contents.length).toBe(1);
    tap(world, { pressedDig: true });
    load(world, c, 'gunpowder');
    expect(can.contents.length).toBe(2);
    const rock = can.contents.find((o) => o.def.id === 'rock')!;
    tap(world, { pressedThrow: true });
    expect(can.contents.length).toBe(0);
    expect(rock.container).toBeNull();
    // Aimed at frame 10 (45°ish): off up and forward, fast.
    expect(rock.xdir).toBeGreaterThan(8);
    expect(rock.ydir).toBeLessThan(-5);
    expect(world.events.some((e) => e.type === 'siege' && e.sound === 'Blast2')).toBe(true);
  });

  it('keeps the last place for gunpowder', () => {
    const world = flatWorld();
    const can = onGround(world, 'cannon', 100);
    for (let i = 0; i < 9; i++) can.contents.push(world.spawnItem('rock', 0, 0));
    for (const it of can.contents) it.container = can;
    const c = clonkAt(world, 100);
    grab(world, c);
    world.give(c, 'rock');
    tap(world, { pressedThrow: true });
    expect(c.carrying?.def.id).toBe('rock');
    c.contents.length = 0;
    load(world, c, 'gunpowder');
    expect(can.contents.length).toBe(10);
  });
});

describe('Crossbow and arrows', () => {
  it('shoots an arrow from a pack that hurts an enemy clonk on its way', () => {
    const world = flatWorld();
    world.addPlayer(1, { wealth: 0, stock: {} });
    const bow = onGround(world, 'crossbow', 100);
    bow.dir = 1;
    const c = clonkAt(world, 100);
    const enemy = world.addClonk(170, GROUND - 10, 1);
    run(world, 5);
    grab(world, c);
    load(world, c, 'arrows');
    expect(arrowCount(bow)).toBe(10);
    // Aim level: frame 19.
    bow.phase = 19;
    const before = enemy.energy;
    tap(world, { pressedThrow: true });
    expect(arrowCount(bow)).toBe(9);
    run(world, 10);
    expect(enemy.energy).toBeLessThan(before);
    // The arrow stopped in it and can be picked up again later.
    const arrow = world.items.find((o) => o.def.id === 'arrow')!;
    expect(arrow.shot).toBe(false);
  });

  it('reloads for 10 ticks between shots', () => {
    const world = flatWorld();
    const bow = onGround(world, 'crossbow', 100);
    const c = clonkAt(world, 100);
    grab(world, c);
    load(world, c, 'arrows');
    tap(world, { pressedThrow: true });
    tap(world, { pressedThrow: true });
    expect(arrowCount(bow)).toBe(9);
    run(world, SIEGE.reload);
    tap(world, { pressedThrow: true });
    expect(arrowCount(bow)).toBe(8);
  });

  it('loose arrows go back into the pack the clonk carries', () => {
    const world = flatWorld();
    const c = clonkAt(world, 100);
    const pack = world.give(c, 'arrows')!;
    pack.count = 3;
    world.spawnItem('arrow', 104, GROUND - 2);
    run(world, 5);
    expect(pack.count).toBe(4);
    expect(world.items.some((o) => o.def.id === 'arrow')).toBe(false);
    // A pack is worth what's left of it.
    expect(itemValue(pack)).toBe(Math.trunc((20 * 4) / 10));
  });

  it('an arrow through a balloon lets its gas out: it drops', () => {
    const world = flatWorld();
    const b = world.addVehicle('balloon', 200, 40, 0);
    b.setAction('Float');
    const arrow = world.spawnItem('arrow', 150, 30, 12, 0);
    arrow.shot = true;
    arrow.lastX = arrow.x;
    arrow.lastY = arrow.y;
    run(world, 8);
    expect(b.action).toBe('DropOff');
  });
});

describe('Steam engine and wagon', () => {
  it('couples a wagon on double dig and pulls it; a clonk inside drives it', () => {
    const world = flatWorld();
    const e = onGround(world, 'engine', 100);
    const w = onGround(world, 'wagon', 140);
    const c = clonkAt(world, 100);
    grab(world, c);
    tap(world, { pressedUse: true });
    expect(e.pulling).toBe(w);
    expect(engineOf(world, w)).toBe(e);
    // Double right: the engine drives off on its own, the clonk lets go.
    tap(world, { pressedRight: true, right: true });
    run(world, 3);
    tap(world, { pressedRight: true, right: true });
    expect(c.vehicle).toBeNull();
    const x0 = w.x;
    run(world, 40);
    expect(w.x).toBeGreaterThan(x0 + 30);
    // Into the wagon: up at its door.
    world.step(new Map([[0, { ...NO_CONTROL }]]));
    e.comDir = { x: 0, y: 0 };
    run(world, 30);
    c.setPosition(w.x, GROUND - 10);
    tap(world, { up: true, pressedUp: true });
    expect(c.contained).toBe(w);
    // Left held drives the engine left.
    run(world, 30, { left: true });
    expect(e.xdir).toBeLessThan(0);
    // Stopped, down gets out.
    run(world, 2);
    e.comDir = { x: 0, y: 0 };
    run(world, 20);
    tap(world, { pressedDown: true, down: true });
    expect(c.contained).toBeNull();
  });
});

describe('Submarine', () => {
  it('swims where it is steered, takes things in with its grapple and fires torpedoes', () => {
    const world = flatWorld(true);
    const sub = world.addVehicle('sub', 380, 140, 0);
    run(world, 5);
    expect(sub.action).toBe('Swim');
    // In the water, no sinking.
    const y0 = sub.y;
    run(world, 30);
    expect(Math.abs(sub.y - y0)).toBeLessThan(2);
    const c = world.addClonk(sub.x, sub.y, 0);
    c.contained = sub;
    sub.contents.push(world.spawnItem('torpedo', sub.x, sub.y));
    sub.contents[0].container = sub;
    run(world, 20, { up: true });
    expect(sub.y).toBeLessThan(y0 - 10);
    run(world, 1);
    tap(world, { pressedDig: true });
    const t = world.items.find((o) => o.def.id === 'torpedo')!;
    expect(t.container).toBeNull();
    run(world, 10);
    expect(Math.abs(t.xdir)).toBeGreaterThan(1);
  });

  it('wrecks at 150 damage and lets its crew out', () => {
    const world = flatWorld(true);
    const sub = world.addVehicle('sub', 380, 140, 0);
    const c = world.addClonk(sub.x, sub.y, 0);
    c.contained = sub;
    run(world, 2);
    sub.damage = 150;
    run(world, 1);
    expect(sub.burned).toBe(true);
    expect(c.contained).toBeNull();
  });
});

describe('Chest and bridge', () => {
  it('a chest opens when held, keeps things and shuts when let go', () => {
    const world = flatWorld();
    const chest = onGround(world, 'chest', 100);
    const c = clonkAt(world, 100);
    grab(world, c);
    run(world, 30);
    expect(chest.action).toBe('Open');
    load(world, c, 'gold');
    expect(chest.contents.length).toBe(1);
    // Held on to, not pushed: walking doesn't move it.
    const x0 = chest.x;
    run(world, 10, { right: true });
    expect(chest.x).toBe(x0);
    tap(world, { doubleDown: true, pressedDown: true, down: true });
    expect(c.vehicle).toBeNull();
    run(world, 30);
    expect(chest.action).toBe('Closed');
  });

  it('a bridge segment locks over a gap, solid on top, and is walked over', () => {
    const world = flatWorld();
    // A gap 40 wide.
    for (let y = GROUND; y < 140; y++) for (let x = 200; x < 240; x++) world.land.set(x, y, Mat.Sky);
    const br = onGround(world, 'bridge', 180);
    const c = clonkAt(world, 180);
    grab(world, c);
    run(world, 20, { right: true });
    run(world, 20);
    expect(br.x).toBeGreaterThan(210);
    expect(br.x).toBeLessThan(230);
    tap(world, { pressedUse: true });
    expect(br.locked).toBe(true);
    run(world, 30);
    expect(br.hasMask).toBe(true);
    // It stays put.
    const x0 = br.x;
    const y0 = br.y;
    run(world, 30);
    expect([br.x, br.y]).toEqual([x0, y0]);
    // Let go and walk across it.
    tap(world, { doubleDown: true, pressedDown: true, down: true });
    run(world, 80, { right: true });
    expect(c.x).toBeGreaterThan(250);
    expect(c.y).toBeLessThan(GROUND);
  });
});

describe('Barrels and the fire bomb', () => {
  it('an empty barrel carried into water fills up and splashes it out on double dig', () => {
    const world = flatWorld(true);
    const c = world.addClonk(380, 150, 0);
    const b = world.give(c, 'barrel')!;
    run(world, 36);
    expect(b.def.id).toBe('waterBarrel');
    expect(b.fill).toBe(200);
    c.setPosition(100, GROUND - 10);
    run(world, 10);
    const before = world.land.pxs.count;
    tap(world, { pressedUse: true });
    expect(b.def.id).toBe('barrel');
    expect(world.land.pxs.count).toBeGreaterThan(before);
  });

  it('a fire bomb bursts into flames where it lands', () => {
    const world = flatWorld();
    world.spawnItem('firebomb', 100, 60, 0, 3);
    run(world, 30);
    expect(world.items.some((o) => o.def.id === 'firebomb')).toBe(false);
    expect(world.flames.length).toBeGreaterThan(10);
  });

  it('an oil barrel in a blast blows up and leaves its empty barrel', () => {
    const world = flatWorld();
    world.spawnItem('oilBarrel', 100, GROUND - 6);
    run(world, 5);
    world.explode(104, GROUND - 6, 20, null);
    run(world, 5);
    expect(world.items.some((o) => o.def.id === 'oilBarrel')).toBe(false);
    expect(world.items.some((o) => o.def.id === 'barrel')).toBe(true);
  });
});

describe('Cannon tower', () => {
  function towerWithGun(id: VehicleId = 'towerCannon') {
    const world = flatWorld();
    const tower = world.addStructure('cannonTower', 100, GROUND - 22, -1);
    const door = tower.exitPoint().x;
    const gun = onGround(world, id, door);
    const c = clonkAt(world, door);
    grab(world, c);
    run(world, 5);
    tap(world, { up: true, pressedUp: true });
    run(world, 2);
    return { world, tower, gun, c };
  }

  it('a combat cannon pushed in is mounted on the roof, aimed towards the middle', () => {
    const { tower, gun, c } = towerWithGun();
    expect(c.contained).toBe(tower);
    expect(gun.mountedOn).toBe(tower);
    expect(gun.r).toBe(45);
    expect([gun.x, gun.y]).toEqual([tower.x, tower.y - 19]);
  });

  it('turns while right is held, and shoots a rock with one gunpowder from the menu', () => {
    const { world, tower, gun, c } = towerWithGun();
    run(world, 20, { right: true });
    expect(gun.r).toBeCloseTo(45 + 20 * 0.5, 0);
    run(world, 1);
    load(world, c, 'rock');
    load(world, c, 'gunpowder');
    expect(tower.contents.length).toBe(2);
    tap(world, { pressedDig: true });
    expect(c.menuKind).toBe('fire');
    expect(world.menuList(c).map((e) => e.id)).toEqual(['rock']);
    tap(world, { pressedThrow: true });
    expect(tower.contents.length).toBe(0);
    const rock = world.items.find((o) => o.def.id === 'rock')!;
    expect(rock.container).toBeNull();
    expect(rock.xdir).toBeGreaterThan(5);
    expect(rock.ydir).toBeLessThan(-5);
  });

  it('up twice takes the gun off: it comes out at the door', () => {
    const { world, tower, gun } = towerWithGun();
    tap(world, { pressedUp: true, up: true });
    run(world, 3);
    tap(world, { pressedUp: true, up: true });
    expect(gun.mountedOn).toBeNull();
    expect(gun.contained).toBeNull();
    expect(Math.abs(gun.x - tower.exitPoint().x)).toBeLessThan(2);
  });

  it('the artillery cannon shoots a clonk inside out over the land', () => {
    const { world, tower, c } = towerWithGun('artillery');
    const other = world.addClonk(tower.x, tower.y, 0);
    other.contained = tower;
    for (let i = 0; i < 4; i++) load(world, c, 'gunpowder');
    tap(world, { pressedDig: true });
    expect(world.menuList(c).map((e) => e.id)).toEqual(['clonk']);
    tap(world, { pressedThrow: true });
    expect(other.contained).toBeNull();
    expect(c.contained).toBe(tower);
    run(world, 20);
    expect(other.x).toBeGreaterThan(tower.x + 40);
  });
});
