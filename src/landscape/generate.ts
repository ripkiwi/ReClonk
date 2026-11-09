import { Rng } from '../core/rng';
import type { Landscape } from './landscape';
import { createMap, DEFAULT_LANDSCAPE, evaluate, mapToLandscape, type LandscapeDef, type MapData } from './mapCreator';
import { placeGrass, placeVegetation, type Grass, type PlantId } from '../objects/vegetation';
import { LIQUID, MATERIALS, Mat, type ItemId } from './materials';

export interface GeneratedMap {
  land: Landscape;
  /** The small map the landscape was zoomed from, one pixel per chunk. */
  map: MapData;
  zoom: number;
  /** Loose objects: buried in the earth (the original's "InEarth" objects) and lying on the surface. */
  items: { id: ItemId; x: number; y: number }[];
  /** Where the first clonk starts, standing on the surface. */
  spawn: { x: number; y: number };
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
  const map = createMap(l, rng, ctx.players);
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
  return { land, map, zoom, items, spawn: { x: sx, y: surface[sx] - 10 }, surface, plants, grass };
}
