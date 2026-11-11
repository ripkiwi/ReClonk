// Volcanoes, like the original's (Objects.c4d/Effects.c4d/Volcano.c4d and
// C4Weather::LaunchVolcano): a vein of lava eats its way up from the bottom of
// the map, forking now and then, and once it breaks out into the open it
// pours and spits lava for a while. See licenses/clonk_engine_license.txt.

import type { Rng } from '../core/rng';
import { Mat } from '../landscape/materials';
import type { World } from './world';

export interface Volcano {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  /** Width of the vein; it narrows as it climbs, and it's gone at 0. */
  width: number;
  mat: Mat;
  /** Sideways drift per step (forks lean away). */
  xDir: number;
  /** Ticks it pours lava once it's out, and how long it has. */
  liveTime: number;
  time: number;
  /** 'advance': climbing through the ground, a step a tick. 'discharge': out in the open, casting lava every other tick. */
  mode: 'advance' | 'discharge';
  removed: boolean;
}

/** Volcano.c4d Activate: a new vein at x, y, `size` wide. */
export function launchVolcano(world: World, rng: Rng, mat: Mat, x: number, y: number, size: number, xDir = 0): Volcano | null {
  const v: Volcano = { x, y, oldX: x, oldY: y, width: size, mat, xDir, liveTime: 200 + 2 * size, time: 0, mode: 'advance', removed: false };
  if (!inGround(world, v)) return null;
  world.events.push({ type: 'volcano', x, y, tick: world.tick });
  // Round off the bottom end.
  const w2 = Math.trunc(size / 2);
  const q = (n: number): number => (n > 0 ? rng.int(n) : 0);
  fillQuad(world, mat, [
    [x - w2, y],
    [x + w2, y],
    [x + q(w2), y + Math.trunc(size / 4) + q(Math.trunc(size / 4))],
    [x - q(w2), y + Math.trunc(size / 4) + q(Math.trunc(size / 4))],
  ]);
  return v;
}

/** The vein is still underground: solid ground or its own lava 8 px above it. */
function inGround(world: World, v: Volcano): boolean {
  const land = world.land;
  const x = Math.round(v.x);
  const y = Math.round(v.y) - 8;
  if (land.isSolid(x, y)) return true;
  const m = land.get(x, y);
  return m === v.mat || (v.mat === Mat.Lava && m === Mat.DuroLava);
}

/** One tick of every volcano. Forks start in the same list and go on next tick. */
export function stepVolcanoes(world: World, rng: Rng, volcanoes: Volcano[]): Volcano[] {
  const born: Volcano[] = [];
  for (const v of volcanoes) {
    if (v.removed) continue;
    if (v.mode === 'advance') advance(world, rng, v, born);
    else if (world.tick % 2 === 0) castLava(world, rng, v);
    if (v.mode === 'discharge') v.time++;
  }
  return volcanoes.filter((v) => !v.removed).concat(born);
}

/** Volcano.c4d Advance: a step up through the ground, drawing lava behind, throwing loose things up. */
function advance(world: World, rng: Rng, v: Volcano, born: Volcano[]): void {
  const land = world.land;
  const ax = rng.int(11) - 5 + v.xDir;
  const ay = rng.int(8) - 12;
  if (!rng.int(30)) branch(world, rng, v, born);
  let xdir: number;
  let ydir: number;
  if (!inGround(world, v)) {
    v.mode = 'discharge';
    v.time = 0;
    xdir = 30 - rng.int(60);
    ydir = -20 - rng.int(50) - Math.trunc(v.width / 2);
    world.events.push({ type: 'volcano', x: v.x, y: v.y, tick: world.tick });
  } else {
    xdir = (v.x - v.oldX) * 10;
    ydir = (v.y - v.oldY) * 10;
  }
  // Loose objects in the way get thrown along.
  const left = Math.min(v.oldX, v.x) - Math.trunc(v.width / 2);
  const right = left + v.width + Math.abs(v.oldX - v.x);
  for (const item of world.items) {
    if (item.container || item.removed) continue;
    if (item.x < left || item.x >= right || item.y < v.y || item.y >= v.oldY) continue;
    item.xdir = xdir / 10;
    item.ydir = ydir / 10;
  }
  v.oldX = v.x;
  v.oldY = v.y;
  v.x += ax;
  v.y += ay;
  const w2 = Math.trunc(v.width / 2);
  fillQuad(world, v.mat, [
    [v.x - w2, v.y],
    [v.x + w2, v.y],
    [v.oldX + w2, v.oldY],
    [v.oldX - w2, v.oldY],
  ]);
  if (v.x + w2 < 0 || v.x - w2 > land.width || v.y < 0 || v.y > land.height) {
    v.removed = true;
    return;
  }
  // Narrows by one now and then.
  if (!rng.int(5) && --v.width <= 0) v.removed = true;
}

/** Volcano.c4d Branch: a fork splits off part of the width and leans away. */
function branch(world: World, rng: Rng, v: Volcano, born: Volcano[]): void {
  const str = v.width > 0 ? rng.int(v.width) : 0;
  let xDir = 2 + rng.int(4);
  xDir = (1 - 2 * rng.int(2)) * xDir;
  const fork = launchVolcano(world, rng, v.mat, Math.trunc(-v.width / 2 + v.x + str / 2), v.y, str, xDir);
  if (fork) born.push(fork);
  v.width -= str;
}

/**
 * Volcano.c4d CastLava: boil away any other liquid on the vent, pour lava
 * out and now and then spit some up into the air, until its time is up.
 */
function castLava(world: World, rng: Rng, v: Volcano): void {
  const land = world.land;
  if (inGround(world, v)) {
    // Its own lava filled the cave it came out in: climb on.
    v.mode = 'advance';
    return;
  }
  const x = Math.round(v.x);
  const above = land.get(x, Math.round(v.y) - 2);
  if (land.isLiquid(x, Math.round(v.y) - 2) && above !== Mat.Lava && above !== Mat.DuroLava) {
    for (let i = 0; i < 5; i++) land.extractMaterial(x, Math.round(v.y) - 2);
  }
  while (land.isSolid(x, Math.round(v.y)) && v.y > 0) v.y--;
  const y = Math.round(v.y);
  for (let i = 3 + rng.int(5); i > 0; i--) land.insertMaterial(v.mat, x, y);
  if (!rng.int(2)) {
    let dy = 0;
    while (land.get(x, y + dy) === v.mat && y + dy > 0) dy--;
    const w = v.width;
    const amount = Math.max(Math.trunc(w / 2), 5);
    const level = Math.max(50, w) + rng.int(50);
    const cx = x - Math.trunc(w / 2) + (w > 0 ? rng.int(w) : 0);
    const angle = 270 + 10 - rng.int(21);
    const spread = 20 + rng.int(30);
    castPxs(land, rng, v.mat, amount, level, cx, y + dy - 1, angle, spread);
  }
  if (!rng.int(10)) world.events.push({ type: 'volcano', x: v.x, y: v.y, tick: world.tick });
  if (v.time > v.liveTime) v.removed = true;
}

/** CastPXSX: loose pixels flying out at an angle (270 is straight up) give or take half the spread, at level/10 px per tick. */
function castPxs(land: World['land'], rng: Rng, mat: Mat, amount: number, level: number, x: number, y: number, angle: number, spread: number): void {
  for (let i = 0; i < amount; i++) {
    const a = ((angle + rng.int(spread + 1) - Math.trunc(spread / 2)) * Math.PI) / 180;
    const speed = (level / 2 + rng.int(Math.trunc(level / 2) + 1)) / 10;
    land.pxs.create(mat, x, y, Math.cos(a) * speed, Math.sin(a) * speed);
  }
}

/**
 * DrawMaterialQuad: fill a four-cornered shape with material, underground.
 * Buildings' basements stay.
 */
function fillQuad(world: World, mat: Mat, pts: [number, number][]): void {
  const land = world.land;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  // A vein a pixel or two wide is just a line.
  const [ax, ay] = [(pts[0][0] + pts[1][0]) / 2, pts[0][1]];
  const [bx, by] = [(pts[2][0] + pts[3][0]) / 2, pts[2][1]];
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(ax + ((bx - ax) * i) / steps);
    const y = Math.round(ay + ((by - ay) * i) / steps);
    if (land.inBounds(x, y) && land.get(x, y) !== Mat.Basement) {
      land.set(x, y, mat);
      land.setTunnel(x, y, true);
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!land.inBounds(x, y) || !inside(pts, x + 0.5, y + 0.5)) continue;
      if (land.get(x, y) === Mat.Basement) continue;
      land.set(x, y, mat);
      land.setTunnel(x, y, true);
    }
  }
}

function inside(pts: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
