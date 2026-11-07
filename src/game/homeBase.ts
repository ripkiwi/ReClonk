import { Mat } from '../landscape/materials';
import { STRUCTURES } from '../objects/defs';
import type { Structure } from '../objects/structure';
import { DEFAULT_BASE, type BaseSettings } from './scenarios';
import type { PlayerState, World } from './world';

/** First solid (or liquid) row in a column. */
export function groundAt(world: World, x: number): number {
  const { land } = world;
  for (let y = 0; y < land.height; y++) if (land.get(x, y) !== Mat.Sky) return y;
  return land.height;
}

/** True if there is water near the surface anywhere in [x0, x1]. */
function wet(world: World, x0: number, x1: number): boolean {
  for (let x = x0; x <= x1; x++) {
    const y = groundAt(world, x);
    if (world.land.isLiquid(x, y) || world.land.isLiquid(x, y + 2)) return true;
  }
  return false;
}

/** The nearest column to `nearX` with dry ground, for a crew to start on. */
export function dryGround(world: World, nearX: number): number {
  const { width } = world.land;
  for (let d = 0; d < width; d += 4) {
    for (const x of [nearX + d, nearX - d]) {
      if (x >= 10 && x < width - 10 && !wet(world, x - 6, x + 6)) return x;
    }
  }
  return nearX;
}

/**
 * Find a dry spot for a building near `nearX`, searching outwards, preferring
 * flat ground. Returns the centre column.
 */
export function findBuildSite(world: World, id: string, nearX: number): number {
  const half = STRUCTURES[id].width / 2;
  const { width } = world.land;
  let best = Math.max(half + 2, Math.min(width - half - 3, nearX));
  let bestScore = Infinity;
  for (let d = 0; d < width; d += 4) {
    for (const x of [nearX + d, nearX - d]) {
      if (x - half < 2 || x + half >= width - 2 || wet(world, x - half - 4, x + half + 4)) continue;
      if (world.structures.some((s) => Math.abs(s.x - x) < (s.def.width + STRUCTURES[id].width) / 2 + 10)) continue;
      const bumpiness = Math.abs(groundAt(world, x - half) - groundAt(world, x + half));
      const score = bumpiness + d / 8;
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    if (bestScore < d / 8) break;
  }
  return best;
}

/**
 * Lay a building's stone basement right under it, like the original's
 * buildings do when they're put up: solid ground that can't be dug, only
 * broken by blasts. Remembers the ground it replaced, to put back if it breaks.
 */
export function layBasement(world: World, s: Structure, floor: number): void {
  const b = s.def.basement;
  if (!b) return;
  const { land } = world;
  const x0 = s.x - Math.floor(b.width / 2);
  const n = b.width * b.height;
  const saved = { cells: new Uint8Array(n), tex: new Uint8Array(n), tunnel: new Uint8Array(n) };
  for (let dy = 0; dy < b.height; dy++) {
    for (let dx = 0; dx < b.width; dx++) {
      const x = x0 + dx;
      const y = floor + dy;
      if (!land.inBounds(x, y)) continue;
      const i = y * land.width + x;
      const k = dy * b.width + dx;
      saved.cells[k] = land.cells[i];
      saved.tex[k] = land.tex[i];
      saved.tunnel[k] = land.tunnel[i];
      land.set(x, y, Mat.Basement);
      land.setTunnel(x, y, true);
    }
  }
  s.basement = { x: x0, y: floor, w: b.width, h: b.height, damage: 0, saved };
}

/**
 * Put up a building on the surface at column `x`: level the ground under it
 * (clear hills above, fill dips below with earth), then place it standing on
 * that floor, on its basement.
 */
export function buildOnSurface(world: World, id: string, x: number, base = -1): Structure {
  const def = STRUCTURES[id];
  const { land } = world;
  const floor = groundAt(world, x);
  const x0 = x + def.offset.x - 2;
  const x1 = x + def.offset.x + def.width + 2;
  for (let xx = x0; xx <= x1; xx++) {
    for (let y = floor - def.height - 10; y < floor; y++) {
      land.set(xx, y, Mat.Sky);
      land.setTunnel(xx, y, false);
    }
    for (let y = floor; y < land.height && land.get(xx, y) === Mat.Sky; y++) land.set(xx, y, Mat.Earth);
  }
  // Bottom edge of the building sits on the floor row.
  const s = world.addStructure(id, x, floor - (def.offset.y + def.height), base);
  layBasement(world, s, floor);
  return s;
}

/**
 * Default scenario setup for one player: a wooden hut with their flag (their
 * home base) where the crew starts, starting gold and stock, and an ordinary
 * hut without a flag a bit further away.
 */
export function setupDefaultBases(
  world: World,
  player: number,
  spawnX: number,
  start: BaseSettings = DEFAULT_BASE,
  spareHut = true,
): { home: Structure; player: PlayerState } {
  const state = world.addPlayer(player, start);
  const home = buildOnSurface(world, 'hut', findBuildSite(world, 'hut', spawnX), player);
  if (spareHut) {
    const awayX = spawnX + (spawnX < world.land.width / 2 ? 260 : -260);
    buildOnSurface(world, 'hut', findBuildSite(world, 'hut', awayX));
  }
  return { home, player: state };
}
