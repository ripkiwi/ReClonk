import { NO_CONTROL, type ControlState, type ControlStyle, type CrewCommand } from '../objects/clonk';

export interface KeyLayout {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  throw: string[];
  dig: string[];
  /** Open the spell menu (sorcerers). */
  magic: string[];
  /** Crew cursor: previous and next clonk, and the whole crew. */
  crewPrev: string[];
  crewNext: string[];
  crewAll: string[];
}

/** A second press within this many ticks (a third of a second) counts as a double press. */
export const DOUBLE_PRESS_TICKS = 12;

/** Keys 1 to 9 pick a crew member by its place in the crew bar. */
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

/**
 * Key layouts per control style. Codes are physical key positions (KeyboardEvent.code),
 * so the classic layout sits on the same keys on QWERTY, QWERTZ and AZERTY keyboards.
 */
export const LAYOUTS: Record<ControlStyle, KeyLayout> = {
  /**
   * Hold a direction to walk, let go to stop. Arrow keys and WASD both work.
   * Q digs, E throws, Tab and R pick crew members.
   */
  jumpAndRun: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW', 'Space'],
    down: ['ArrowDown', 'KeyS'],
    throw: ['KeyE'],
    dig: ['KeyQ'],
    magic: ['KeyF'],
    crewPrev: [],
    crewNext: ['Tab'],
    crewAll: ['KeyR'],
  },
  /**
   * The original's first keyboard layout (C4Config Kbd1): Z/Y left, C right, S jump,
   * X stop, A throw, D dig, and Q/E/W for the crew cursor. Tap a direction to
   * start walking, tap stop to stop. Arrow keys work too, with Space to throw
   * and Enter to dig.
   */
  classic: {
    left: ['KeyZ', 'ArrowLeft'],
    right: ['KeyC', 'ArrowRight'],
    up: ['KeyS', 'ArrowUp'],
    down: ['KeyX', 'ArrowDown'],
    throw: ['KeyA', 'Space'],
    dig: ['KeyD', 'Enter'],
    magic: ['KeyF'],
    crewPrev: ['KeyQ'],
    crewNext: ['KeyE', 'Tab'],
    crewAll: ['KeyW'],
  },
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
  /** Crew command from the keys or the crew bar, for the next tick. */
  private crew: CrewCommand | null = null;
  /** Ticks read so far, and when dig and down were last pressed, to spot double presses. */
  private ticks = 0;
  private lastDig = -Infinity;
  private lastDown = -Infinity;
  /** While false, keys are ignored (menus, pause). */
  enabled = true;

  private readonly onDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.gameKeys.has(e.code)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat) {
      this.pressed.add(e.code);
      this.commands++;
      const k = this.layout;
      const digit = DIGITS.indexOf(e.code);
      if (digit >= 0) this.crew = { type: 'pick', index: digit };
      else if (k.crewAll.includes(e.code)) this.crew = { type: 'all' };
      else if (k.crewPrev.includes(e.code) || (e.shiftKey && k.crewNext.includes(e.code))) this.crew = { type: 'prev' };
      else if (k.crewNext.includes(e.code)) this.crew = { type: 'next' };
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
    /** The player's own keys, if they changed them in the settings. */
    layout: KeyLayout = LAYOUTS[style],
  ) {
    this.layout = layout;
    this.gameKeys = new Set([...Object.values(this.layout).flat(), ...DIGITS]);
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
    this.crew = null;
  }

  /** Send a crew command with the next tick, e.g. from clicking the crew bar. */
  command(cmd: CrewCommand): void {
    if (this.enabled) this.crew = cmd;
  }

  private any(codes: string[], set: Set<string>): boolean {
    return codes.some((c) => set.has(c));
  }

  /** Read the controls for one tick and clear the pressed latches. */
  read(): ControlState {
    const h = this.held;
    const p = this.pressed;
    const k = this.layout;
    const tick = this.ticks++;
    const dig = this.any(k.dig, p);
    const down = this.any(k.down, p);
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
      pressedDig: dig,
      pressedMagic: this.any(k.magic, p),
      pressedUse: dig && tick - this.lastDig <= DOUBLE_PRESS_TICKS,
      doubleDown: down && tick - this.lastDown <= DOUBLE_PRESS_TICKS,
      crew: this.crew,
      commands: this.commands,
    };
    // A double press uses up both presses, so a third quick press starts over.
    if (dig) this.lastDig = state.pressedUse ? -Infinity : tick;
    if (down) this.lastDown = state.doubleDown ? -Infinity : tick;
    this.pressed = new Set();
    this.commands = 0;
    this.crew = null;
    return state;
  }
}
