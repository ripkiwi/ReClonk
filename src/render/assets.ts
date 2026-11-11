import { Assets, Rectangle, Texture } from 'pixi.js';
import { CLONK_KINDS, type ClonkKind } from '../objects/defs';

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
  /** The sprite sheet and shirt overlay of every kind of clonk. */
  clonks: Record<ClonkKind, { body: Texture; overlay: Texture }>;
  items: Record<string, Texture>;
}

async function loadTexture(file: string): Promise<Texture> {
  const tex = await Assets.load<Texture>(CONTENT_BASE + file);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export async function loadAssets(materialTextures: string[], itemFiles: string[]): Promise<GameAssets> {
  const unique = [...new Set(materialTextures)];
  const kinds = Object.keys(CLONK_KINDS) as ClonkKind[];
  const [mats, sky, sheets, items] = await Promise.all([
    Promise.all(unique.map((t) => loadGray(`${CONTENT_BASE}materials/${t}.png`))),
    loadTexture('sky/Clouds1.jpg'),
    Promise.all(kinds.map(async (k) => ({ body: await loadTexture(CLONK_KINDS[k].graphic.file), overlay: await loadTexture(CLONK_KINDS[k].graphic.overlay) }))),
    Promise.all(itemFiles.map(loadTexture)),
  ]);
  const clonks = Object.fromEntries(kinds.map((k, i) => [k, sheets[i]])) as GameAssets['clonks'];
  sky.source.scaleMode = 'linear';
  sky.source.addressMode = 'repeat';
  return {
    materials: Object.fromEntries(unique.map((t, i) => [t, mats[i]])),
    sky,
    clonk: clonks.clonk.body,
    clonkOverlay: clonks.clonk.overlay,
    clonks,
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

/**
 * Is this colour one of the owner's colour pixels (ClrByOwner in the
 * original's StdSurface2.cpp): a saturated blue, hue 145..175 of 255?
 */
function clrByOwner(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false;
  const L = Math.trunc(((max + min) * 255 + 255) / (2 * 255));
  const S = L <= 127 ? Math.trunc(((max - min) * 255 + Math.trunc((max + min) / 2)) / (max + min)) : Math.trunc(((max - min) * 255 + Math.trunc((2 * 255 - max - min) / 2)) / (2 * 255 - max - min));
  const d = (c: number): number => Math.trunc(((max - c) * Math.trunc(255 / 6) + Math.trunc((max - min) / 2)) / (max - min));
  let H = r === max ? d(b) - d(g) : g === max ? Math.trunc(255 / 3) + d(r) - d(b) : Math.trunc((2 * 255) / 3) + d(g) - d(r);
  if (H < 0) H += 255;
  if (H > 255) H -= 255;
  return H >= 145 && H <= 175 && S > 100;
}

const ownerCache = new Map<Texture, { body: Texture; overlay: Texture }>();

/**
 * Split a sheet into its own colours and its owner-coloured part, like the
 * original's ColorByOwner (CreateColorByOwner): blue pixels move to a grey
 * overlay that is then tinted in the owner's colour.
 */
export function colorByOwner(sheet: Texture): { body: Texture; overlay: Texture } {
  let out = ownerCache.get(sheet);
  if (out) return out;
  const src = sheet.source.resource as CanvasImageSource;
  const w = sheet.source.width;
  const h = sheet.source.height;
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')!];
  };
  const [bodyCanvas, bodyCtx] = make();
  const [overCanvas, overCtx] = make();
  bodyCtx.drawImage(src, 0, 0);
  const body = bodyCtx.getImageData(0, 0, w, h);
  const over = overCtx.createImageData(w, h);
  const p = body.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3] || !clrByOwner(p[i], p[i + 1], p[i + 2])) continue;
    over.data[i] = over.data[i + 1] = over.data[i + 2] = p[i + 2];
    over.data[i + 3] = p[i + 3];
    p[i + 3] = 0;
  }
  bodyCtx.putImageData(body, 0, 0);
  overCtx.putImageData(over, 0, 0);
  const tex = (c: HTMLCanvasElement): Texture => {
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    return t;
  };
  out = { body: tex(bodyCanvas), overlay: tex(overCanvas) };
  ownerCache.set(sheet, out);
  return out;
}
