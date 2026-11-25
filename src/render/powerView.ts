// Drawing for power and production: power lines and pipes, the buildings'
// working animations (their ActMap facets), the blinking "needs power"
// symbol, the derrick's drill pipe, railway signals, and the cannon tower's
// flame shots and lightning bolts.

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { LINE } from '../objects/line';
import type { Structure } from '../objects/structure';
import type { World } from '../game/world';
import { frame } from './assets';

/** A working animation: frames of `w` x `h` side by side from (x, y), drawn at `at` from the building's top-left corner (ActMap Facet). */
interface Activity {
  activity: string;
  x: number;
  y: number;
  w: number;
  h: number;
  at: { x: number; y: number };
}

/** The original's ActMap facets for each building's work. */
export const ACTIVITIES: Record<string, Activity> = {
  sawmill: { activity: 'saw', x: 0, y: 78, w: 26, h: 9, at: { x: 23, y: 11 } },
  powerPlant: { activity: 'burn', x: 0, y: 68, w: 8, h: 11, at: { x: 9, y: 35 } },
  foundry: { activity: 'burn', x: 0, y: 67, w: 8, h: 10, at: { x: 48, y: 34 } },
  workshop: { activity: 'build', x: 0, y: 69, w: 8, h: 11, at: { x: 11, y: 24 } },
  pump: { activity: 'pump', x: 0, y: 0, w: 28, h: 32, at: { x: 0, y: 0 } },
  derrick: { activity: 'pump', x: 0, y: 56, w: 6, h: 20, at: { x: 11, y: 34 } },
  anvil: { activity: 'forge', x: 24, y: 0, w: 24, h: 22, at: { x: 2, y: -2 } },
};

/** Files these draw from, besides the buildings' own sheets. */
export const POWER_GRAPHICS = { energy: 'gui/Energy.png', pipeHead: 'structures/PipeHead.png', flameShot: 'items/FlameShot.png' };

/** The signal's sheet: 4 columns of 24 (go through, halt right, halt left, halt and go) by 3 rows of 50 (no loading, unload, load). */
const SIGNAL_FRAME = { w: 24, h: 50 };

interface Overlay {
  work: Sprite;
  energy: Sprite;
  signal: Sprite | null;
  head: Sprite | null;
}

export class PowerView {
  /** Lines, the derrick's pipe, in front of the buildings. */
  readonly lines = new Graphics();
  /** The working animations and symbols, over the buildings. */
  readonly overlays = new Container();
  /** Flame shots and bolts, over everything. */
  readonly shots = new Container();
  private readonly bolts = new Graphics();
  private readonly flameSprites: Sprite[] = [];
  private readonly sprites = new Map<Structure, Overlay>();

  constructor(
    private readonly world: World,
    private readonly tex: Record<string, Texture>,
  ) {
    this.shots.addChild(this.bolts);
  }

  update(): void {
    this.drawLines();
    this.drawStructures();
    this.drawShots();
  }

  /** Power lines in copper, pipes in grey, with a light dot at each bend (C4Object::DrawLine). */
  private drawLines(): void {
    const g = this.lines;
    g.clear();
    for (const l of this.world.lines) {
      if (l.removed || l.xs.length < 2) continue;
      g.moveTo(l.xs[0] + 0.5, l.ys[0] + 0.5);
      for (let i = 1; i < l.xs.length; i++) g.lineTo(l.xs[i] + 0.5, l.ys[i] + 0.5);
      g.stroke({ color: LINE.colors[l.kind], width: 1 });
      for (let i = 1; i < l.xs.length - 1; i++) g.rect(l.xs[i], l.ys[i], 1, 1).fill(LINE.colors.joint);
    }
    // The derrick's pipe down to its drill head (DerrickPipeLine).
    for (const s of this.world.structures) {
      if (s.def.id !== 'derrick' || !s.drill || s.gone || !s.complete) continue;
      const top = s.y + Math.trunc(s.def.height / 4);
      if (s.drill.y <= top) continue;
      g.moveTo(s.x + 0.5, top).lineTo(s.x + 0.5, s.drill.y).stroke({ color: LINE.colors.drain, width: 1 });
    }
  }

  private overlay(s: Structure): Overlay {
    let o = this.sprites.get(s);
    if (!o) {
      o = {
        work: new Sprite(),
        energy: new Sprite(this.tex[POWER_GRAPHICS.energy]),
        signal: s.def.id === 'signal' ? new Sprite() : null,
        head: s.def.id === 'derrick' ? new Sprite(frame(this.tex[POWER_GRAPHICS.pipeHead], 0, 0, 3, 4)) : null,
      };
      for (const sp of [o.signal, o.work, o.head, o.energy]) if (sp) this.overlays.addChild(sp);
      this.sprites.set(s, o);
    }
    return o;
  }

  private drawStructures(): void {
    const seen = new Set<Structure>();
    for (const s of this.world.structures) {
      const act = ACTIVITIES[s.def.id];
      const powered = s.def.energy > 0 || !!act || s.def.id === 'signal';
      if (!powered) continue;
      seen.add(s);
      const o = this.overlay(s);
      const alive = s.complete && !s.burned && !s.gone;
      // Working: the frame of its animation.
      o.work.visible = alive && !!act && s.activity === act.activity;
      if (o.work.visible && act) {
        const sheet = this.tex[s.def.graphic.file];
        o.work.texture = frame(sheet, act.x + s.phase * act.w, act.y, act.w, act.h);
        o.work.position.set(s.left + act.at.x, s.top + act.at.y);
      }
      // Out of power: the energy symbol blinks over it (C4Object::Draw with NeedEnergy).
      o.energy.visible = alive && s.needEnergy && this.world.tick % 35 > 12;
      if (o.energy.visible) o.energy.position.set(s.x - 5, s.top + 2);
      if (o.signal) {
        o.signal.visible = alive;
        if (alive) {
          const f = SIGNAL_FRAME;
          o.signal.texture = frame(this.tex[s.def.graphic.file], s.signal.phase * f.w, s.signal.load * f.h, f.w, f.h);
          o.signal.position.set(s.left, s.top);
        }
      }
      if (o.head) {
        o.head.visible = alive && !!s.drill;
        if (s.drill) o.head.position.set(s.x - 1, Math.round(s.drill.y) - 1);
      }
    }
    for (const [s, o] of this.sprites) {
      if (seen.has(s)) continue;
      for (const sp of [o.work, o.energy, o.signal, o.head]) sp?.destroy();
      this.sprites.delete(s);
    }
  }

  /** Flame shots (FlameShot.c4d, turned the way they fly) and the lightning cannon's bolts (DrawBolt, bluish white). */
  private drawShots(): void {
    const shots = this.world.flameShots;
    while (this.flameSprites.length < shots.length) {
      const sp = new Sprite(this.tex[POWER_GRAPHICS.flameShot]);
      sp.anchor.set(0.5);
      this.shots.addChild(sp);
      this.flameSprites.push(sp);
    }
    this.flameSprites.forEach((sp, i) => {
      const f = shots[i];
      sp.visible = !!f;
      if (!f) return;
      sp.position.set(f.x, f.y);
      sp.angle = f.r - 90;
    });
    const g = this.bolts;
    g.clear();
    for (const b of this.world.towerBolts) {
      const pts = b.points;
      if (pts.length < 2) continue;
      const fade = b.fade >= 0 ? (b.fade + 1) / 5 : 1;
      for (const [color, width, alpha] of [[0x8090ff, 3, 0.4], [0xffffff, 1, 0.95]] as const) {
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x + Math.random() - 0.5, pts[i].y + Math.random() - 0.5);
        g.stroke({ color, width, alpha: alpha * fade });
      }
    }
  }
}
