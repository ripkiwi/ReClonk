import {
  ACTION_LABELS,
  ACTIONS,
  bindKey,
  isDefaultLayout,
  isReserved,
  keyName,
  layoutFor,
  MAX_KEYS_PER_ACTION,
  resetKeys,
  unbindKey,
  type Action,
  type Settings,
} from '../input/bindings';
import type { ControlStyle } from '../objects/clonk';
import { bigButton, h } from './dom';

export interface GameSettingsOptions {
  settings: Settings;
  /** Which control style's keys to show first: the active player's. */
  style: ControlStyle;
  /** Store the changed settings. */
  save(): void;
  click(): void;
  /** The music settings changed. */
  onMusic(): void;
  onBack(): void;
}

const STYLES: { style: ControlStyle; title: string }[] = [
  { style: 'jumpAndRun', title: "Jump'n'Run" },
  { style: 'classic', title: 'Classic' },
];

/**
 * The game settings: keys for both control styles, and whether to show the
 * key help during a round. Changes are saved straight away.
 */
export function gameSettings(o: GameSettingsOptions): HTMLElement[] {
  const { settings } = o;
  let style = o.style;
  /** The action waiting for a key press, if any. */
  let listening: Action | null = null;
  let note = '';
  const body = h('div', { class: 'paper-body key-settings', style: { top: '34px', bottom: '40px' } });
  const paper = h('div', { class: 'paper', style: { left: '86px', top: '40px' } }, body);

  const stopListening = (): void => {
    removeEventListener('keydown', onCapture, { capture: true });
    listening = null;
  };

  // Catches the next key before the menu or the game sees it.
  const onCapture = (e: KeyboardEvent): void => {
    if (!paper.isConnected || !listening) return stopListening();
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const action = listening;
    if (e.code === 'Escape') {
      note = '';
    } else if (isReserved(e.code)) {
      note = `${keyName(e.code) || 'That key'} is taken: Esc and P pause, 1–9 pick a clonk, and Ctrl, Alt and the system key belong to the browser.`;
    } else {
      const done = bindKey(settings, style, action, e.code);
      if (done) {
        note = done.from ? `${keyName(e.code)} moved here from “${ACTION_LABELS[style][done.from]}”.` : '';
        o.save();
      }
    }
    stopListening();
    o.click();
    render();
  };

  const listen = (action: Action): void => {
    stopListening();
    listening = action;
    note = 'Press a key, or Esc to cancel.';
    addEventListener('keydown', onCapture, { capture: true });
    render();
  };

  const render = (): void => {
    const layout = layoutFor(settings, style);
    const tabs = h('div', { class: 'key-tabs' });
    for (const s of STYLES) {
      tabs.append(
        h(
          'button',
          {
            class: `ink-button${s.style === style ? ' selected' : ''}`,
            onclick: () => {
              stopListening();
              style = s.style;
              note = '';
              o.click();
              render();
            },
          },
          s.title,
        ),
      );
    }

    const table = h('table', { class: 'key-table' });
    for (const action of ACTIONS) {
      const keys = h('td', { class: 'key-cell' });
      for (const code of layout[action]) {
        keys.append(
          h(
            'button',
            {
              class: 'key-chip',
              title: 'Click to remove',
              onclick: () => {
                unbindKey(settings, style, action, code);
                o.save();
                note = '';
                o.click();
                render();
              },
            },
            keyName(code),
            h('span', { class: 'x' }, '×'),
          ),
        );
      }
      if (listening === action) keys.append(h('span', { class: 'key-chip listening' }, 'press a key…'));
      else if (layout[action].length < MAX_KEYS_PER_ACTION) {
        keys.append(h('button', { class: 'key-add', title: 'Add a key', onclick: () => listen(action) }, '+'));
      }
      if (!layout[action].length && listening !== action && action !== 'crewPrev') keys.append(h('span', { class: 'key-none' }, 'no key'));
      table.append(h('tr', { class: listening === action ? 'listening' : '' }, h('td', {}, ACTION_LABELS[style][action]), keys));
    }
    table.append(h('tr', { class: 'fixed' }, h('td', {}, 'Pick a clonk'), h('td', { class: 'key-cell' }, '1 – 9')));
    table.append(h('tr', { class: 'fixed' }, h('td', {}, 'Pause'), h('td', { class: 'key-cell' }, 'Esc or P')));

    const help = h('input', {
      type: 'checkbox',
      checked: settings.showKeyHelp,
      onchange: (e: Event) => {
        settings.showKeyHelp = (e.target as HTMLInputElement).checked;
        o.save();
        o.click();
      },
    });

    const music = settings.music;
    const musicCheck = (key: 'menu' | 'game'): HTMLElement =>
      h('input', {
        type: 'checkbox',
        checked: music[key],
        onchange: (e: Event) => {
          music[key] = (e.target as HTMLInputElement).checked;
          o.save();
          o.onMusic();
          o.click();
        },
      });
    const volume = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: String(music.volume),
      title: 'Music volume',
      oninput: (e: Event) => {
        music.volume = Number((e.target as HTMLInputElement).value);
        o.onMusic();
      },
      onchange: () => o.save(),
    });

    body.replaceChildren(
      h('h1', {}, 'Settings'),
      h('div', { class: 'sub' }, 'Saved in this browser, for every player.'),
      h('h3', {}, 'Music'),
      h(
        'div',
        { class: 'music-row' },
        h('label', { class: 'check-row' }, musicCheck('menu'), ' In the menus'),
        h('label', { class: 'check-row' }, musicCheck('game'), ' During a round'),
        h('label', { class: 'volume-row' }, 'Volume ', volume),
      ),
      h('h3', {}, 'During a round'),
      h('label', { class: 'check-row' }, help, ' Show the key help along the bottom of the screen'),
      h('p', { class: 'hint-line' }, 'The keys are always listed in the pause menu (Esc).'),
      h('h3', {}, 'Keys'),
      tabs,
      table,
      h(
        'div',
        { class: 'key-footer' },
        h('span', { class: 'key-note' }, note),
        h(
          'button',
          {
            class: 'ink-button',
            disabled: isDefaultLayout(settings, style),
            onclick: () => {
              stopListening();
              resetKeys(settings, style);
              o.save();
              note = `${STYLES.find((s) => s.style === style)?.title} keys are back to the defaults.`;
              o.click();
              render();
            },
          },
          'Reset to defaults',
        ),
      ),
    );
  };

  render();
  return [
    paper,
    bigButton('Back', 288, 545, () => {
      stopListening();
      o.onBack();
    }),
  ];
}
