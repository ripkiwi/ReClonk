// Flames and smoke over burning things, drawn like the original's fire effect
// (FnFxFireTimer in C4Effect.cpp, the Fire and Fire2 particles, C4Object::ExecFire's Smoke).
// Drawn only: it uses Math.random, never the world's random numbers.

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Burnable } from '../game/fire';
import type { World } from '../game/world';
import { Clonk } from '../objects/clonk';
import { CLONK } from '../objects/defs';
import { Item } from '../objects/item';
import { Plant } from '../objects/vegetation';
import { frame } from './assets';

/** The two flame particles (Particles.c4d Fire.c4d and Fire2.c4d). */
export const FIRE_PARTICLES = {
  /** Reddish flames drawn normally, fading by 5 a tick. */
  fire: { file: 'effects/Fire.png', size: 26, frames: 1, fade: 5 },
  /** Bright flames drawn additively, 8 random looks, fading by 10 a tick. */
  fire2: { file: 'effects/Fire2.png', size: 32, frames: 8, fade: 10 },
};

/** WindDrift=35: how strongly the wind takes the flames along. */
const WIND_DRIFT = 35 - 20;

interface Flame {
  sprite: Sprite;
  owner: Burnable;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The original's alpha byte: 0 opaque, 255 gone. */
  alpha: number;
  fade: number;
}

interface Puff {
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
}

/** How a fire looks: living things and plants burn in an arch, buildings along the bottom, small objects in a trail. */
type Mode = 'living' | 'struct' | 'object';

interface Look {
  mode: Mode;
  /** Centre of the shape now. */
  x: number;
  y: number;
  /** The full shape's size (Def Shape). */
  w: number;
  h: number;
  fireTop: number;
  /** Percent left, and whether it shrinks in width too (StretchGrowth). */
  con: number;
  stretch: boolean;
  r: number;
  xdir: number;
  ydir: number;
}

function look(o: Burnable): Look | null {
  if (o instanceof Clonk) {
    if (o.contained) return null;
    return { mode: 'living', x: o.x, y: o.y, w: CLONK.width, h: CLONK.height, fireTop: 0, con: 100, stretch: true, r: 0, xdir: o.xdir, ydir: o.ydir };
  }
  if (o instanceof Item) {
    if (o.container) return null;
    const f = o.def.graphic.facet;
    return { mode: 'object', x: o.x, y: o.y, w: f.w, h: f.h, fireTop: 0, con: o.con / 1000, stretch: true, r: 0, xdir: o.xdir, ydir: o.ydir };
  }
  if (o instanceof Plant) {
    const c = o.center;
    const b = o.def.burned;
    return { mode: 'living', x: c.x, y: c.y, w: b.width, h: b.height, fireTop: b.fireTop, con: o.scale * 100, stretch: true, r: o.r, xdir: 0, ydir: 0 };
  }
  if (o.gone) return null;
  const con = o.con / 1000;
  const h = (o.def.height * con) / 100;
  return { mode: 'struct', x: o.x, y: o.top + o.def.height - h / 2, w: o.def.width, h: o.def.height, fireTop: 0, con, stretch: false, r: 0, xdir: 0, ydir: 0 };
}

/** Flames and smoke for every burning thing: some in front of it, most behind. */
export class FireView {
  /** Behind trees and buildings, and in front of everything. */
  readonly back = new Container();
  readonly front = new Container();
  private readonly smoke = new Graphics();
  private readonly flames: Flame[] = [];
  private readonly pool: Sprite[] = [];
  private readonly puffs: Puff[] = [];
  /** Where each burning thing was last tick, so its flames move with it (the particles' Attach). */
  private readonly last = new Map<Burnable, { x: number; y: number }>();
  private lastTick = -1;

  constructor(
    private readonly world: World,
    private readonly textures: Record<string, Texture>,
  ) {
    this.back.addChild(this.smoke);
  }

  update(): void {
    const tick = this.world.tick;
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    const now = new Map<Burnable, Look>();
    for (const o of this.burning()) {
      const l = look(o);
      if (l) now.set(o, l);
    }
    this.move(now);
    for (const [o, l] of now) {
      const since = tick - (o.fire?.since ?? tick);
      if (l.mode === 'object' || since % 4 === 0) this.emit(o, l);
      this.smokeFrom(o, l, tick);
    }
    this.last.clear();
    for (const [o, l] of now) this.last.set(o, { x: l.x, y: l.y });
    this.drawSmoke();
  }

  private *burning(): Generator<Burnable> {
    const w = this.world;
    for (const c of w.clonks) if (c.fire) yield c;
    for (const i of w.items) if (i.fire) yield i;
    for (const p of w.plants) if (p.fire) yield p;
    for (const s of w.structures) if (s.fire) yield s;
  }

  private wind(x: number, y: number): number {
    const w = this.world.weather;
    return w ? w.windAt(this.world, x, y) : 0;
  }

  /** Move and fade the flames (fxStdExec): with their object, in the wind. */
  private move(now: Map<Burnable, Look>): void {
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i];
      const l = now.get(f.owner);
      const prev = this.last.get(f.owner);
      if (l && prev) {
        f.x += l.x - prev.x;
        f.y += l.y - prev.y;
      }
      f.x += f.vx;
      f.y += f.vy;
      const vx = f.vx + (l?.xdir ?? 0);
      const vy = f.vy + (l?.ydir ?? 0);
      f.vx += ((this.wind(f.x, f.y) / 15 - vx) * WIND_DRIFT) / 800;
      f.vy += ((0 - vy) * WIND_DRIFT) / 800;
      f.alpha += f.fade;
      if (f.alpha >= 255) {
        f.sprite.visible = false;
        f.sprite.removeFromParent();
        this.pool.push(f.sprite);
        this.flames.splice(i, 1);
        continue;
      }
      f.sprite.position.set(f.x, f.y);
      f.sprite.alpha = 1 - f.alpha / 255;
    }
  }

  /** A new set of flames, half reddish and half bright (FnFxFireTimer). */
  private emit(o: Burnable, l: Look): void {
    const w = Math.max(l.w, 1);
    const h = l.h;
    let yOff = h / 2 - l.fireTop;
    const con = Math.max(l.con, 1);
    const wdtCon = l.stretch ? con : Math.max(con, 100);
    const cos = Math.cos((l.r * Math.PI) / 180);
    const sin = Math.sin((l.r * Math.PI) / 180);
    // Things lying tilted burn better from the middle.
    if (l.r && yOff > 0) yOff = 0;
    const count = Math.max(2, Math.trunc((Math.trunc(Math.sqrt(w * h) / 4) * wdtCon) / 100));
    const a = Math.sqrt((Math.sqrt(w * h) * (con + 20)) / 120) * 12;
    for (let i = 0; i < count * 2; i++) {
      const size = (Math.floor(Math.random() * 11) + 30 - 5 - 1 + a) / 10;
      const red = i < count / 2;
      const def = red ? FIRE_PARTICLES.fire : FIRE_PARTICLES.fire2;
      let alpha = red ? 0x32 : 0;
      if (l.mode === 'object') alpha += 0x62;
      const rx = Math.floor(Math.random() * (w + 1)) - Math.trunc(w / 2) - 1;
      const px = (rx * wdtCon) / 100;
      let py = (yOff * con) / 100;
      // An arch over living things and plants.
      if (l.mode === 'living') py -= (px * px * 100) / w / wdtCon;
      let vx: number;
      let vy: number;
      if (l.mode !== 'object') {
        vx = (rx * con) / 400 - px / 3 - l.xdir * 3;
        vy = -Math.floor(Math.random() * (15 + (h * con) / 300)) - 1 - l.ydir * 3;
      } else {
        vx = -l.xdir * 3;
        vy = -l.ydir * 3;
        if (Math.trunc(vy) === 0) vy = -Math.floor(Math.random() * (13 + h / 4)) - 1;
      }
      const sprite = this.pool.pop() ?? new Sprite();
      const f = Math.floor(Math.random() * def.frames);
      sprite.texture = frame(this.textures[def.file], f * def.size, 0, def.size, def.size);
      sprite.anchor.set(0.5);
      sprite.scale.set((size * 2) / def.size);
      sprite.blendMode = red ? 'normal' : 'add';
      sprite.tint = red ? (((196 + Math.floor(Math.random() * 59)) << 16) | (0x40 << 8)) : 0xffffff;
      sprite.visible = true;
      sprite.alpha = 1 - alpha / 255;
      const x = l.x + cos * px - sin * py;
      const y = l.y + sin * px + cos * py;
      sprite.position.set(x, y);
      (Math.random() < 0.75 ? this.back : this.front).addChild(sprite);
      this.flames.push({ sprite, owner: o, x, y, vx: vx / 10, vy: vy / 10, alpha, fade: def.fade });
    }
  }

  /** Smoke rises from what burns, bigger and less often from bigger things (ExecFire, SmokeRate 100). */
  private smokeFrom(o: Burnable, l: Look, tick: number): void {
    const width = l.stretch ? (l.w * l.con) / 100 : l.w;
    const level = Math.trunc((2 * width) / 3);
    if (level < 1) return;
    const rate = Math.max(Math.trunc((50 * level) / 100), 3);
    const id = 'id' in o ? o.id : 0;
    if ((tick + id * 7) % rate !== 0 && Math.abs(l.xdir) <= 2) return;
    this.puffs.push({ x: l.x, y: l.y - (l.h * l.con) / 200, r: Math.max(2, level / 6), age: 0, life: 50 + Math.floor(Math.random() * 30) });
  }

  private drawSmoke(): void {
    const g = this.smoke;
    g.clear();
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age++;
      if (p.age >= p.life) {
        this.puffs.splice(i, 1);
        continue;
      }
      p.y -= 0.5;
      p.x += this.wind(p.x, p.y) / 60;
      const t = p.age / p.life;
      g.circle(p.x, p.y, p.r * (1 + 2 * t)).fill({ color: 0x404040, alpha: 0.4 * (1 - t) });
    }
  }

  destroy(): void {
    for (const s of this.pool) s.destroy();
  }
}
