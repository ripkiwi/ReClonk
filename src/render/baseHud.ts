import { Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import { TICKS_PER_SECOND } from '../core/loop';
import { shopEntry, type World } from '../game/world';
import type { Clonk, ControlStyle } from '../objects/clonk';
import { BUILD_PLANS, CLONK, ENERGY_UNIT, ITEMS, STRUCTURES } from '../objects/defs';
import { frame, type GameAssets } from './assets';

const style = (size: number, fill = '#ffffff'): TextStyleOptions => ({
  fill,
  fontSize: size,
  fontFamily: 'monospace',
  stroke: { color: '#000000', width: 3 },
});

/** Messages stay on screen this long. */
const MESSAGE_TICKS = TICKS_PER_SECOND * 3;

/** Key names for the building hints, per control style. */
const KEYS: Record<ControlStyle, { choose: string; buy: string; sell: string; up: string; down: string }> = {
  jumpAndRun: { choose: '←/→', buy: '↑ or E', sell: 'E', up: '↑', down: '↓' },
  classic: { choose: 'Z/C or ←/→', buy: 'S/↑ or A', sell: 'A', up: 'S/↑', down: 'X/↓' },
};

/**
 * HUD for one player's crew: energy bar, gold, and while inside a building
 * what you can do there (leave, buy, sell), plus short messages.
 */
export class BaseHud {
  readonly root = new Container();
  private readonly bars = new Graphics();
  private readonly energyText = new Text({ text: '', style: style(14) });
  private readonly coin = new Sprite();
  private readonly wealthText = new Text({ text: '', style: style(16, '#ffe070') });
  private readonly panel = new Graphics();
  private readonly title = new Text({ text: '', style: style(16) });
  private readonly menuRow = new Container();
  private readonly hint = new Text({ text: '', style: style(13, '#dddddd') });
  private readonly toast = new Text({ text: '', style: style(16, '#ffe070') });
  private messages: { text: string; tick: number }[] = [];
  /** What the buy menu was last drawn for, so it's only rebuilt when something changes. */
  private menuKey = '';

  constructor(
    private readonly world: World,
    private readonly assets: GameAssets,
    private readonly player: number,
    private readonly style: ControlStyle = 'jumpAndRun',
    /** Draw the energy bar and gold here. Off when another HUD shows them. */
    private readonly showStatus = true,
    /** The player's shirt colour, for clonks in the shop. */
    private readonly color = 0x2a5bd7,
  ) {
    const g = ITEMS.gold.graphic;
    this.coin.texture = frame(assets.items[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h);
    this.coin.scale.set(3);
    this.root.addChild(this.bars, this.energyText, this.coin, this.wealthText, this.panel, this.title, this.menuRow, this.hint, this.toast);
  }

  update(screenW: number, screenH: number, clonk: Clonk): void {
    const w = this.world;
    for (const m of w.messages.splice(0)) if (m.player === this.player) this.messages.push(m);
    this.messages = this.messages.filter((m) => w.tick - m.tick < MESSAGE_TICKS).slice(-3);

    this.bars.visible = this.energyText.visible = this.coin.visible = this.wealthText.visible = this.showStatus;
    // Energy bar under the carried-item slot, and gold next to it.
    const frac = clonk.energy / CLONK.energy;
    this.bars.clear()
      .roundRect(10, 60, 160, 14, 4).fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(12, 62, 156 * frac, 10, 3).fill(frac > 0.3 ? 0x3fbf4a : 0xd8402c);
    this.energyText.text = clonk.alive ? `${Math.ceil(clonk.energy / ENERGY_UNIT)}` : 'dead';
    this.energyText.position.set(176, 58);
    const wealth = w.players.get(this.player)?.wealth ?? 0;
    this.coin.position.set(10, 82);
    this.wealthText.text = `${wealth}`;
    this.wealthText.position.set(32, 82);

    this.updateBuilding(screenW, clonk);

    this.toast.text = this.messages.map((m) => m.text).join('\n');
    this.toast.anchor.set(0.5, 1);
    this.toast.position.set(screenW / 2, screenH - 44);
  }

  private updateBuilding(screenW: number, clonk: Clonk): void {
    const s = clonk.contained;
    const planning = !s && clonk.buildMenu !== null;
    const show = !!s || planning;
    this.panel.visible = this.title.visible = this.hint.visible = this.menuRow.visible = show;
    if (planning) return this.updateBuildMenu(screenW, clonk);
    if (!s) return;
    const own = this.world.inOwnBase(clonk);
    this.title.text = own ? `${s.def.name} (your base)` : s.def.name;
    const stock = this.world.players.get(this.player)?.stock ?? {};
    const list = clonk.menu === null ? [] : this.world.shopList(this.player);
    const key = `${clonk.menu}:${list.map((id) => `${id}=${stock[id]}`).join(',')}`;
    if (key !== this.menuKey) {
      this.menuKey = key;
      this.menuRow.removeChildren().forEach((c) => c.destroy({ children: true }));
      list.forEach((id, i) => {
        const def = shopEntry(id);
        const cell = new Container();
        const box = new Graphics().roundRect(0, 0, 92, 62, 6);
        if (i === clonk.menu) box.fill({ color: 0xffe070, alpha: 0.3 }).stroke({ color: 0xffe070, width: 2 });
        else box.fill({ color: 0x000000, alpha: 0.3 });
        let icon: Container;
        if (id === 'clonk') {
          // The clonk sprite plus its shirt overlay in the player's colour.
          const walk = CLONK.actions.Walk;
          icon = new Container();
          const shirt = new Sprite(frame(this.assets.clonkOverlay, walk.facetX, walk.facetY, CLONK.width, CLONK.height));
          shirt.tint = this.color;
          icon.addChild(new Sprite(frame(this.assets.clonk, walk.facetX, walk.facetY, CLONK.width, CLONK.height)), shirt);
          icon.scale.set(2);
          icon.position.set(2, 10);
        } else {
          const g = ITEMS[id].graphic;
          icon = new Sprite(frame(this.assets.items[g.file], g.facet.x, g.facet.y, g.facet.w, g.facet.h));
          icon.scale.set(4);
          icon.position.set(8, 8);
        }
        // Long names go on two lines.
        const name = def.name.length > 8 ? def.name.replace(' ', '\n') : def.name;
        const label = new Text({ text: `${name}\n${def.value}g  x${stock[id] ?? 0}`, style: style(12) });
        label.position.set(36, 10);
        cell.addChild(box, icon, label);
        cell.position.set(i * 100, 0);
        this.menuRow.addChild(cell);
      });
    }

    let height = 64;
    const k = KEYS[this.style];
    if (clonk.menu !== null) {
      this.hint.text = `${k.choose} choose · ${k.buy} buy · ${k.down} close`;
      height = 130;
    } else if (own) {
      const healing = clonk.energy < CLONK.energy ? 'Healing… ' : '';
      this.hint.text = `${healing}${k.up} buy · ${k.sell} sell what you carry · ${k.down} leave`;
    } else {
      this.hint.text = `No flag: not your base · ${k.down} leave`;
    }
    const width = Math.max(360, this.menuRow.width + 24);
    const x = Math.round(screenW / 2 - width / 2);
    this.panel.clear().roundRect(x, 10, width, height, 8).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    this.title.position.set(x + 12, 16);
    this.menuRow.position.set(x + 12, 42);
    this.hint.position.set(x + 12, 10 + height - 24);
  }

  /** The construction kit's menu: the buildings it can put up where the clonk stands. */
  private updateBuildMenu(screenW: number, clonk: Clonk): void {
    const key = `build:${clonk.buildMenu}`;
    if (key !== this.menuKey) {
      this.menuKey = key;
      this.menuRow.removeChildren().forEach((c) => c.destroy({ children: true }));
      BUILD_PLANS.forEach((id, i) => {
        const def = STRUCTURES[id];
        const p = def.graphic.picture;
        const cell = new Container();
        const box = new Graphics().roundRect(0, 0, 112, 76, 6);
        if (i === clonk.buildMenu) box.fill({ color: 0xffe070, alpha: 0.3 }).stroke({ color: 0xffe070, width: 2 });
        else box.fill({ color: 0x000000, alpha: 0.3 });
        const pic = new Sprite(frame(this.assets.items[def.graphic.file], p.x, p.y, p.w, p.h));
        const scale = Math.min(48 / p.w, 52 / p.h);
        pic.scale.set(scale);
        pic.position.set(6 + (48 - p.w * scale) / 2, 6 + (52 - p.h * scale) / 2);
        const label = new Text({ text: def.name.replace(' ', '\n'), style: style(12) });
        label.position.set(58, 12);
        cell.addChild(box, pic, label);
        cell.position.set(i * 120, 0);
        this.menuRow.addChild(cell);
      });
    }
    const k = KEYS[this.style];
    this.title.text = 'Construction kit: build here';
    this.hint.text = `${k.choose} choose · ${k.buy} build · ${k.down} close`;
    const height = 146;
    const width = Math.max(360, this.menuRow.width + 24);
    const x = Math.round(screenW / 2 - width / 2);
    this.panel.clear().roundRect(x, 10, width, height, 8).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    this.title.position.set(x + 12, 16);
    this.menuRow.position.set(x + 12, 42);
    this.hint.position.set(x + 12, 10 + height - 24);
  }
}
