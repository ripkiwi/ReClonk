import { Rng } from '../core/rng';
import type { Landscape } from './landscape';
import { createMap, DEFAULT_LANDSCAPE, evaluate, mapToLandscape, type LandscapeDef, type MapData } from './mapCreator';
import { MapScriptError, runMapScript } from './mapScript';
import { placeGrass, placeVegetation, type Grass, type PlantId } from '../objects/vegetation';
import { LIQUID, MATERIALS, Mat, type ItemId } from './materials';

export interface GeneratedMap {
  land: Landscape;
  /** The small map the landscape was zoomed from, one pixel per chunk. */
  map: MapData;
  zoom: number;
  /** Loose objects: buried in the earth (the original's "InEarth" objects) and lying on the surface. */
  items: { id: ItemId; x: number; y: number }[];
  /** Where the first clonk starts, standing on the surface (in caves: on a cave floor). */
  spawn: { x: number; y: number };
  /** A map with no open sky to start under, like Lava Caves: the crew starts on a cave floor near the spawn. */
  cave: boolean;
  /** Height of the ground (first non-sky pixel) per column. */
  surface: Int32Array;
  /** Trees and bushes: centre x, bottom, how grown (con) and which way they face. */
  plants: { id: PlantId; x: number; bottom: number; con: number; dir: -1 | 1 }[];
  grass: Grass[];
}

/** How many crews take part, for maps that grow with the number of players. */
export interface MapContext {
  players: number;
}

/**
 * Build the world of a scenario the way the original does: the map creator
 * draws a small map from the scenario's landscape values, the landscape zoom
 * turns it into ragged chunks of material, and objects are buried in the earth
 * (C4Game::PlaceInEarth). The same landscape, seed and player count always give
 * the same world.
 */
export function generateMap(l: LandscapeDef = DEFAULT_LANDSCAPE, seed = 0, ctx: MapContext = { players: 1 }): GeneratedMap {
  const rng = new Rng(seed);
  const map = scriptedMap(l, rng, ctx.players) ?? createMap(l, rng, ctx.players);
  const zoom = evaluate(l.mapZoom, rng);
  const land = mapToLandscape(map, zoom, rng.int(3133700));
  land.topOpen = l.topOpen;
  land.bottomOpen = l.bottomOpen;
  const { width, height } = land;

  const surface = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height && land.get(x, y) === Mat.Sky) y++;
    surface[x] = y;
  }
  const dryAt = (x: number): boolean => surface[x] < height && MATERIALS[land.get(x, surface[x])].density > LIQUID;

  // Objects in the earth: one per 5000 pixels at level 100, each placed at a random spot of earth.
  const items: GeneratedMap['items'] = [];
  // In a fixed order, so the same settings always make the same map however they were saved.
  const sorted = <T>(r: Partial<Record<ItemId, T>>): [ItemId, T][] => (Object.entries(r) as [ItemId, T][]).sort(([a], [b]) => (a < b ? -1 : 1));
  const kinds = sorted(l.inEarth).flatMap(([id, n]) => Array<ItemId>(Math.max(0, Math.round(n))).fill(id));
  const amount = Math.trunc((Math.trunc((width * height) / 5000) * evaluate(l.inEarthLevel, rng)) / 100);
  if (kinds.length) {
    for (let i = 0; i < amount; i++) {
      const id = kinds[rng.int(kinds.length)];
      for (let tries = 0; tries < 35; tries++) {
        const x = rng.int(width);
        const y = rng.int(height);
        if (land.get(x, y) !== Mat.Earth) continue;
        items.push({ id, x, y });
        break;
      }
    }
  }
  // Objects lying on the ground (not in the original's scenarios, but handy for melees).
  for (const [id, n] of sorted(l.onSurface)) {
    const count = Math.floor((n * width) / 1000);
    for (let i = 0; i < count; i++) {
      // A few tries to find dry ground, so lakes don't swallow them.
      for (let tries = 0; tries < 8; tries++) {
        const x = 4 + rng.int(width - 8);
        if (!dryAt(x)) continue;
        // Resting right on the ground: dropped from higher up, flints would explode on landing.
        items.push({ id, x, y: surface[x] - 1 });
        break;
      }
    }
  }

  // A map without sky above most of it is a cave: start on a cave floor.
  let open = 0;
  for (let x = 0; x < width; x++) if (surface[x] > 0) open++;
  if (open < width / 4) {
    const spawn = caveStart(land, new Rng(seed ^ 0xca7e));
    const vegRng = new Rng(seed ^ 0x7ee5);
    const plants = placeVegetation(land, vegRng, l.vegetation, evaluate(l.vegetationLevel, vegRng));
    return { land, map, zoom, items, spawn, cave: true, surface, plants, grass: [] };
  }

  // Start a third of the way in, on dry ground.
  let sx = Math.floor(width / 3);
  for (let d = 0; d < width; d++) {
    const x = Math.floor(width / 3) + (d % 2 ? -1 : 1) * Math.ceil(d / 2);
    if (x >= 8 && x < width - 8 && dryAt(x) && surface[x] > 12) {
      sx = x;
      break;
    }
  }
  // Trees and grass get random numbers of their own, so they don't change the rest of the map.
  const vegRng = new Rng(seed ^ 0x7ee5);
  const plants = placeVegetation(land, vegRng, l.vegetation, evaluate(l.vegetationLevel, vegRng));
  const grass = l.grass ? placeGrass(land, vegRng, surface) : [];
  return { land, map, zoom, items, spawn: { x: sx, y: surface[sx] - 10 }, cave: false, surface, plants, grass };
}

/** The map drawn by the landscape's map script, or null if there is none or it can't be read (then the map creator draws it). */
function scriptedMap(l: LandscapeDef, rng: Rng, players: number): MapData | null {
  if (!l.mapScript?.trim()) return null;
  try {
    return runMapScript(l.mapScript, l, rng, players);
  } catch (e) {
    if (!(e instanceof MapScriptError)) throw e;
    console.warn(`Map script: ${e.message}`);
    return null;
  }
}

/** Empty space a clonk can stand in: open air or tunnel, no liquid. */
const free = (land: Landscape, x: number, y: number): boolean => land.inBounds(x, y) && land.get(x, y) === Mat.Sky;

/** The floor row (first ground pixel) below the free pixel nearest to y in column x, searching up and down; -1 if none. */
export function floorNear(land: Landscape, x: number, y: number): number {
  for (let d = 0; d < land.height; d++) {
    for (const yy of d ? [y - d, y + d] : [y]) {
      if (free(land, x, yy) && land.inBounds(x, yy + 1) && !free(land, x, yy + 1) && MATERIALS[land.get(x, yy + 1)].density > LIQUID) return yy + 1;
    }
    if (y - d < 0 && y + d >= land.height) break;
  }
  return -1;
}

/**
 * A start on a cave floor, like the original's player start in a closed map
 * (C4Player::ScenarioInit: a random spot, then FindSolidGround and
 * FindConSiteSpot): a level stretch of dry floor with open cave above it, big
 * enough for a hut, away from lava and the edges of the map. If there is no
 * such room, a smaller one will do.
 */
function caveStart(land: Landscape, rng: Rng): { x: number; y: number } {
  const { width, height } = land;
  const hot = (x: number, y: number): boolean => {
    for (let dy = -50; dy <= 20; dy += 5) for (let dx = -45; dx <= 45; dx += 5) {
      const m = land.inBounds(x + dx, y + dy) ? land.get(x + dx, y + dy) : Mat.Sky;
      if (m === Mat.Lava || m === Mat.DuroLava || m === Mat.Acid) return true;
    }
    return false;
  };
  let best: { x: number; y: number; score: number } | null = null;
  for (const [half, room, tries] of [[36, 50, 600], [22, 24, 400]]) {
    for (let t = 0; t < tries; t++) {
      const x = 60 + rng.int(Math.max(1, width - 120));
      const y = 60 + rng.int(Math.max(1, height - 120));
      const floor = floorNear(land, x, y);
      if (floor < room + 10) continue;
      // Level floor across the hut's width, with open cave above it.
      let lo = floor;
      let hi = floor;
      let ok = true;
      for (let dx = -half; dx <= half && ok; dx += 3) {
        const f = floorNear(land, x + dx, floor - 3);
        if (f < 0 || Math.abs(f - floor) > 6) ok = false;
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
        for (let dy = 2; dy < room && ok; dy += 3) if (!free(land, x + dx, f - dy)) ok = false;
      }
      if (!ok || hot(x, floor)) continue;
      const score = hi - lo + rng.int(3);
      if (!best || score < best.score) best = { x, y: floor, score };
      if (score <= 1) break;
    }
    if (best) break;
  }
  // No good floor anywhere: dig a little room in the middle of the map.
  if (!best) {
    const x = Math.floor(width / 2);
    const y = Math.floor(height / 2);
    for (let dx = -24; dx <= 24; dx++) for (let dy = -30; dy < 0; dy++) {
      land.set(x + dx, y + dy, Mat.Sky);
      land.setTunnel(x + dx, y + dy, true);
    }
    for (let dx = -24; dx <= 24; dx++) if (free(land, x + dx, y)) land.set(x + dx, y, Mat.Earth);
    return { x, y: y - 10 };
  }
  return { x: best.x, y: best.y - 10 };
}
