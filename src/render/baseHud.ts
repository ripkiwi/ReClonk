import { Container, Sprite, Text, type TextStyleOptions } from 'pixi.js';
import { TICKS_PER_SECOND } from '../core/loop';
import { SPELLS, spellList } from '../game/magic';
import { groupItems, isCrewId, isVehicleId, shopEntry, type ShopId, type World } from '../game/world';
import type { Clonk, ControlStyle } from '../objects/clonk';
import { keyName } from '../input/bindings';
import { LAYOUTS, type KeyLayout } from '../input/keyboard';
import { BUILD_PLANS, CLONK, CLONK_KINDS, ITEMS, MAGIC_UNIT, STRUCTURES } from '../objects/defs';
import { DESCRIPTIONS } from '../objects/descriptions';
import type { Structure } from '../objects/structure';
import { VEHICLES, type Vehicle } from '../objects/vehicle';
import { frame, type GameAssets } from './assets';
import { ClassicMenu, fitInto, menuGraphics, sheetPicture, SYMBOL, tradeSymbol, type MenuGraphics, type MenuItemView, type MenuKey, type MenuView } from './classicMenu';

const style = (size: number, fill = '#ffffff'): TextStyleOptions => ({
  fill,
  fontSize: size,
  fontFamily: 'Endeavour, serif',
  stroke: { color: '#000000', width: 3 },
});

/** Messages stay on screen this long. */
const MESSAGE_TICKS = TICKS_PER_SECOND * 3;

/** Key names for the menus' bottom bar: the first key bound to each command. */
interface MenuKeys {
  throw: string;
  dig: string;
  up: string;
  down: string;
  left: string;
}

function menuKeys(k: KeyLayout): MenuKeys {
  const first = (codes: readonly string[]): string => (codes[0] ? keyName(codes[0]) : '?');
  return { throw: first(k.throw), dig: first(k.dig), up: first(k.up), down: first(k.down), left: first(k.left) };
}

/**
 * The object menus of the leader of one player's crew, in the original's look
 * (see ClassicMenu): inside a building what's kept there and the buy, sell and
 * get menus; the lorry's load; the construction kit's and the sorcerer's menus.
 * Plus short messages (bought, sold, can't afford).
 */
export class BaseHud {
  readonly root = new Container();
  private readonly keys: MenuKeys;
  private readonly gfx: MenuGraphics;
  private readonly menu: ClassicMenu;
  private readonly toast = new Text({ text: '', style: style(16, '#ffe070') });
  private messages: { text: string; tick: number }[] = [];
  /** Which item was selected, and since when, for the description pop-up. */
  private selection = { key: '', since: 0 };

  constructor(
    private readonly world: World,
    private readonly assets: GameAssets,
    private readonly player: number,
    style: ControlStyle = 'jumpAndRun',
    /** The player's shirt colour, for clonks in the shop and the flag in the menu symbols. */
    private readonly color = 0x2a5bd7,
    /** The player's keys, for the key caps; the style's defaults if not given. */
    layout: KeyLayout = LAYOUTS[style],
  ) {
    this.keys = menuKeys(layout);
    this.gfx = menuGraphics(assets.items);
    this.menu = new ClassicMenu(this.gfx);
    this.root.addChild(this.menu.root, this.toast);
  }

  update(screenW: number, screenH: number, clonk: Clonk): void {
    const w = this.world;
    for (const m of w.messages.splice(0)) if (m.player === this.player) this.messages.push(m);
    this.messages = this.messages.filter((m) => w.tick - m.tick < MESSAGE_TICKS).slice(-3);

    const view = clonk.alive ? this.view(clonk) : null;
    this.menu.root.visible = !!view;
    if (view) {
      // How long the same item has been selected.
      const sel = `${view.key.split(':')[0]}:${view.selected}`;
      if (sel !== this.selection.key) this.selection = { key: sel, since: w.tick };
      view.selectedFor = w.tick - this.selection.since;
      // The original's pixels at the world's zoom, so menus keep their size next to the clonks.
      const scale = Math.max(1, Math.round(screenH / 380));
      const size = ClassicMenu.size(view);
      const x = (screenW - size.w * scale) / 2;
      // Open menus sit in the middle (C4Menu::InitLocation); what's kept in a building, at the top.
      const y = view.selected === null ? 12 : (screenH - size.h * scale) / 2;
      this.menu.draw(view, scale, x, y);
    }

    this.toast.text = this.messages.map((m) => m.text).join('\n');
    this.toast.anchor.set(0.5, 1);
    this.toast.position.set(screenW / 2, screenH - 44);
  }

  /** What to show for the clonk right now, or null for nothing. */
  private view(c: Clonk): MenuView | null {
    if (c.contained) return c.menu !== null ? this.buildingMenu(c, c.contained) : this.buildingContents(c, c.contained);
    if (c.spellMenu !== null) return this.spellMenu(c);
    if (c.buildMenu !== null) return this.buildMenu(c);
    const lorry = c.action.procedure === 'push' && c.vehicle?.def.collection ? c.vehicle : null;
    if (lorry) return this.lorryMenu(c, lorry);
    return null;
  }

  private get okCancel(): MenuKey[] {
    return [
      { command: 'throw', key: this.keys.throw, action: 'ok' },
      { command: 'dig', key: this.keys.dig, action: 'cancel' },
    ];
  }

  /** A building's picture (DefCore Picture). */
  private structurePicture(s: Structure): () => Container {
    const g = s.def.graphic;
    return () => sheetPicture(this.assets.items[g.file], g.picture, SYMBOL);
  }

  /** Anything's picture, fitted into a menu item. */
  private picture(id: ShopId, owner = this.player): Container {
    if (isCrewId(id)) {
      // The clonk with its shirt in the player's colour.
      const walk = CLONK_KINDS[id].actions.Walk;
      const sheet = this.assets.clonks[id];
      const icon = new Container();
      const shirt = new Sprite(frame(sheet.overlay, walk.facetX, walk.facetY, CLONK.width, CLONK.height));
      shirt.tint = this.color;
      icon.addChild(new Sprite(frame(sheet.body, walk.facetX, walk.facetY, CLONK.width, CLONK.height)), shirt);
      return fitInto(icon, SYMBOL, CLONK.width, CLONK.height);
    }
    if (isVehicleId(id)) {
      const vd = VEHICLES[id];
      return sheetPicture(this.assets.items[vd.graphic.file], vd.picture, SYMBOL);
    }
    const def = ITEMS[id];
    const g = def.graphic;
    const f = def.picture;
    const icon = new Container();
    icon.addChild(new Sprite(frame(this.assets.items[g.file], f.x, f.y, f.w, f.h)));
    // Owner-coloured things (the flag) show their cloth in the owner's colour.
    if (g.overlay) {
      const cloth = new Sprite(frame(this.assets.items[g.overlay], f.x, f.y, f.w, f.h));
      cloth.tint = owner === this.player ? this.color : 0xffffff;
      icon.addChild(cloth);
    }
    return fitInto(icon, SYMBOL, f.w, f.h);
  }

  /**
   * Inside a building with no menu open: what's kept in it, and the keys of
   * what can be done here.
   */
  private buildingContents(c: Clonk, s: Structure): MenuView {
    const own = this.world.inOwnBase(c);
    const list = groupItems(s.contents);
    const k = this.keys;
    const keys: MenuKey[] = own
      ? [
          { command: 'up', key: k.up, action: 'buy' },
          { command: 'dig', key: k.dig, action: 'sell' },
          { command: 'throw', key: k.throw, action: c.carrying ? 'put' : 'get' },
          { command: 'left', key: k.left, action: 'get' },
          { command: 'down', key: k.down, action: 'exit' },
        ]
      : [
          { command: 'throw', key: k.throw, action: c.carrying ? 'put' : 'get' },
          { command: 'dig', key: k.dig, action: 'get' },
          { command: 'down', key: k.down, action: 'exit' },
        ];
    const name = s.def.name;
    return {
      symbol: this.structurePicture(s),
      caption: own ? `${name} (your base)` : s.contents.length ? name : `${name} is empty.`,
      // A count only for more than one, as under the clonk's own things (DrawIDList).
      items: list.map((e) => ({ picture: () => this.picture(e.id), count: e.count > 1 ? e.count : undefined, caption: ITEMS[e.id].name })),
      selected: null,
      keys,
      color: this.color,
      key: `in:${s.def.id}:${own}:${!!c.carrying}:${list.map((e) => `${e.id}=${e.count}`).join(',')}`,
    };
  }

  /** The buy, sell or get menu of the building the clonk is in. */
  private buildingMenu(c: Clonk, s: Structure): MenuView {
    const list = this.world.menuList(c);
    const kind = c.menuKind;
    const verb = kind === 'buy' ? 'Buy' : kind === 'sell' ? 'Sell' : 'Get';
    const items: MenuItemView[] = list.map((e) => ({
      picture: () => this.picture(e.id),
      count: e.count,
      caption: `${verb} ${shopEntry(e.id).name}`,
      value: e.value,
      description: DESCRIPTIONS[e.id],
    }));
    return {
      symbol: kind === 'get' ? this.structurePicture(s) : () => tradeSymbol(this.gfx, kind, this.color),
      caption: kind === 'buy' ? 'There is nothing to buy.' : `${s.def.name} is empty.`,
      items,
      selected: list.length ? Math.min(c.menu ?? 0, list.length - 1) : null,
      extra: kind === 'get' ? undefined : 'value',
      keys: this.okCancel,
      color: this.color,
      key: `${kind}:${c.menu}:${list.map((e) => `${e.id}=${e.count}`).join(',')}`,
    };
  }

  /** The sorcerer's spell menu: the cost and the magic energy left in the bottom bar. */
  private spellMenu(c: Clonk): MenuView {
    const list = spellList(this.world);
    const mana = Math.floor(c.magicEnergy / MAGIC_UNIT);
    return {
      symbol: () => fitInto(new Sprite(this.gfx.magic), SYMBOL, 25, 35),
      caption: 'Magic',
      items: list.map((id) => {
        const def = SPELLS[id];
        return {
          picture: () => sheetPicture(this.assets.items[def.icon], { x: 0, y: 0, w: def.iconSize, h: def.iconSize }, SYMBOL),
          caption: def.name,
          value: def.value,
          dim: def.value > mana,
          description: def.description,
        };
      }),
      selected: Math.min(c.spellMenu ?? 0, list.length - 1),
      extra: 'magic',
      magic: mana,
      keys: this.okCancel,
      key: `spell:${c.spellMenu}:${mana}:${list.join()}`,
    };
  }

  /** The construction kit's menu: the buildings it can put up here. */
  private buildMenu(c: Clonk): MenuView {
    const kit = ITEMS.conkit;
    return {
      symbol: () => sheetPicture(this.assets.items[kit.graphic.file], kit.picture, SYMBOL),
      caption: 'Construction',
      items: BUILD_PLANS.map((id) => {
        const def = STRUCTURES[id];
        return {
          picture: () => sheetPicture(this.assets.items[def.graphic.file], def.graphic.picture, SYMBOL),
          caption: `Construction: ${def.name}`,
          description: DESCRIPTIONS[id],
        };
      }),
      selected: c.buildMenu,
      keys: this.okCancel,
      key: `build:${c.buildMenu}`,
    };
  }

  /** Pushing a lorry: what's in it; with the Get menu open (throw with empty hands), one can be taken out. */
  private lorryMenu(c: Clonk, v: Vehicle): MenuView {
    const list = groupItems(v.contents);
    const open = c.loadMenu !== null;
    const limit = v.def.collection?.limit ?? 0;
    const k = this.keys;
    const keys: MenuKey[] = open
      ? this.okCancel
      : c.carrying
        ? [{ command: 'throw', key: k.throw, action: 'put' }]
        : list.length
          ? [{ command: 'throw', key: k.throw, action: 'get' }]
          : [];
    return {
      symbol: () => sheetPicture(this.assets.items[v.def.graphic.file], v.def.picture, SYMBOL),
      caption: v.contents.length ? `${v.def.name}: ${v.contents.length}/${limit}` : `${v.def.name} is empty.`,
      items: list.map((e) => ({ picture: () => this.picture(e.id), count: e.count, caption: `Get ${ITEMS[e.id].name}`, description: DESCRIPTIONS[e.id] })),
      selected: open && list.length ? Math.min(c.loadMenu!, list.length - 1) : null,
      keys,
      key: `load:${c.loadMenu}:${!!c.carrying}:${v.contents.length}:${list.map((e) => `${e.id}=${e.count}`).join(',')}`,
    };
  }
}
