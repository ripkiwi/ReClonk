import { Rng } from '../core/rng';
import { Landscape } from './landscape';
import { Mat } from './materials';

/** Smooth 1D value noise built from the seeded RNG: integer-only, deterministic. */
function heightProfile(width: number, rng: Rng, base: number, amplitude: number, step: number): Int32Array {
  const points = Math.ceil(width / step) + 2;
  const knots = Array.from({ length: points }, () => rng.int(amplitude * 2 + 1) - amplitude);
  const out = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    const k = Math.floor(x / step);
    const t = x - k * step;
    // Linear interpolation in integers.
    out[x] = base + Math.trunc((knots[k] * (step - t) + knots[k + 1] * t) / step);
  }
  return out;
}

function blob(land: Landscape, rng: Rng, m: Mat, minY: number, rx: number, ry: number): void {
  const cx = rng.int(land.width);
  const cy = minY + rng.int(Math.max(1, land.height - minY - ry));
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx * ry * ry + dy * dy * rx * rx <= rx * rx * ry * ry && land.get(x, y) === Mat.Earth) {
        land.set(x, y, m);
      }
    }
  }
}

/** Generate a simple test map: rolling hills, ore pockets, a lake and a granite floor. */
export function generateLandscape(width: number, height: number, seed: number): Landscape {
  const rng = new Rng(seed);
  const land = new Landscape(width, height);
  const surface = heightProfile(width, rng, Math.floor(height * 0.4), Math.floor(height * 0.08), 40);
  const sandDepth = heightProfile(width, rng, 6, 4, 25);

  for (let x = 0; x < width; x++) {
    for (let y = surface[x]; y < height; y++) {
      const depth = y - surface[x];
      land.set(x, y, depth < sandDepth[x] ? Mat.Sand : Mat.Earth);
    }
    for (let y = height - 4 - rng.int(3); y < height; y++) land.set(x, y, Mat.Granite);
  }

  const pockets = Math.floor((width * height) / 9000);
  for (let i = 0; i < pockets; i++) blob(land, rng, Mat.Rock, surface[0] + 20, 6 + rng.int(10), 3 + rng.int(6));
  for (let i = 0; i < pockets / 2; i++) blob(land, rng, Mat.Gold, surface[0] + 30, 3 + rng.int(5), 2 + rng.int(3));

  // A small lake in the lowest valley.
  let lowest = 0;
  for (let x = 1; x < width; x++) if (surface[x] > surface[lowest]) lowest = x;
  land.paint(lowest, surface[lowest] - 4, 14, Mat.Water);

  land.dirty = true;
  return land;
}
