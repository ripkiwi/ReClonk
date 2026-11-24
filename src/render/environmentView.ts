// How the environment objects look: the night sky, stars, the sun and its
// lens flare, glinting gold and big falling rocks (Objects.c4d/Environment.c4d:
// Time.c4d, Stars.c4d, Lenseflare.c4d, Glint.c4d, Rockfall.c4d/BigRock.c4d).

import { Container, Sprite } from 'pixi.js';
import { BIG_ROCK, type BigRock } from '../game/environment';
import type { World } from '../game/world';
import { MATERIALS } from '../landscape/materials';
import { frame, type GameAssets } from './assets';

export const ENV_SPRITES = {
  star: 'environment/Star.png',
  spark: 'environment/MaterialSpark.png',
  flare: 'environment/Lenseflare.png',
  bigRock: BIG_ROCK.file,
};

/** Lenseflare.c4d's flecks (its Fleck0-13 actions): where in the graphics, and their size. */
const FLECKS = [
  [0, 192, 39], [58, 192, 89], [29, 231, 20], [0, 281, 61], [0, 231, 29], [192, 64, 19], [192, 92, 6],
  [192, 83, 9], [147, 192, 38], [354, 0, 70], [39, 192, 19], [211, 64, 28], [256, 0, 98], [192, 98, 195],
];

interface Spark {
  s: Sprite;
  age: number;
}

/** The original's gamma ramp for a time of day (Time.c4d RestoreSkyColors): darker and bluer at night, [dark, middle, light] per channel. */
export function nightRamp(light: number): number[][] {
  const lt = Math.trunc(light / 2) + 78;
  return [
    [0, lt, 255],
    [0, lt, 255],
    [0, 128, 255],
  ];
}

/** The sun's yellow glow when you look right at it alone (Lenseflare.c4d ManageFlares' gamma ramp). */
export function sunRamp(distance: number): number[][] | null {
  const y = Math.max(0, Math.min(100, (500 - distance) / 5));
  if (y <= 0) return null;
  const a = (30 * y) / 100;
  const b = 128 + (60 * y) / 100;
  return [
    [a, b, 255],
    [a, b, 255],
    [0, 128, 255],
  ];
}

export class EnvironmentView {
  /** Stars far away behind the landscape (C4D_Background, parallax), in screen pixels. */
  readonly back = new Container();
  /** The sun, behind the landscape, in the world. */
  readonly behind = new Container();
  /** Glints on the landscape, and big rocks. */
  readonly middle = new Container();
  /** The lens flare's flecks, over everything (C4D_Foreground). */
  readonly front = new Container();
  private readonly starSprites = new Map<object, Sprite>();
  private readonly rockSprites = new Map<BigRock, Sprite>();
  private readonly sparks: Spark[] = [];
  private sun: Sprite | null = null;
  private readonly flecks: Sprite[] = [];
  private lastTick = -1;
  /** How far the view's centre is from the sun, for the yellow glow. */
  sunDistance = Infinity;

  constructor(
    private readonly world: World,
    private readonly assets: GameAssets,
  ) {}

  /** Update for a view with its top-left corner at (camX, camY), viewW by viewH world pixels, drawn at `zoom`. */
  update(camX: number, camY: number, viewW: number, viewH: number, zoom: number): void {
    const env = this.world.environment;
    if (!env) return;
    this.updateStars(camX, camY, viewW, viewH, zoom);
    this.updateSun(camX, camY, viewW, viewH);
    this.updateRocks();
    if (this.world.tick !== this.lastTick) {
      this.lastTick = this.world.tick;
      if (env.has('glint')) this.glint(camX, camY, viewW, viewH, env.count('glint'));
      for (const sp of this.sparks) {
        sp.age++;
        sp.s.texture = frame(this.assets.items[ENV_SPRITES.spark], Math.min(7, sp.age) * 32, 0, 32, 32);
      }
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        if (this.sparks[i].age < 8) continue;
        this.sparks[i].s.destroy();
        this.sparks.splice(i, 1);
      }
    }
  }

  /**
   * Stars far behind the landscape: each moves only a little with the view
   * (its parallax), so they seem far away. Drawn in screen pixels.
   */
  private updateStars(camX: number, camY: number, viewW: number, viewH: number, zoom: number): void {
    const env = this.world.environment!;
    const seen = new Set<object>();
    for (const st of env.stars) {
      // Its place on the screen: it moves with the view by its parallax only.
      const sx = (st.x - (camX * st.parallax) / 100) * zoom;
      const sy = (st.y - (camY * st.parallax) / 100) * zoom;
      if (sx < -4 || sy < -4 || sx > viewW * zoom + 4 || sy > viewH * zoom + 4) continue;
      seen.add(st);
      let s = this.starSprites.get(st);
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        s.blendMode = 'add';
        s.tint = st.color;
        this.back.addChild(s);
        this.starSprites.set(st, s);
      }
      s.texture = frame(this.assets.items[ENV_SPRITES.star], st.phase * 3, 0, 3, 3);
      s.position.set(Math.round(sx), Math.round(sy));
      s.scale.set(Math.max(1, zoom / 2));
    }
    for (const [st, s] of this.starSprites) {
      if (seen.has(st)) continue;
      s.destroy();
      this.starSprites.delete(st);
    }
  }

  /**
   * The sun and its lens flare (Lenseflare.c4d): by day, a glow where the sun
   * stands and flecks on the line from it through the middle of the view, the
   * nearer the view, the closer together. Hidden while something covers the sun.
   */
  private updateSun(camX: number, camY: number, viewW: number, viewH: number): void {
    const env = this.world.environment!;
    const sun = env.sun;
    const tex = this.assets.items[ENV_SPRITES.flare];
    if (!sun) return;
    if (!this.sun) {
      this.sun = new Sprite(frame(tex, 0, 0, 192, 192));
      this.sun.anchor.set(0.5);
      this.sun.blendMode = 'add';
      this.behind.addChild(this.sun);
      const n = Math.trunc(this.world.land.width / 2 / 50);
      for (let i = 0; i < n; i++) {
        const [fx, fy, fs] = FLECKS[i % 14];
        const s = new Sprite(frame(tex, fx, fy, fs, fs));
        s.anchor.set(0.5);
        s.blendMode = 'add';
        this.front.addChild(s);
        this.flecks.push(s);
      }
    }
    const day = env.isDay;
    this.sun.visible = day;
    this.sun.position.set(sun.x, sun.y);
    const cx = camX + viewW / 2;
    const cy = camY + viewH / 2;
    const vx = cx - sun.x;
    const vy = cy - sun.y;
    const dist = Math.max(1, Math.hypot(vx, vy));
    this.sunDistance = day ? dist : Infinity;
    const visible = day && this.world.land.density(Math.round(sun.x), Math.round(sun.y)) < 25;
    const light = env.has('time') ? env.light : 100;
    const gray = Math.round((255 * light) / 100);
    const color = (gray << 16) | (gray << 8) | gray;
    this.sun.tint = color;
    // 0 near, 1000 far; 300 pixels away is far.
    const far = 1000 - Math.max(0, Math.min(1000, (3000 - dist * 10) / 3));
    const step = (50 * far) / 10 / 100;
    const alpha = Math.max(75, Math.min(100, (2000 - dist) / 20)) / 100;
    this.flecks.forEach((s, i) => {
      s.visible = visible;
      if (!visible) return;
      const k = (i * step) / dist;
      s.position.set(sun.x + vx * k, sun.y + vy * k);
      s.tint = color;
      s.alpha = alpha;
    });
  }

  private updateRocks(): void {
    const env = this.world.environment!;
    const seen = new Set<BigRock>();
    for (const r of env.rocks) {
      seen.add(r);
      let s = this.rockSprites.get(r);
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        this.middle.addChild(s);
        this.rockSprites.set(r, s);
      }
      s.texture = frame(this.assets.items[BIG_ROCK.file], r.frame() * BIG_ROCK.size, 0, BIG_ROCK.size, BIG_ROCK.size);
      s.position.set(r.x, r.y);
      s.scale.set(r.con / 100);
    }
    for (const [r, s] of this.rockSprites) {
      if (seen.has(r)) continue;
      s.destroy();
      this.rockSprites.delete(r);
    }
  }

  /**
   * Glint.c4d: every tick it looks at random spots of the map (more on bigger
   * maps and with more glint objects) and sparkles where there's gold, crystal
   * or ice: mostly a small bright twinkle, sometimes a bigger faint glow. Now
   * and then nuggets and crystals stuck in the earth twinkle too. Only the
   * spots in view matter, so it looks at as many of those as would fall in it.
   */
  private glint(camX: number, camY: number, viewW: number, viewH: number, factor: number): void {
    const land = this.world.land;
    let tries = (factor * viewW * viewH) / 250000;
    for (; tries > 0; tries--) {
      if (tries < 1 && Math.random() >= tries) break;
      const x = Math.floor(camX + Math.random() * viewW);
      const y = Math.floor(camY + Math.random() * viewH);
      const name = MATERIALS[land.get(x, y)]?.name;
      const rnd = (): number => 128 + Math.floor(Math.random() * 128);
      if (name === 'Gold') this.sparkle(x, y, 255, 255, rnd(), true);
      else if (name === 'Crystal') {
        const c = rnd();
        this.sparkle(x, y, c, c, 255, true);
      } else if (name === 'Ice') this.sparkle(x, y, rnd(), 255, 255, true);
    }
    if (Math.random() * 15 >= 1) return;
    for (const it of this.world.items) {
      if (it.container || it.removed || (it.def.id !== 'gold' && it.def.id !== 'crystal') || it.xdir || it.ydir) continue;
      if (it.x < camX || it.y < camY || it.x > camX + viewW || it.y > camY + viewH || !land.isSolid(it.x, it.y)) continue;
      if (Math.random() * 10 < 1 && Math.random() * (11 - factor) < 1) this.sparkle(it.x - 3 + Math.floor(Math.random() * 7), it.y - 3 + Math.floor(Math.random() * 7), 255, 255, 255, false);
    }
  }

  private sparkle(x: number, y: number, r: number, g: number, b: number, big: boolean): void {
    const s = new Sprite(frame(this.assets.items[ENV_SPRITES.spark], 0, 0, 32, 32));
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = (r << 16) | (g << 8) | b;
    s.position.set(x, y);
    // A small strong twinkle, or a bigger, faint glow (particle sizes 25-50 and 50-250, in tenths of a pixel across).
    if (Math.random() * 3 >= 1 || !big) {
      s.scale.set(((25 + Math.random() * 25) / 10 / 32) * 2);
    } else {
      s.scale.set(((50 + Math.random() * 200) / 10 / 32) * 2);
      s.alpha = 1 - (192 + Math.random() * 64) / 255;
    }
    this.middle.addChild(s);
    this.sparks.push({ s, age: 0 });
  }

  destroy(): void {
    this.back.destroy({ children: true });
    this.behind.destroy({ children: true });
    this.middle.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
