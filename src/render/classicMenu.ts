import { Container, Graphics, Sprite, Text, Texture, type TextStyleOptions } from 'pixi.js';
import { MENU_COLUMNS } from '../game/menus';
import { colorByOwner, frame } from './assets';

/*
 * The original's object menu (C4Menu on a C4GUI::Dialog), drawn the same way:
 * a wooden title bar (GUICaption) with the menu's symbol and the selected
 * item's caption, a dark see-through body with a brown 3D frame, five 35 px
 * items to a row with the selected one on red and counts like "3x" in the
 * corner, and a bar along the bottom with the menu keys and the price.
 * Everything is laid out in the original's pixels and scaled up as a whole.
 */

/** C4SymbolSize: one menu item. */
export const SYMBOL = 35;
/** C4MN_FrameWidth. */
const FRAME = 2;
/** C4GUI_MinWoodBarHgt: the title bar. */
const TITLE_H = 23;
/** C4MN_SymbolSize: the bottom bar with keys and value. */
const BAR_H = 16;
/** C4MN_InfoCaption_Delay: ticks on one item before its description shows. */
const TOOLTIP_DELAY = 90;
/** C4GUI_StandardBGColor 0x5f000000 (the original's alpha counts transparency). */
const BG_ALPHA = 1 - 0x5f / 255;
/** C4GUI_BorderAlpha 0xaf. */
const BORDER_ALPHA = 1 - 0xaf / 255;
const BORDER1 = 0x772200;
const BORDER2 = 0x331100;
const BORDER3 = 0xaa4400;
/** The palette's CRed, the selection box. */
const SELECT = 0xd01010;
/** C4GUI_ToolTipBGColor, C4GUI_ToolTipColor. */
const TIP_BG = 0xf1ea78;
const TIP_TEXT = 0x483222;

/** The GUI graphics (CC BY-NC, see public/classic/README.md). */
export interface MenuGraphics {
  caption: Texture;
  control: Texture;
  wealth: Texture;
  magic: Texture;
  flag: Texture;
  arrow: Texture;
  exit: Texture;
  hand: Texture;
}

/** Files of the menu graphics in the content pack; load them with the other pictures. */
export const MENU_GRAPHICS: Record<keyof MenuGraphics, string> = {
  caption: 'gui/GUICaption.png',
  control: 'gui/Control.png',
  wealth: 'gui/Wealth.png',
  magic: 'gui/Magic.png',
  flag: 'gui/MenuFlag.png',
  arrow: 'gui/Arrow.png',
  exit: 'gui/Exit.png',
  hand: 'gui/Hand.png',
};

/** The menu graphics out of the loaded pictures. */
export function menuGraphics(pictures: Record<string, Texture>): MenuGraphics {
  return Object.fromEntries(Object.entries(MENU_GRAPHICS).map(([k, f]) => [k, pictures[f]])) as unknown as MenuGraphics;
}

/** The control symbols in Control.png (fctCommand, by the original's CON_ numbers). */
export const COMMAND = { throw: 3, up: 4, dig: 5, left: 6, down: 7, right: 8 } as const;
export type Command = keyof typeof COMMAND;
export type MenuAction = 'ok' | 'cancel' | 'exit' | 'buy' | 'sell' | 'get' | 'put';

/** One key in the bottom bar: the key cap with its command arrow and name, then what it does. */
export interface MenuKey {
  command: Command;
  /** The key's name, printed on the cap. */
  key: string;
  /** What it does, as a symbol: OK, cancel, leave, buy, sell, get something, put something in. */
  action: MenuAction;
}

export interface MenuItemView {
  /** Draws the item's picture; it is fitted into the 35 px square. */
  picture: () => Container;
  /** "3x" in the corner, unless undefined. */
  count?: number;
  /** The title while it's selected ("Buy Flint"). */
  caption: string;
  /** Price shown in the bottom bar while it's selected. */
  value?: number;
  /** Shown faded (can't afford it). */
  dim?: boolean;
  /** The description that pops up when it stays selected for a while. */
  description?: string;
}

export interface MenuView {
  /** Draws the menu's symbol, shown at the left of the title bar. */
  symbol: () => Container;
  /** The title when nothing is selected, or the menu is empty ("Hut is empty."). */
  caption: string;
  items: MenuItemView[];
  /** The selected item, or null for a menu you only look at. */
  selected: number | null;
  /** The bottom bar's right side: the selected item's price in gold, or its magic cost out of `magic`. */
  extra?: 'value' | 'magic';
  /** Magic energy available, for `extra: 'magic'`. */
  magic?: number;
  keys: MenuKey[];
  /** The player's colour, for the flag in the buy and sell symbols. */
  color?: number;
  /** Ticks the selection has stayed on the same item, for the description pop-up. */
  selectedFor?: number;
  /** A key that changes whenever anything shown changes. */
  key: string;
}

const textStyle = (size: number, fill: number | string = 0xffffff, stroke = true): TextStyleOptions => ({
  fill,
  fontSize: size,
  fontFamily: 'Endeavour, serif',
  ...(stroke ? { stroke: { color: 0x000000, width: 2, join: 'round' as const } } : {}),
});

/** Fit a picture into a square of `size`, centred. */
export function fitInto(pic: Container, size: number, w: number, h: number): Container {
  const k = Math.min(size / w, size / h);
  pic.scale.set(k);
  pic.position.set((size - w * k) / 2, (size - h * k) / 2);
  const box = new Container();
  box.addChild(pic);
  return box;
}

/** A picture cut from a sheet, fitted into a square. */
export function sheetPicture(sheet: Texture, f: { x: number; y: number; w: number; h: number }, size: number, tint?: number): Container {
  const s = new Sprite(frame(sheet, f.x, f.y, f.w, f.h));
  if (tint !== undefined) s.tint = tint;
  return fitInto(s, size, f.w, f.h);
}

/**
 * An object menu in the original's look. Call `draw` every frame; it only
 * rebuilds when the view's key changes.
 */
export class ClassicMenu {
  readonly root = new Container();
  private drawn = '';
  private resolution = 1;
  /** Size in the original's pixels, after the last draw. */
  width = 0;
  height = 0;

  constructor(private readonly gfx: MenuGraphics) {}

  /**
   * Draw the menu at `scale` original pixels per screen pixel, its top-left
   * corner at (x, y) on screen.
   */
  draw(view: MenuView, scale: number, x: number, y: number): void {
    const tip = (view.selectedFor ?? 0) >= TOOLTIP_DELAY;
    const key = `${view.key}|${scale}|${tip}`;
    this.root.position.set(Math.round(x), Math.round(y));
    this.root.scale.set(scale);
    if (key === this.drawn) return;
    this.drawn = key;
    this.resolution = scale * (globalThis.devicePixelRatio || 1);
    this.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.build(view, tip);
  }

  /** The size the view will have, in the original's pixels. */
  static size(view: Pick<MenuView, 'items' | 'extra' | 'keys'>): { w: number; h: number } {
    const lines = Math.max(1, Math.ceil(view.items.length / MENU_COLUMNS));
    const bar = view.extra || view.keys.length ? BAR_H : 0;
    return { w: MENU_COLUMNS * SYMBOL + 2 * FRAME, h: TITLE_H + lines * SYMBOL + bar + FRAME };
  }

  private text(s: string, size: number, fill: number | string = 0xffffff, stroke = true): Text {
    const t = new Text({ text: s, style: textStyle(size, fill, stroke), resolution: this.resolution });
    return t;
  }

  private build(view: MenuView, tip: boolean): void {
    const { w, h } = ClassicMenu.size(view);
    this.width = w;
    this.height = h;
    const bar = view.extra || view.keys.length ? BAR_H : 0;

    // Body: see-through black with the brown 3D frame (Dialog::DrawElement, Element::Draw3DFrame).
    const body = new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: BG_ALPHA });
    const line = (x0: number, y0: number, x1: number, y1: number, color: number): void => {
      body.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1).fill({ color, alpha: BORDER_ALPHA });
    };
    line(0, 0, w - 1, 0, BORDER1);
    line(0, 0, 0, h - 1, BORDER1);
    line(1, 1, w - 2, 1, BORDER2);
    line(1, 1, 1, h - 2, BORDER2);
    line(0, h - 1, w - 1, h - 1, BORDER3);
    line(w - 1, 0, w - 1, h - 1, BORDER3);
    line(1, h - 2, w - 2, h - 2, BORDER1);
    line(w - 2, 1, w - 2, h - 2, BORDER1);
    this.root.addChild(body);

    this.root.addChild(this.titleBar(view, w));

    // Items, five to a row (C4Menu::UpdateElementPositions).
    const items = new Container();
    items.position.set(FRAME, TITLE_H);
    view.items.forEach((it, i) => {
      const cell = new Container();
      cell.position.set((i % MENU_COLUMNS) * SYMBOL, Math.floor(i / MENU_COLUMNS) * SYMBOL);
      if (i === view.selected) cell.addChild(new Graphics().rect(0, 0, SYMBOL, SYMBOL).fill(SELECT));
      const pic = it.picture();
      if (it.dim) pic.alpha = 0.45;
      cell.addChild(pic);
      if (it.count !== undefined) {
        // C4MenuItem::DrawElement: "3x" in the bottom right corner.
        const n = this.text(`${it.count}x`, 9);
        n.anchor.set(1, 1);
        n.position.set(SYMBOL - 1, SYMBOL);
        cell.addChild(n);
      }
      items.addChild(cell);
    });
    this.root.addChild(items);

    if (bar) this.root.addChild(this.bottomBar(view, w, h - bar - FRAME + 1));

    // The selected item's description, after a while (C4Menu::Draw, Screen::DrawToolTip).
    const sel = view.selected !== null ? view.items[view.selected] : undefined;
    if (tip && sel?.description) {
      const t = this.text(sel.description, 9, TIP_TEXT, false);
      t.style.wordWrap = true;
      t.style.wordWrapWidth = Math.max(120, w - 10);
      const tw = Math.ceil(t.width) + 6;
      const th = Math.ceil(t.height) + 4;
      const i = view.selected!;
      const cx = FRAME + (i % MENU_COLUMNS) * SYMBOL + SYMBOL / 2;
      const cy = TITLE_H + Math.floor(i / MENU_COLUMNS) * SYMBOL;
      const tx = Math.max(0, Math.min(w - tw, cx - tw / 2));
      const box = new Container();
      box.addChild(new Graphics().rect(0, 0, tw, th).fill(TIP_BG).rect(0, 0, tw, th).stroke({ color: 0x000000, alpha: 1 - 0x7f / 255, width: 1, alignment: 1 }));
      t.position.set(3, 1);
      box.addChild(t);
      box.position.set(tx, cy + SYMBOL + 5);
      this.root.addChild(box);
    }
  }

  /** The wooden title bar with the menu symbol and caption (WoodenLabel, DynBarFacet). */
  private titleBar(view: MenuView, w: number): Container {
    const bar = new Container();
    const cap = this.gfx.caption;
    const cw = cap.source.width;
    const ch = cap.source.height;
    const edge = 32;
    // Begin, middle tiled up to a third of the end piece, then the end flush right (Element::DrawBar).
    bar.addChild(new Sprite(frame(cap, 0, 0, Math.min(edge, w), ch)));
    const mid = cw - 2 * edge;
    for (let x = edge; x < w - edge / 3; x += mid) {
      const s = new Sprite(frame(cap, edge, 0, Math.min(mid, w - edge / 3 - x), ch));
      s.x = x;
      bar.addChild(s);
    }
    const end = new Sprite(frame(cap, cw - edge, 0, edge, ch));
    end.x = w - edge;
    bar.addChild(end);
    // The symbol in a square at the left.
    const sym = view.symbol();
    const holder = fitInto(sym, TITLE_H - 2, SYMBOL, SYMBOL);
    holder.position.set(1, 1);
    bar.addChild(holder);
    const sel = view.selected !== null ? view.items[view.selected] : undefined;
    const t = this.text(sel?.caption ?? view.caption, 11);
    t.anchor.set(0, 0.5);
    t.position.set(TITLE_H + 3, TITLE_H / 2);
    // Long captions are cut at the bar's end.
    const mask = new Graphics().rect(TITLE_H, 0, w - TITLE_H - 4, TITLE_H).fill(0xffffff);
    t.mask = mask;
    bar.addChild(mask, t);
    return bar;
  }

  /** The bottom bar: menu keys on the left, the price on the right (C4Menu::DrawElement). */
  private bottomBar(view: MenuView, w: number, y: number): Container {
    const bar = new Container();
    bar.y = y;
    const g = new Graphics();
    // The divider frame (C4Menu::DrawFrame).
    g.rect(1, 0, w - 2, 1).fill({ color: BORDER3, alpha: 0.6 });
    bar.addChild(g);
    let x = FRAME;
    for (const k of view.keys) {
      bar.addChild(this.keyCap(k, x));
      x += BAR_H;
      const icon = this.actionIcon(k.action, view.color ?? 0xffffff);
      icon.position.set(x, 0);
      bar.addChild(icon);
      x += BAR_H + 3;
    }
    const sel = view.selected !== null ? view.items[view.selected] : undefined;
    if (view.extra && sel?.value !== undefined) {
      // fctWealth.DrawValue / fctMagic.DrawValue2, right-aligned.
      const label = view.extra === 'magic' ? `${sel.value}/${view.magic ?? 0}` : `${sel.value}`;
      const t = this.text(label, 10, view.extra === 'magic' && sel.value > (view.magic ?? 0) ? 0xff9080 : 0xffffff);
      t.anchor.set(1, 0.5);
      t.position.set(w - FRAME - 1, BAR_H / 2);
      bar.addChild(t);
      const icon = view.extra === 'magic' ? this.gfx.magic : this.gfx.wealth;
      const iw = view.extra === 'magic' ? (BAR_H * 25) / 35 : 2 * BAR_H;
      const s = new Sprite(icon);
      s.width = iw;
      s.height = BAR_H;
      s.position.set(w - FRAME - 2 - t.width - iw, 0);
      bar.addChild(s);
    }
    return bar;
  }

  /** The symbol after a key in the bottom bar. */
  private actionIcon(a: MenuAction, color: number): Container {
    const ctl = this.gfx.control;
    switch (a) {
      case 'ok':
      case 'cancel':
        // fctOKCancel: the tick and the cross in Control.png.
        return sheetPicture(ctl, { x: a === 'ok' ? 128 : 160, y: 100, w: 32, h: 32 }, BAR_H);
      case 'exit':
        return sheetPicture(this.gfx.exit, { x: 0, y: 0, w: 64, h: 64 }, BAR_H);
      case 'buy':
      case 'sell':
        return fitInto(tradeSymbol(this.gfx, a, color), BAR_H, SYMBOL, SYMBOL);
      case 'get':
        return sheetPicture(this.gfx.hand, { x: 0, y: 0, w: 64, h: 64 }, BAR_H);
      case 'put':
        return sheetPicture(this.gfx.hand, { x: 64 * 5, y: 0, w: 64, h: 64 }, BAR_H);
    }
  }

  /** A key cap with the command's arrow and the key's name (DrawCommandKey). */
  private keyCap(k: MenuKey, x: number): Container {
    const cap = new Container();
    cap.x = x;
    const ctl = this.gfx.control;
    const key = new Sprite(frame(ctl, 0, 100, 64, 64));
    key.scale.set(BAR_H / 64);
    const sym = new Sprite(frame(ctl, COMMAND[k.command] * 32, 36, 32, 32));
    sym.scale.set(BAR_H / 32);
    cap.addChild(key, sym);
    const name = this.text(k.key, 7);
    name.anchor.set(0.5, 1);
    name.position.set(BAR_H / 2, BAR_H);
    cap.addChild(name);
    return cap;
  }
}

/**
 * The buy and sell menus' symbol (DrawMenuSymbol): the flag in the player's
 * colour, gold in front of it, and an arrow up for buying or down for selling.
 * 35 px square.
 */
export function tradeSymbol(gfx: MenuGraphics, kind: 'buy' | 'sell', color: number): Container {
  const out = new Container();
  const flag = colorByOwner(gfx.flag);
  const f = new Container();
  const cloth = new Sprite(flag.overlay);
  cloth.tint = color;
  f.addChild(new Sprite(flag.body), cloth);
  f.scale.set((SYMBOL * 0.75) / 64);
  out.addChild(f);
  const gold = new Sprite(gfx.wealth);
  gold.width = SYMBOL;
  gold.height = SYMBOL / 2;
  gold.y = SYMBOL / 2;
  out.addChild(gold);
  const arrow = new Sprite(frame(gfx.arrow, kind === 'buy' ? 0 : 64, 0, 64, 64));
  arrow.scale.set((SYMBOL * 0.7) / 64);
  arrow.position.set(SYMBOL * 0.3, SYMBOL * 0.15);
  out.addChild(arrow);
  return out;
}
