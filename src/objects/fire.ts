// Fire rules from the Clonk Rage engine (C4Object::Incinerate, ExecFire and
// Extinguish; FnFxFireStart and FnFxFireTimer in C4Effect.cpp; the OnFire and
// Inflammable check in C4GameObjects::CrossCheck). See licenses/clonk_engine_license.txt.

/** What burns, and who lit it (credited with what the fire does). */
export interface FireState {
  /** Id of the clonk that set it alight, or -1. */
  by: number;
  /** Tick it caught fire. */
  since: number;
}

export const FIRE = {
  /** Con a burning object loses each tick (DoCon(-100), unless NoBurnDecay): a full one is gone in 1000 ticks. */
  decay: 100,
  /** Damage every 10 ticks (DoDamage(+2), unless NoBurnDamage). */
  damageInterval: 10,
  damage: 2,
  /** Energy every 5 ticks (DoEnergy(-1)): a fresh clonk burns to death in about 7 seconds. */
  energyInterval: 5,
  energy: 1,
  /** Every 5 ticks: water puts it out, and a clonk in a home base is put out (BASEFUNC_Extinguish). */
  checkInterval: 5,
  /** Every 35 ticks a burning object sets fire to an inflammable one its centre is in, one time in its ContactIncinerate. */
  contactInterval: 35,
  /** A clonk catches fire one time in 1 (Clonk.c4d ContactIncinerate) and doesn't burn away (NoBurnDecay). */
  clonkContact: 1,
  /** Things bigger than this (width × height) catch fire with a whoosh (the Inflame sound). */
  inflameArea: 500,
  /** Things this heavy crackle while they burn (the Fire sound loop). */
  loopMass: 100,
  /** A burned tree lying on the ground under 90% rots by 1% every 51 ticks (Tree.c4d IntTreeDecay). */
  rotInterval: 51,
  rotBelow: 90000,
  rot: 1000,
};
