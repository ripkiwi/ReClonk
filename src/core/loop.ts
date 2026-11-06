/** Simulation ticks per second. The original engine also ran at 36. */
export const TICKS_PER_SECOND = 36;
const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Never simulate more than this many ticks per frame, so a stalled tab can't freeze the game. */
const MAX_TICKS_PER_FRAME = 5;

/**
 * Fixed-timestep loop: the simulation advances in whole ticks, independent of
 * frame rate, while rendering happens once per animation frame.
 */
export class FixedLoop {
  private accumulator = 0;
  tick = 0;

  constructor(private readonly onTick: (tick: number) => void) {}

  /** Feed elapsed real time in milliseconds; runs as many ticks as are due. */
  advance(elapsedMs: number): number {
    this.accumulator += elapsedMs;
    let ran = 0;
    while (this.accumulator >= TICK_MS && ran < MAX_TICKS_PER_FRAME) {
      this.onTick(this.tick++);
      this.accumulator -= TICK_MS;
      ran++;
    }
    if (ran === MAX_TICKS_PER_FRAME) this.accumulator = 0;
    return ran;
  }
}
