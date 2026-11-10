import { cleanMusicSettings, defaultMusicSettings, type MusicSettings } from '../audio/music';
import type { ControlStyle } from '../objects/clonk';
import type { KeyValueStore } from '../game/profiles';
import { LAYOUTS, type KeyLayout } from './keyboard';

/** One thing a key can do. */
export type Action = keyof KeyLayout;

/** The actions in the order the settings screen lists them. */
export const ACTIONS: readonly Action[] = ['left', 'right', 'up', 'down', 'dig', 'throw', 'magic', 'crewPrev', 'crewNext', 'crewAll'];

/** What each action does, per control style, for the settings screen. */
export const ACTION_LABELS: Record<ControlStyle, Record<Action, string>> = {
  jumpAndRun: {
    left: 'Walk left (hold)',
    right: 'Walk right (hold)',
    up: 'Jump, climb up, go in a door',
    down: 'Climb down, leave a building',
    dig: 'Dig (twice: use what you carry, or chop a tree)',
    throw: 'Throw',
    magic: 'Magic: a sorcerer\'s spell menu',
    crewPrev: 'Previous clonk',
    crewNext: 'Next clonk (Shift: previous)',
    crewAll: 'Whole crew',
  },
  classic: {
    left: 'Start walking left',
    right: 'Start walking right',
    up: 'Jump, go in a door',
    down: 'Stop (twice: gather the crew)',
    dig: 'Dig (twice: use what you carry, or chop a tree)',
    throw: 'Throw',
    magic: 'Magic: a sorcerer\'s spell menu',
    crewPrev: 'Previous clonk',
    crewNext: 'Next clonk (Shift: previous)',
    crewAll: 'Whole crew',
  },
};

/** At most this many keys per action. */
export const MAX_KEYS_PER_ACTION = 3;

/**
 * Keys that can't be bound: Escape and P pause the game, 1 to 9 pick a crew
 * member, and Ctrl, Alt and the system key belong to the browser.
 */
const RESERVED = new Set([
  'Escape',
  'KeyP',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'ContextMenu',
]);

export function isReserved(code: string): boolean {
  return RESERVED.has(code) || !code;
}

/** Settings that belong to this browser rather than to a player. */
export interface Settings {
  /** Changed key layouts. A style that's missing uses its default keys. */
  keys: Partial<Record<ControlStyle, KeyLayout>>;
  /** Show the strip of key hints at the bottom during a round. Off by default. */
  showKeyHelp: boolean;
  /** Menu and in-game music. */
  music: MusicSettings;
}

const STORAGE_KEY = 'reclonk.settings.v1';

export function defaultSettings(): Settings {
  return { keys: {}, showKeyHelp: false, music: defaultMusicSettings() };
}

export function loadSettings(storage: KeyValueStore): Settings {
  const settings = defaultSettings();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return settings;
    const data = JSON.parse(raw) as Partial<Settings>;
    settings.showKeyHelp = data.showKeyHelp === true;
    settings.music = cleanMusicSettings(data.music);
    for (const style of Object.keys(LAYOUTS) as ControlStyle[]) {
      const saved = data.keys?.[style];
      if (saved && typeof saved === 'object') settings.keys[style] = cleanLayout(saved, style);
    }
  } catch {
    // Corrupt settings: fall back to the defaults.
  }
  return settings;
}

export function saveSettings(storage: KeyValueStore, settings: Settings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** A copy of a stored layout with only valid keys, and defaults for actions it doesn't know. */
function cleanLayout(saved: Partial<Record<Action, unknown>>, style: ControlStyle): KeyLayout {
  const layout = copyLayout(LAYOUTS[style]);
  const used = new Set<string>();
  // The player's own keys first, then the defaults of actions the save doesn't know (ones added since).
  const known = ACTIONS.filter((a) => Array.isArray(saved[a]));
  for (const action of [...known, ...ACTIONS.filter((a) => !known.includes(a))]) {
    const codesSaved = saved[action];
    const codes: unknown[] = Array.isArray(codesSaved) ? codesSaved : layout[action];
    layout[action] = [];
    for (const c of codes) {
      if (typeof c !== 'string' || isReserved(c) || used.has(c) || layout[action].length >= MAX_KEYS_PER_ACTION) continue;
      layout[action].push(c);
      used.add(c);
    }
  }
  return layout;
}

function copyLayout(layout: KeyLayout): KeyLayout {
  return Object.fromEntries(ACTIONS.map((a) => [a, [...layout[a]]])) as unknown as KeyLayout;
}

/** The keys a control style plays with: the player's own, or the defaults. */
export function layoutFor(settings: Settings, style: ControlStyle): KeyLayout {
  return settings.keys[style] ?? LAYOUTS[style];
}

/** True if a style still has its default keys. */
export function isDefaultLayout(settings: Settings, style: ControlStyle): boolean {
  const layout = layoutFor(settings, style);
  return ACTIONS.every((a) => layout[a].join() === LAYOUTS[style][a].join());
}

/**
 * Give `action` the key `code`. A key does one thing per style, so if another
 * action had it, it moves over; that action is returned so the screen can say so.
 * Returns false if the key can't be bound.
 */
export function bindKey(settings: Settings, style: ControlStyle, action: Action, code: string): { from: Action | null } | false {
  if (isReserved(code)) return false;
  const layout = copyLayout(layoutFor(settings, style));
  if (layout[action].includes(code)) return { from: null };
  let from: Action | null = null;
  for (const a of ACTIONS) {
    if (a !== action && layout[a].includes(code)) {
      layout[a] = layout[a].filter((c) => c !== code);
      from = a;
    }
  }
  layout[action] = [...layout[action], code].slice(-MAX_KEYS_PER_ACTION);
  settings.keys[style] = layout;
  return { from };
}

export function unbindKey(settings: Settings, style: ControlStyle, action: Action, code: string): void {
  const layout = copyLayout(layoutFor(settings, style));
  layout[action] = layout[action].filter((c) => c !== code);
  settings.keys[style] = layout;
}

export function resetKeys(settings: Settings, style: ControlStyle): void {
  delete settings.keys[style];
}

// ------------------------------------------------------------- key names

const NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '<',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

/** What the keys are labelled on this keyboard, if the browser can tell (Chrome and Edge can). */
let labels: ReadonlyMap<string, string> = new Map();

/** Use the labels of the player's own keyboard layout, e.g. Y and Z swapped on a German one. */
export function setKeyLabels(map: ReadonlyMap<string, string>): void {
  labels = map;
}

/** A short, readable name for a key code: KeyA → A, ArrowLeft → ←, Numpad4 → Num 4. */
export function keyName(code: string): string {
  const label = labels.get(code);
  if (label && label.trim() && !/^\s$/.test(label)) return label.length === 1 ? label.toUpperCase() : label;
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6).replace('Add', '+').replace('Subtract', '-').replace('Multiply', '*').replace('Divide', '/').replace('Decimal', '.')}`;
  return code;
}

/** "W, ↑ or Space". */
function list(codes: readonly string[]): string {
  const names = codes.map(keyName);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** Left and right keys side by side: "A / D or ← / →". */
function pairs(left: readonly string[], right: readonly string[]): string {
  if (!left.length || !right.length) return [list(left), list(right)].filter(Boolean).join(' / ');
  if (left.length !== right.length) return `${list(left)} / ${list(right)}`;
  return left.map((l, i) => `${keyName(l)} / ${keyName(right[i])}`).join(' or ');
}

const first = (codes: readonly string[]): string => (codes[0] ? keyName(codes[0]) : '?');

/** What each key does, for help texts in the menu and in game. */
export function keyHelp(style: ControlStyle, k: KeyLayout): [keys: string, action: string][] {
  const rows: [string, string][] = [];
  const add = (keys: string, action: string): void => {
    if (keys) rows.push([keys, action]);
  };
  const crew = [k.crewPrev.length ? first(k.crewPrev) : '', k.crewNext.length ? first(k.crewNext) : ''].filter(Boolean).join(' / ');
  if (style === 'jumpAndRun') {
    add(pairs(k.left, k.right), 'walk (hold)');
    add(list(k.up), 'jump, climb up, go in a door');
    add(list(k.down), 'climb down, leave a building, build, hold on to an elevator or tower');
    add(list(k.dig), `dig, again to stop (steer with ${first(k.left)} / ${first(k.right)} / ${first(k.up)} / ${first(k.down)})`);
    if (k.dig.length) add(`${first(k.dig)} ${first(k.dig)}`, 'use what you carry');
    add(list(k.throw), 'throw');
    add(list(k.magic), 'spell menu (sorcerers)');
    add(crew ? `${crew} / 1–9` : '1–9', `${k.crewPrev.length ? 'previous / ' : ''}next clonk / pick a clonk`);
    add(list(k.crewAll), `whole crew (${first(k.down)} gathers them)`);
  } else {
    add(pairs(k.left, k.right), 'start walking');
    add(list(k.down), 'stop');
    add(list(k.up), 'jump, go in a door');
    add(list(k.dig), `dig (${first(k.left)} / ${first(k.right)} turn)`);
    if (k.dig.length) add(`${first(k.dig)} ${first(k.dig)}`, 'use what you carry');
    if (k.down.length) add(`${first(k.down)} ${first(k.down)}`, 'build, hold on to an elevator or tower');
    add(list(k.throw), 'throw');
    add(list(k.magic), 'spell menu (sorcerers)');
    add(crew ? `${crew} or 1–9` : '1–9', `${k.crewPrev.length ? 'previous / ' : ''}next clonk, pick a clonk`);
    add(list(k.crewAll), `whole crew (${first(k.down)} ${first(k.down)} gathers them)`);
  }
  return rows;
}

/** Key names for the hints inside buildings. */
export function buildingKeys(k: KeyLayout): { choose: string; buy: string; sell: string; up: string; down: string } {
  const short = (codes: readonly string[]): string => codes.slice(0, 2).map(keyName).join('/');
  return {
    choose: pairs(k.left.slice(0, 2), k.right.slice(0, 2)).replaceAll(' / ', '/'),
    buy: `${short(k.up)} or ${first(k.throw)}`,
    sell: first(k.throw),
    up: short(k.up),
    down: short(k.down),
  };
}
