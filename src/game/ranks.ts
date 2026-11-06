// Clonk ranks, ported from the Clonk Rage rank system (C4RankSystem.cpp) and the
// clonk's original rank list. See licenses/clonk_engine_license.txt.

/** The 24 base ranks, in order. Rank 0 is a plain Clonk. */
export const RANK_NAMES = [
  'Clonk', 'Ensign', 'Lieutenant', 'Captain', 'Major', 'Lieutenant Colonel', 'Colonel',
  'Brigade General', 'Major General', 'Lieutenant General', 'General', 'Midshipman', 'Commander',
  'Commodore', 'Rear-Admiral', 'Vice-Admiral', 'Admiral', 'Fleet Admiral', 'Counsellor of State',
  'Secretary of State', 'Chancellor', 'Vice President', 'President', 'Premier',
] as const;

/** After Premier the list starts over with a suffix: "Clonk First Class", "Ensign First Class", and so on. */
const EXTENSIONS = ['%s First Class', '%s Second Degree', '%s Without Equal', 'Sublime %s', 'Exalted %s'];

export const MAX_RANK = RANK_NAMES.length * (EXTENSIONS.length + 1) - 1;

/** Experience points base: rank n needs n^1.5 × 1000 experience, like the original. */
const RANK_BASE = 1000;

/** Experience needed to reach a rank. */
export function experienceForRank(rank: number): number {
  if (rank <= 0) return 0;
  return Math.floor(Math.pow(rank, 1.5) * RANK_BASE);
}

export function rankForExperience(exp: number): number {
  let r = 0;
  while (r < MAX_RANK && experienceForRank(r + 1) <= exp) r++;
  return r;
}

export function rankName(rank: number): string {
  const n = RANK_NAMES.length;
  const r = Math.max(0, Math.min(MAX_RANK, rank));
  if (r < n) return RANK_NAMES[r];
  return EXTENSIONS[Math.floor(r / n) - 1].replace('%s', RANK_NAMES[r % n]);
}

/**
 * Which icons to draw from the rank symbol strip (Rank.png: 24 base symbols,
 * then 5 extension stars). Extended ranks show the base symbol plus a star.
 */
export function rankSymbols(rank: number): { base: number; extension?: number } {
  const n = RANK_NAMES.length;
  const r = Math.max(0, Math.min(MAX_RANK, rank));
  if (r < n) return { base: r };
  return { base: r % n, extension: n + Math.floor(r / n) - 1 };
}

/** How far a clonk is towards its next rank, 0..1. */
export function rankProgress(exp: number): number {
  const r = rankForExperience(exp);
  if (r >= MAX_RANK) return 1;
  const lo = experienceForRank(r);
  const hi = experienceForRank(r + 1);
  return (exp - lo) / (hi - lo);
}
