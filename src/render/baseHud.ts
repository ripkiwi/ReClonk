import { Container, Graphics, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import { TICKS_PER_SECOND } from '../core/loop';
import { SPELLS, spellList } from '../game/magic';
import { isCrewId, isVehicleId, shopEntry, type World } from '../game/world';
import type { Clonk, ControlStyle } from '../objects/clonk';
import { buildingKeys } from '../input/bindings';
import { LAYOUTS, type KeyLayout } from '../input/keyboard';
import { BUILD_PLANS, CLONK, CLONK_KINDS, ENERGY_UNIT, ITEMS, MAGIC_UNIT, STRUCTURES } from '../objects/defs';
import { VEHICLES } from '../objects/vehicle';
import { frame, type GameAssets } from './assets';

const style = (size: number, fill = '#ffffff'): TextStyleOptions => ({
  fill,
  fontSize: size,
  fontFamily: 'monospace',
  stroke: { color: '#000000', width: 3 },
});

/** Messages stay on screen this long. */
const MESSAGE_TICKS = TICKS_PER_SECOND * 3;

/** Where the clonk's own panel (name, energy, wealth) ends on the left of the screen. */
const HUD_PANEL = 316;

/**
 * HUD for one player's crew: energy bar, gold, and while inside a building
 * what you can do there (leave, buy, sell), plus short messages.
 */
export class BaseHud {
  readonly root = new Container();
  private readonly keys: ReturnType<typeof buildingKeys>;
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
    style: ControlStyle = 'jumpAndRun',
    /** Draw the energy bar and gold here. Off when another HUD shows them. */
    private readonly showStatus = true,
    /** The player's shirt colour, for clonks in the shop. */
    private readonly color = 0x2a5bd7,
    /** The player's keys, for the hints; the style's defaults if not given. */
    layout: KeyLayout = LAYOUTS[style],
  ) {
    this.keys = buildingKeys(layout);
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
    const casting = !s && clonk.spellMenu !== null;
    const show = !!s || planning || casting;
    this.panel.visible = this.title.visible = this.hint.visible = this.menuRow.visible = show;
    if (casting) return this.updateSpellMenu(screenW, clonk);
    this.title.style.wordWrap = false;
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
        if (isCrewId(id)) {
          // The clonk sprite plus its shirt overlay in the player's colour.
          const walk = CLONK_KINDS[id].actions.Walk;
          const sheet = this.assets.clonks[id];
          icon = new Container();
          const shirt = new Sprite(frame(sheet.overlay, walk.facetX, walk.facetY, CLONK.width, CLONK.height));
          shirt.tint = this.color;
          icon.addChild(new Sprite(frame(sheet.body, walk.facetX, walk.facetY, CLONK.width, CLONK.height)), shirt);
          icon.scale.set(2);
          icon.position.set(2, 10);
        } else if (isVehicleId(id)) {
          // The vehicle's picture, fitted into the icon's corner.
          const vd = VEHICLES[id];
          const p = vd.picture;
          icon = new Sprite(frame(this.assets.items[vd.graphic.file], p.x, p.y, p.w, p.h));
          icon.scale.set(32 / Math.max(p.w, p.h));
          icon.position.set(2, 14);
        } else {
          const g = ITEMS[id].graphic;
          icon = new Container();
          // Owner-coloured things (the flag) show their picture with the cloth in the player's colour.
          const f = g.overlay ? ITEMS[id].picture : g.facet;
          icon.addChild(new Sprite(frame(this.assets.items[g.file], f.x, f.y, f.w, f.h)));
          if (g.overlay) {
            const cloth = new Sprite(frame(this.assets.items[g.overlay], f.x, f.y, f.w, f.h));
            cloth.tint = this.color;
            icon.addChild(cloth);
          }
          const k = Math.min(4, 28 / Math.max(f.w, f.h));
          icon.scale.set(k);
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
    const k = this.keys;
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
    // A long shop list moves over rather than cover the clonk's panel.
    const x = width > screenW - 2 * HUD_PANEL ? Math.max(Math.min(HUD_PANEL, screenW - width - 8), 8) : Math.round(screenW / 2 - width / 2);
    this.panel.clear().roundRect(x, 10, width, height, 8).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    this.title.position.set(x + 12, 16);
    this.menuRow.position.set(x + 12, 42);
    this.hint.position.set(x + 12, 10 + height - 24);
  }

  /** The sorcerer's spell menu: every spell with what it costs; the ones it can't afford are dimmed. */
  private updateSpellMenu(screenW: number, clonk: Clonk): void {
    const list = spellList(this.world);
    const mana = Math.floor(clonk.magicEnergy / MAGIC_UNIT);
    const key = `spell:${clonk.spellMenu}:${mana}:${list.join()}`;
    // Stays clear of the clonk's panel in the top left corner.
    const per = Math.max(3, Math.min(list.length, Math.floor((screenW - HUD_PANEL - 40) / 84)));
    if (key !== this.menuKey) {
      this.menuKey = key;
      this.menuRow.removeChildren().forEach((c) => c.destroy({ children: true }));
      list.forEach((id, i) => {
        const def = SPELLS[id];
        const cell = new Container();
        const box = new Graphics().roundRect(0, 0, 78, 74, 6);
        if (i === clonk.spellMenu) box.fill({ color: 0x70a0ff, alpha: 0.35 }).stroke({ color: 0xa0c0ff, width: 2 });
        else box.fill({ color: 0x000000, alpha: 0.3 });
        const pic = new Sprite(frame(this.assets.items[def.icon], 0, 0, def.iconSize, def.iconSize));
        pic.scale.set(36 / def.iconSize);
        pic.position.set(21, 4);
        const label = new Text({ text: `${def.name}\n${def.value}`, style: { ...style(11, def.value > mana ? '#ff9080' : '#ffffff'), align: 'center', wordWrap: true, wordWrapWidth: 76 } });
        label.anchor.set(0.5, 0);
        label.position.set(39, 41);
        cell.alpha = def.value > mana ? 0.6 : 1;
        cell.addChild(box, pic, label);
        cell.position.set((i % per) * 84, Math.floor(i / per) * 80);
        this.menuRow.addChild(cell);
      });
    }
    const k = this.keys;
    const sel = SPELLS[list[Math.min(clonk.spellMenu ?? 0, list.length - 1)]];
    this.title.text = `Magic (${mana} magic energy): ${sel.description}`;
    this.title.style.wordWrap = true;
    this.title.style.wordWrapWidth = Math.max(336, per * 84 - 6);
    this.hint.text = `${k.choose} choose · ${k.buy} cast · ${k.down} close`;
    const rows = Math.ceil(list.length / per);
    const titleH = this.title.height;
    const width = Math.max(360, per * 84 + 18);
    const height = titleH + rows * 80 + 44;
    const x = Math.max(HUD_PANEL, Math.round(screenW / 2 - width / 2));
    this.panel.clear().roundRect(x, 10, width, height, 8).fill({ color: 0x000000, alpha: 0.55 }).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
    this.title.position.set(x + 12, 16);
    this.menuRow.position.set(x + 12, 22 + titleH);
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
    const k = this.keys;
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
