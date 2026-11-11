import { describe, expect, it } from 'vitest';
import { bindKey, defaultSettings, isDefaultLayout, keyHelp, layoutFor, loadSettings, resetKeys, saveSettings, unbindKey } from './bindings';
import { Keyboard, LAYOUTS } from './keyboard';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('Key bindings', () => {
  it('start with the default keys and the in-game key help off', () => {
    const s = loadSettings(memory());
    expect(s.showKeyHelp).toBe(false);
    expect(layoutFor(s, 'jumpAndRun')).toEqual(LAYOUTS.jumpAndRun);
    expect(layoutFor(s, 'classic')).toEqual(LAYOUTS.classic);
  });

  it('a key moves from the action that had it, per style only', () => {
    const s = defaultSettings();
    expect(bindKey(s, 'jumpAndRun', 'throw', 'KeyQ')).toEqual({ from: 'dig' });
    expect(layoutFor(s, 'jumpAndRun').dig).toEqual([]);
    expect(layoutFor(s, 'jumpAndRun').throw).toEqual(['KeyE', 'KeyQ']);
    expect(layoutFor(s, 'classic')).toEqual(LAYOUTS.classic);
    expect(LAYOUTS.jumpAndRun.dig).toEqual(['KeyQ']);
  });

  it('pause and crew pick keys cannot be bound', () => {
    const s = defaultSettings();
    expect(bindKey(s, 'classic', 'dig', 'Escape')).toBe(false);
    expect(bindKey(s, 'classic', 'dig', 'KeyP')).toBe(false);
    expect(bindKey(s, 'classic', 'dig', 'Digit3')).toBe(false);
    expect(isDefaultLayout(s, 'classic')).toBe(true);
  });

  it('save, load and reset', () => {
    const store = memory();
    const s = defaultSettings();
    s.showKeyHelp = true;
    unbindKey(s, 'classic', 'left', 'KeyZ');
    bindKey(s, 'classic', 'left', 'KeyY');
    saveSettings(store, s);
    const back = loadSettings(store);
    expect(back.showKeyHelp).toBe(true);
    expect(layoutFor(back, 'classic').left).toEqual(['ArrowLeft', 'KeyY']);
    resetKeys(back, 'classic');
    expect(isDefaultLayout(back, 'classic')).toBe(true);
  });

  it('corrupt or hostile saves fall back to sane keys', () => {
    const store = memory();
    store.setItem('reclonk.settings.v1', JSON.stringify({ showKeyHelp: 'yes', keys: { classic: { left: ['Escape', 'KeyJ', 'KeyJ', 5], dig: 'x' } } }));
    const s = loadSettings(store);
    expect(s.showKeyHelp).toBe(false);
    expect(layoutFor(s, 'classic').left).toEqual(['KeyJ']);
    expect(layoutFor(s, 'classic').dig).toEqual(LAYOUTS.classic.dig);
  });

  it('the magic key is F, and a save from before it keeps the player’s own F', () => {
    expect(LAYOUTS.jumpAndRun.magic).toEqual(['KeyF']);
    expect(LAYOUTS.classic.magic).toEqual(['KeyF']);
    const store = memory();
    const { magic: _, ...old } = LAYOUTS.classic;
    store.setItem('reclonk.settings.v1', JSON.stringify({ keys: { classic: old, jumpAndRun: { ...LAYOUTS.jumpAndRun, magic: undefined, throw: ['KeyF'] } } }));
    const s = loadSettings(store);
    expect(layoutFor(s, 'classic').magic).toEqual(['KeyF']);
    expect(layoutFor(s, 'jumpAndRun').throw).toEqual(['KeyF']);
    expect(layoutFor(s, 'jumpAndRun').magic).toEqual([]);
  });

  it('the help text follows the bindings', () => {
    const s = defaultSettings();
    bindKey(s, 'jumpAndRun', 'dig', 'KeyF');
    unbindKey(s, 'jumpAndRun', 'dig', 'KeyQ');
    const help = keyHelp('jumpAndRun', layoutFor(s, 'jumpAndRun'));
    expect(help).toContainEqual(['F F', 'use what you carry']);
    expect(keyHelp('jumpAndRun', LAYOUTS.jumpAndRun)[0]).toEqual(['← / → or A / D', 'walk (hold)']);
  });

  it('the keyboard plays with the rebound keys', () => {
    const s = defaultSettings();
    bindKey(s, 'jumpAndRun', 'dig', 'KeyF');
    const target = new EventTarget();
    const kb = new Keyboard('jumpAndRun', target as unknown as Window, layoutFor(s, 'jumpAndRun'));
    const tap = (code: string): void => {
      for (const type of ['keydown', 'keyup']) target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
    };
    tap('KeyF');
    expect(kb.read().pressedDig).toBe(true);
    tap('KeyQ');
    expect(kb.read().pressedDig).toBe(true);
  });
});
