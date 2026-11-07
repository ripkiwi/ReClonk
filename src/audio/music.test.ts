import { describe, expect, it } from 'vitest';
import { cleanMusicSettings, defaultMusicSettings, GAME_TRACKS, nextTrack } from './music';

describe('nextTrack', () => {
  it('never repeats the last song with three songs', () => {
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      expect(nextTrack(GAME_TRACKS, ['SlopingOff'], () => r)).not.toBe('SlopingOff');
    }
  });

  it('can pick any song at first', () => {
    const seen = new Set([0, 0.5, 0.99].map((r) => nextTrack(GAME_TRACKS, [], () => r)));
    expect(seen.size).toBe(3);
  });

  it('works with a single song', () => {
    expect(nextTrack(['A'], ['A'], () => 0.7)).toBe('A');
  });
});

describe('cleanMusicSettings', () => {
  it('uses defaults for missing or broken values', () => {
    expect(cleanMusicSettings(undefined)).toEqual(defaultMusicSettings());
    expect(cleanMusicSettings({ menu: 'yes', volume: 'loud' })).toEqual(defaultMusicSettings());
  });

  it('keeps valid values and clamps the volume', () => {
    expect(cleanMusicSettings({ menu: false, game: true, volume: 250 })).toEqual({ menu: false, game: true, volume: 100 });
    expect(cleanMusicSettings({ volume: -3 }).volume).toBe(0);
  });
});
