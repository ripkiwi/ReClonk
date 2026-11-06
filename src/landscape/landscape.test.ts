import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { generateLandscape } from './generate';
import { Landscape } from './landscape';
import { Mat } from './materials';

describe('Landscape', () => {
  it('sand falls until it lands', () => {
    const land = new Landscape(5, 5);
    land.set(2, 0, Mat.Sand);
    const rng = new Rng(1);
    for (let t = 0; t < 10; t++) land.step(t, rng);
    expect(land.get(2, 4)).toBe(Mat.Sand);
    expect(land.get(2, 0)).toBe(Mat.Sky);
  });

  it('water spreads sideways on a flat floor', () => {
    const land = new Landscape(9, 2);
    for (let i = 0; i < 3; i++) land.set(4, 1 - Math.min(i, 1), Mat.Water);
    const rng = new Rng(1);
    for (let t = 0; t < 20; t++) land.step(t, rng);
    let onFloor = 0;
    for (let x = 0; x < 9; x++) if (land.get(x, 1) === Mat.Water) onFloor++;
    expect(onFloor).toBe(2);
    expect(land.get(4, 0)).toBe(Mat.Sky);
  });

  it('digging removes diggable cells and reports gold, but leaves granite', () => {
    const land = new Landscape(10, 10);
    land.set(5, 5, Mat.Gold);
    land.set(5, 6, Mat.Granite);
    land.set(4, 5, Mat.Earth);
    const removed = land.dig(5, 5, 2);
    expect(removed.get(Mat.Gold)).toBe(1);
    expect(removed.get(Mat.Earth)).toBe(1);
    expect(land.get(5, 5)).toBe(Mat.Sky);
    expect(land.get(5, 6)).toBe(Mat.Granite);
  });

  it('the same seed generates and simulates identically', () => {
    const a = generateLandscape(160, 90, 99);
    const b = generateLandscape(160, 90, 99);
    const ra = new Rng(5);
    const rb = new Rng(5);
    for (let t = 0; t < 50; t++) {
      a.step(t, ra);
      b.step(t, rb);
    }
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });
});
