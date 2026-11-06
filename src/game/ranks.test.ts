import { describe, expect, it } from 'vitest';
import { experienceForRank, MAX_RANK, rankForExperience, rankName, rankProgress, rankSymbols } from './ranks';

describe('ranks', () => {
  it('needs rank^1.5 × 1000 experience, like the original', () => {
    expect(experienceForRank(0)).toBe(0);
    expect(experienceForRank(1)).toBe(1000);
    expect(experienceForRank(2)).toBe(2828);
    expect(experienceForRank(4)).toBe(8000);
  });

  it('finds the rank for an amount of experience', () => {
    expect(rankForExperience(0)).toBe(0);
    expect(rankForExperience(999)).toBe(0);
    expect(rankForExperience(1000)).toBe(1);
    expect(rankForExperience(2827)).toBe(1);
    expect(rankForExperience(2828)).toBe(2);
    expect(rankForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_RANK);
  });

  it('names ranks, with extensions after Premier', () => {
    expect(rankName(0)).toBe('Clonk');
    expect(rankName(1)).toBe('Ensign');
    expect(rankName(23)).toBe('Premier');
    expect(rankName(24)).toBe('Clonk First Class');
    expect(rankName(25)).toBe('Ensign First Class');
    expect(rankName(49)).toBe('Ensign Second Degree');
    expect(rankName(MAX_RANK)).toBe('Exalted Premier');
    expect(rankName(MAX_RANK + 10)).toBe('Exalted Premier');
  });

  it('picks the rank symbol, plus a star for extended ranks', () => {
    expect(rankSymbols(3)).toEqual({ base: 3 });
    expect(rankSymbols(25)).toEqual({ base: 1, extension: 24 });
    expect(rankSymbols(MAX_RANK)).toEqual({ base: 23, extension: 28 });
  });

  it('measures progress towards the next rank', () => {
    expect(rankProgress(0)).toBe(0);
    expect(rankProgress(500)).toBe(0.5);
    expect(rankProgress(1000)).toBe(0);
  });
});
