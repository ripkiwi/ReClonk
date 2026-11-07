import type { ItemId } from '../landscape/materials';
import type { MapOptions } from '../landscape/generate';
import { LIMITS, mapOptions, type ScenarioDef } from '../game/scenarios';
import type { ShopId } from '../game/world';
import { bigButton, h } from './dom';
import { scenarioPreview } from './preview';

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

type Lim = { min: number; max: number; step: number };

const ITEMS: [ItemId, string][] = [
  ['flint', 'Flints'],
  ['rock', 'Rocks'],
  ['gold', 'Gold'],
];
const FOR_SALE: [ShopId, string][] = [
  ['flint', 'Flints'],
  ['rock', 'Rocks'],
  ['clonk', 'Clonks'],
];

/**
 * The settings of a scenario, like the original's scenario properties:
 * the map, what lies in the ground, the crew and the home base, with a map
 * preview that follows every change.
 */
export function scenarioSettings(o: SettingsOptions): HTMLElement[] {
  const s = o.scenario;
  // Work on a copy with every map setting spelled out.
  const d: ScenarioDef = structuredClone({ ...s, map: mapOptions(s) });
  const map = d.map as MapOptions;

  const preview = h('div', { class: 'preview' }, scenarioPreview(d, 206, 136));
  let timer = 0;
  const changed = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => preview.replaceChildren(scenarioPreview(d, 206, 136)), 150);
  };

  /** A slider with its value shown next to it. */
  const slider = (label: string, lim: Lim, get: () => number, set: (v: number) => void, show: (v: number) => string): HTMLElement => {
    const out = h('span', { class: 'set-value' }, show(get()));
    const input = h('input', {
      type: 'range',
      min: lim.min,
      max: lim.max,
      step: lim.step,
      value: String(get()),
      oninput: () => {
        set(Number(input.value));
        out.textContent = show(get());
        changed();
      },
    });
    return h('label', { class: 'set-row' }, h('span', { class: 'set-label' }, label), input, out);
  };

  /** A small number field, kept within its limits. Object densities may have one decimal. */
  const number = (lim: Lim, get: () => number, set: (v: number) => void, title = '', decimals = false): HTMLInputElement => {
    const show = (v: number): string => String(decimals ? Math.round(v * 10) / 10 : v);
    const input = h('input', {
      type: 'number',
      class: 'set-number',
      min: lim.min,
      max: lim.max,
      step: decimals ? 'any' : lim.step,
      value: show(get()),
      title,
      onchange: () => {
        const n = Number(input.value) || 0;
        const v = Math.max(lim.min, Math.min(lim.max, decimals ? Math.round(n * 10) / 10 : Math.round(n)));
        set(v);
        input.value = show(v);
        changed();
      },
    });
    return input;
  };

  const checkbox = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
    const input = h('input', {
      type: 'checkbox',
      checked: get(),
      onchange: () => {
        set(input.checked);
        changed();
      },
    });
    return h('label', { class: 'set-row' }, h('span', { class: 'set-label' }, label), input);
  };

  const title = h('input', {
    class: 'set-title',
    value: d.title,
    maxLength: 40,
    spellcheck: false,
    oninput: () => (d.title = title.value),
  });
  const description = h('textarea', {
    class: 'set-desc',
    rows: 2,
    maxLength: 400,
    oninput: () => (d.description = description.value),
  });
  description.value = d.description;

  const seed = number(LIMITS.seed, () => d.seed, (v) => (d.seed = v), 'Every number gives a different map');
  const reroll = h(
    'button',
    {
      class: 'ink-button',
      title: 'A new random map with the same settings',
      onclick: () => {
        d.seed = Math.floor(Math.random() * LIMITS.seed.max);
        seed.value = String(d.seed);
        changed();
      },
    },
    'New map',
  );

  const per = 'How many per 1000 pixels of map width';
  const objects = h('table', { class: 'set-table' }, h('tr', {}, h('th', {}), h('th', {}, 'In the earth'), h('th', {}, 'On the surface')));
  for (const [id, name] of ITEMS) {
    objects.append(
      h(
        'tr',
        {},
        h('td', {}, name),
        h('td', {}, number(LIMITS.objects, () => map.buried[id] ?? 0, (v) => (map.buried[id] = v), per, true)),
        h('td', {}, number(LIMITS.objects, () => map.onSurface[id] ?? 0, (v) => (map.onSurface[id] = v), per, true)),
      ),
    );
  }

  const carry = h(
    'select',
    {
      class: 'set-select',
      onchange: () => {
        d.startItems = carry.value ? [carry.value as ItemId] : [];
      },
    },
    h('option', { value: '' }, 'nothing'),
    ...ITEMS.map(([id, name]) => h('option', { value: id }, name.replace(/s$/, '').toLowerCase())),
  );
  carry.value = d.startItems[0] ?? '';

  const stock = h(
    'table',
    { class: 'set-table' },
    h('tr', {}, h('th', {}), ...FOR_SALE.map(([, name]) => h('th', {}, name))),
    h(
      'tr',
      {},
      h('td', {}, 'For sale'),
      ...FOR_SALE.map(([id, name]) => h('td', {}, number(LIMITS.stock, () => d.base.stock[id] ?? 0, (v) => (d.base.stock[id] = v), `${name} the shop has in stock`))),
    ),
  );
  const baseRows = h(
    'div',
    {},
    h('label', { class: 'set-row' }, h('span', { class: 'set-label' }, 'Gold'), number(LIMITS.wealth, () => d.base.wealth, (v) => (d.base.wealth = v), 'Starting gold')),
    stock,
  );
  const showBase = (): void => void baseRows.classList.toggle('off', !d.homeBase);
  showBase();

  // The last crew standing wins (the original's Melee goal). It only matters with someone to fight.
  const goalBox = h('input', {
    type: 'checkbox',
    checked: d.goal === 'melee',
    onchange: () => (d.goal = goalBox.checked ? 'melee' : 'none'),
  });
  const goalRow = h(
    'label',
    { class: 'set-row', title: 'Computer crews to play against. The round ends when only one crew has clonks left.' },
    h('span', { class: 'set-label' }),
    goalBox,
    'Last crew standing wins',
  );
  const showGoal = (): void => void goalRow.classList.toggle('off', d.opponents === 0);
  showGoal();

  const note = o.original
    ? `${s.title} comes with the game, so your changes are saved as a new scenario.`
    : o.basedOnTitle
      ? `Your own scenario, based on ${o.basedOnTitle}. Changes are saved to it.`
      : 'Your own scenario. Changes are saved to it.';

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const times = (v: number): string => `×${v.toFixed(1)}`;
  const paper = h(
    'div',
    { class: 'paper settings', style: { left: '86px', top: '16px' } },
    h(
      'div',
      { class: 'paper-body' },
      title,
      h('div', { class: 'sub' }, note),
      h(
        'div',
        { class: 'set-columns' },
        h(
          'div',
          {},
          h('h3', {}, 'Map'),
          slider('Width', LIMITS.width, () => d.width, (v) => (d.width = v), String),
          slider('Height', LIMITS.height, () => d.height, (v) => (d.height = v), String),
          h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, 'Seed'), seed, reroll),
          slider('Hills', LIMITS.hilliness, () => map.hilliness, (v) => (map.hilliness = v), pct),
          slider('Rock veins', LIMITS.veins, () => map.rockVeins, (v) => (map.rockVeins = v), times),
          slider('Gold veins', LIMITS.veins, () => map.goldVeins, (v) => (map.goldVeins = v), times),
          checkbox('Lake', () => map.lake, (v) => (map.lake = v)),
          h('h3', {}, 'Objects ', h('small', { class: 'hint', title: per }, 'per 1000 px of width')),
          objects,
          h('h3', {}, 'Description'),
          description,
        ),
        h(
          'div',
          {},
          preview,
          h('h3', {}, 'Crew'),
          slider('Clonks', LIMITS.crewSize, () => d.crewSize, (v) => (d.crewSize = v), String),
          h('label', { class: 'set-row' }, h('span', { class: 'set-label' }, 'Each carries'), carry),
          slider('Opponents', LIMITS.opponents, () => d.opponents, (v) => {
            d.opponents = v;
            showGoal();
          }, (v) => (v ? String(v) : 'none')),
          goalRow,
          h('h3', { class: 'set-check' }, 'Home base ', checkbox('', () => d.homeBase, (v) => {
            d.homeBase = v;
            showBase();
          })),
          baseRows,
        ),
      ),
    ),
  );
  return [
    paper,
    bigButton('Cancel', 150, 540, () => o.onCancel()),
    bigButton(o.original ? 'Save as copy' : 'Save', 426, 540, () => o.onSave(d)),
  ];
}
