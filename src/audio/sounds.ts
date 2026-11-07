import { CONTENT_BASE } from '../render/assets';

/** Sound effects from the classic content pack (Sound.c4g). */
export const SOUND_FILES = [
  'Blast1',
  'Blast2',
  'Blast3',
  'Build1',
  'Build2',
  'Click',
  'Die',
  'Elevator',
  'Eliminated',
  'Grab',
  'Hurt1',
  'Hurt2',
  'Hurt3',
  'Kime1',
  'Kime2',
  'Kime3',
  'Punch1',
  'Punch2',
  'Punch3',
  'SteelGate1',
  'Trumpet',
] as const;
export type SoundId = (typeof SOUND_FILES)[number];

/**
 * Plays short sound effects with the Web Audio API, so the same sound can overlap
 * itself. Browsers only allow audio after the first click or key press, so the
 * audio context starts lazily; sounds before that are skipped.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private readonly data = new Map<SoundId, ArrayBuffer>();
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  muted = false;

  /** Fetch the files. Missing files just stay silent. */
  async load(): Promise<void> {
    await Promise.all(
      SOUND_FILES.map(async (id) => {
        try {
          const res = await fetch(`${CONTENT_BASE}sound/${id}.wav`);
          if (res.ok) this.data.set(id, await res.arrayBuffer());
        } catch {
          // Sound is optional.
        }
      }),
    );
  }

  /** Create the audio context; call from a click or key handler. */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    for (const [id, raw] of this.data) {
      this.ctx.decodeAudioData(raw.slice(0)).then(
        (buf) => this.buffers.set(id, buf),
        () => {},
      );
    }
  }

  play(id: SoundId, volume = 1): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (this.muted || !ctx || !buf || volume <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, volume) * 0.7;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }
}
