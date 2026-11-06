/**
 * Seeded, deterministic pseudo-random number generator (mulberry32).
 *
 * The simulation must produce identical results on every machine so that
 * replays and lockstep multiplayer work. Never use Math.random() inside the
 * simulation; always use an Rng owned by the game state.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, max). */
  int(max: number): number {
    return this.nextU32() % max;
  }

  /** True with probability 1/2. */
  bool(): boolean {
    return (this.nextU32() & 1) === 1;
  }
}
