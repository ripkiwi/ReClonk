import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { Landscape } from '../landscape/landscape';
import { Mat } from '../landscape/materials';
import { NO_CONTROL, type Clonk, type ControlState } from '../objects/clonk';
import { STRUCTURES } from '../objects/defs';
import { Line } from '../objects/line';
import type { Structure } from '../objects/structure';
import { VEHICLES, type VehicleId } from '../objects/vehicle';
import { energyPoints, POWER, useLinekit } from './power';
import { forge, PRODUCTION, startProduction } from './production';
import { checkSignal, signalControl } from './signals';
import { GUNS, liquidAmmo, mountGun, shootLiquid } from './cannonTower';
import { World } from './world';

const GROUND = 100;

function flatWorld(): World {
  const land = new Landscape(600, 260);
  for (let y = GROUND; y < 260; y++) for (let x = 0; x < 600; x++) land.set(x, y, Mat.Earth);
  const world = new World(land, new Rng(1));
  world.addPlayer(0, { wealth: 200, stock: {} });
  return world;
}

function run(world: World, ticks: number, ctrl: Partial<ControlState> = {}): void {
  const controls = new Map([[0, { ...NO_CONTROL, ...ctrl }]]);
  for (let i = 0; i < ticks; i++) world.step(controls);
}

const tap = (world: World, ctrl: Partial<ControlState>): void => run(world, 1, ctrl);

/** A finished building standing on the ground. */
function build(world: World, id: string, x: number): Structure {
  return world.addStructure(id, x, GROUND - Math.ceil(STRUCTURES[id].height / 2), -1);
}

function clonkAt(world: World, x: number): Clonk {
  const c = world.addClonk(x, GROUND - 10, 0);
  run(world, 10);
  return c;
}

function walkTo(world: World, c: Clonk, x: number): void {
  for (let i = 0; i < 400 && Math.abs(c.x - x) > 1; i++) run(world, 1, x > c.x ? { right: true } : { left: true });
  run(world, 10);
}

describe('Power lines', () => {
  it('a line kit lays a power line from a windmill to a workshop', () => {
    const world = flatWorld();
    const mill = build(world, 'windmill', 100);
    const shop = build(world, 'workshop', 250);
    const c = clonkAt(world, mill.x);
    world.give(c, 'linekit');
    expect(useLinekit(world, c)).toBe(true);
    expect(world.lines.length).toBe(1);
    expect(world.lines[0].kind).toBe('power');
    expect(world.lines[0].from).toBe(mill);
    walkTo(world, c, shop.x);
    useLinekit(world, c);
    const l = world.lines[0];
    expect(l.to).toBe(shop);
    expect(c.carrying).toBeFalsy();
    // Every 10 ticks a third of the windmill's power, at most 20 points, goes over.
    mill.energy = 90 * POWER.unit;
    shop.energy = 0;
    run(world, 10);
    expect(energyPoints(shop)).toBeGreaterThanOrEqual(19);
    expect(energyPoints(mill)).toBeLessThan(90);
  });

  it('breaks when one end burns down', () => {
    const world = flatWorld();
    const mill = build(world, 'windmill', 100);
    const shop = build(world, 'workshop', 250);
    world.lines.push(new Line('power', mill, shop, 0));
    run(world, 2);
    expect(world.lines.length).toBe(1);
    shop.gone = true;
    run(world, 1);
    expect(world.lines.length).toBe(0);
  });

  it('bends around a rock wall as its kit is carried past it', () => {
    const world = flatWorld();
    const mill = build(world, 'windmill', 100);
    for (let y = GROUND - 40; y < GROUND; y++) for (let x = 195; x < 205; x++) world.land.set(x, y, Mat.Rock);
    const kit = world.spawnItem('linekit', 150, GROUND - 5);
    const l = new Line('power', mill, kit, 0);
    world.lines.push(l);
    // Over the wall and down the other side.
    for (let x = 150; x <= 250; x += 2) {
      kit.setPosition(x, x < 190 || x > 210 ? GROUND - 5 : GROUND - 50);
      kit.xdir = kit.ydir = 0;
      run(world, 1);
    }
    expect(world.lines).toContain(l);
    expect(l.xs.length).toBeGreaterThan(2);
  });
});

describe('Power plant and the Power usage rule', () => {
  it('burns coal when a connected building needs power, and the power reaches it', () => {
    const world = flatWorld();
    world.rules.add('energy');
    const plant = build(world, 'powerPlant', 100);
    const saw = build(world, 'sawmill', 300);
    world.store(plant, world.spawnItem('coal', plant.x, plant.y));
    world.lines.push(new Line('power', plant, saw, 0));
    saw.energy = 0;
    // The sawmill has wood to cut, so it needs power.
    world.store(saw, world.spawnItem('wood', saw.x, saw.y));
    saw.logs.push(2);
    run(world, 40);
    expect(saw.needEnergy || plant.activity === 'burn').toBe(true);
    run(world, 120);
    expect(plant.activity).toBe('burn');
    expect(plant.contents.some((o) => o.def.id === 'coal')).toBe(false);
    run(world, 200);
    expect(energyPoints(saw) + (saw.activity === 'saw' ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe('Pump', () => {
  it('pumps water from a lake through a source pipe and out of a drain pipe', () => {
    const world = flatWorld();
    // A pond to the left.
    for (let y = GROUND; y < GROUND + 20; y++) for (let x = 20; x < 80; x++) world.land.set(x, y, Mat.Water);
    const pump = build(world, 'pump', 150);
    const c = clonkAt(world, pump.x);
    // The source pipe from the pump; its end lies in the pond.
    world.give(c, 'linekit');
    useLinekit(world, c);
    const source = world.lines[0];
    expect(source.kind).toBe('source');
    const kit = c.carrying!;
    c.contents.splice(c.contents.indexOf(kit), 1);
    kit.container = null;
    kit.setPosition(50, GROUND + 5);
    // The drain pipe, its end on the ground to the right.
    world.give(c, 'linekit');
    useLinekit(world, c);
    const drain = world.lines[1];
    expect(drain.kind).toBe('drain');
    const kit2 = c.carrying!;
    c.contents.splice(c.contents.indexOf(kit2), 1);
    kit2.container = null;
    kit2.setPosition(300, GROUND - 3);
    const water = (): number => {
      let n = 0;
      for (let y = GROUND - 30; y < GROUND + 20; y++) for (let x = 0; x < 600; x++) if (world.land.get(x, y) === Mat.Water) n++;
      return n;
    };
    const pond = (): number => {
      let n = 0;
      for (let y = GROUND - 30; y < GROUND + 20; y++) for (let x = 0; x < 100; x++) if (world.land.get(x, y) === Mat.Water) n++;
      return n;
    };
    const before = pond();
    run(world, 400);
    expect(pond()).toBeLessThan(before - 50);
    expect(water()).toBeGreaterThan(before - 60);
  });
});

describe('Production', () => {
  it('a clonk in the workshop builds a lorry from 2 metal, and it rolls out', () => {
    const world = flatWorld();
    const shop = build(world, 'workshop', 200);
    const c = clonkAt(world, shop.x);
    world.enter(c, shop);
    world.store(shop, world.spawnItem('metal', shop.x, shop.y));
    world.store(shop, world.spawnItem('metal', shop.x, shop.y));
    startProduction(world, c, shop, 'lorry');
    expect(c.producing).toBe('lorry');
    const ticks = Math.ceil(100000 / Math.trunc(PRODUCTION.buildRate / 75)) + 5;
    run(world, ticks);
    expect(world.vehicles.some((v) => v.def.id === 'lorry')).toBe(true);
    expect(shop.contents.some((o) => o.def.id === 'metal')).toBe(false);
    expect(c.producing).toBeNull();
  });

  it('stops and says what is missing', () => {
    const world = flatWorld();
    const shop = build(world, 'workshop', 200);
    const c = clonkAt(world, shop.x);
    world.enter(c, shop);
    startProduction(world, c, shop, 'cannon');
    run(world, 5);
    expect(c.producing).toBeNull();
    expect(world.messages.some((m) => m.text.includes('needs'))).toBe(true);
  });

  it('the produce menu lists what the chemical plant makes', () => {
    const world = flatWorld();
    const lab = build(world, 'chemicalPlant', 200);
    const c = clonkAt(world, lab.x);
    world.enter(c, lab);
    tap(world, { pressedLeft: true, left: true });
    expect(c.menuKind).toBe('produce');
    expect(world.menuList(c).map((e) => e.id)).toContain('gunpowder');
  });

  it('the foundry melts ore with coal into metal, without power', () => {
    const world = flatWorld();
    world.rules.add('energy');
    const f = build(world, 'foundry', 200);
    world.store(f, world.spawnItem('ore', f.x, f.y));
    world.store(f, world.spawnItem('coal', f.x, f.y));
    run(world, 40);
    expect(f.activity).toBe('burn');
    run(world, PRODUCTION.foundry.ticks + 5);
    expect(world.items.some((o) => o.def.id === 'metal' && !o.removed)).toBe(true);
    expect(f.contents.length).toBe(0);
  });

  it('the sawmill cuts a felled tree into wood', () => {
    const world = flatWorld();
    const saw = build(world, 'sawmill', 200);
    saw.logs.push(3);
    run(world, 40 + 3 * (PRODUCTION.saw.ticks + 40));
    const wood = world.items.filter((o) => o.def.id === 'wood' && !o.removed && !o.container);
    expect(wood.length).toBeGreaterThanOrEqual(2);
  });

  it('the anvil forges a line kit from metal', () => {
    const world = flatWorld();
    const anvil = build(world, 'anvil', 200);
    const c = clonkAt(world, anvil.x);
    world.give(c, 'metal');
    forge(world, c, anvil, 'linekit');
    expect(c.contained).toBe(anvil);
    run(world, PRODUCTION.anvil.ticks + 2);
    expect(c.contained).toBeNull();
    expect(world.items.some((o) => o.def.id === 'linekit' && !o.removed)).toBe(true);
    expect(world.items.some((o) => o.def.id === 'metal' && !o.removed)).toBe(false);
  });
});

describe('Railway signals', () => {
  it('a signal set to halt stops the engine, and sends it on to the right after its wait', () => {
    const world = flatWorld();
    const sig = build(world, 'signal', 200);
    const bottom = Math.max(...VEHICLES.engine.vertices.map((v) => v.y));
    const e = world.addVehicle('engine', 200, GROUND - 1 - bottom, 0);
    run(world, 3);
    const c = clonkAt(world, 260);
    signalControl(world, c, sig, { ...NO_CONTROL, pressedRight: true });
    expect(sig.signal.phase).toBe(1);
    e.comDir = { x: -1, y: 0 };
    expect(checkSignal(world, e)).toBe(true);
    expect(e.comDir.x).toBe(0);
    run(world, 15 * 8);
    expect(e.comDir.x).toBe(1);
  });

  it('through lets it pass', () => {
    const world = flatWorld();
    const sig = build(world, 'signal', 200);
    const bottom = Math.max(...VEHICLES.engine.vertices.map((v) => v.y));
    const e = world.addVehicle('engine', 200, GROUND - 1 - bottom, 0);
    run(world, 3);
    expect(sig.signal.phase).toBe(0);
    expect(checkSignal(world, e)).toBe(false);
  });
});

describe('Cannon tower guns', () => {
  function mounted(id: VehicleId) {
    const world = flatWorld();
    const tower = build(world, 'cannonTower', 200);
    const bottom = Math.max(...VEHICLES[id].vertices.map((v) => v.y));
    const gun = world.addVehicle(id, 260, GROUND - 1 - bottom, 0);
    expect(mountGun(world, tower, gun)).toBe(true);
    const c = clonkAt(world, tower.exitPoint().x);
    world.enter(c, tower);
    return { world, tower, gun, c };
  }

  it('the flame thrower takes an oil barrel and shoots a burning shot', () => {
    const { world, tower, gun, c } = mounted('flameThrower');
    world.store(tower, world.spawnItem('oilBarrel', tower.x, tower.y));
    run(world, 1);
    expect(gun.oil).toBe(200);
    expect(tower.contents[0].def.id).toBe('barrel');
    tap(world, { pressedDig: true });
    expect(gun.oil).toBe(200 - GUNS.flame.oil);
    expect(world.flameShots.length).toBe(1);
    run(world, 60);
    expect(world.flameShots.length).toBe(0);
    expect(world.flames.length).toBeGreaterThan(5);
    expect(c.contained).toBe(tower);
  });

  it('the lightning cannon charges from a battery and fires two bolts', () => {
    const { world, tower, gun } = mounted('lightningCannon');
    world.store(tower, world.spawnItem('battery', tower.x, tower.y));
    run(world, 1);
    expect(gun.crystals).toBe(GUNS.lightning.battery);
    tap(world, { pressedDig: true });
    expect(gun.crystals).toBe(GUNS.lightning.battery - 1);
    expect(world.towerBolts.length).toBe(2);
    run(world, 40);
    expect(world.towerBolts.length).toBe(0);
  });

  it('the lightning cannon makes crystals from the tower’s power', () => {
    const { world, tower, gun } = mounted('lightningCannon');
    // 350 points make a crystal: more than a tower holds, so keep it powered.
    for (let i = 0; i < 40; i++) {
      tower.energy = 100 * POWER.unit;
      run(world, 15);
    }
    expect(gun.crystals).toBeGreaterThanOrEqual(1);
  });

  it('the liquid cannon empties the tower’s water barrels out of its barrel', () => {
    const { world, tower, gun } = mounted('liquidCannon');
    world.store(tower, world.spawnItem('waterBarrel', tower.x, tower.y));
    world.store(tower, world.spawnItem('acidBarrel', tower.x, tower.y));
    expect(liquidAmmo(tower).map((e) => e.id)).toEqual(['waterBarrel', 'acidBarrel', 'barrel']);
    shootLiquid(world, tower, gun, 'waterBarrel');
    expect(tower.contents.map((o) => o.def.id)).toEqual(['barrel', 'acidBarrel']);
    let water = 0;
    for (let i = 0; i < world.land.cells.length; i++) if (world.land.cells[i] === Mat.Water) water++;
    expect(water + world.land.pxs.count).toBeGreaterThan(100);
  });

  it('munition packs unpack into bullets for the anti-air cannon', () => {
    const { world, tower } = mounted('antiAir');
    world.store(tower, world.spawnItem('munitionPack', tower.x, tower.y));
    run(world, 1);
    expect(tower.contents.filter((o) => o.def.id === 'bullet').length).toBe(GUNS.bullets);
  });
});
