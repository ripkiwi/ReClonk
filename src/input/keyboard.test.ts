import { describe, expect, it } from 'vitest';
import { DOUBLE_PRESS_TICKS, Keyboard } from './keyboard';

/** A keyboard listening on a plain event target instead of the browser window. */
function keyboard(style: 'jumpAndRun' | 'classic' = 'jumpAndRun') {
  const target = new EventTarget();
  const kb = new Keyboard(style, target as unknown as Window);
  const key = (type: 'keydown' | 'keyup', code: string, shiftKey = false): void => {
    target.dispatchEvent(Object.assign(new Event(type), { code, shiftKey, repeat: false, ctrlKey: false, metaKey: false, altKey: false }));
  };
  const tap = (code: string, shiftKey = false): void => {
    key('keydown', code, shiftKey);
    key('keyup', code, shiftKey);
  };
  return { kb, key, tap };
}

describe('Keyboard', () => {
  it("jump'n'run: Q digs and E throws", () => {
    const { kb, tap } = keyboard();
    tap('KeyQ');
    expect(kb.read()).toMatchObject({ pressedDig: true, pressedThrow: false, pressedUse: false });
    tap('KeyE');
    expect(kb.read()).toMatchObject({ pressedDig: false, pressedThrow: true });
    tap('KeyS');
    expect(kb.read()).toMatchObject({ pressedDown: true, pressedDig: false });
  });

  it('Q twice in quick succession uses the carried item; slower taps are two digs', () => {
    const { kb, tap } = keyboard();
    tap('KeyQ');
    kb.read();
    for (let i = 0; i < 5; i++) kb.read();
    tap('KeyQ');
    expect(kb.read()).toMatchObject({ pressedDig: true, pressedUse: true });
    // A third quick tap starts over instead of counting as another double.
    tap('KeyQ');
    expect(kb.read().pressedUse).toBe(false);
    for (let i = 0; i < DOUBLE_PRESS_TICKS + 1; i++) kb.read();
    tap('KeyQ');
    expect(kb.read()).toMatchObject({ pressedDig: true, pressedUse: false });
  });

  it("jump'n'run crew keys: Tab, Shift+Tab, 1 to 9 and R", () => {
    const { kb, tap } = keyboard();
    tap('Tab');
    expect(kb.read().crew).toEqual({ type: 'next' });
    tap('Tab', true);
    expect(kb.read().crew).toEqual({ type: 'prev' });
    tap('Digit3');
    expect(kb.read().crew).toEqual({ type: 'pick', index: 2 });
    tap('KeyR');
    expect(kb.read().crew).toEqual({ type: 'all' });
    expect(kb.read().crew).toBeNull();
  });

  it('classic keeps the original keys and Q/E/W crew cursor, with stop twice for gathering', () => {
    const { kb, tap } = keyboard('classic');
    tap('KeyD');
    expect(kb.read().pressedDig).toBe(true);
    tap('KeyA');
    expect(kb.read().pressedThrow).toBe(true);
    tap('KeyQ');
    expect(kb.read().crew).toEqual({ type: 'prev' });
    tap('KeyE');
    expect(kb.read().crew).toEqual({ type: 'next' });
    tap('KeyW');
    expect(kb.read().crew).toEqual({ type: 'all' });
    tap('KeyX');
    expect(kb.read().doubleDown).toBe(false);
    tap('KeyX');
    expect(kb.read().doubleDown).toBe(true);
  });

  it('crew bar clicks reach the next tick', () => {
    const { kb } = keyboard();
    kb.command({ type: 'toggle', index: 1 });
    expect(kb.read().crew).toEqual({ type: 'toggle', index: 1 });
  });
});
