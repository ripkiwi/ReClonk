import { NO_CONTROL, type ControlState, type ControlStyle } from '../objects/clonk';

export interface KeyLayout {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  throw: string[];
  dig: string[];
}

/**
 * Key layouts per control style. Codes are physical key positions (KeyboardEvent.code),
 * so the classic layout sits on the same keys on QWERTY, QWERTZ and AZERTY keyboards.
 */
export const LAYOUTS: Record<ControlStyle, KeyLayout> = {
  /** Hold a direction to walk, let go to stop. Arrow keys and WASD both work; down digs. */
  jumpAndRun: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW', 'Space'],
    down: ['ArrowDown', 'KeyS'],
    throw: ['KeyQ', 'KeyE'],
    dig: [],
  },
  /**
   * The original's first keyboard layout (C4Config Kbd1): Z/Y left, C right, S jump,
   * X stop, A throw, D dig. Tap a direction to start walking, tap stop to stop.
   * Arrow keys work too, with Space to throw and Enter to dig.
   */
  classic: {
    left: ['KeyZ', 'ArrowLeft'],
    right: ['KeyC', 'ArrowRight'],
    up: ['KeyS', 'ArrowUp'],
    down: ['KeyX', 'ArrowDown'],
    throw: ['KeyA', 'Space'],
    dig: ['KeyD', 'Enter'],
  },
};

/** What each key does, for help texts in the menu and in game. */
export const KEY_HELP: Record<ControlStyle, [keys: string, action: string][]> = {
  jumpAndRun: [
    ['A / D or ← / →', 'walk (hold)'],
    ['W, ↑ or Space', 'jump, climb up, go in a door'],
    ['S / ↓', 'dig (hold a direction to steer)'],
    ['Q or E', 'throw'],
  ],
  classic: [
    ['Z (Y) / C or ← / →', 'start walking'],
    ['X or ↓', 'stop'],
    ['S or ↑', 'jump, go in a door'],
    ['D or Enter', 'dig (← / → turn)'],
    ['A or Space', 'throw'],
  ],
};

/**
 * Turns keyboard events into one ControlState per simulation tick.
 * "Pressed" flags are latched until the next tick reads them, so a quick tap
 * between two ticks is never lost.
 */
export class Keyboard {
  private readonly held = new Set<string>();
  private pressed = new Set<string>();
  private commands = 0;
  private layout: KeyLayout;
  private gameKeys: Set<string>;
  /** While false, keys are ignored (menus, pause). */
  enabled = true;

  private readonly onDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.gameKeys.has(e.code)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat) {
      this.pressed.add(e.code);
      this.commands++;
    }
    this.held.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  // Releasing keys while the tab is in the background would otherwise leave them stuck.
  private readonly onBlur = (): void => this.held.clear();

  constructor(
    style: ControlStyle,
    private readonly target: Window = window,
  ) {
    this.layout = LAYOUTS[style];
    this.gameKeys = new Set(Object.values(this.layout).flat());
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  /** Forget held keys, e.g. when the game pauses. */
  reset(): void {
    this.held.clear();
    this.pressed.clear();
    this.commands = 0;
  }

  private any(codes: string[], set: Set<string>): boolean {
    return codes.some((c) => set.has(c));
  }

  /** Read the controls for one tick and clear the pressed latches. */
  read(): ControlState {
    const h = this.held;
    const p = this.pressed;
    const k = this.layout;
    const state: ControlState = {
      ...NO_CONTROL,
      left: this.any(k.left, h) || this.any(k.left, p),
      right: this.any(k.right, h) || this.any(k.right, p),
      up: this.any(k.up, h) || this.any(k.up, p),
      down: this.any(k.down, h) || this.any(k.down, p),
      pressedUp: this.any(k.up, p),
      pressedDown: this.any(k.down, p),
      pressedLeft: this.any(k.left, p),
      pressedRight: this.any(k.right, p),
      pressedThrow: this.any(k.throw, p),
      pressedDig: this.any(k.dig, p),
      commands: this.commands,
    };
    this.pressed = new Set();
    this.commands = 0;
    return state;
  }
}
