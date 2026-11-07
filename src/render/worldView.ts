import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js';
import { PLAYER_COLORS } from '../game/profiles';
import { rankName } from '../game/ranks';
import type { CrewCursor, World, WorldEvent } from '../game/world';
import { CLONK, FLAG } from '../objects/defs';
import type { Clonk } from '../objects/clonk';
import type { Item } from '../objects/item';
import type { Structure } from '../objects/structure';
import { frame, type GameAssets } from './assets';
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

/** How long a message above a clonk stays up, in ticks. */
const MESSAGE_TICKS = 36 * 4;

/** Draws one player's view of the world: sky, landscape, objects and effects, following a clonk. */
export class WorldView {
  readonly root = new Container();
  private readonly sky: TilingSprite;
  private readonly layer = new Container();
  private readonly landscape: LandscapeView;
  private readonly clonkSprites = new Map<Clonk, { body: Sprite; shirt: Sprite }>();
  private readonly itemSprites = new Map<Item, Sprite>();
  private readonly structureSprites = new Map<Structure, { body: Sprite; door: Sprite; pole: Sprite; cloth: Sprite; basement: Sprite | null }>();
  /** Buildings sit behind loose items and clonks. */
  private readonly structureLayer = new Container();
  /** Marks over the selected clonks. */
  private readonly marks = new Graphics();
  private readonly flashes: Flash[] = [];
  private readonly messages: Message[] = [];
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
    this.layer.addChild(this.landscape.sprite, this.structureLayer);
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

    this.layer.scale.set(this.zoom);
    this.layer.position.set(-Math.round(this.camX * this.zoom), -Math.round(this.camY * this.zoom));
    this.sky.width = screenW;
    this.sky.height = screenH;
    this.sky.tileScale.set(this.zoom * 1.5);
    this.sky.tilePosition.set(-this.camX * 0.4 * this.zoom, -this.camY * 0.4 * this.zoom);

    this.landscape.update();
    this.updateStructures();
    this.updateItems();
    this.updateClonks();
    this.updateMarks(cursor);
    this.updateEffects(events);
  }

  /** Remove everything from the screen and free the landscape texture. */
  destroy(): void {
    const tex = this.landscape.sprite.texture;
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
    }
    for (const [item, s] of this.itemSprites) {
      if (!seen.has(item)) {
        s.destroy();
        this.itemSprites.delete(item);
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
          body: new Sprite(frame(tex[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h)),
          door: new Sprite(),
          pole: new Sprite(),
          cloth: new Sprite(),
          basement: null,
        };
        const b = st.basement;
        if (b && st.def.basement) {
          s.basement = new Sprite(frame(tex[st.def.basement.file], 0, 0, b.w, b.h));
          s.basement.position.set(b.x, b.y);
          this.structureLayer.addChild(s.basement);
        }
        const left = st.x + st.def.offset.x;
        const top = st.y + st.def.offset.y;
        s.body.position.set(left, top);
        s.door.position.set(left + g.door.at.x, top + g.door.at.y);
        // The flag's attach vertex sits on the building's flag vertex.
        const fx = st.x + st.def.flagVertex.x - FLAG.vertex.x - FLAG.width / 2;
        const fy = st.y + st.def.flagVertex.y - FLAG.vertex.y - FLAG.height / 2;
        s.pole.position.set(fx, fy);
        s.cloth.position.set(fx, fy);
        this.structureLayer.addChild(s.body, s.door, s.pole, s.cloth);
        this.structureSprites.set(st, s);
      }
      if (s.basement && !st.basement) {
        s.basement.destroy();
        s.basement = null;
      }
      const d = st.doorFrame;
      s.door.visible = st.door > 0;
      if (st.door > 0) s.door.texture = frame(tex[g.file], g.door.x + d * g.door.w, g.door.y, g.door.w, g.door.h);

      s.pole.visible = s.cloth.visible = st.hasFlag;
      if (st.hasFlag) {
        const f = FLAG.fly;
        const phase = Math.floor(this.world.tick / f.delay) % f.length;
        const y = f.y + f.dir * FLAG.height;
        s.pole.texture = frame(tex[FLAG.graphic.file], phase * FLAG.width, y, FLAG.width, FLAG.height);
        s.cloth.texture = frame(tex[FLAG.graphic.overlay], phase * FLAG.width, y, FLAG.width, FLAG.height);
        s.cloth.tint = this.colorOf(st.base);
      }
    }
  }

  private updateEffects(events: readonly WorldEvent[]): void {
    for (const e of events) {
      if (e.type === 'promotion' && e.clonk.info) {
        this.say(e.clonk, `${e.clonk.info.name} is promoted\nto ${rankName(e.rank)}!`);
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
