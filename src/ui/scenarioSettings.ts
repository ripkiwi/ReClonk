import { crewCount, ITEM_IDS, LIMITS, SHOP_IDS, type ScenarioDef } from '../game/scenarios';
import { SPELL_IDS, SPELLS, LATER_SPELLS, type SpellId } from '../game/magic';
import { LATER_RULES, RULE_IDS, RULES } from '../game/rules';
import { isCrewId, type ShopId } from '../game/world';
import { MAX_MAP_PLAYER_EXTEND, type SVal } from '../landscape/mapCreator';
import { MATERIALS, Mat, TEXMAP, texIndex, TUNNEL, type ItemId, type TexEntry } from '../landscape/materials';
import { CLONK_KINDS, ITEMS } from '../objects/defs';
import { PLANT_IDS, PLANTS, type PlantId } from '../objects/vegetation';
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
const plantPicture = (id: PlantId): Picture => ({ file: PLANTS[id].file, sheet: PLANTS[id].sheet, ...PLANTS[id].picture });

const PICTURES: Record<ItemId | 'clonk' | 'sorcerer' | 'hut' | 'melee' | 'grass', Picture> = {
  ...(Object.fromEntries((Object.keys(ITEM_SHEETS) as ItemId[]).map((id) => [id, itemPicture(id)])) as Record<ItemId, Picture>),
  clonk: { file: 'clonk/Graphics.png', sheet: [256, 280], x: 192, y: 100, w: 32, h: 40 },
  sorcerer: { file: 'sorcerer/Graphics.png', sheet: [256, 348], x: 192, y: 100, w: 32, h: 40 },
  hut: { file: 'structures/Hut2.png', sheet: [100, 66], x: 0, y: 0, w: 60, h: 50 },
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
  name: string;
  icon(): HTMLElement;
  get(): number;
  set(v: number): void;
  max: number;
  /** Not in the game yet: shown greyed, and can't be switched on. */
  later?: boolean;
}

/** A whole picture file as an ID list icon (rules, spells). */
const wholePicture = (file: string, size: number, px: number): HTMLElement => picture({ file, sheet: [size, size], x: 0, y: 0, w: size, h: size }, px);

/**
 * The original's ID list (C4IdListCtrl): object pictures with their count
 * underneath in a white box, and buttons on the right that raise and lower
 * the count of the selected one. Click a picture to select it; + and - keys
 * and double clicks work too, Shift changes by 10.
 */
function idList(entries: IdEntry[], o: { x: number; y: number; w: number; hgt: number; label: string; title?: string; format?: (n: number) => string; onChange(): void }): HTMLElement[] {
  const fmt = o.format ?? ((n: number) => `${n}x`);
  let selected = 0;
  const tiles = entries.map((e, i) => {
    const count = h('span', { class: 'idl-count' });
    const tile = h('button', {
      class: 'idl-tile',
      title: e.name,
      onclick: () => select(i),
      ondblclick: () => change(1),
      onkeydown: (ev: KeyboardEvent) => {
        const step = ev.shiftKey ? 10 : 1;
        if (ev.key === '+' || ev.key === '=') change(step);
        else if (ev.key === '-') change(-step);
        else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') select(Math.min(entries.length - 1, selected + 1), true);
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') select(Math.max(0, selected - 1), true);
        else return;
        ev.preventDefault();
      },
    }, e.icon(), count);
    return { tile, count };
  });
  const refresh = (): void => {
    entries.forEach((e, i) => {
      const n = e.get();
      tiles[i].count.textContent = fmt(n);
      tiles[i].tile.classList.toggle('zero', n === 0);
      tiles[i].tile.classList.toggle('later', !!e.later);
      tiles[i].tile.classList.toggle('sel', i === selected);
    });
  };
  const select = (i: number, focus = false): void => {
    selected = i;
    if (focus) tiles[i].tile.focus();
    refresh();
  };
  const change = (d: number): void => {
    const e = entries[selected];
    if (e.later) return;
    e.set(Math.max(0, Math.min(e.max, Math.round((e.get() + d) * 10) / 10)));
    refresh();
    o.onChange();
  };
  // Hold a button to keep counting.
  const hold = (d: number): ((ev: PointerEvent) => void) => (ev) => {
    ev.preventDefault();
    const step = ev.shiftKey ? d * 10 : d;
    change(step);
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
  const box = h('div', { class: 'idl', style: at(o.x, o.y, o.w, o.hgt), title: o.title ?? '' }, ...tiles.map((t) => t.tile));
  const buttons = h(
    'div',
    { class: 'idl-btns', style: at(o.x + o.w, o.y, 15, o.hgt) },
    h('button', { title: 'More (Shift: 10 more)', onpointerdown: hold(1) }, '+'),
    h('button', { title: 'Fewer (Shift: 10 fewer)', onpointerdown: hold(-1) }, '−'),
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
const FOR_SALE: [ShopId, string, Picture][] = SHOP_IDS.map((id) => [id, isCrewId(id) ? CLONK_KINDS[id].name : ITEMS[id].name, PICTURES[id]]);
/** Textures a material layer can use: everything but sky and basements. */
const LAYER_TEXTURES = TEXMAP.filter((t) => t.mat !== Mat.Basement && t.name !== 'Sky' && t.name !== 'Water-Liquid');
const GROUNDS = ['Earth', 'Earth-Rough', 'Earth-Smooth2', 'Earth-Ridge', 'Sand', 'Sand-Smooth3'];

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
        name: `${name} for sale in the home base`,
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
        { name: 'Clonks in the crew', icon: () => picture(PICTURES.clonk, 30), get: () => d.crewSize, set: (v) => (d.crewSize = Math.max(1, v)), max: LIMITS.crewSize.max },
        { name: 'Sorcerers in the crew: they cast spells with magic energy from crystals', icon: () => picture(PICTURES.sorcerer, 30), get: () => d.sorcerers, set: (v) => (d.sorcerers = v), max: LIMITS.sorcerers.max },
      ],
      { x: 66, y: 26, w: 110, hgt: 30, label: 'Crew:', onChange: () => {} },
    ),
    // The original's Magic list: the spells sorcerers know. At least one stays on.
    ...idList(
      [
        ...SPELL_IDS.map((id) => ({
          name: `${SPELLS[id].name} (${SPELLS[id].value} magic energy): ${SPELLS[id].description}`,
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
      }],
      { x: 206, y: 26, w: 170, hgt: 30, label: 'Buildings:', onChange: showRules },
    ),
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `Each clonk carries: ${name}`,
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
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `${name}: share of the objects in the earth`,
        icon: () => picture(PICTURES[id], 22),
        get: () => l.inEarth[id] ?? 0,
        set: (v: number) => (l.inEarth[id] = v),
        max: LIMITS.share.max,
      })),
      { x: 205, y: 15, w: 170, hgt: 58, label: 'Objects in earth types:', onChange: changed },
    ),
    ...inEarthLevel,
    ...idList(
      ITEM_NAMES.map(([id, name]) => ({
        name: `${name} lying on the ground, per 1000 pixels of map width`,
        icon: () => picture(PICTURES[id], 22),
        get: () => l.onSurface[id] ?? 0,
        set: (v: number) => (l.onSurface[id] = v),
        max: LIMITS.objects.max,
      })),
      { x: 205, y: 104, w: 170, hgt: 58, label: 'Objects on the surface:', title: 'Per 1000 pixels of map width', format: String, onChange: changed },
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
          name: 'Grass along the earth surface',
          icon: () => picture(PICTURES.grass, 24),
          get: () => (l.grass ? 1 : 0),
          set: (v: number) => (l.grass = v > 0),
          max: 1,
        },
      ],
      { x: 5, y: 122, w: 170, hgt: 30, label: 'Vegetation types:', title: 'Trees and bushes by share, and grass on or off', onChange: changed },
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
  ws('Volcanoes:', 205, 46, 'rgb(220,60,30)', w.volcano, ['none', 'plenty'], () => 'need lava, which comes later', 'Volcanoes need lava, which comes later');
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
