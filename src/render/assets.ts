import { Assets, Rectangle, Texture } from 'pixi.js';

/** Where the original Clonk graphics live (CC BY-NC, see public/classic/README.md). */
export const CONTENT_BASE = `${import.meta.env.BASE_URL}classic/`;

export interface GrayTexture {
  width: number;
  height: number;
  /** One brightness byte (0..255) per pixel. */
  data: Uint8Array;
}

async function loadGray(url: string): Promise<GrayTexture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
  // Stretch contrast so the pattern spans the material's whole dark-to-light colour range.
  const sorted = Array.from(data).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, ((data[i] - lo) * 255) / Math.max(1, hi - lo)));
  return { width: img.width, height: img.height, data };
}

export interface GameAssets {
  /** Material textures as brightness maps, keyed by file name without extension. */
  materials: Record<string, GrayTexture>;
  sky: Texture;
  clonk: Texture;
  clonkOverlay: Texture;
  items: Record<string, Texture>;
}

async function loadTexture(file: string): Promise<Texture> {
  const tex = await Assets.load<Texture>(CONTENT_BASE + file);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export async function loadAssets(materialTextures: string[], itemFiles: string[]): Promise<GameAssets> {
  const unique = [...new Set(materialTextures)];
  const [mats, sky, clonk, clonkOverlay, items] = await Promise.all([
    Promise.all(unique.map((t) => loadGray(`${CONTENT_BASE}materials/${t}.png`))),
    loadTexture('sky/Clouds1.jpg'),
    loadTexture('clonk/Graphics.png'),
    loadTexture('clonk/Overlay.png'),
    Promise.all(itemFiles.map(loadTexture)),
  ]);
  sky.source.scaleMode = 'linear';
  sky.source.addressMode = 'repeat';
  return {
    materials: Object.fromEntries(unique.map((t, i) => [t, mats[i]])),
    sky,
    clonk,
    clonkOverlay,
    items: Object.fromEntries(itemFiles.map((f, i) => [f, items[i]])),
  };
}

const frameCache = new Map<string, Texture>();

/** A sub-rectangle of a sprite sheet, cached. */
export function frame(sheet: Texture, x: number, y: number, w: number, h: number): Texture {
  const key = `${sheet.uid}:${x},${y},${w},${h}`;
  let t = frameCache.get(key);
  if (!t) {
    t = new Texture({ source: sheet.source, frame: new Rectangle(x, y, w, h) });
    frameCache.set(key, t);
  }
  return t;
}
