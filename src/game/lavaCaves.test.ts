import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateMap } from '../landscape/generate';
import { Mat } from '../landscape/materials';
import { NO_CONTROL } from '../objects/clonk';
import { createProfile, hireClonk } from './profiles';
import { LOCAL_PLAYER, startRound } from './round';
import { scenarioById } from './scenarios';

const lava = (m: Mat): boolean => m === Mat.Lava || m === Mat.DuroLava;

describe('Lava Caves', () => {
  const s = scenarioById('lava-caves')!;

  it('has the original values', () => {
    const l = s.landscape;
    expect([l.mapWidth.std, l.mapHeight.std, l.mapZoom.std, l.topOpen]).toEqual([95, 60, 15, false]);
    expect(l.mapScript).toContain('map LavaCaves');
    expect([s.crewSize, s.opponents, s.homeBase, s.base.wealth, s.goals]).toEqual([1, 0, true, 30, { monsterkill: 1, value: 16 }]);
    expect(s.base.stock).toMatchObject({ conkit: 5, wood: 10, flint: 10, tflint: 14, supertflint: 6, superflint: 3, teraflint: 1, flag: 3, lorry: 1, clonk: 5 });
    expect([s.weather.climate.std, s.weather.volcano.std, s.weather.earthquake.std]).toEqual([0, 3, 5]);
  });

  it('its map script draws closed caves with lava, gold and granite', () => {
    for (const seed of [1, 2, 3]) {
      const m = generateMap(s.landscape, seed);
      expect(m.cave).toBe(true);
      expect([m.land.width, m.land.height]).toEqual([1425, 900]);
      const count = new Map<Mat, number>();
      let tunnel = 0;
      for (let y = 0; y < m.land.height; y += 3) {
        for (let x = 0; x < m.land.width; x += 3) {
          const mat = m.land.get(x, y);
          count.set(mat, (count.get(mat) ?? 0) + 1);
          if (mat === Mat.Sky && m.land.isTunnel(x, y)) tunnel++;
        }
      }
      const total = (m.land.width / 3) * (m.land.height / 3);
      // Mostly caves and earth; nothing open to the sky.
      expect(tunnel / total).toBeGreaterThan(0.15);
      expect((count.get(Mat.Sky) ?? 0) - tunnel).toBe(0);
      expect((count.get(Mat.Earth) ?? 0) / total).toBeGreaterThan(0.15);
      for (const mat of [Mat.DuroLava, Mat.Gold, Mat.Granite, Mat.Rock, Mat.Ashes]) expect(count.get(mat) ?? 0).toBeGreaterThan(0);
      // The ceiling is earth all along the top.
      for (let x = 0; x < m.land.width; x += 25) expect(m.land.get(x, 2)).not.toBe(Mat.Sky);
      // The same seed, the same map.
      expect(Buffer.from(generateMap(s.landscape, seed).land.cells).equals(Buffer.from(m.land.cells))).toBe(true);
    }
  }, 30000);

  it('starts the crew at its hut on a cave floor, away from the lava', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = createProfile({ profiles: [], activeId: null }, 'Kevin');
      hireClonk(p, ['Alfons'], new Rng(1));
      const round = startRound(s, p, ['Alfons'], seed);
      const { world } = round;
      const huts = world.structures;
      expect(huts.map((h) => h.base)).toEqual([LOCAL_PLAYER]);
      const hut = huts[0];
      const c = round.crew[0];
      expect(Math.abs(c.x - hut.x)).toBeLessThan(40);
      for (let dx = -40; dx <= 40; dx += 4) for (let dy = -40; dy <= 20; dy += 4) expect(lava(world.land.get(c.x + dx, c.y + dy))).toBe(false);
      const controls = new Map([[LOCAL_PLAYER, NO_CONTROL]]);
      for (let t = 0; t < 200; t++) world.step(controls);
      // Standing on the floor by the hut, alive, with its flint.
      expect(c.alive).toBe(true);
      expect(Math.abs(c.x - hut.x)).toBeLessThan(40);
      expect(world.land.isSolid(Math.round(c.x), Math.round(c.y) + 11)).toBe(true);
      expect(c.carrying?.def.id).toBe('flint');
    }
  }, 30000);
});
