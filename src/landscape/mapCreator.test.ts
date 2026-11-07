import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from './generate';
import { Landscape } from './landscape';
import { createMap, DEFAULT_LANDSCAPE, evaluate, IFT, mapSize, sval, type LandscapeDef } from './mapCreator';
import { DEFAULT_TEX, Mat, TEXMAP, texIndex } from './materials';

const def = (changes: Partial<LandscapeDef> = {}): LandscapeDef => ({ ...structuredClone(DEFAULT_LANDSCAPE), ...changes });

describe('Scenario values', () => {
  it('pick a value from std - rnd to std + rnd, within min and max (C4SVal)', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(evaluate(sval(50, 3), rng));
    expect([...seen].sort((a, b) => a - b)).toEqual([47, 48, 49, 50, 51, 52, 53]);
    for (let i = 0; i < 50; i++) expect(evaluate(sval(95, 20, 0, 100), rng)).toBeLessThanOrEqual(100);
    expect(evaluate(sval(10), rng)).toBe(10);
  });

  it('find texture map entries like the original (GetIndexMatTex)', () => {
    expect(TEXMAP[texIndex('Earth', 'Smooth')].name).toBe('Earth-Smooth');
    expect(TEXMAP[texIndex('Rock-Ridge', 'Rough')].name).toBe('Rock-Ridge');
    expect(TEXMAP[texIndex('Gold', 'Rough')].name).toBe('Gold-Rough');
    expect(TEXMAP[texIndex('Water', 'Smooth')].name).toBe('Water-Smooth');
    // No such texture: the material's own; no such material: nothing.
    expect(TEXMAP[texIndex('Granite-Swirl')].name).toBe('Granite-Rock');
    expect(texIndex('Ore', 'Rough')).toBe(0);
  });
});

describe('Map creator', () => {
  it('the same values and seed always draw the same map', () => {
    const l = def({ amplitude: sval(30, 20), random: sval(40, 10), liquidLevel: sval(30, 10), layers: [{ name: 'Rock', count: 20 }] });
    const a = createMap(l, new Rng(9), 1);
    const b = createMap(l, new Rng(9), 1);
    expect(b).toEqual(a);
    expect(createMap(l, new Rng(10), 1).pix).not.toEqual(a.pix);
  });

  it('a flat map at amplitude and random 0: ground from the middle down', () => {
    const m = createMap(def({ mapWidth: sval(100), mapHeight: sval(50) }), new Rng(1), 1);
    const ground = texIndex('Earth', 'Smooth') + IFT;
    for (const x of [0, 50, 99]) {
      expect(m.pix[24 * 100 + x]).toBe(0);
      expect(m.pix[25 * 100 + x]).toBe(ground);
      expect(m.pix[49 * 100 + x]).toBe(ground);
    }
  });

  it('water fills the open air below the water level', () => {
    // A valley: a sine wave with a deep dip, water level 40 fills the map from row 30 down.
    const m = createMap(def({ mapWidth: sval(100), mapHeight: sval(50), amplitude: sval(100), period: sval(10), phase: sval(0), liquidLevel: sval(40) }), new Rng(1), 1);
    const water = texIndex('Water', 'Smooth');
    let lake = 0;
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 50; y++) {
        const c = m.pix[y * 100 + x];
        if (c === water) {
          lake++;
          expect(y).toBeGreaterThanOrEqual(30);
        }
        if (y < 30) expect(c).not.toBe(water);
      }
    }
    expect(lake).toBeGreaterThan(50);
  });

  it('layers are drawn into the ground only, and only with Layers on', () => {
    const l = def({ mapWidth: sval(100), mapHeight: sval(60), layers: [{ name: 'Gold', count: 100 }] });
    const gold = texIndex('Gold', 'Rough') + IFT;
    const m = createMap(l, new Rng(4), 1);
    let veins = 0;
    for (let i = 0; i < m.pix.length; i++) {
      if (m.pix[i] !== gold) continue;
      veins++;
      expect(Math.floor(i / 100)).toBeGreaterThanOrEqual(30);
    }
    expect(veins).toBeGreaterThan(100);
    expect(createMap(l, new Rng(4), 1, false).pix.includes(gold)).toBe(false);
  });

  it('a map with "width according to player number" grows with every player, up to 4 and its maximum', () => {
    const l = def({ mapWidth: sval(80, 0, 64, 250), mapPlayerExtend: true });
    expect(mapSize(l, new Rng(1), 1).width).toBe(80);
    expect(mapSize(l, new Rng(1), 3).width).toBe(240);
    expect(mapSize(l, new Rng(1), 4).width).toBe(250);
    expect(mapSize(l, new Rng(1), 8).width).toBe(250);
    expect(mapSize({ ...l, mapPlayerExtend: false }, new Rng(1), 3).width).toBe(80);
  });
});

describe('Landscape from a map', () => {
  it('every map pixel becomes a ragged chunk of landscape, zoom times as big', () => {
    const g = generateMap(def({ mapWidth: sval(64, 0, 20, 250), mapHeight: sval(40), mapZoom: sval(10) }), 5);
    expect([g.land.width, g.land.height, g.zoom]).toEqual([640, 400, 10]);
    // Ground from about the middle down, underground (tunnel background once dug).
    expect(g.land.get(320, 300)).toBe(Mat.Earth);
    expect(g.land.isTunnel(320, 300)).toBe(true);
    expect(g.land.get(320, 100)).toBe(Mat.Sky);
    // The surface is ragged, not a straight line, even on a flat map.
    expect(new Set(g.surface).size).toBeGreaterThan(3);
  });

  it('smooth and rough earth keep their textures', () => {
    const g = generateMap(def({ layers: [{ name: 'Earth-Rough', count: 60 }] }), 2);
    const rough = texIndex('Earth-Rough');
    let n = 0;
    for (let i = 0; i < g.land.tex.length; i++) {
      if (g.land.tex[i] !== rough) continue;
      n++;
      expect(g.land.cells[i]).toBe(Mat.Earth);
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('buries objects in earth, as many as the amount says', () => {
    const l = def({ mapWidth: sval(100), mapHeight: sval(60), inEarth: { flint: 1, gold: 1 }, inEarthLevel: sval(50) });
    const g = generateMap(l, 3);
    // (1000 * 600 / 5000) * 50 / 100 = 60, each on a spot of earth.
    expect(g.items.length).toBeGreaterThan(55);
    expect(g.items.length).toBeLessThanOrEqual(60);
    for (const it of g.items) expect(g.land.get(it.x, it.y)).toBe(Mat.Earth);
    expect(new Set(g.items.map((i) => i.id))).toEqual(new Set(['flint', 'gold']));
  });

  it('top and bottom open', () => {
    const land = new Landscape(10, 10);
    expect(land.get(5, -1)).toBe(Mat.Sky);
    expect(land.get(5, 10)).toBe(Mat.Granite);
    land.topOpen = false;
    land.bottomOpen = true;
    expect(land.get(5, -1)).toBe(Mat.Granite);
    expect(land.get(5, 10)).toBe(Mat.Sky);
    expect(land.get(-1, 5)).toBe(Mat.Granite);
  });

  it('a pixel set to a material gets its own texture; flowing water takes its texture along', () => {
    const land = new Landscape(10, 10);
    land.paint(5, 5, Mat.Earth, texIndex('Earth-Rough'));
    expect(land.tex[55]).toBe(texIndex('Earth-Rough'));
    land.set(5, 5, Mat.Rock);
    expect(land.tex[55]).toBe(DEFAULT_TEX[Mat.Rock]);
    land.paint(2, 0, Mat.Water, texIndex('Water-Smooth'));
    for (let t = 0; t < 30; t++) land.step(t, new Rng(1));
    expect(land.get(2, 9)).toBe(Mat.Water);
    expect(land.tex[92]).toBe(texIndex('Water-Smooth'));
    expect(land.tex[2]).toBe(0);
  });
});
