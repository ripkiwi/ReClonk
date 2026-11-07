import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { createMap, evaluate, mapColor, type LandscapeDef } from '../landscape/mapCreator';
import { MATERIALS, Mat } from '../landscape/materials';
import { crewCount, type ScenarioDef } from '../game/scenarios';

const SKY_TOP = [0x6f, 0xa6, 0xe0];
const SKY_BOTTOM = [0xc4, 0xdf, 0xf6];
const TUNNEL = [0x5c, 0x42, 0x1e];
const ITEM_COLORS: Record<string, number[]> = { flint: [0xc0, 0x20, 0x10], gold: [0xff, 0xe0, 0x30], rock: [0x50, 0x50, 0x50] };

/** Recent previews, by everything that shapes the map, so edited scenarios get a fresh picture. */
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_SIZE = 12;

/** A canvas can only be in one place on the page: hand out copies of cached pictures. */
function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

/**
 * A small picture of a scenario's map, like the title image the original shows
 * in its scenario book. Generated from the scenario itself, so mods get one for free.
 */
export function scenarioPreview(s: ScenarioDef, width = 206, height = 156): HTMLCanvasElement {
  const key = JSON.stringify([s.landscape, s.seed, s.opponents, width, height]);
  const cached = cache.get(key);
  if (cached) return copyOf(cached);

  const map = generateMap(s.landscape, s.seed, { players: crewCount(s) });
  const { land } = map;
  // Fill the picture: show the full map height and crop the sides, centred on the start.
  const scale = Math.min(land.width / width, land.height / height);
  const x0 = Math.max(0, Math.min(land.width - width * scale, map.spawn.x - (width * scale) / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = Math.floor(x0 + px * scale);
      const y = Math.floor(py * scale);
      const m = land.get(x, y);
      let c: number[];
      if (y >= land.height) c = [0x20, 0x18, 0x10];
      else if (m === Mat.Sky) {
        if (land.isTunnel(x, y)) c = TUNNEL;
        else {
          const t = py / height;
          c = SKY_TOP.map((v, i) => v + (SKY_BOTTOM[i] - v) * t);
        }
      } else {
        const col = MATERIALS[m].colors[m === Mat.Earth ? 1 : 2];
        c = [(col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff];
      }
      const o = (py * width + px) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  // Loose objects lying on the surface show as dots.
  for (const it of map.items) {
    if (land.get(it.x, it.y) !== Mat.Sky) continue;
    const px = Math.floor((it.x - x0) / scale);
    const py = Math.floor(it.y / scale);
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const c = ITEM_COLORS[it.id] ?? [0, 0, 0];
    const o = (py * width + px) * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, canvas);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return copyOf(canvas);
}

export interface MapPreviewOptions {
  /** Draw the material layers too (the original's "Layers" display option). */
  layers: boolean;
  /** Frame the part of the map one screen shows (the original's "Screen size"). */
  screen: boolean;
  /** Crews taking part, for maps that grow with the number of players. */
  players: number;
  /** Size of the screen frame in landscape pixels. */
  screenSize?: { width: number; height: number };
}

/**
 * The editor's map preview, like the original's Scenario Properties: the map
 * the map creator draws, one block per map pixel in its material's colour on a
 * blue sky, fitted into the box, with a hatched frame the size of one screen.
 * Uses the scenario's seed, so it's the map the round gets.
 */
export function mapPreview(l: LandscapeDef, seed: number, o: MapPreviewOptions, boxW: number, boxH: number): HTMLCanvasElement {
  const rng = new Rng(seed);
  const map = createMap(l, rng, o.players, o.layers);
  const zoom = evaluate(l.mapZoom, rng);
  const s = Math.min(boxW / map.width, boxH / map.height);
  const w = Math.max(1, Math.round(map.width * s));
  const hgt = Math.max(1, Math.round(map.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, hgt);
  const d = img.data;
  for (let py = 0; py < hgt; py++) {
    const my = Math.min(map.height - 1, Math.floor(py / s));
    for (let px = 0; px < w; px++) {
      const mx = Math.min(map.width - 1, Math.floor(px / s));
      const c = mapColor(map.pix[my * map.width + mx]);
      const o4 = (py * w + px) * 4;
      // Sky in the original preview's blue.
      d[o4] = c < 0 ? 100 : (c >> 16) & 0xff;
      d[o4 + 1] = c < 0 ? 100 : (c >> 8) & 0xff;
      d[o4 + 2] = c < 0 ? 255 : c & 0xff;
      d[o4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (o.screen) {
    const screen = o.screenSize ?? { width: 800, height: 600 };
    const fw = Math.min(w, Math.round((screen.width * w) / (map.width * zoom)));
    const fh = Math.min(hgt, Math.round((screen.height * hgt) / (map.height * zoom)));
    // A hatched black frame, like the original's diagonal-hatch brush.
    const hatch = document.createElement('canvas');
    hatch.width = hatch.height = 4;
    const hc = hatch.getContext('2d');
    if (hc) {
      hc.fillStyle = '#000';
      for (let i = 0; i < 4; i++) hc.fillRect(3 - i, i, 1, 1);
      const pattern = ctx.createPattern(hatch, 'repeat');
      if (pattern) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, fw - 2, fh - 2);
      }
    }
  }
  return canvas;
}
