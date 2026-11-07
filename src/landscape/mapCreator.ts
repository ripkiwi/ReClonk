/**
 * The original's dynamic map creator and landscape zoom, ported from the Clonk
 * Rage engine (C4Map.cpp: C4MapCreator::Create; C4Landscape.cpp: ChunkOZoom,
 * DrawChunk, DrawSmoothOChunk; StdSurface8.cpp: Polygon, itself taken from
 * Allegro). Clonk source code: Copyright (c) 2001-2014 RedWolf Design GmbH, ISC
 * license.
 *
 * A scenario describes its landscape with a handful of numbers (map size, zoom,
 * amplitude, phase, period, random, water level, material layers). The map
 * creator draws a small map from them, one pixel per material chunk, and the
 * zoom turns every map pixel into a ragged 10x10 chunk of landscape.
 */
import type { Rng } from '../core/rng';
import { Landscape } from './landscape';
import { MATERIALS, Mat, TEXMAP, texIndex, type ItemId } from './materials';

/**
 * A scenario value with a random spread, like the original's C4SVal: each
 * round picks a value from std - rnd to std + rnd, kept within min..max.
 */
export interface SVal {
  std: number;
  rnd: number;
  min: number;
  max: number;
}

export const sval = (std: number, rnd = 0, min = 0, max = 100): SVal => ({ std, rnd, min, max });

/** Random(n) of the original: 0 for an empty range. */
function random(rng: Rng, n: number): number {
  return n > 0 ? rng.int(n) : 0;
}

/** C4SVal::Evaluate. */
export function evaluate(v: SVal, rng: Rng): number {
  return Math.max(v.min, Math.min(v.max, v.std + random(rng, 2 * v.rnd + 1) - v.rnd));
}

/** The landscape section of a scenario (the original's [Landscape] in Scenario.txt). */
export interface LandscapeDef {
  /** Map size in map pixels; every map pixel becomes `mapZoom` x `mapZoom` landscape pixels. */
  mapWidth: SVal;
  mapHeight: SVal;
  mapZoom: SVal;
  /** Height of the hills, in percent of half the map height. */
  amplitude: SVal;
  /** Where the hills start, in percent of a wave. */
  phase: SVal;
  /** How many hills: percent of 10 waves across the map. */
  period: SVal;
  /** Rugged, random ups and downs on top of the waves. */
  random: SVal;
  /** Water fills the open air below this level, in percent of the map height from the bottom. */
  liquidLevel: SVal;
  /** The map gets wider with each crew taking part (up to 4 times). */
  mapPlayerExtend: boolean;
  /** Open sky above the map; otherwise there's a ceiling. */
  topOpen: boolean;
  /** Things that fall out of the bottom of the map are gone. */
  bottomOpen: boolean;
  /** The ground, and the liquid of lakes (material-texture names from the texture map). */
  material: string;
  liquid: string;
  /** Veins of other materials in the ground: name and amount (per 15000 map pixels). */
  layers: { name: string; count: number }[];
  /** Objects buried in the earth, by relative share, and how many (percent of 1 per 5000 pixels). */
  inEarth: Partial<Record<ItemId, number>>;
  inEarthLevel: SVal;
  /** Not in the original: objects lying on the surface, per 1000 pixels of map width. */
  onSurface: Partial<Record<ItemId, number>>;
}

/** The original's defaults (C4SLandscape::Default). */
export const DEFAULT_LANDSCAPE: LandscapeDef = {
  mapWidth: sval(100, 0, 64, 250),
  mapHeight: sval(50, 0, 40, 250),
  mapZoom: sval(10, 0, 5, 15),
  amplitude: sval(0),
  phase: sval(50),
  period: sval(15),
  random: sval(0),
  liquidLevel: sval(0),
  mapPlayerExtend: false,
  topOpen: true,
  bottomOpen: false,
  material: 'Earth',
  liquid: 'Water',
  layers: [],
  inEarth: {},
  inEarthLevel: sval(50),
  onSurface: {},
};

/** C4S_MaxMapPlayerExtend. */
export const MAX_MAP_PLAYER_EXTEND = 4;

/** The underground flag on a map pixel (MapIFT): the chunk gets tunnel background. */
export const IFT = 128;

/** A map: one byte per pixel, a texture map index plus IFT. */
export interface MapData {
  width: number;
  height: number;
  pix: Uint8Array;
}

/** C4SLandscape::GetMapSize. */
export function mapSize(l: LandscapeDef, rng: Rng, players: number): { width: number; height: number } {
  let width = evaluate(l.mapWidth, rng);
  const height = evaluate(l.mapHeight, rng);
  if (l.mapPlayerExtend) width = Math.min(width * Math.min(Math.max(players, 1), MAX_MAP_PLAYER_EXTEND), l.mapWidth.max);
  return { width, height };
}

/** sin() from plain arithmetic, so every browser draws the same map. */
function dsin(x: number): number {
  const TAU = 2 * Math.PI;
  x -= Math.floor(x / TAU) * TAU;
  let sign = 1;
  if (x > Math.PI) {
    x -= Math.PI;
    sign = -1;
  }
  if (x > Math.PI / 2) x = Math.PI - x;
  const x2 = x * x;
  // Taylor series to x^13: error below 1e-11 on [0, pi/2].
  let term = x;
  let sum = x;
  for (let n = 1; n <= 6; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sign * sum;
}

/**
 * C4MapCreator::Create: rolling surface from a sine wave plus a random walk,
 * everything below it filled with the ground material (underground), water
 * up to the liquid level, then veins of other materials drawn into the ground.
 */
export function createMap(l: LandscapeDef, rng: Rng, players: number, layers = true): MapData {
  const { width: w, height: h } = mapSize(l, rng, players);
  const pix = new Uint8Array(w * h);
  let exclusive = -1;
  const get = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w && y < h ? pix[y * w + x] : 0);
  const set = (x: number, y: number, c: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (exclusive > -1 && pix[y * w + x] !== exclusive) return;
    pix[y * w + x] = c;
  };

  // Surface
  const ground = texIndex(l.material, 'Smooth') + IFT;
  const amplitude = evaluate(l.amplitude, rng);
  const phase = evaluate(l.phase, rng);
  let period = evaluate(l.period, rng);
  if (l.mapPlayerExtend) period *= Math.min(players, MAX_MAP_PLAYER_EXTEND);
  const natural = evaluate(l.random, rng);
  const level0 = Math.trunc(Math.min(w, h) / 2);
  const maxrange = Math.trunc((level0 * 3) / 4);
  let rndCy = (random(rng, 2000 + 1) - 1000) / 1000;
  let rndTend = (random(rng, 200 + 1) - 100) / 20000;
  const fullperiod = 20 * Math.PI;
  for (let x = 0; x < w; x++) {
    rndCy += rndTend;
    rndTend += (random(rng, 100 + 1) - 50) / 10000;
    if (rndTend > 0.05) rndTend = 0.05;
    if (rndTend < -0.05) rndTend = -0.05;
    if (rndCy < -0.5) rndTend += 0.01;
    if (rndCy > 0.5) rndTend -= 0.01;
    const cyNatural = (rndCy * natural) / 100;
    const cyCurve = (dsin(((fullperiod * period) / 100) * (x / w) + (2 * Math.PI * phase) / 100) * amplitude) / 100;
    const cy = level0 + Math.max(-maxrange, Math.min(maxrange, Math.trunc(maxrange * (cyCurve + cyNatural))));
    set(x, cy, ground);
  }
  // Raise bottom to surface
  for (let x = 0; x < w; x++) for (let y = h - 1; y >= 0 && !get(x, y); y--) set(x, y, ground);
  // Raise liquid level
  exclusive = 0;
  const liquid = texIndex(l.liquid, 'Smooth');
  const level = evaluate(l.liquidLevel, rng);
  for (let x = 0; x < w; x++) for (let y = Math.trunc((h * (100 - level)) / 100); y < h; y++) set(x, y, liquid);
  exclusive = -1;

  // Layers
  if (layers) {
    exclusive = ground;
    for (const layer of l.layers) {
      const col = texIndex(layer.name, 'Rough');
      if (!col) continue;
      const count = Math.trunc((layer.count * w * h) / 15000);
      for (let i = 0; i < count; i++) {
        const sx = random(rng, w);
        let sy = 0;
        while (sy < h && get(sx, sy) !== exclusive) sy++;
        sy += 5 + random(rng, h - sy - 10);
        // DrawLayer
        let x = sx;
        let y = sy;
        const size = random(rng, 15);
        for (let k = 0; k < size; k++) {
          x += random(rng, 9) - 4;
          y += random(rng, 3) - 1;
          for (let c = random(rng, 3); c < 5; c++) {
            set(x + c, y, col + IFT);
            set(x + c + 1, y + 1, col + IFT);
          }
        }
      }
    }
    exclusive = -1;
  }
  return { width: w, height: h, pix };
}

/** Chunk shapes of the materials (the .c4m files' Shape). */
const enum Chunk {
  Flat = 0,
  TopFlat = 1,
  Smooth = 2,
  Rough = 3,
}

/** A painter that fills polygons into the landscape, with Allegro's scanline rules like the original. */
class Painter {
  constructor(
    private readonly land: Landscape,
    private readonly mapSeed: number,
  ) {}

  mat: Mat = Mat.Sky;
  tex = 0;
  underground = false;

  private pixel(x: number, y: number): void {
    if (!this.land.inBounds(x, y)) return;
    this.land.paint(x, y, this.mat, this.tex);
    this.land.setTunnel(x, y, this.underground);
  }

  /** ChunkyRandom: cheap per-chunk noise from the chunk's coordinates and the map seed. */
  private rnd(c: { o: number }, range: number): number {
    if (!range) return 0;
    c.o += 3;
    return ((c.o ^ this.mapSeed) >>> 0) % range;
  }

  /** CSurface8::Polygon. */
  polygon(v: number[]): void {
    const SHIFT = 16;
    type Edge = { y: number; bottom: number; x: number; dx: number; w: number };
    const edges: Edge[] = [];
    const n = v.length / 2;
    let top = Infinity;
    let bottom = -Infinity;
    for (let c = 0, j = n - 1; c < n; j = c, c++) {
      let x1 = v[c * 2];
      let y1 = v[c * 2 + 1];
      let x2 = v[j * 2];
      let y2 = v[j * 2 + 1];
      if (y1 === y2) continue;
      if (y2 < y1) [x1, y1, x2, y2] = [x2, y2, x1, y1];
      const dx = Math.trunc(((x2 - x1) * (1 << SHIFT)) / (y2 - y1));
      let x = x1 * (1 << SHIFT) + (1 << (SHIFT - 1)) - 1;
      if (dx < 0) x += Math.min(dx + (1 << SHIFT), 0);
      const e = { y: y1, bottom: y2 - 1, x, dx, w: Math.max(Math.abs(dx) - (1 << SHIFT), 0) };
      if (e.bottom < e.y) continue;
      top = Math.min(top, e.y);
      bottom = Math.max(bottom, e.bottom);
      edges.push(e);
    }
    const mid = (e: Edge): number => e.x + e.w / 2;
    for (let y = top; y <= bottom; y++) {
      const active = edges.filter((e) => e.y <= y && y <= e.bottom).sort((a, b) => mid(a) - mid(b));
      for (let k = 0; k + 1 < active.length; k += 2) {
        let x1 = active[k].x >> SHIFT;
        let x2 = (active[k + 1].x + active[k + 1].w) >> SHIFT;
        if (x1 > x2) [x1, x2] = [x2, x1];
        for (let x = x1; x <= x2; x++) this.pixel(x, y);
      }
      for (const e of active) if (y < e.bottom) e.x += e.dx;
    }
  }

  /** DrawChunk: a ragged octagon around a map pixel's square. */
  chunk(tx: number, ty: number, wdt: number, hgt: number, type: Chunk, cro: number): void {
    if (type === Chunk.Flat) {
      for (let y = ty; y <= ty + hgt; y++) for (let x = tx; x <= tx + wdt; x++) this.pixel(x, y);
      return;
    }
    const top = type === Chunk.TopFlat ? 0 : 1;
    const side = type === Chunk.Rough ? 2 : 1;
    const c = { o: cro };
    const rx = Math.max(Math.trunc(wdt / 2), 1);
    const r = (range: number): number => this.rnd(c, range);
    const half = Math.trunc(rx / 2);
    const v = [
      tx - r(half), ty - r(half * top),
      tx - r(rx * side), ty + Math.trunc(hgt / 2),
      tx - r(rx), ty + hgt + r(rx),
      tx + Math.trunc(wdt / 2), ty + hgt + r(2 * rx),
      tx + wdt + r(rx), ty + hgt + r(rx),
      tx + wdt + r(rx * side), ty + Math.trunc(hgt / 2),
      tx + wdt + r(half), ty - r(half * top),
      tx + Math.trunc(wdt / 2), ty - r(rx * top),
    ];
    this.polygon(v);
  }

  /** DrawSmoothOChunk: fills the step where a smooth material goes down a slope. */
  smoother(tx: number, ty: number, wdt: number, hgt: number, flip: boolean, cro: number): void {
    const c = { o: cro };
    const rx = Math.max(Math.trunc(wdt / 2), 1);
    const half = Math.trunc(rx / 2);
    const v = [tx, ty - this.rnd(c, half), tx, ty + hgt, tx + wdt, ty + hgt, tx + wdt, ty - this.rnd(c, half)];
    if (flip) {
      v[0] = tx + Math.trunc(wdt / 2);
      v[1] = ty + Math.trunc(hgt / 3);
    } else {
      v[6] = tx + Math.trunc(wdt / 2);
      v[7] = ty + Math.trunc(hgt / 3);
    }
    this.polygon(v);
  }
}

/**
 * C4Landscape::MapToLandscape: every map pixel becomes a chunk of landscape,
 * texture by texture in texture map order, so later materials overlap the
 * earlier ones with their ragged edges.
 */
export function mapToLandscape(map: MapData, zoom: number, mapSeed: number, land = new Landscape(map.width * zoom, map.height * zoom)): Landscape {
  const p = new Painter(land, mapSeed);
  const { width: mw, height: mh, pix } = map;
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < mw && y < mh ? pix[y * mw + x] : 0);
  const used = new Set<number>();
  for (const c of pix) used.add(c & (IFT - 1));
  for (let t = 1; t < TEXMAP.length; t++) {
    if (!used.has(t)) continue;
    const entry = TEXMAP[t];
    const type = entry.shape as Chunk;
    p.mat = entry.mat;
    p.tex = t;
    for (let y = 0; y < mh; y++) {
      const ty = y * zoom;
      for (let x = 0; x < mw; x++) {
        const here = at(x, y);
        const tx = x * zoom;
        const cro = (x << 2) + y;
        if ((here & (IFT - 1)) === t) {
          p.underground = here >= IFT;
          p.chunk(tx, ty, zoom, zoom, type, cro);
        } else if (type === Chunk.Smooth && y < mh - 1 && (at(x, y + 1) & (IFT - 1)) === t) {
          // Smooth slopes: fill the step next to a chunk of the same texture.
          if (x > 0 && (at(x - 1, y) & (IFT - 1)) === t) {
            p.underground = at(x - 1, y) >= IFT;
            p.smoother(tx, ty, zoom, zoom, false, cro);
          }
          if (x < mw - 1 && (at(x + 1, y) & (IFT - 1)) === t) {
            p.underground = at(x + 1, y) >= IFT;
            p.smoother(tx, ty, zoom, zoom, true, cro);
          }
        }
      }
    }
  }
  return land;
}

/** Tunnel colour in the editor's map preview (the original's Tunnel material). */
const TUNNEL_COLOR = 0x523212;

/** Colour of a map pixel in the editor's preview: its material's first colour, like the original; -1 for sky. */
export function mapColor(c: number): number {
  const t = c & (IFT - 1);
  if (!t) return -1;
  const e = TEXMAP[t];
  return e.mat === Mat.Sky ? TUNNEL_COLOR : MATERIALS[e.mat].colors[0];
}
