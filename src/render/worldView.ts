import { ColorMatrixFilter, Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js';
import { PLAYER_COLORS } from '../game/profiles';
import { rankName } from '../game/ranks';
import { Weather } from '../game/weather';
import type { CrewCursor, World, WorldEvent } from '../game/world';
import { MATERIALS, Mat } from '../landscape/materials';
import { CLONK, CONSTRUCTION, ELEVATOR_CASE, FLAG, GATE } from '../objects/defs';
import type { Clonk } from '../objects/clonk';
import type { Item } from '../objects/item';
import type { Structure } from '../objects/structure';
import { GRASS, type Grass, type Plant } from '../objects/vegetation';
import { frame, type GameAssets } from './assets';
import { FireView } from './fireView';
import { LandscapeView } from './landscapeView';

interface Flash {
  g: Graphics;
  born: number;
  radius: number;
}

interface Message {
  text: Text;
  born: number;
  follow: Clonk;
}

interface StructureSprites {
  /** The whole building, faint, while it's a construction site. */
  site: Sprite;
  /** The built part. */
  body: Sprite;
  door: Sprite;
  pole: Sprite;
  cloth: Sprite;
  basement: Sprite | null;
  rope: Graphics;
  liftCase: Sprite | null;
  gates: Sprite[];
  /** Con the body was last drawn for, and whether as the burned ruin. */
  con: number;
  burned: boolean;
}

/** Smoke and sparks behind a meteor (Meteor.c4d SmokeTrail), drawn only. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  alpha: number;
  life: number;
  age: number;
  /** Falls by this much more each tick (grass blades, dust). */
  gravity?: number;
}

/** How long a message above a clonk stays up, in ticks. */
const MESSAGE_TICKS = 36 * 4;

/** The original's season colour ramps (C4Weather SeasonColors): dark, middle and light for winter, spring, summer, autumn. */
const SEASON_COLORS = [
  [0x000000, 0x7f7f90, 0xefefff],
  [0x070f00, 0x90a07f, 0xffffdf],
  [0x000000, 0x808080, 0xffffff],
  [0x0f0700, 0xa08067, 0xffffdf],
];

/**
 * C4Weather::SetSeasonGamma: the season's colour ramp, blended between
 * seasons and turned bluer when it's freezing. Returns [dark, middle, light]
 * for red, green and blue.
 */
export function seasonRamp(season: number, temperature: number): number[][] {
  const s1 = Math.trunc(season / 25) % 4;
  const s2 = (s1 + 1) % 4;
  const off1 = Math.max(5, Math.min(19, season % 25)) - 5;
  const off2 = 15 - off1;
  return [16, 8, 0].map((shift) =>
    [0, 1, 2].map((i) => {
      const c1 = (SEASON_COLORS[s1][i] >> shift) & 255;
      const c2 = (SEASON_COLORS[s2][i] >> shift) & 255;
      let v = Math.trunc((c1 * off2 + c2 * off1) / 15);
      // Red and green fade in the cold, blue comes out.
      if (temperature < 0) v += shift ? Math.trunc(temperature / 2) : -Math.trunc(temperature / 2);
      return Math.max(0, Math.min(255, v));
    }),
  );
}

/** The straight line through a ramp's three points (at 0, 128 and 255), as scale and offset. */
function fitRamp(p: number[]): [number, number] {
  const xs = [0, 128, 255];
  const mx = (0 + 128 + 255) / 3;
  const my = (p[0] + p[1] + p[2]) / 3;
  let num = 0;
  let den = 0;
  for (let i = 0; i < 3; i++) {
    num += (xs[i] - mx) * (p[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const a = num / den;
  return [a, (my - a * mx) / 255];
}

/** Draws one player's view of the world: sky, landscape, objects and effects, following a clonk. */
export class WorldView {
  readonly root = new Container();
  private readonly sky: TilingSprite;
  private readonly layer = new Container();
  private readonly landscape: LandscapeView;
  private readonly clonkSprites = new Map<Clonk, { body: Sprite; shirt: Sprite }>();
  private readonly itemSprites = new Map<Item, Sprite>();
  /** The owner-coloured cloth of loose flags, drawn over their item sprite. */
  private readonly itemOverlays = new Map<Item, Sprite>();
  private readonly structureSprites = new Map<Structure, StructureSprites>();
  /** Trees and bushes: a holder at the root that tilts when it falls, and the picture in it. */
  private readonly plantSprites = new Map<Plant, { holder: Container; body: Sprite; burned: boolean | null }>();
  private readonly grassSprites = new Map<Grass, Sprite>();
  /** Grass sits behind trees, trees behind buildings (the original's object order). */
  private readonly grassLayer = new Container();
  private readonly plantLayer = new Container();
  /** Buildings sit behind loose items and clonks. */
  private readonly structureLayer = new Container();
  /** Marks over the selected clonks. */
  private readonly marks = new Graphics();
  private readonly flashes: Flash[] = [];
  private readonly messages: Message[] = [];
  /** Rain, snow and loose earth in flight. */
  private readonly pxs = new Graphics();
  /** Lightning bolts and meteor trails, over everything. */
  private readonly sparks = new Graphics();
  private readonly particles: Particle[] = [];
  /** Flames and smoke. */
  private readonly fire: FireView;
  /** Season colours and lightning flashes. */
  private readonly tint = new ColorMatrixFilter();
  private lastTick = -1;
  zoom = 2;
  camX = 0;
  camY = 0;

  constructor(
    private readonly world: World,
    private readonly assets: GameAssets,
    /** Shirt colour for a player number. */
    private readonly colorOf: (owner: number) => number = (o) => PLAYER_COLORS[o % PLAYER_COLORS.length],
  ) {
    this.sky = new TilingSprite({ texture: assets.sky, width: 1, height: 1 });
    this.sky.alpha = 0.7;
    this.root.addChild(this.sky, this.layer);
    this.landscape = new LandscapeView(world.land, assets.materials);
    this.fire = new FireView(world, assets.items);
    this.layer.addChild(this.landscape.sprite, this.grassLayer, this.fire.back, this.plantLayer, this.structureLayer, this.pxs);
  }

  /**
   * Corner marks around the selected clonks and a small arrow over the leader,
   * like the original's selection marks.
   */
  private updateMarks(cursor: CrewCursor | undefined): void {
    const g = this.marks;
    g.clear();
    if (!cursor) return;
    const color = 0xffe070;
    for (const c of cursor.selected) {
      if (c.contained || !c.alive) continue;
      const l = c.x - 9;
      const t = c.y - 12;
      const r = c.x + 9;
      const b = c.y + 11;
      const k = 3;
      g.moveTo(l, t + k).lineTo(l, t).lineTo(l + k, t)
        .moveTo(r - k, t).lineTo(r, t).lineTo(r, t + k)
        .moveTo(l, b - k).lineTo(l, b).lineTo(l + k, b)
        .moveTo(r - k, b).lineTo(r, b).lineTo(r, b - k);
    }
    g.stroke({ color, width: 1, alpha: 0.9 });
    const lead = cursor.leader;
    if (lead && !lead.contained && lead.alive) {
      const bob = Math.round(Math.sin(this.world.tick / 6));
      const y = lead.y - 17 + bob;
      g.poly([lead.x - 3, y - 3, lead.x + 3, y - 3, lead.x, y]).fill({ color, alpha: 0.95 });
    }
  }

  /** Update everything for a screen of the given size, centred on `follow`. */
  update(screenW: number, screenH: number, follow: Clonk | undefined, events: readonly WorldEvent[], cursor?: CrewCursor): void {
    const { land } = this.world;
    // Pick a zoom that shows roughly 380 world pixels vertically, like the original at 1:1 on an old screen.
    this.zoom = Math.max(1, Math.round(screenH / 380));
    const viewW = screenW / this.zoom;
    const viewH = screenH / this.zoom;
    if (follow) {
      // Ease towards the clonk.
      const tx = follow.x - viewW / 2;
      const ty = follow.y - viewH / 2;
      this.camX += (tx - this.camX) * 0.2;
      this.camY += (ty - this.camY) * 0.2;
    }
    this.camX = Math.max(0, Math.min(land.width - viewW, this.camX));
    this.camY = Math.max(0, Math.min(land.height - viewH, this.camY));
    if (viewW > land.width) this.camX = (land.width - viewW) / 2;

    const [sx, sy] = this.quakeShake(follow);
    this.layer.scale.set(this.zoom);
    this.layer.position.set(-Math.round((this.camX + sx) * this.zoom), -Math.round((this.camY + sy) * this.zoom));
    this.sky.width = screenW;
    this.sky.height = screenH;
    this.sky.tileScale.set(this.zoom * 1.5);
    const skyX = this.world.weather?.skyX ?? 0;
    this.sky.tilePosition.set((-(this.camX + sx) * 0.4 + skyX) * this.zoom, -(this.camY + sy) * 0.4 * this.zoom);

    this.landscape.update();
    this.updatePlants();
    this.updateStructures();
    this.updateItems();
    this.updateClonks();
    this.updateMarks(cursor);
    this.updatePxs(viewW, viewH);
    this.fire.update();
    this.layer.addChild(this.fire.front);
    this.updateSparks();
    this.updateTint();
    this.updateEffects(events);
  }

  /**
   * Earthquakes shake the view (Earthquake.c4d FxQuakeEffectTimer): weak at
   * first, hardest halfway, weak again at the end, and less the further away.
   */
  private quakeShake(follow: Clonk | undefined): [number, number] {
    const w = this.world.weather;
    if (!w?.quakes.length) return [0, 0];
    let x = 0;
    let y = 0;
    for (const q of w.quakes) {
      let level = Weather.shake(q);
      if (level <= 0) continue;
      if (follow) level = (300 * level) / Math.max(300, Math.hypot(follow.x - q.x, follow.y - q.y));
      const a = (q.time * 100 * Math.PI) / 180;
      x += Math.sin(a) * level;
      y += Math.cos(a) * level;
    }
    return [x, y];
  }

  /**
   * Loose pixels like the original draws them: a streak for the fast ones
   * (rain), a dot for the slow ones; snow as soft white flakes.
   */
  private updatePxs(viewW: number, viewH: number): void {
    const g = this.pxs;
    g.clear();
    const list = this.world.land.pxs.list;
    if (!list.length) return;
    const x0 = this.camX - 20;
    const y0 = this.camY - 20;
    const x1 = this.camX + viewW + 20;
    const y1 = this.camY + viewH + 20;
    let snow = false;
    let rain = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if (p.mat === Mat.Snow) snow = true;
      else if (p.mat === Mat.Water && Math.abs(p.xdir) + Math.abs(p.ydir) >= 1) {
        g.moveTo(p.x - p.xdir, p.y - p.ydir).lineTo(p.x, p.y);
        rain = true;
      }
    }
    if (rain) g.stroke({ color: 0x5c7cff, width: 1, alpha: 0.7 });
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.mat === Mat.Snow || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const fast = Math.abs(p.xdir) + Math.abs(p.ydir) >= 1;
      if (p.mat === Mat.Water && fast) continue;
      // Flying lava glows (Lava.c4m PXSGfx, 6 px); other drops show their own colour.
      if (p.mat === Mat.Lava || p.mat === Mat.DuroLava) {
        g.circle(p.x, p.y, 3).fill({ color: 0xff8010, alpha: 0.35 });
        g.circle(p.x, p.y, 1.4).fill(0xfff060);
      } else g.rect(Math.floor(p.x), Math.floor(p.y), fast ? 2 : 1, fast ? 2 : 1).fill(MATERIALS[p.mat].colors[2]);
    }
    if (!snow) return;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.mat !== Mat.Snow || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      // Flakes of a few sizes, the bigger ones fainter (C4PXSSystem::Draw).
      const z = 1 + ((i ^ 341) % 3);
      g.circle(p.x, p.y, z * 0.6).fill({ color: 0xffffff, alpha: 1 - z * 0.15 });
    }
  }

  /** Lightning bolts, and smoke and sparks behind meteors. */
  private updateSparks(): void {
    const g = this.sparks;
    g.clear();
    this.layer.addChild(g);
    const w = this.world.weather;
    for (const b of w?.bolts ?? []) {
      const pts = b.points;
      if (pts.length < 2) continue;
      // C4FacetEx::DrawBolt: each segment a thin, jittery white sliver.
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const c = pts[i];
        const jx = Math.random() * 2 - 1;
        const jy = Math.random() * 2 - 1;
        g.poly([a.x, a.y, c.x, c.y, c.x + jx, c.y + jy, a.x + jx, a.y + jy]).fill({ color: 0xffffff, alpha: 0.95 });
        g.moveTo(a.x, a.y).lineTo(c.x, c.y);
      }
      g.stroke({ color: 0xc8d8ff, width: 2.5, alpha: 0.35 });
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
    }
    // New smoke and sparks once per tick for every meteor.
    const tick = this.world.tick;
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      for (const item of this.world.items) {
        if (item.def.id !== 'meteor' || item.container) continue;
        const add = (p: Partial<Particle> & { size: number; color: number; life: number }): void => {
          this.particles.push({ x: item.x, y: item.y, vx: 0, vy: 0, alpha: 0.5, age: 0, ...p });
        };
        add({ size: 3, color: 0x404040, life: 30, vy: -0.3 });
        add({ y: item.y - 5, size: 1 + Math.random() * 3, color: 0x505050, life: 24, vy: -0.4 });
        for (let n = Math.floor(Math.random() * 6); n > 0; n--) {
          const c = 20 + Math.random() * 41;
          const color = (255 << 16) | (Math.floor(Math.random() * 100) << 8) | Math.min(255, Math.floor(c * 4));
          add({ x: item.x + Math.random() * 11 - 5, y: item.y + Math.random() * 11 - 5, size: c / 40, color, life: 8 });
        }
        add({ size: 1.2, color: 0xff9b00, life: 6, alpha: 0.8 });
      }
      // Sparks from burning fuses, in hands too.
      for (const item of this.world.items) {
        if (!item.lit || item.removed) continue;
        const holder = item.container as Clonk | null;
        if (holder?.contained) continue;
        const x = holder ? holder.x + holder.dir * 4 : item.x;
        const y = holder ? holder.y - 2 : item.y - 2;
        for (let n = 1 + Math.floor(Math.random() * 2); n > 0; n--) {
          this.particles.push({
            x, y, vx: Math.random() * 1.2 - 0.6, vy: -Math.random() * 1.2, size: 0.6 + Math.random() * 0.5,
            color: Math.random() < 0.5 ? 0xffd040 : 0xff8020, alpha: 1, life: 6 + Math.floor(Math.random() * 6), age: 0, gravity: 0.08,
          });
        }
      }
      for (const p of this.particles) {
        p.age++;
        if (p.gravity) p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
      }
      for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].age >= this.particles[i].life) this.particles.splice(i, 1);
    }
    for (const p of this.particles) {
      const t = p.age / p.life;
      g.circle(p.x, p.y, p.size * (1 + t)).fill({ color: p.color, alpha: p.alpha * (1 - t) });
    }
    this.layer.addChild(this.marks);
  }

  /**
   * The original's gamma ramps, as a colour matrix over the whole view: the
   * season's colours (if the scenario wants them), and the white flash of lightning.
   */
  private updateTint(): void {
    const w = this.world.weather;
    const season = w?.def.seasonColors ? seasonRamp(w.season, w.temperature) : null;
    const flash = w?.flash ?? 0;
    if (!season && !flash) {
      if (this.root.filters) this.root.filters = null;
      return;
    }
    const m = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    for (let ch = 0; ch < 3; ch++) {
      let [a, b] = season ? fitRamp(season[ch]) : [1, 0];
      if (flash) {
        // Lightning: dark brightened to the flash, middle half way (ramp 5).
        const [la, lb] = fitRamp([flash, 128 + flash / 2, 255]);
        a = la * a;
        b = la * b + lb;
      }
      m[ch * 5 + ch] = a;
      m[ch * 5 + 4] = b;
    }
    this.tint.matrix = m as typeof this.tint.matrix;
    if (!this.root.filters) this.root.filters = [this.tint];
  }

  /** Remove everything from the screen and free the landscape texture. */
  destroy(): void {
    const tex = this.landscape.sprite.texture;
    this.fire.destroy();
    this.root.destroy({ children: true });
    tex.destroy(true);
  }

  /** Show a message above a clonk, like the original's GameMsgObject. */
  say(clonk: Clonk, message: string): void {
    for (const m of this.messages.filter((m) => m.follow === clonk)) m.born = -Infinity;
    const text = new Text({
      text: message,
      style: {
        fontFamily: 'Endeavour, serif',
        fontSize: 26,
        fill: '#ffffff',
        align: 'center',
        stroke: { color: '#000000', width: 4 },
      },
    });
    text.anchor.set(0.5, 1);
    text.scale.set(0.5);
    this.layer.addChild(text);
    this.messages.push({ text, born: this.world.tick, follow: clonk });
  }

  private updateClonks(): void {
    for (const c of this.world.clonks) {
      let s = this.clonkSprites.get(c);
      if (!s) {
        s = { body: new Sprite(), shirt: new Sprite() };
        s.body.anchor.set(0.5);
        s.shirt.anchor.set(0.5);
        s.shirt.tint = this.colorOf(c.owner);
        this.layer.addChild(s.body, s.shirt);
        // Keep the selection marks on top of every clonk.
        this.layer.addChild(this.marks);
        this.clonkSprites.set(c, s);
      }
      s.body.visible = s.shirt.visible = !c.contained;
      const a = c.action;
      const fx = a.facetX + c.phase * CLONK.width;
      for (const [sprite, sheet] of [
        [s.body, this.assets.clonk],
        [s.shirt, this.assets.clonkOverlay],
      ] as const) {
        sprite.texture = frame(sheet, fx, a.facetY, CLONK.width, CLONK.height);
        sprite.position.set(c.x, c.y);
        // The sheet is drawn facing left; mirror it when facing right.
        sprite.scale.x = -c.dir;
      }
    }
  }

  private updateItems(): void {
    const seen = new Set<Item>();
    for (const item of this.world.items) {
      if (item.container) continue;
      seen.add(item);
      let s = this.itemSprites.get(item);
      if (!s) {
        const g = item.def.graphic;
        s = new Sprite(frame(this.assets.items[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h));
        s.anchor.set(0.5);
        this.layer.addChildAt(s, 2);
        this.itemSprites.set(item, s);
      }
      s.position.set(item.x, item.y);
      s.angle = item.r;
      // Burning wood gets smaller, and stays charred (Wood.c4d Incineration: RGB 48, 32, 32).
      s.scale.set(item.con / 100000);
      s.tint = item.burned ? 0x302020 : 0xffffff;
      const lit = item.def.litFacet;
      if (lit) {
        const f = item.lit ? lit : item.def.graphic.facet;
        s.texture = frame(this.assets.items[item.def.graphic.file], f.x, f.y, f.w, f.h);
      }
      const over = item.def.graphic.overlay;
      if (over) {
        let o = this.itemOverlays.get(item);
        if (!o) {
          const f = item.def.graphic.facet;
          o = new Sprite(frame(this.assets.items[over], f.x, f.y, f.w, f.h));
          o.anchor.set(0.5);
          this.layer.addChildAt(o, this.layer.getChildIndex(s) + 1);
          this.itemOverlays.set(item, o);
        }
        o.position.copyFrom(s.position);
        o.angle = s.angle;
        o.scale.copyFrom(s.scale);
        o.tint = item.owner >= 0 ? this.colorOf(item.owner) : 0xffffff;
      }
    }
    for (const [item, s] of this.itemSprites) {
      if (!seen.has(item)) {
        s.destroy();
        this.itemSprites.delete(item);
        this.itemOverlays.get(item)?.destroy();
        this.itemOverlays.delete(item);
      }
    }
  }

  /** Trees sway in their animation strips and grow stretched from the bottom; felled ones lie tilted over their root. */
  private updatePlants(): void {
    const tex = this.assets.items;
    const seen = new Set<Plant>();
    for (const p of this.world.plants) {
      seen.add(p);
      const d = p.def;
      let s = this.plantSprites.get(p);
      if (!s) {
        const body = new Sprite();
        body.anchor.set(0.5);
        body.scale.x = p.dir;
        const holder = new Container();
        holder.addChild(body);
        this.plantLayer.addChild(holder);
        s = { holder, body, burned: null };
        this.plantSprites.set(p, s);
      }
      // A burned tree is one picture of a dead tree, its own size, on the same root.
      const b = p.burned ? d.burned : d;
      if (s.burned !== p.burned) {
        s.burned = p.burned;
        s.body.position.set((b.offset.x + b.width / 2 - d.root.x) * p.dir, b.offset.y + b.height / 2 - d.root.y);
      }
      if (p.burned) s.body.texture = frame(tex[d.burned.file], 0, 0, b.width, b.height);
      else {
        const f = p.state === 'standing' ? p.frame(this.world.tick) : 0;
        s.body.texture = frame(tex[d.file], f * d.width, 0, d.width, d.height);
      }
      const pv = p.pivot;
      s.holder.position.set(pv.x, pv.y);
      s.holder.scale.set(p.scale);
      s.holder.angle = p.r;
    }
    for (const [p, s] of this.plantSprites) {
      if (!seen.has(p)) {
        s.holder.destroy({ children: true });
        this.plantSprites.delete(p);
      }
    }
    const gseen = new Set<Grass>();
    for (const g of this.world.grass) {
      gseen.add(g);
      if (this.grassSprites.has(g)) continue;
      const sp = new Sprite(frame(tex[GRASS.file], g.frame * GRASS.width, 0, GRASS.width, GRASS.height));
      sp.anchor.set(0.5);
      sp.position.set(g.x, g.y);
      sp.scale.set(g.scale * g.dir, g.scale);
      sp.angle = g.r;
      this.grassLayer.addChild(sp);
      this.grassSprites.set(g, sp);
    }
    for (const [g, sp] of this.grassSprites) {
      if (!gseen.has(g)) {
        sp.destroy();
        this.grassSprites.delete(g);
      }
    }
  }

  private updateStructures(): void {
    const tex = this.assets.items;
    for (const st of this.world.structures) {
      const g = st.def.graphic;
      let s = this.structureSprites.get(st);
      if (!s) {
        s = {
          site: new Sprite(frame(tex[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h)),
          body: new Sprite(),
          door: new Sprite(),
          pole: new Sprite(),
          cloth: new Sprite(),
          basement: null,
          rope: new Graphics(),
          liftCase: null,
          gates: [],
          con: -1,
          burned: false,
        };
        const b = st.basement;
        if (b && st.def.basement) {
          s.basement = new Sprite(frame(tex[st.def.basement.file], 0, 0, b.w, b.h));
          s.basement.position.set(b.x, b.y);
          this.structureLayer.addChild(s.basement);
        }
        const left = st.left;
        const top = st.top;
        // A construction site shows the whole building faintly, and the built part solid.
        s.site.position.set(left, top);
        s.site.alpha = 0.25;
        if (g.door) s.door.position.set(left + g.door.at.x, top + g.door.at.y);
        // The flag's attach vertex sits on the building's flag vertex.
        const fx = st.x + st.def.flagVertex.x - FLAG.vertex.x - FLAG.width / 2;
        const fy = st.y + st.def.flagVertex.y - FLAG.vertex.y - FLAG.height / 2;
        s.pole.position.set(fx, fy);
        s.cloth.position.set(fx, fy);
        this.structureLayer.addChild(s.rope, s.site, s.body, s.door, s.pole, s.cloth);
        this.structureSprites.set(st, s);
      }
      if (s.basement && !st.basement) {
        s.basement.destroy();
        s.basement = null;
      }
      // Burned away: only the basement is left.
      if (st.gone) {
        for (const sp of [s.site, s.body, s.door, s.pole, s.cloth, s.liftCase, ...s.gates]) if (sp) sp.visible = false;
        s.rope.clear();
        continue;
      }
      // Burned: the black ruin (its Burned.c4d graphics), which burns down from the top.
      const file = st.burned ? st.def.burned.file : g.file;
      if (st.burned !== s.burned) {
        s.burned = st.burned;
        s.con = -1;
        s.site.texture = frame(tex[file], g.facet.x, g.facet.y, g.facet.w, g.facet.h);
      }
      if (st.con !== s.con) {
        // The built part, from the bottom up.
        s.con = st.con;
        const full = st.con >= CONSTRUCTION.fullCon;
        const h = full ? g.facet.h : Math.max(1, Math.round((g.facet.h * st.con) / CONSTRUCTION.fullCon));
        s.body.texture = frame(tex[file], g.facet.x, g.facet.y + g.facet.h - h, g.facet.w, h);
        s.body.position.set(st.left, st.top + g.facet.h - h);
        s.site.visible = !full && !st.burned;
      }
      const d = st.doorFrame;
      s.door.visible = !!g.door && st.door > 0;
      if (g.door && st.door > 0) s.door.texture = frame(tex[g.file], g.door.x + d * g.door.w, g.door.y, g.door.w, g.door.h);

      s.pole.visible = s.cloth.visible = st.hasFlag;
      if (st.hasFlag) {
        const f = FLAG.fly;
        const phase = Math.floor(this.world.tick / f.delay) % f.length;
        // The flag flies the way the wind blows (Flag.c4d Flying).
        const weather = this.world.weather;
        const dir = weather ? Math.max(0, Math.min(8, Math.trunc(weather.windAt(this.world, st.x, st.top) / 10) + 4)) : f.dir;
        const y = f.y + dir * FLAG.height;
        s.pole.texture = frame(tex[FLAG.graphic.file], phase * FLAG.width, y, FLAG.width, FLAG.height);
        s.cloth.texture = frame(tex[FLAG.graphic.overlay], phase * FLAG.width, y, FLAG.width, FLAG.height);
        s.cloth.tint = this.colorOf(st.base);
      }

      // Elevator: the case, hanging from its rope (LiftCase, stretched from the elevator's top).
      const k = st.liftCase;
      if (!k && s.liftCase) {
        s.liftCase.destroy();
        s.liftCase = null;
        s.rope.clear();
      }
      for (const sp of s.gates.splice(st.gates.length)) sp.destroy();
      if (k) {
        const c = ELEVATOR_CASE;
        if (!s.liftCase) {
          s.liftCase = new Sprite(frame(tex[c.file], 0, 0, c.width, c.height));
          this.structureLayer.addChild(s.liftCase);
        }
        s.liftCase.position.set(k.left, k.boxTop);
        const rx = st.left + c.rope.x;
        const ry = st.top + c.rope.y;
        s.rope.clear().rect(rx, ry, c.rope.facet.w, Math.max(0, k.boxTop - ry)).fill(0x5a3a1a);
      }
      // Guard tower gates.
      st.gates.forEach((gate, i) => {
        let sp = s.gates[i];
        if (!sp) {
          sp = new Sprite(frame(tex[gate.def.file], 0, 0, GATE.width, GATE.height));
          this.structureLayer.addChild(sp);
          s.gates[i] = sp;
        }
        sp.position.set(gate.left, gate.top);
      });
    }
  }

  private updateEffects(events: readonly WorldEvent[]): void {
    for (const e of events) {
      if (e.type === 'promotion' && e.clonk.info) {
        this.say(e.clonk, `${e.clonk.info.name} is promoted\nto ${rankName(e.rank)}!`);
        continue;
      }
      if (e.type === 'grassBlown') {
        // Blades fly out (Grass.c4d OnShockwaveHit).
        const lvl = 40 + e.level / 2;
        const w = 20 * e.grass.scale;
        for (let n = 15 + Math.floor(Math.random() * 10); n > 0; n--) {
          this.particles.push({
            x: e.x + (Math.random() - 0.5) * w, y: e.y - 1, vx: ((Math.random() - 0.5) * 2 * lvl) / 3 / 10, vy: -(lvl / 3 + (Math.random() * lvl) / 3) / 10,
            size: 0.7, color: Math.random() < 0.5 ? 0x3c8c28 : 0x5aa83a, alpha: 1, life: 30 + Math.floor(Math.random() * 30), age: 0, gravity: 0.1,
          });
        }
        continue;
      }
      if (e.type === 'chop') {
        // Wood chips off the trunk (Clonk.c4d Chopping: CastParticles Dust).
        const c = e.clonk;
        for (let n = 1 + Math.floor(Math.random() * 3); n > 0; n--) {
          this.particles.push({
            x: c.x + c.dir * 8, y: c.y + 1, vx: c.dir * Math.random() * 0.8, vy: -Math.random() * 1.2, size: 0.8,
            color: 0x9a7040, alpha: 0.9, life: 14, age: 0, gravity: 0.08,
          });
        }
        continue;
      }
      // Lava hissing on water makes white steam, acid grey fumes (Smoke in C4Material.cpp's reactions), volcanoes thick smoke.
      if (e.type === 'poof') {
        if (Math.random() < 1 / 3) this.fire.puff(e.x, e.y - 2, 3, 0xd8d8d8);
        continue;
      }
      if (e.type === 'corrode') {
        if (Math.random() < 1 / 5) this.fire.puff(e.x, e.y - 2, 3 + Math.random() * 3, 0x708060);
        continue;
      }
      if (e.type === 'volcano') {
        for (let n = 1 + Math.floor(Math.random() * 3); n >= 0; n--) this.fire.puff(e.x + (Math.random() - 0.5) * 20, e.y - 10, 8 + Math.random() * 8, 0x584838);
        continue;
      }
      if (e.type !== 'explosion') continue;
      const g = new Graphics();
      g.position.set(e.x, e.y);
      this.layer.addChild(g);
      this.flashes.push({ g, born: this.world.tick, radius: e.radius });
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const age = this.world.tick - f.born;
      if (age > 14) {
        f.g.destroy();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = age / 14;
      f.g.clear();
      f.g.circle(0, 0, f.radius * (0.6 + t)).fill({ color: 0xffd040, alpha: 0.8 * (1 - t) });
      f.g.circle(0, 0, f.radius * (0.3 + 0.5 * t)).fill({ color: 0xffffff, alpha: 0.9 * (1 - t) * (1 - t) });
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      const age = this.world.tick - m.born;
      if (age > MESSAGE_TICKS) {
        m.text.destroy();
        this.messages.splice(i, 1);
        continue;
      }
      m.text.position.set(m.follow.x, m.follow.y - 14);
      m.text.alpha = age > MESSAGE_TICKS - 18 ? (MESSAGE_TICKS - age) / 18 : 1;
    }
  }
}
