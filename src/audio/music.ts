/** Same folder as CONTENT_BASE in render/assets, without pulling in Pixi (the settings code uses this file). */
const MUSIC_BASE = `${import.meta.env.BASE_URL}classic/music/`;

/** The menu theme, like the original's Frontend.ogg. */
export const MENU_TRACK = 'Frontend';
/** Songs played during a round (the rest of the original Music.c4g). */
export const GAME_TRACKS = ['PizzaStrings', 'Rocking-Horse', 'SlopingOff'] as const;

/** Music settings, stored with the other browser settings. */
export interface MusicSettings {
  /** Play the menu theme in the menus. */
  menu: boolean;
  /** Play songs during a round. */
  game: boolean;
  /** 0 to 100. */
  volume: number;
}

export function defaultMusicSettings(): MusicSettings {
  return { menu: true, game: true, volume: 50 };
}

/** A clean copy of stored music settings; anything missing or broken uses the default. */
export function cleanMusicSettings(saved: unknown): MusicSettings {
  const out = defaultMusicSettings();
  if (!saved || typeof saved !== 'object') return out;
  const s = saved as Partial<Record<keyof MusicSettings, unknown>>;
  if (typeof s.menu === 'boolean') out.menu = s.menu;
  if (typeof s.game === 'boolean') out.game = s.game;
  if (typeof s.volume === 'number' && Number.isFinite(s.volume)) out.volume = Math.round(Math.min(100, Math.max(0, s.volume)));
  return out;
}

/**
 * Pick the next song like the original (C4MusicSystem::Play): any song that wasn't
 * among the last half of the list played, so nothing repeats too soon.
 * `recent` is newest last.
 */
export function nextTrack(tracks: readonly string[], recent: readonly string[], random: () => number = Math.random): string {
  const blocked = new Set(recent.slice(-Math.floor(tracks.length / 2)));
  const pool = tracks.filter((t) => !blocked.has(t));
  const from = pool.length ? pool : tracks;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

const FADE_MS = 700;

/**
 * Background music with streamed <audio> elements: the menu theme loops in the
 * menus, and the round songs follow each other in random order. Browsers only
 * start audio after a click or key press, so `unlock` retries then.
 */
export class Music {
  private mode: 'none' | 'menu' | 'game' = 'none';
  private audio: HTMLAudioElement | null = null;
  private track = '';
  private readonly recent: string[] = [];
  private readonly supported: boolean;

  constructor(private readonly settings: MusicSettings) {
    this.supported = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
  }

  /** Back in the menus: the menu theme, unless it's already playing. */
  menu(): void {
    if (this.mode === 'menu') return;
    this.mode = 'menu';
    this.switchTo(this.settings.menu ? MENU_TRACK : '');
  }

  /** A round starts: a fresh song. */
  game(): void {
    this.mode = 'game';
    this.switchTo(this.settings.game ? this.pickGameTrack() : '');
  }

  /** Call after the settings change. */
  refresh(): void {
    if (this.audio) this.audio.volume = this.volume();
    const wanted = this.mode === 'menu' ? this.settings.menu : this.mode === 'game' ? this.settings.game : false;
    if (!wanted) this.switchTo('');
    else if (!this.track) this.switchTo(this.mode === 'menu' ? MENU_TRACK : this.pickGameTrack());
  }

  /** Start music that the browser blocked; call from a click or key handler. */
  unlock(): void {
    if (this.audio?.paused) this.audio.play().catch(() => {});
  }

  private volume(): number {
    // Squared, so the slider feels even to the ear.
    return (this.settings.volume / 100) ** 2;
  }

  private pickGameTrack(): string {
    const t = nextTrack(GAME_TRACKS, this.recent);
    this.recent.push(t);
    if (this.recent.length > GAME_TRACKS.length) this.recent.shift();
    return t;
  }

  private switchTo(track: string): void {
    if (!this.supported) return;
    if (this.audio) fadeOut(this.audio);
    this.audio = null;
    this.track = track;
    if (!track) return;
    const audio = new Audio(`${MUSIC_BASE}${track}.ogg`);
    audio.preload = 'auto';
    audio.volume = this.volume();
    if (track === MENU_TRACK) audio.loop = true;
    else
      audio.addEventListener('ended', () => {
        if (this.audio === audio && this.mode === 'game') this.switchTo(this.pickGameTrack());
      });
    this.audio = audio;
    audio.play().catch(() => {
      // Blocked until the player clicks or presses a key; unlock() starts it then.
    });
  }
}

function fadeOut(audio: HTMLAudioElement): void {
  const start = audio.volume;
  const began = performance.now();
  const step = (): void => {
    const t = (performance.now() - began) / FADE_MS;
    if (t >= 1 || audio.paused) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    audio.volume = start * (1 - t);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
