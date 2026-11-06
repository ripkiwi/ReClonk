import { NO_CONTROL, type ControlState } from '../objects/clonk';

/** Default key layout. Arrow keys and WASD both work. */
export const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW', 'Space'],
  down: ['ArrowDown', 'KeyS'],
  throw: ['KeyQ', 'KeyE'],
};

const GAME_KEYS = new Set(Object.values(KEYS).flat());

/**
 * Turns keyboard events into one ControlState per simulation tick.
 * "Pressed" flags are latched until the next tick reads them, so a quick tap
 * between two ticks is never lost.
 */
export class Keyboard {
  private readonly held = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    // Releasing keys while the tab is in the background would otherwise leave them stuck.
    target.addEventListener('blur', () => this.held.clear());
  }

  private any(codes: string[], set: Set<string>): boolean {
    return codes.some((c) => set.has(c));
  }

  /** Read the controls for one tick and clear the pressed latches. */
  read(): ControlState {
    const h = this.held;
    const p = this.pressed;
    const state: ControlState = {
      ...NO_CONTROL,
      left: this.any(KEYS.left, h) || this.any(KEYS.left, p),
      right: this.any(KEYS.right, h) || this.any(KEYS.right, p),
      up: this.any(KEYS.up, h) || this.any(KEYS.up, p),
      down: this.any(KEYS.down, h) || this.any(KEYS.down, p),
      pressedUp: this.any(KEYS.up, p),
      pressedDown: this.any(KEYS.down, p),
      pressedThrow: this.any(KEYS.throw, p),
    };
    this.pressed = new Set();
    return state;
  }
}
