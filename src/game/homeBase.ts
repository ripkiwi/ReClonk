import { Mat } from '../landscape/materials';
import { STRUCTURES } from '../objects/defs';
import type { Structure } from '../objects/structure';
import type { PlayerState, ShopId, World } from './world';

/** Starting money and home base stock for the default scenario (like Scenario.txt Wealth / HomeBaseMaterial). */
export const DEFAULT_START: { wealth: number; stock: Partial<Record<ShopId, number>> } = {
  wealth: 25,
  stock: { flint: 10, rock: 10, clonk: 5 },
};

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
 * Put up a building on the surface at column `x`: level the ground under it
 * (clear hills above, fill dips below with earth), then place it standing on that floor.
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
  return world.addStructure(id, x, floor - (def.offset.y + def.height), base);
}

/**
 * Default scenario setup for one player: a wooden hut with their flag (their
 * home base) where the crew starts, starting gold and stock, and an ordinary
 * hut without a flag a bit further away.
 */
export function setupDefaultBases(world: World, player: number, spawnX: number): { home: Structure; player: PlayerState } {
  const state = world.addPlayer(player, DEFAULT_START);
  const home = buildOnSurface(world, 'hut', findBuildSite(world, 'hut', spawnX), player);
  const awayX = spawnX + (spawnX < world.land.width / 2 ? 260 : -260);
  buildOnSurface(world, 'hut', findBuildSite(world, 'hut', awayX));
  return { home, player: state };
}
