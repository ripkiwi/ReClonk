import { crewCount, ITEM_IDS, LIMITS, SHOP_IDS, type ScenarioDef } from '../game/scenarios';
import { SPELL_IDS, SPELLS, LATER_SPELLS, type SpellId } from '../game/magic';
import { LATER_RULES, RULE_IDS, RULES } from '../game/rules';
import { shopEntry, type ShopId } from '../game/world';
import { MAX_MAP_PLAYER_EXTEND, type SVal } from '../landscape/mapCreator';
import { MATERIALS, Mat, TEXMAP, texIndex, TUNNEL, type ItemId, type TexEntry } from '../landscape/materials';
import { ITEMS, STRUCTURES } from '../objects/defs';
import { PLANT_IDS, PLANTS, type PlantId } from '../objects/vegetation';
import { VEHICLES, type VehicleId } from '../objects/vehicle';
import { CONTENT_BASE } from '../render/assets';
import { bigButton, h } from './dom';
import { mapPreview } from './preview';

export interface SettingsOptions {
  /** The scenario whose settings are edited. It isn't changed until `onSave`. */
  scenario: ScenarioDef;
  /** An original scenario: saving makes a copy. */
  original: boolean;
  /** Title of the original a copy was made from, for the note at the top. */
  basedOnTitle?: string;
  onSave(edited: ScenarioDef): void;
  onCancel(): void;
}

/*
 * The original's Scenario Properties dialog (Clonk Rage editor: C4ScenarioDlg,
 * C4PageLandscape, C4LandscapeCtrl, C4IdListCtrl, Slider), rebuilt on our
 * paper. Controls sit where the original's dialog templates put them: the
 * templates measure in dialog units, turned into pixels here.
 */
const DX = 1.585;
const DY = 1.76;
const px = (n: number, d: number): string => `${Math.round(n * d)}px`;
function at(x: number, y: number, w?: number, hgt?: number): Partial<CSSStyleDeclaration> {
  return { left: px(x, DX), top: px(y, DY), ...(w !== undefined ? { width: px(w, DX) } : {}), ...(hgt !== undefined ? { height: px(hgt, DY) } : {}) };
}

/** An object's picture in its graphics file (the DefCore's Picture), for the ID lists. */
interface Picture {
  file: string;
  /** Size of the whole file. */
  sheet: [number, number];
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Item pictures come from their definitions; the file sizes are needed to scale the sheet. */
const ITEM_SHEETS: Record<ItemId, [number, number]> = {
  flint: [64, 70],
  tflint: [64, 140],
  superflint: [64, 70],
  supertflint: [64, 140],
  teraflint: [64, 70],
  rock: [64, 70],
  gold: [64, 70],
  wood: [64, 71],
  conkit: [88, 60],
  meteor: [128, 128],
  crystal: [64, 74],
  flag: [208, 128],
};
const itemPicture = (id: ItemId): Picture => ({ file: ITEMS[id].graphic.file, sheet: ITEM_SHEETS[id], ...ITEMS[id].picture });
const vehiclePicture = (id: VehicleId): Picture => ({
  file: VEHICLES[id].graphic.file,
  sheet: VEHICLES[id].graphic.sheet,
  ...VEHICLES[id].picture,
});
const plantPicture = (id: PlantId): Picture => ({ file: PLANTS[id].file, sheet: PLANTS[id].sheet, ...PLANTS[id].picture });

const PICTURES: Record<ItemId | VehicleId | 'clonk' | 'sorcerer' | 'hut' | 'elevator' | 'tower' | 'melee' | 'grass', Picture> = {
  ...(Object.fromEntries((Object.keys(ITEM_SHEETS) as ItemId[]).map((id) => [id, itemPicture(id)])) as Record<ItemId, Picture>),
  ...(Object.fromEntries((Object.keys(VEHICLES) as VehicleId[]).map((id) => [id, vehiclePicture(id)])) as Record<VehicleId, Picture>),
  clonk: { file: 'clonk/Graphics.png', sheet: [256, 280], x: 192, y: 100, w: 32, h: 40 },
  sorcerer: { file: 'sorcerer/Graphics.png', sheet: [256, 348], x: 192, y: 100, w: 32, h: 40 },
  hut: { file: 'structures/Hut2.png', sheet: [100, 66], x: 0, y: 0, w: 60, h: 50 },
  elevator: { file: 'structures/Elevator.png', sheet: [84, 56], x: 0, y: 0, w: 28, h: 56 },
  tower: { file: 'structures/Tower2.png', sheet: [192, 79], x: 144, y: 0, w: 48, h: 64 },
  melee: { file: 'goals/Melee.png', sheet: [64, 64], x: 0, y: 0, w: 64, h: 64 },
  grass: { file: 'vegetation/Grass.png', sheet: [120, 30], x: 40, y: 0, w: 40, h: 30 },
  // The flag's front-end picture (PictureFE): its cloth is already coloured in.
  flag: { ...itemPicture('flag'), y: 64 },
};

function picture(p: Picture, size: number): HTMLElement {
  const s = Math.min(size / p.w, size / p.h);
  return h('span', {
    class: 'idl-pic',
    style: {
      width: `${p.w * s}px`,
      height: `${p.h * s}px`,
      backgroundImage: `url("${CONTENT_BASE}${p.file}")`,
      backgroundSize: `${p.sheet[0] * s}px ${p.sheet[1] * s}px`,
      backgroundPosition: `${-p.x * s}px ${-p.y * s}px`,
    },
  });
}

/** A square of a material texture in the material's colours, like the landscape draws it. */
function swatch(t: TexEntry, size: number): HTMLCanvasElement {
  const canvas = h('canvas', { class: 'idl-pic', width: size, height: size });
  const colors = t.mat === Mat.Sky ? TUNNEL.colors : MATERIALS[t.mat].colors;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = css(colors[1]);
  ctx.fillRect(0, 0, size, size);
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, size * 2, size * 2, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size);
    const d = data.data;
    // Stretch the pattern over the material's dark-to-light colours, like the landscape does.
    let lo = 765;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      lo = Math.min(lo, d[i] + d[i + 1] + d[i + 2]);
      hi = Math.max(hi, d[i] + d[i + 1] + d[i + 2]);
    }
    for (let i = 0; i < d.length; i += 4) {
      const b = (d[i] + d[i + 1] + d[i + 2] - lo) / Math.max(1, hi - lo);
      const [a, c, k] = b < 0.5 ? [colors[0], colors[1], b * 2] : [colors[1], colors[2], b * 2 - 1];
      for (let ch = 0; ch < 3; ch++) {
        const s = 16 - ch * 8;
        d[i + ch] = ((a >> s) & 255) + (((c >> s) & 255) - ((a >> s) & 255)) * k;
      }
      d[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  };
  img.src = `${CONTENT_BASE}materials/${t.texture}.png`;
  return canvas;
}

/** One entry of an ID list: an object (or material) with a count. */
interface IdEntry {
  /** "Name: what it does". The part before the colon is the name in the menus. */
  name: string;
  icon(): HTMLElement;
  get(): number;
  set(v: number): void;
  max: number;
  /** Not in the game yet: shown greyed in the Add menu, and can't be added. */
  later?: boolean;
}

/** A whole picture file as an ID list icon (rules, spells). */
const wholePicture = (file: string, size: number, px: number): HTMLElement => picture({ file, sheet: [size, size], x: 0, y: 0, w: size, h: size }, px);

/** "Name: what it does" split in two. */
function nameAndText(e: IdEntry): [string, string] {
  const i = e.name.indexOf(': ');
  return i < 0 ? [e.name, ''] : [e.name.slice(0, i), e.name.slice(i + 2)];
}

/** The Add menu's view, kept between openings like the original kept it in its config. */
let selectView: 'symbols' | 'details' = 'symbols';

/** The dialog paper a popup goes on, and how much it is scaled on screen. */
function paperOf(el: HTMLElement): { paper: HTMLElement; scale: number } | null {
  const paper = el.closest<HTMLElement>('.paper');
  if (!paper) return null;
  return { paper, scale: paper.getBoundingClientRect().width / (paper.offsetWidth || 1) };
}

/**
 * The original's object selection dialog (C4IdSelectDlg), opened by the Add
 * button of an ID list: every object of the list's kind, as symbols or in
 * details. Click objects to pick them (click again to drop), OK adds one of
 * each; a double click adds that one at once.
 */
function selectDialog(anchor: HTMLElement, category: string, entries: IdEntry[], onAdd: (picked: number[]) => void, onClose: () => void): void {
  const host = paperOf(anchor);
  if (!host) return;
  const picked = new Set<number>();
  const shade = h('div', { class: 'ids-shade' });
  const list = h('div', { class: 'ids-list', tabIndex: 0 });
  const close = (): void => {
    shade.remove();
    removeEventListener('keydown', keys, true);
    onClose();
  };
  const ok = (): void => {
    const chosen = [...picked];
    close();
    if (chosen.length) onAdd(chosen);
  };
  const keys = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
    else if (ev.key === 'Enter') ok();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  const fill = (): void => {
    list.className = `ids-list ${selectView}`;
    list.replaceChildren(
      ...(selectView === 'details'
        ? [h('div', { class: 'ids-row ids-head' }, h('span', {}, 'Name'), h('span', {}, 'Description'))]
        : []),
      ...entries.map((e, i) => {
        const [name, text] = nameAndText(e);
        const n = e.get();
        const row = h(
          'div',
          {
            class: `ids-row${e.later ? ' later' : ''}${picked.has(i) ? ' sel' : ''}`,
            title: e.later ? e.name : `${e.name}${n ? ` (in the list: ${n})` : ''}`,
            onclick: () => {
              if (e.later) return;
              if (picked.has(i)) picked.delete(i);
              else picked.add(i);
              fill();
            },
            ondblclick: () => {
              if (e.later) return;
              picked.clear();
              picked.add(i);
              ok();
            },
          },
          h('span', { class: 'ids-name' }, e.icon(), h('span', {}, name)),
          ...(selectView === 'details' ? [h('span', { class: 'ids-text' }, text)] : []),
        );
        return row;
      }),
    );
  };
  const radio = (v: typeof selectView, label: string): HTMLLabelElement => {
    const input = h('input', { type: 'radio', name: 'ids-view', checked: selectView === v, onchange: () => { selectView = v; fill(); } });
    return h('label', { class: 'pp-check' }, input, label);
  };
  const dialog = h(
    'div',
    { class: 'ids', role: 'dialog' },
    h('div', { class: 'ids-title' }, `Object selection: ${category}`),
    list,
    h(
      'div',
      { class: 'ids-side' },
      h('button', { class: 'pp-button', onclick: ok }, 'OK'),
      h('button', { class: 'pp-button', onclick: close }, 'Cancel'),
      h('div', { class: 'ids-view' }, h('div', {}, 'View:'), radio('symbols', 'Symbols'), radio('details', 'Details')),
    ),
  );
  shade.append(dialog);
  shade.addEventListener('pointerdown', (ev) => ev.target === shade && close());
  addEventListener('keydown', keys, true);
  fill();
  host.paper.append(shade);
  list.focus();
}

/** The original's right-click menu on an ID list: + and − the selected object, Add... and Delete. */
function contextMenu(ev: MouseEvent, items: { label: string; disabled?: boolean; run(): void }[]): void {
  const host = paperOf(ev.currentTarget as HTMLElement);
  if (!host) return;
  ev.preventDefault();
  const r = host.paper.getBoundingClientRect();
  const menu = h('div', {
    class: 'idl-menu',
    style: { left: `${(ev.clientX - r.left) / host.scale}px`, top: `${(ev.clientY - r.top) / host.scale}px` },
  });
  const close = (): void => {
    menu.remove();
    removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  for (const it of items) {
    if (it.label === '-') menu.append(h('hr'));
    else menu.append(h('button', { disabled: !!it.disabled, onclick: () => { close(); it.run(); } }, it.label));
  }
  addEventListener('pointerdown', outside, true);
  host.paper.append(menu);
}

/**
 * The original's ID list (C4IdListCtrl with C4IdCtrlButtons): only the objects
 * in the list, as pictures with their count underneath, and three buttons on
 * the right. + and − raise and lower the count of the selected one (at 0 it
 * leaves the list), the third opens the object selection (Add...) to put more
 * objects in. + with nothing selected opens it too. Right click for the menu;
 * keys: + and −, Insert adds, Delete removes, Shift changes by 10.
 */
function idList(entries: IdEntry[], o: { x: number; y: number; w: number; hgt: number; label: string; category?: string; title?: string; format?: (n: number) => string; onChange(): void }): HTMLElement[] {
  const fmt = o.format ?? ((n: number) => `${n}x`);
  const category = o.category ?? o.label.replace(/:$/, '');
  let selected = -1;
  let open = false;
  const box = h('div', {
    class: 'idl',
    tabIndex: 0,
    style: at(o.x, o.y, o.w, o.hgt),
    title: o.title ?? '',
    onkeydown: (ev: KeyboardEvent) => {
      const step = ev.shiftKey ? 10 : 1;
      const vis = shown();
      const pos = vis.indexOf(selected);
      if (ev.key === '+' || ev.key === '=') plus(step);
      else if (ev.key === '-') change(-step);
      else if (ev.key === 'Insert') add();
      else if (ev.key === 'Delete' || ev.key === 'Backspace') remove();
      else if ((ev.key === 'ArrowRight' || ev.key === 'ArrowDown') && vis.length) select(vis[Math.min(vis.length - 1, pos + 1)]);
      else if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') && vis.length) select(vis[Math.max(0, pos - 1)]);
      else return;
      ev.preventDefault();
    },
    oncontextmenu: (ev: MouseEvent) => {
      box.focus();
      const name = selected >= 0 ? nameAndText(entries[selected])[0] : '';
      contextMenu(ev, [
        { label: `+ ${name}`, disabled: selected < 0, run: () => change(1) },
        { label: `− ${name}`, disabled: selected < 0, run: () => change(-1) },
        { label: '-', run: () => {} },
        { label: 'Add...', run: add },
        { label: 'Delete', disabled: selected < 0, run: remove },
      ]);
    },
  });
  /** The entries in the list: the ones with a count. */
  const shown = (): number[] => entries.flatMap((e, i) => (!e.later && e.get() > 0 ? [i] : []));
  const refresh = (): void => {
    const vis = shown();
    if (!vis.includes(selected)) selected = -1;
    box.replaceChildren(
      ...vis.map((i) => {
        const e = entries[i];
        return h(
          'div',
          {
            class: `idl-tile${i === selected ? ' sel' : ''}`,
            title: e.name,
            onpointerdown: (ev: PointerEvent) => ev.button !== 1 && select(i),
            ondblclick: () => change(1),
          },
          e.icon(),
          h('span', { class: 'idl-count' }, fmt(e.get())),
        );
      }),
      ...(vis.length ? [] : [h('div', { class: 'idl-empty' }, 'Empty: + adds')]),
    );
  };
  // Selecting only moves the highlight, so a double click lands on the same tile.
  const select = (i: number): void => {
    selected = i;
    const vis = shown();
    [...box.querySelectorAll('.idl-tile')].forEach((t, k) => t.classList.toggle('sel', vis[k] === i));
  };
  const change = (d: number): void => {
    const e = entries[selected];
    if (!e) return;
    e.set(Math.max(0, Math.min(e.max, Math.round((e.get() + d) * 10) / 10)));
    refresh();
    o.onChange();
  };
  const remove = (): void => {
    const e = entries[selected];
    if (!e) return;
    e.set(0);
    refresh();
    o.onChange();
  };
  const add = (): void => {
    if (open) return;
    open = true;
    selectDialog(box, category, entries, (picked) => {
      for (const i of picked) {
        const e = entries[i];
        e.set(Math.min(e.max, e.get() + 1));
      }
      selected = picked.filter((i) => entries[i].get() > 0).pop() ?? selected;
      refresh();
      o.onChange();
    }, () => {
      open = false;
      box.focus();
    });
  };
  /** + raises the selected count; with nothing selected it opens the object selection. */
  const plus = (step: number): boolean => {
    if (selected < 0) {
      add();
      return false;
    }
    change(step);
    return true;
  };
  // Hold + or − to keep counting.
  const hold = (d: number): ((ev: PointerEvent) => void) => (ev) => {
    ev.preventDefault();
    box.focus();
    const step = ev.shiftKey ? d * 10 : d;
    if (d > 0 ? !plus(step) : (change(step), selected < 0)) return;
    let timer = window.setTimeout(function again() {
      change(step);
      timer = window.setTimeout(again, 70);
    }, 400);
    const stop = (): void => {
      clearTimeout(timer);
      removeEventListener('pointerup', stop);
      removeEventListener('pointercancel', stop);
    };
    addEventListener('pointerup', stop);
    addEventListener('pointercancel', stop);
  };
  refresh();
  const buttons = h(
    'div',
    { class: 'idl-btns', style: at(o.x + o.w, o.y, 15, o.hgt) },
    h('button', { title: 'More of the selected object (Shift: 10 more). With nothing selected: add objects.', onpointerdown: hold(1) }, '+'),
    h('button', { title: 'Fewer of the selected object (Shift: 10 fewer). At none it leaves the list.', onpointerdown: hold(-1) }, '−'),
    h('button', { class: 'idl-add', title: `Add... (${category})`, onclick: () => add() }, h('span', { class: 'idl-box' })),
  );
  return [h('div', { class: 'pp-label', style: at(o.x, o.y - 10, o.w + 15) }, o.label), box, buttons];
}

/**
 * The original's slider (Slider.cpp): a coloured thumb in a white groove.
 * Dragging sets the value. Right-dragging (or Shift-dragging) away from the
 * thumb sets the random range, drawn as a bar around it: every round then picks
 * a value from that range. Arrow keys: left and right move the value, up and
 * down widen and narrow the random range.
 */
function slider(o: {
  x: number;
  y: number;
  w: number;
  color: string;
  label: string;
  value: SVal;
  random: boolean;
  show(v: SVal): string;
  onChange(): void;
}): HTMLElement[] {
  const v = o.value;
  const W = Math.round(o.w * DX);
  const HALF = 5;
  const RND_MAX = 100;
  const groove = h('div', { class: 'os', tabIndex: 0, style: { ...at(o.x, o.y), width: `${W}px` } });
  groove.style.setProperty('--c', o.color);
  const bar = h('div', { class: 'os-rnd' });
  const thumb = h('div', { class: 'os-thumb' });
  groove.append(bar, thumb);
  const out = h('span', { class: 'pp-value' });
  const valPos = (): number => HALF + ((v.std - v.min) * (W - 2 * HALF)) / Math.max(1, v.max - v.min);
  const draw = (): void => {
    const p = valPos();
    const r = (v.rnd * W) / RND_MAX;
    thumb.style.left = `${p - HALF}px`;
    bar.style.left = `${Math.max(p - HALF - r, 3)}px`;
    bar.style.width = `${Math.max(0, Math.min(p + HALF + r, W - 3) - Math.max(p - HALF - r, 3))}px`;
    bar.style.display = v.rnd > 0 ? '' : 'none';
    out.textContent = o.show(v);
    groove.title = `${o.label.replace(/:$/, '')}: ${o.show(v)}${o.random ? '\nDrag to set. Right-drag or Shift-drag sets a random range: each round picks a value in it.' : ''}`;
  };
  const setFrom = (clientX: number, randomDrag: boolean): void => {
    const rect = groove.getBoundingClientRect();
    const scale = rect.width / W || 1;
    const x = (clientX - rect.left) / scale;
    if (randomDrag) {
      const p = valPos();
      const d = x > p + HALF ? x - (p + HALF) : x < p - HALF ? p - HALF - x : 0;
      v.rnd = Math.round((Math.max(0, Math.min(W, d)) * RND_MAX) / W);
    } else {
      const t = (Math.max(HALF, Math.min(W - HALF, x)) - HALF) / (W - 2 * HALF);
      v.std = Math.round(v.min + t * (v.max - v.min));
    }
    draw();
    o.onChange();
  };
  groove.addEventListener('contextmenu', (e) => e.preventDefault());
  groove.addEventListener('pointerdown', (e) => {
    const randomDrag = o.random && (e.button === 2 || e.shiftKey);
    if (e.button !== 0 && !randomDrag) return;
    e.preventDefault();
    groove.focus();
    groove.setPointerCapture(e.pointerId);
    setFrom(e.clientX, randomDrag);
    const move = (ev: PointerEvent): void => setFrom(ev.clientX, randomDrag);
    const up = (): void => {
      groove.removeEventListener('pointermove', move);
      groove.removeEventListener('pointerup', up);
    };
    groove.addEventListener('pointermove', move);
    groove.addEventListener('pointerup', up);
  });
  groove.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') v.std = Math.min(v.max, v.std + 1);
    else if (e.key === 'ArrowLeft') v.std = Math.max(v.min, v.std - 1);
    else if (e.key === 'ArrowUp' && o.random) v.rnd = Math.min(RND_MAX, v.rnd + 1);
    else if (e.key === 'ArrowDown' && o.random) v.rnd = Math.max(0, v.rnd - 1);
    else return;
    e.preventDefault();
    draw();
    o.onChange();
  });
  draw();
  return [h('div', { class: 'pp-label', style: at(o.x, o.y - 10, o.w) }, o.label, out), groove];
}

function checkbox(label: string, x: number, y: number, w: number, get: () => boolean, set: (v: boolean) => void, title = ''): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked: get(), onchange: () => set(input.checked) });
  return h('label', { class: 'pp-check', style: at(x, y, w), title }, input, label);
}

/** A number field with a spin button, like the original's edit-and-spin controls. */
function spin(x: number, y: number, w: number, lim: { min: number; max: number; step: number }, get: () => number, set: (v: number) => void, title = ''): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    class: 'pp-number',
    min: lim.min,
    max: lim.max,
    step: lim.step,
    value: String(get()),
    title,
    style: at(x, y, w),
    onchange: () => {
      const v = Math.max(lim.min, Math.min(lim.max, Math.round(Number(input.value) || 0)));
      set(v);
      input.value = String(v);
    },
  });
  return input;
}

const ITEM_NAMES: [ItemId, string][] = ITEM_IDS.map((id) => [id, ITEMS[id].name]);
const FOR_SALE: [ShopId, string, Picture][] = SHOP_IDS.map((id) => [id, shopEntry(id).name, PICTURES[id]]);
/** Textures a material layer can use: everything but sky and basements. */
const LAYER_TEXTURES = TEXMAP.filter((t) => t.mat !== Mat.Basement && t.name !== 'Sky' && !(t.name.endsWith('-Liquid') && TEXMAP.some((u) => u.name === t.name.replace('-Liquid', '-Smooth'))));
const GROUNDS = ['Earth', 'Earth-Rough', 'Earth-Smooth2', 'Earth-Ridge', 'Sand', 'Sand-Smooth3', 'Ashes-Rough'];
/** What fills the lakes below the water level (the original's Liquid in Scenario.txt). */
const LIQUIDS: [string, string][] = [
  ['Water-Smooth', 'Water'],
  ['Oil-Smooth', 'Oil'],
  ['Acid-Smooth', 'Acid'],
  ['Lava-Smooth', 'Lava'],
  ['DuroLava-Smooth', 'Lava that never hardens'],
];

/** The tabs of the dialog, in the original's order. */
type Tab = 'game' | 'equipment' | 'landscape' | 'environment' | 'weather';
let lastTab: Tab = 'landscape';

/**
 * The settings of a scenario, laid out like the original's Scenario
 * Properties: Game, Equipment, Landscape, Environment and Weather tabs, the landscape
 * with its coloured sliders and a live map preview.
 */
export function scenarioSettings(o: SettingsOptions): HTMLElement[] {
  const s = o.scenario;
  const d: ScenarioDef = structuredClone(s);
  const l = d.landscape;

  // ---- Map preview (Landscape tab), redrawn shortly after every change.
  const view = { screen: true, layers: true, players: Math.min(crewCount(d), MAX_MAP_PLAYER_EXTEND) };
  const mapBox = h('div', { class: 'pp-map', style: at(135, 15, 180, 185) });
  const drawMap = (): void => {
    const players = l.mapPlayerExtend ? view.players : 1;
    mapBox.replaceChildren(mapPreview(l, d.seed, { layers: view.layers, screen: view.screen, players }, mapBox.clientWidth || 280, mapBox.clientHeight || 320));
  };
  let timer = 0;
  const changed = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(drawMap, 60);
  };

  // ---- Game
  const description = h('textarea', { class: 'pp-desc', maxLength: 400, style: at(6, 133, 186, 62), oninput: () => (d.description = description.value) });
  description.value = d.description;
  const goalNote = h('div', { class: 'pp-hint', style: at(6, 53, 186, 20) });
  const showGoal = (): void => {
    goalNote.textContent = d.goal === 'melee' && d.opponents === 0 ? 'Melee needs computer crews to fight.' : d.goal === 'melee' ? 'The last crew standing wins.' : '';
  };
  showGoal();
  const ruleNote = h('div', { class: 'pp-hint', style: at(199, 124, 186, 76) });
  function showRules(): void {
    const on = RULE_IDS.filter((id) => d.rules.includes(id));
    const needsBase = on.some((id) => id === 'captureTheFlag' || id === 'lossOfBase') && !d.homeBase;
    ruleNote.replaceChildren(
      ...(on.length ? on.map((id) => h('div', {}, h('b', {}, `${RULES[id].name}: `), RULES[id].description)) : ['No rules. Point at one to read what it does.']),
      ...(needsBase ? [h('div', { style: { color: '#a02010' } }, 'Without a home base (Equipment, Buildings) everyone is out at once.')] : []),
    );
  }
  showRules();
  const gamePage = h(
    'div',
    { class: 'pp-page' },
    ...idList(
      [{ name: 'Melee: the last crew standing wins', icon: () => picture(PICTURES.melee, 28), get: () => (d.goal === 'melee' ? 1 : 0), set: (v) => (d.goal = v ? 'melee' : 'none'), max: 1 }],
      { x: 6, y: 19, w: 171, hgt: 30, label: 'Goals:', format: (n) => (n ? 'on' : 'off'), onChange: showGoal },
    ),
    goalNote,
    h('div', { class: 'pp-label', style: at(6, 123, 186) }, 'Description:'),
    description,
    // The original's Rules list. The rules we can't play yet are greyed, with what they wait for.
    ...idList(
      [
        ...RULE_IDS.map((id) => ({
          name: `${RULES[id].name}: ${RULES[id].description}`,
          icon: () => wholePicture(RULES[id].icon, 64, 28),
          get: () => (d.rules.includes(id) ? 1 : 0),
          set: (v: number) => (d.rules = RULE_IDS.filter((r) => (r === id ? v > 0 : d.rules.includes(r)))),
          max: 1,
        })),
        ...LATER_RULES.map((r) => ({
          name: `${r.name}: comes later, it needs ${r.needs}`,
          icon: () => wholePicture(r.icon, 64, 28),
          get: () => 0,
          set: () => {},
          max: 0,
          later: true,
        })),
      ],
      { x: 199, y: 19, w: 171, hgt: 102, label: 'Rules:', format: (n) => (n ? 'on' : 'off'), onChange: showRules },
    ),
    ruleNote,
    h('div', { class: 'pp-label', style: at(6, 86, 120) }, 'Computer crews:'),
    spin(6, 96, 30, LIMITS.opponents, () => d.opponents, (v) => {
      d.opponents = v;
      view.players = Math.min(crewCount(d), MAX_MAP_PLAYER_EXTEND);
      showGoal();
      syncPlayers();
      changed();
    }, 'Computer crews to play against, each as big as yours'),
    h('div', { class: 'pp-hint', style: at(44, 97, 140) }, 'each as big as yours'),
  );

  // ---- Equipment
  // Gold and the shop only matter with a home base.
  const baseOnly: HTMLElement[] = [
    h('div', { class: 'pp-label', style: at(6, 16, 45) }, 'Wealth:'),
    spin(6, 26, 35, LIMITS.wealth, () => d.base.wealth, (v) => (d.base.wealth = v), 'Gold in the home base at the start'),
    ...idList(
      FOR_SALE.map(([id, name, pic]) => ({
        name: `${name}: for sale in the home base`,
        icon: () => picture(pic, id === 'clonk' ? 26 : 22),
        get: () => d.base.stock[id] ?? 0,
        set: (v: number) => (d.base.stock[id] = v),
        max: LIMITS.stock.max,
      })),
      { x: 206, y: 118, w: 170, hgt: 58, label: 'Home base material:', onChange: () => {} },
    ),
  ];
  const knows = (id: SpellId): boolean => !d.magic.length || d.magic.includes(id);
  const showBase = (): void => baseOnly.forEach((e) => e.classList.toggle('off', !d.homeBase));
  showBase();
  const equipPage = h(
    'div',
    { class: 'pp-page' },
    h('div', { class: 'pp-hint', style: at(6, 5, 380) }, 'Values for every crew, the computer crews too.'),
    ...idList(
      [
        { name: 'Clonk: an ordinary clonk of the crew', icon: () => picture(PICTURES.clonk, 30), get: () => d.crewSize, set: (v) => (d.crewSize = Math.max(1, v)), max: LIMITS.crewSize.max },
        { name: 'Sorcerer: a clonk of the crew who can cast spells with magic energy from crystals', icon: () => picture(PICTURES.sorcerer, 30), get: () => d.sorcerers, set: (v) => (d.sorcerers = v), max: LIMITS.sorcerers.max },
      ],
      { x: 66, y: 26, w: 110, hgt: 30, label: 'Crew:', onChange: () => {} },
    ),
    // The original's Magic list: the spells sorcerers know. At least one stays on.
    ...idList(
      [
        ...SPELL_IDS.map((id) => ({
          name: `${SPELLS[id].name}: ${SPELLS[id].value} magic energy. ${SPELLS[id].description}`,
          icon: () => wholePicture(SPELLS[id].icon, SPELLS[id].iconSize, 28),
          get: () => (knows(id) ? 1 : 0),
          set: (v: number) => {
            const next = SPELL_IDS.filter((sp) => (sp === id ? v > 0 : knows(sp)));
            if (next.length) d.magic = next.length === SPELL_IDS.length ? [] : next;
          },
          max: 1,
        })),
        ...LATER_SPELLS.map((name) => ({ name: `${name}: comes later`, icon: () => h('span', { class: 'idl-pic', style: { width: '28px', height: '28px', lineHeight: '28px', textAlign: 'center' } }, '?'), get: () => 0, set: () => {}, max: 0, later: true })),
      ],
      { x: 6, y: 72, w: 370, hgt: 30, label: 'Magic:', title: 'The spells sorcerers can cast', format: (n) => (n ? 'on' : 'off'), onChange: () => {} },
    ),
    ...idList(
      [{
        name: 'Wooden hut with your flag: your home base. An ordinary hut stands nearby.',
        icon: () => picture(PICTURES.hut, 30),
        get: () => (d.homeBase ? 1 : 0),
        set: (v) => {
          d.homeBase = v > 0;
          showBase();
        },
        max: 1,
      },
      // Built in the round, but a scenario can't start with them yet: greyed in the Add menu.
      ...(['elevator', 'tower'] as const).map((id) => ({
        name: `${STRUCTURES[id].name}: comes later, a crew can build one but can't start with one yet`,
        icon: () => picture(PICTURES[id], 30),
        get: () => 0,
        set: () => {},
        max: 0,
        later: true,
      }))],
      { x: 206, y: 26, w: 170, hgt: 30, label: 'Buildings:', onChange: showRules },
    ),
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `${name}: each clonk carries one at the start`,
        icon: () => picture(PICTURES[id], 22),
        get: () => (d.startItems.includes(id) ? 1 : 0),
        set: (v: number) => (d.startItems = v ? [id] : []),
        max: 1,
      })),
      { x: 6, y: 118, w: 170, hgt: 58, label: 'Material:', title: 'What each clonk carries at the start (one object)', onChange: () => {} },
    ),
    ...baseOnly,
  );

  // ---- Landscape
  const zoomEdit = h('input', { class: 'pp-number pp-zoom', readOnly: true, tabIndex: -1, style: at(105, 50, 20) });
  const size = (n: number): string => `${n * l.mapZoom.std} px`;
  const plain = (v: SVal): string => (v.rnd ? `${v.std} ±${v.rnd}` : String(v.std));
  const sliders: HTMLElement[] = [];
  const sl = (label: string, y: number, w: number, color: string, value: SVal, random: boolean, show: (v: SVal) => string): void => {
    sliders.push(...slider({ x: 5, y, w, color, label, value, random, show, onChange: () => {
      zoomEdit.value = String(l.mapZoom.std);
      changed();
    } }));
  };
  // The original's colours: red for size, green for the hills, blue for the water.
  sl('Width:', 15, 120, 'rgb(255,0,0)', l.mapWidth, false, (v) => size(v.std) + (l.mapPlayerExtend ? ' each' : ''));
  sl('Height:', 35, 120, 'rgb(215,0,0)', l.mapHeight, false, (v) => size(v.std));
  sl('Zoom factor:', 55, 95, 'rgb(195,0,0)', l.mapZoom, false, () => '');
  sl('Amplitude:', 75, 120, 'rgb(0,215,0)', l.amplitude, true, plain);
  sl('Phase:', 95, 120, 'rgb(0,195,0)', l.phase, true, plain);
  sl('Period:', 115, 120, 'rgb(0,175,0)', l.period, true, plain);
  sl('Random:', 135, 120, 'rgb(0,155,0)', l.random, true, plain);
  sl('Water level:', 155, 120, 'rgb(0,0,255)', l.liquidLevel, true, plain);
  zoomEdit.value = String(l.mapZoom.std);

  const radios = [1, 2, 3, 4].map((n) => {
    const input = h('input', { type: 'radio', name: 'preview-for', checked: view.players === n, onchange: () => {
      view.players = n;
      changed();
    } });
    return { n, input, label: h('label', { class: 'pp-check', style: at(325, 45 + n * 10, 60) }, input, n === 1 ? '1 player' : `${n} players`) };
  });
  const previewFor = h('div', { class: 'pp-label', style: at(325, 45, 70) }, 'Preview for');
  const syncPlayers = (): void => {
    for (const r of radios) {
      r.input.checked = r.n === view.players;
      r.label.classList.toggle('off', !l.mapPlayerExtend);
    }
    previewFor.classList.toggle('off', !l.mapPlayerExtend);
  };
  syncPlayers();

  const seed = spin(325, 115, 46, LIMITS.seed, () => d.seed, (v) => {
    d.seed = v;
    changed();
  }, 'Every number gives a different map from the same settings');
  const reroll = h('button', {
    class: 'pp-button',
    style: at(357, 114.5, 34, 12),
    title: 'Another map from the same settings',
    onclick: () => {
      d.seed = Math.floor(Math.random() * LIMITS.seed.max);
      seed.value = String(d.seed);
      changed();
    },
  }, 'New');

  const landscapePage = h(
    'div',
    { class: 'pp-page' },
    ...sliders,
    zoomEdit,
    checkbox('Top open', 5, 170, 120, () => l.topOpen, (v) => {
      l.topOpen = v;
      changed();
    }, 'Open sky above the map; otherwise there is a ceiling'),
    checkbox('Bottom open', 5, 179, 120, () => l.bottomOpen, (v) => {
      l.bottomOpen = v;
      changed();
    }, 'Whatever falls out of the bottom of the map is gone'),
    checkbox('Width according to player number', 5, 189, 128, () => l.mapPlayerExtend, (v) => {
      l.mapPlayerExtend = v;
      syncPlayers();
      changed();
    }, 'The map gets wider for every crew taking part (up to 4)'),
    h('div', { class: 'pp-label', style: at(135, 5, 182) }, 'Dynamic map:'),
    mapBox,
    h('div', { class: 'pp-label', style: at(325, 5, 70) }, 'Display'),
    checkbox('Screen size', 325, 15, 70, () => view.screen, (v) => {
      view.screen = v;
      changed();
    }),
    checkbox('Layers', 325, 25, 70, () => view.layers, (v) => {
      view.layers = v;
      changed();
    }),
    previewFor,
    ...radios.map((r) => r.label),
    h('div', { class: 'pp-label', style: at(325, 105, 70) }, 'Map number'),
    seed,
    reroll,
    checkbox('New map every round', 325, 132, 70, () => d.newMapEachRound, (v) => (d.newMapEachRound = v), 'Like the original: a new map each round. Otherwise always the map shown here.'),
  );

  // ---- Environment
  // Layers may name just the material ("Rock" is Rock-Rough), like in the original's Scenario.txt.
  const sameTex = (a: string, b: string): boolean => texIndex(a, 'Rough') === texIndex(b, 'Rough');
  const layerCount = (name: string): number => l.layers.find((x) => sameTex(x.name, name))?.count ?? 0;
  const setLayer = (name: string, v: number): void => {
    const i = l.layers.findIndex((x) => sameTex(x.name, name));
    if (i >= 0 && v === 0) l.layers.splice(i, 1);
    else if (i >= 0) l.layers[i].count = v;
    else if (v > 0 && l.layers.length < LIMITS.maxLayers) l.layers.push({ name, count: v });
  };
  const ground = h(
    'select',
    { class: 'pp-select', style: at(205, 186, 80), onchange: () => {
      l.material = ground.value;
      changed();
    } },
    ...GROUNDS.map((g) => h('option', { value: g }, g.replace('-', ' '))),
  );
  ground.value = GROUNDS.includes(l.material) ? l.material : 'Earth';
  const liquid = h(
    'select',
    { class: 'pp-select', style: at(295, 186, 90), title: 'What fills the lakes below the water level (Landscape page)', onchange: () => {
      l.liquid = liquid.value;
      changed();
    } },
    ...LIQUIDS.map(([v, name]) => h('option', { value: v }, name)),
  );
  // Names like "Water" or "Water-Liquid" pick the matching entry.
  liquid.value = LIQUIDS.find(([v]) => v.split('-')[0].toLowerCase() === l.liquid.split('-')[0].toLowerCase())?.[0] ?? 'Water-Smooth';
  const inEarthLevel = slider({ x: 205, y: 84, w: 170, color: 'rgb(130,90,40)', label: 'Objects in earth amount:', value: l.inEarthLevel, random: true, show: plain, onChange: changed });
  const vegetationLevel = slider({ x: 5, y: 166, w: 170, color: 'rgb(40,140,40)', label: 'Vegetation amount:', value: l.vegetationLevel, random: true, show: plain, onChange: changed });
  const environmentPage = h(
    'div',
    { class: 'pp-page' },
    ...idList(
      LAYER_TEXTURES.map((t) => ({
        name: t.name.startsWith('Tunnel') ? `${t.name} (caves)` : t.name,
        icon: () => swatch(t, 20),
        get: () => layerCount(t.name),
        set: (v: number) => setLayer(t.name, v),
        max: LIMITS.layer.max,
      })),
      { x: 5, y: 15, w: 170, hgt: 92, label: 'Material layers:', title: 'Veins of other materials drawn into the ground: how many per 15000 map pixels', format: String, onChange: changed },
    ),
    h('div', { class: 'pp-label', style: at(205, 176, 80) }, 'Ground:'),
    ground,
    h('div', { class: 'pp-label', style: at(295, 176, 90) }, 'Liquid:'),
    liquid,
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `${name}: share of the objects in the earth`,
        icon: () => picture(PICTURES[id], 22),
        get: () => l.inEarth[id] ?? 0,
        set: (v: number) => (l.inEarth[id] = v),
        max: LIMITS.share.max,
      })),
      { x: 205, y: 15, w: 170, hgt: 58, label: 'Objects in earth types:', category: 'In earth', onChange: changed },
    ),
    ...inEarthLevel,
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `${name}: lying on the ground, per 1000 pixels of map width`,
        icon: () => picture(PICTURES[id], 22),
        get: () => l.onSurface[id] ?? 0,
        set: (v: number) => (l.onSurface[id] = v),
        max: LIMITS.objects.max,
      })),
      { x: 205, y: 104, w: 170, hgt: 58, label: 'Objects on the surface:', category: 'On the surface', title: 'Per 1000 pixels of map width', format: String, onChange: changed },
    ),
    ...idList(
      [
        ...PLANT_IDS.map((id) => ({
          name: `${PLANTS[id].name}: share of the trees and bushes`,
          icon: () => picture(plantPicture(id), 24),
          get: () => l.vegetation[id] ?? 0,
          set: (v: number) => (l.vegetation[id] = v),
          max: LIMITS.share.max,
        })),
        {
          name: 'Grass: along the earth surface',
          icon: () => picture(PICTURES.grass, 24),
          get: () => (l.grass ? 1 : 0),
          set: (v: number) => (l.grass = v > 0),
          max: 1,
        },
      ],
      { x: 5, y: 122, w: 170, hgt: 30, label: 'Vegetation types:', category: 'Vegetation', title: 'Trees and bushes by share, and grass on or off', onChange: changed },
    ),
    ...vegetationLevel,
  );

  // ---- Weather: the original's sliders and colours (C4PageWeather), with its words at both ends.
  const w = d.weather;
  const weatherItems: HTMLElement[] = [];
  const ws = (label: string, x: number, y: number, color: string, value: SVal, ends: [string, string], show: (v: SVal) => string, off = ''): void => {
    const els = [
      ...slider({ x, y, w: 126, color, label, value, random: true, show, onChange: () => {} }),
      h('div', { class: 'pp-end', style: at(x, y + 6, 60) }, ends[0]),
      h('div', { class: 'pp-end right', style: at(x + 66, y + 6, 60) }, ends[1]),
    ];
    if (off) {
      for (const e of els) {
        e.classList.add('off');
        e.title = off;
      }
    }
    weatherItems.push(...els);
  };
  const pm = (v: SVal, unit = ''): string => (v.rnd ? `${v.std}${unit} ±${v.rnd}` : `${v.std}${unit}`);
  const seasonName = (n: number): string => ['winter', 'spring', 'summer', 'autumn', 'winter'][Math.min(4, Math.trunc((n + 12) / 25))];
  const yearLength = (n: number): string => {
    if (n <= 0) return 'stands still';
    const minutes = (100 * Math.ceil(200 / n) * 35) / 36 / 60;
    return minutes >= 10 ? `a year in ${Math.round(minutes)} min` : `a year in ${minutes.toFixed(1)} min`;
  };
  ws('Climate:', 18, 17, 'rgb(200,160,80)', w.climate, ['hot', 'cold'], (v) => `around ${50 - v.std}°${v.rnd ? ` ±${v.rnd}` : ''}`);
  ws('Season:', 18, 46, 'rgb(160,120,40)', w.startSeason, ['spring', 'winter'], (v) => (v.rnd >= 50 ? 'any' : v.rnd ? `${seasonName(v.std)} ±${v.rnd}` : seasonName(v.std)));
  ws('Time advance:', 18, 76, 'rgb(120,80,0)', w.yearSpeed, ['slow', 'fast'], (v) => yearLength(v.std) + (v.rnd ? ` (±${v.rnd})` : ''));
  ws('Rain:', 18, 113, 'rgb(40,40,130)', w.rain, ['none', 'plenty'], (v) => pm(v));
  ws('Thunderstorms:', 18, 142, 'rgb(90,90,200)', w.lightning, ['none', 'plenty'], (v) => pm(v));
  ws('Wind:', 18, 171, 'rgb(140,140,250)', w.wind, ['left', 'right'], (v) => pm(v));
  ws('Earthquakes:', 205, 17, 'rgb(255,80,50)', w.earthquake, ['none', 'plenty'], (v) => pm(v));
  ws('Volcanoes:', 205, 46, 'rgb(220,60,30)', w.volcano, ['none', 'plenty'], (v) => pm(v));
  ws('Meteorites:', 205, 76, 'rgb(200,30,0)', w.meteorite, ['none', 'plenty'], (v) => pm(v));
  ws('Gravity:', 205, 113, 'rgb(80,80,80)', l.gravity, ['weak', 'strong'], (v) => pm(v, '%'));
  const weatherPage = h(
    'div',
    { class: 'pp-page' },
    ...weatherItems,
    h('div', { class: 'pp-hint', style: at(18, 190, 160, 10) }, 'Rain falls from one cloud per 500 pixels of map width.'),
    checkbox('Season colours', 205, 142, 160, () => w.seasonColors, (v) => (w.seasonColors = v), 'Tint the world with the season: green in spring, brown in autumn, blue when it freezes'),
    checkbox('Sky moves with the wind', 205, 152, 160, () => w.skyWind, (v) => (w.skyWind = v), 'The clouds in the sky drift along with the wind'),
  );

  // ---- Tabs
  const pages: Record<Tab, HTMLElement | null> = {
    game: gamePage,
    equipment: equipPage,
    landscape: landscapePage,
    environment: environmentPage,
    weather: weatherPage,
  };
  const names: Record<Tab, string> = { game: 'Game', equipment: 'Equipment', landscape: 'Landscape', environment: 'Environment', weather: 'Weather' };
  const pageBox = h('div', { class: 'pp-pages' });
  const tabButtons = (Object.keys(names) as Tab[]).map((t) =>
    h('button', {
      class: 'pp-tab',
      disabled: !pages[t],
      onclick: () => show(t),
    }, names[t]),
  );
  const show = (t: Tab): void => {
    lastTab = t;
    (Object.keys(names) as Tab[]).forEach((k, i) => tabButtons[i].classList.toggle('on', k === t));
    pageBox.replaceChildren(pages[t] ?? h('div'));
    if (t === 'landscape') drawMap();
  };

  const title = h('input', {
    class: 'set-title',
    value: d.title,
    maxLength: 40,
    spellcheck: false,
    oninput: () => (d.title = title.value),
  });
  const note = o.original
    ? `${s.title} comes with the game, so your changes are saved as a new scenario.`
    : o.basedOnTitle
      ? `Your own scenario, based on ${o.basedOnTitle}. Changes are saved to it.`
      : 'Your own scenario. Changes are saved to it.';

  const paper = h(
    'div',
    { class: 'paper settings' },
    h('div', { class: 'paper-body' }, title, h('div', { class: 'sub' }, note), h('div', { class: 'pp-tabs' }, ...tabButtons), pageBox),
  );
  show(lastTab);
  // The map box has its size once it's on the page.
  requestAnimationFrame(() => lastTab === 'landscape' && drawMap());
  return [
    paper,
    bigButton('Cancel', 150, 540, () => o.onCancel()),
    bigButton(o.original ? 'Save as copy' : 'Save', 426, 540, () => o.onSave(d)),
  ];
}
