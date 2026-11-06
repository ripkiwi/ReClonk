import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { World } from '../game/world';
import { CLONK, FLAG } from '../objects/defs';
import type { Clonk } from '../objects/clonk';
import type { Item } from '../objects/item';
import type { Structure } from '../objects/structure';
import { frame, type GameAssets } from './assets';
import { LandscapeView } from './landscapeView';

/** Shirt colours per player, like the original's ColorByOwner overlay. */
export const PLAYER_COLORS = [0x2a5bd7, 0xd23c2c, 0x2fa83a, 0xe0b020];

interface Flash {
  g: Graphics;
  born: number;
  radius: number;
}

/** Draws one player's view of the world: sky, landscape, objects and effects, following a clonk. */
export class WorldView {
  readonly root = new Container();
  private readonly sky: TilingSprite;
  private readonly layer = new Container();
  private readonly landscape: LandscapeView;
  private readonly clonkSprites = new Map<Clonk, { body: Sprite; shirt: Sprite }>();
  private readonly itemSprites = new Map<Item, Sprite>();
  private readonly structureSprites = new Map<Structure, { body: Sprite; door: Sprite; pole: Sprite; cloth: Sprite }>();
  /** Buildings sit behind loose items and clonks. */
  private readonly structureLayer = new Container();
  private readonly flashes: Flash[] = [];
  zoom = 2;
  camX = 0;
  camY = 0;

  constructor(
    private readonly world: World,
    private readonly assets: GameAssets,
  ) {
    this.sky = new TilingSprite({ texture: assets.sky, width: 1, height: 1 });
    this.sky.alpha = 0.7;
    this.root.addChild(this.sky, this.layer);
    this.landscape = new LandscapeView(world.land, assets.materials);
    this.layer.addChild(this.landscape.sprite, this.structureLayer);
  }

  /** Update everything for a screen of the given size, centred on `follow`. */
  update(screenW: number, screenH: number, follow: Clonk | undefined): void {
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
    this.updateEffects();
  }

  private updateClonks(): void {
    for (const c of this.world.clonks) {
      let s = this.clonkSprites.get(c);
      if (!s) {
        s = { body: new Sprite(), shirt: new Sprite() };
        s.body.anchor.set(0.5);
        s.shirt.anchor.set(0.5);
        s.shirt.tint = PLAYER_COLORS[c.owner % PLAYER_COLORS.length];
        this.layer.addChild(s.body, s.shirt);
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
        };
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
        s.cloth.tint = PLAYER_COLORS[st.base % PLAYER_COLORS.length];
      }
    }
  }

  private updateEffects(): void {
    for (const e of this.world.events.splice(0)) {
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
  }
}
