import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DEFAULT_LANDSCAPE, IFT, sval, type LandscapeDef } from './mapCreator';
import { MapScriptError, missingMaterials, runMapScript } from './mapScript';
import { texIndex } from './materials';

const L: LandscapeDef = { ...DEFAULT_LANDSCAPE, mapWidth: sval(40, 0, 20, 250), mapHeight: sval(30, 0, 20, 250) };
const run = (script: string, seed = 1) => runMapScript(script, L, new Rng(seed), 1);
const at = (m: { width: number; pix: Uint8Array }, x: number, y: number): number => m.pix[y * m.width + x];

describe('Map scripts', () => {
  const earth = texIndex('Earth-Smooth') + IFT;
  const rock = texIndex('Rock-Rough') + IFT;

  it('draws a map as big as the landscape values, filled with its material', () => {
    const m = run('map Test { mat=Earth; tex=Smooth; };');
    expect([m.width, m.height]).toEqual([40, 30]);
    expect(m.pix.every((p) => p === earth)).toBe(true);
  });

  it('places overlays in percent of their owner, with children drawn inside', () => {
    const m = run('map T { overlay { x=50; wdt=50; mat=Earth; tex=Smooth; overlay { y=50; hgt=50; mat=Rock; tex=Rough; }; }; };');
    expect(at(m, 10, 10)).toBe(0);
    expect(at(m, 30, 5)).toBe(earth);
    expect(at(m, 30, 25)).toBe(rock);
    expect(at(m, 10, 25)).toBe(0);
  });

  it('combines a chain of overlays with & | ^ before the last one paints', () => {
    const left = 'overlay { wdt=50; }';
    const top = 'overlay { hgt=50; mat=Rock; tex=Rough; }';
    const and = run(`map T { ${left} & ${top}; };`);
    expect([at(and, 5, 5), at(and, 30, 5), at(and, 5, 25)]).toEqual([rock, 0, 0]);
    const or = run(`map T { ${left} | ${top}; };`);
    expect([at(or, 5, 5), at(or, 30, 5), at(or, 5, 25), at(or, 30, 25)]).toEqual([rock, rock, rock, 0]);
    const xor = run(`map T { ${left} ^ ${top}; };`);
    expect([at(xor, 5, 5), at(xor, 30, 5), at(xor, 5, 25)]).toEqual([0, rock, rock]);
  });

  it('reuses named overlays, with changed fields, and inverts (within loose bounds)', () => {
    const m = run('overlay Half { wdt=50; mat=Rock; tex=Rough; }; map T { mat=Earth; tex=Smooth; Half { invert=1; loosebounds=1; }; };');
    expect(at(m, 5, 5)).toBe(earth);
    expect(at(m, 30, 5)).toBe(rock);
  });

  it('draws borders around what the owner fills', () => {
    const m = run('map T { overlay { x=25; wdt=50; y=25; hgt=50; mat=Earth; tex=Smooth; overlay { algo=border; a=1; b=1; mat=Rock; tex=Rough; }; }; };');
    expect(at(m, 10, 7)).toBe(rock);
    expect(at(m, 20, 15)).toBe(earth);
    expect(at(m, 29, 15)).toBe(rock);
    expect(at(m, 31, 15)).toBe(0);
  });

  it('turbulence, bozo, lines and the other algorithms make the same map from the same seed', () => {
    const script = 'map T { overlay { algo=bozo; turbulence=1000; mat=Earth; tex=Smooth; overlay { algo=lines; rotate=45; a=2; b=6; mat=Rock; tex=Rough; }; }; overlay { algo=sin; oy=60; zoomY=-500; mat=Water; tex=Smooth; }; };';
    expect(run(script, 5).pix).toEqual(run(script, 5).pix);
    expect(run(script, 5).pix).not.toEqual(run(script, 6).pix);
    const kinds = new Set(run(script, 5).pix);
    expect(kinds.size).toBeGreaterThan(2);
  });

  it('leaves out materials the game does not have, keeping what is beneath', () => {
    const m = run('map T { mat=Earth; tex=Smooth; overlay { mat=Coal; tex=Swirl; overlay { mat=Rock; tex=Rough; }; }; };');
    expect(m.pix.every((p) => p === earth)).toBe(true);
    expect(missingMaterials('map T { mat=Coal; overlay { mat=Earth; }; overlay { mat=Tunnel; }; };')).toEqual(['Coal']);
  });

  it('reports mistakes', () => {
    expect(() => run('map T { mat=Earth }')).toThrow(MapScriptError);
    expect(() => run('map T { Nope; };')).toThrow(/unknown object/);
    expect(() => run('map T { overlay { algo=nope; }; };')).toThrow(/algorithm/);
    expect(() => run('overlay { };')).toThrow(/unnamed/);
  });
});
