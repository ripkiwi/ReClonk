import { Rng } from '../core/rng';
import { Landscape } from './landscape';
import { Mat, type ItemId } from './materials';

export interface GeneratedMap {
  land: Landscape;
  /** Loose objects buried in the earth, revealed by digging (like the original's "InEarth" objects). */
  items: { id: ItemId; x: number; y: number }[];
  /** Where the first clonk starts, standing on the surface. */
  spawn: { x: number; y: number };
  /** Surface height per column. */
  surface: Int32Array;
}

/** Smooth 1D value noise from the seeded RNG, summed over a few octaves. Integer-only, deterministic. */
function heightProfile(width: number, rng: Rng, octaves: { step: number; amp: number }[]): Int32Array {
  const out = new Int32Array(width);
  for (const { step, amp } of octaves) {
    const knots = Array.from({ length: Math.ceil(width / step) + 2 }, () => rng.int(amp * 2 + 1) - amp);
    for (let x = 0; x < width; x++) {
      const k = Math.floor(x / step);
      const t = x - k * step;
      // Smoothstep interpolation in integers (scaled by step^3).
      const s = 3 * t * t * step - 2 * t * t * t;
      const s3 = step * step * step;
      out[x] += Math.trunc((knots[k] * (s3 - s) + knots[k + 1] * s) / s3);
    }
  }
  return out;
}

/** A blobby, slanted vein of a material: a chain of overlapping ellipses following a random walk. */
function vein(land: Landscape, rng: Rng, m: Mat, x: number, y: number, length: number, thickness: number): void {
  let dirX = rng.bool() ? 1 : -1;
  let dirY = rng.int(3) - 1;
  for (let i = 0; i < length; i++) {
    const rx = thickness + rng.int(thickness);
    const ry = Math.max(2, Math.floor(thickness * 0.7) + rng.int(thickness));
    for (let yy = y - ry; yy <= y + ry; yy++) {
      for (let xx = x - rx; xx <= x + rx; xx++) {
        const dx = xx - x;
        const dy = yy - y;
        if (dx * dx * ry * ry + dy * dy * rx * rx > rx * rx * ry * ry) continue;
        const here = land.get(xx, yy);
        if (here === Mat.Earth || here === Mat.Sand || (m === Mat.Granite && here !== Mat.Sky)) land.set(xx, yy, m);
      }
    }
    x += dirX * (rx - 1);
    y += dirY * Math.max(1, ry - 2);
    if (rng.int(4) === 0) dirY = rng.int(3) - 1;
    if (rng.int(8) === 0) dirX = -dirX;
  }
}

/**
 * Generate a map in the spirit of a classic Clonk scenario: rolling hills of
 * earth with a sandy top, rock and gold veins, granite near the bottom, a lake,
 * and flints, rocks and gold buried in the ground.
 */
export interface MapOptions {
  /** Height of the hills; 1 is the default rolling landscape, near 0 is flat. */
  hilliness: number;
  /** Multipliers for how many rock and gold veins there are. */
  rockVeins: number;
  goldVeins: number;
  lake: boolean;
  /** Buried objects per 1000 pixels of map width. */
  buried: Record<ItemId, number>;
  /** Objects lying loose on the surface per 1000 pixels of map width. */
  onSurface: Partial<Record<ItemId, number>>;
}

export const DEFAULT_MAP: MapOptions = {
  hilliness: 1,
  rockVeins: 1,
  goldVeins: 1,
  lake: true,
  buried: { flint: 20, rock: 1000 / 70, gold: 1000 / 120 },
  onSurface: {},
};

export function generateMap(width: number, height: number, seed: number, options: Partial<MapOptions> = {}): GeneratedMap {
  const opt = { ...DEFAULT_MAP, ...options };
  const rng = new Rng(seed);
  const land = new Landscape(width, height);
  const base = Math.floor(height * 0.38);
  const hills = heightProfile(width, rng, [
    { step: 160, amp: Math.floor(height * 0.12 * opt.hilliness) },
    { step: 40, amp: Math.floor(height * 0.03 * Math.max(opt.hilliness, 0.3)) },
  ]);
  const surface = new Int32Array(width);
  for (let x = 0; x < width; x++) surface[x] = base + hills[x];
  const sandDepth = heightProfile(width, rng, [{ step: 30, amp: 3 }]);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (y < surface[x]) continue;
      land.set(x, y, y - surface[x] < 4 + sandDepth[x] ? Mat.Sand : Mat.Earth);
      land.setTunnel(x, y, true);
    }
  }

  // Granite: a ragged bottom layer plus a few boulders.
  const graniteTop = heightProfile(width, rng, [{ step: 30, amp: 6 }]);
  for (let x = 0; x < width; x++) {
    for (let y = height - 12 + graniteTop[x]; y < height; y++) land.set(x, y, Mat.Granite);
  }
  const area = width * height;
  for (let i = 0; i < area / 120000; i++) {
    vein(land, rng, Mat.Granite, rng.int(width), base + 60 + rng.int(height - base - 80), 3 + rng.int(4), 7);
  }
  // Rock veins.
  for (let i = 0; i < (area / 16000) * opt.rockVeins; i++) {
    const x = rng.int(width);
    vein(land, rng, Mat.Rock, x, surface[x] + 15 + rng.int(height - surface[x] - 30), 5 + rng.int(10), 7);
  }
  // Gold veins, deeper down.
  for (let i = 0; i < (area / 45000) * opt.goldVeins; i++) {
    const x = rng.int(width);
    const top = surface[x] + 50;
    if (top >= height - 30) continue;
    vein(land, rng, Mat.Gold, x, top + rng.int(height - top - 30), 5 + rng.int(8), 8);
  }

  // A lake in the deepest valley.
  let lowest = Math.floor(width * 0.1);
  for (let x = lowest; x < width * 0.9; x++) if (surface[x] > surface[lowest]) lowest = x;
  const lakeR = 28;
  const lakeTop = opt.lake ? surface[lowest] - lakeR : 1;
  const lakeBottom = opt.lake ? surface[lowest] + lakeR : 0;
  for (let y = lakeTop; y <= lakeBottom; y++) {
    for (let x = lowest - lakeR * 2; x <= lowest + lakeR * 2; x++) {
      const dx = (x - lowest) / 2;
      const dy = y - surface[lowest];
      if (dx * dx + dy * dy > lakeR * lakeR || !land.inBounds(x, y)) continue;
      const waterLine = surface[lowest] - 4;
      if (land.get(x, y) === Mat.Granite) continue;
      land.set(x, y, y >= waterLine ? Mat.Water : Mat.Sky);
      land.setTunnel(x, y, false);
    }
  }

  // Buried objects: flints and rocks close to the surface, gold a bit deeper.
  const items: GeneratedMap['items'] = [];
  const bury = (id: ItemId, count: number, minDepth: number, maxDepth: number): void => {
    for (let i = 0; i < count; i++) {
      const x = 4 + rng.int(width - 8);
      const y = surface[x] + minDepth + rng.int(maxDepth - minDepth);
      if (land.get(x, y) === Mat.Earth) items.push({ id, x, y });
    }
  };
  const per = (n: number): number => Math.floor((n * width) / 1000);
  bury('flint', per(opt.buried.flint), 12, 60);
  bury('rock', per(opt.buried.rock), 8, 80);
  bury('gold', per(opt.buried.gold), 40, 160);
  for (const [id, n] of Object.entries(opt.onSurface) as [ItemId, number][]) {
    for (let i = 0; i < per(n); i++) {
      const x = 4 + rng.int(width - 8);
      // Resting right on the ground: dropped from higher up, flints would explode on landing.
      items.push({ id, x, y: surface[x] - 1 });
    }
  }

  // Start on the surface, a third of the way in and away from the lake.
  let sx = Math.floor(width / 3);
  if (opt.lake && Math.abs(sx - lowest) < lakeR * 3) sx = Math.floor((width * 2) / 3);
  return { land, items, spawn: { x: sx, y: surface[sx] - 10 }, surface };
}
