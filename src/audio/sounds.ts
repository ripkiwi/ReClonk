import { CONTENT_BASE } from '../render/assets';

/** Sound effects from the classic content pack (Sound.c4g). */
export const SOUND_FILES = [
  'Blast1',
  'Blast2',
  'Blast3',
  'Build1',
  'Build2',
  'Chop1',
  'Chop2',
  'Chop3',
  'Chop4',
  'Click',
  'Crystal1',
  'Crystal2',
  'Crystal3',
  'Corrode',
  'Die',
  'Earthquake',
  'Electric',
  'Elevator',
  'Eliminated',
  'Energy',
  'Fire',
  'Fuse',
  'Fusing',
  'Grab',
  'Hurt1',
  'Hurt2',
  'Hurt3',
  'Inflame',
  'Kime1',
  'Kime2',
  'Kime3',
  'Magic1',
  'Lava1',
  'Lava2',
  'Lava3',
  'Punch1',
  'Punch2',
  'Punch3',
  'Propel',
  'Pshshsh',
  'RockHit1',
  'RockHit2',
  'RockHit3',
  'SailDown',
  'SailUp',
  'SteelGate1',
  'Thunder1',
  'Thunder2',
  'Thunder3',
  'TreeDown1',
  'TreeDown2',
  'TreeDown3',
  'Trumpet',
  'VolcanoCast',
  'Wind',
  'Wind2',
  'WoodHit1',
  'WoodHit2',
  'WoodHit3',
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
  /** Sounds that keep playing while something lasts (wind, an earthquake), with their volume. */
  private readonly loops = new Map<SoundId, { src: AudioBufferSourceNode; gain: GainNode }>();
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

  /**
   * Keep a sound looping at a volume, like the original's SoundLevel and
   * action sounds; volume 0 stops it.
   */
  loop(id: SoundId, volume: number): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    const playing = this.loops.get(id);
    const v = this.muted ? 0 : Math.max(0, Math.min(1, volume)) * 0.7;
    if (playing) {
      if (v > 0) playing.gain.gain.setTargetAtTime(v, playing.src.context.currentTime, 0.1);
      else {
        playing.src.stop();
        this.loops.delete(id);
      }
      return;
    }
    if (!ctx || !buf || v <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = v;
    src.connect(gain).connect(ctx.destination);
    src.start();
    this.loops.set(id, { src, gain });
  }

  /** Stop every looping sound (the round ended or paused). */
  stopLoops(): void {
    for (const id of [...this.loops.keys()]) this.loop(id, 0);
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
