import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  getEngineInfo,
  rollDicePair,
  rollSixSidedDie,
  type RandomSource,
} from '../src/index.js';

describe('Game Engine - Pure Dice Mechanics', () => {
  it('returns engine metadata', () => {
    const info = getEngineInfo();
    expect(info.milestone).toBe(1);
    expect(info.name).toContain('Charchokkha');
  });

  describe('Deterministic RNG injection', () => {
    it('produces predictable die values with injected sequence', () => {
      const sequence = [1, 2, 3, 4, 5, 6];
      let index = 0;
      const deterministicRng: RandomSource = () => sequence[index++];

      for (let expected = 1; expected <= 6; expected++) {
        expect(rollSixSidedDie(deterministicRng)).toBe(expected);
      }
    });

    it('calculates dice pairs and identifies doubles deterministically', () => {
      // Double 4s
      const doubleRng: RandomSource = () => 4;
      const doubleResult = rollDicePair(doubleRng);
      expect(doubleResult).toEqual({
        die1: 4,
        die2: 4,
        total: 8,
        isDouble: true,
      });

      // 3 and 5 (non-double)
      const nonDoubleSequence = [3, 5];
      let idx = 0;
      const nonDoubleRng: RandomSource = () => nonDoubleSequence[idx++];
      const nonDoubleResult = rollDicePair(nonDoubleRng);
      expect(nonDoubleResult).toEqual({
        die1: 3,
        die2: 5,
        total: 8,
        isDouble: false,
      });
    });
  });

  describe('Six-sided die range assertion', () => {
    it('asserts every roll using default RNG is an integer between 1 and 6 inclusive', () => {
      const rolls: number[] = [];
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const value = rollSixSidedDie();
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(6);
        rolls.push(value);
      }

      // Over 1000 rolls, all values 1 through 6 should appear
      const uniqueValues = new Set(rolls);
      expect(uniqueValues.size).toBe(6);
      for (let side = 1; side <= 6; side++) {
        expect(uniqueValues.has(side)).toBe(true);
      }
    });

    it('asserts every roll using Node.js crypto.randomInt(1, 7) is an integer between 1 and 6 inclusive', () => {
      const cryptoRng: RandomSource = (min, maxExclusive) => randomInt(min, maxExclusive);
      const rolls: number[] = [];
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const value = rollSixSidedDie(cryptoRng);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(6);
        rolls.push(value);
      }

      const uniqueValues = new Set(rolls);
      expect(uniqueValues.size).toBe(6);
      for (let side = 1; side <= 6; side++) {
        expect(uniqueValues.has(side)).toBe(true);
      }
    });
  });

  describe('Illegal/Invalid outputs protection', () => {
    it('throws RangeError if RNG produces a value lower than 1', () => {
      const invalidRng: RandomSource = () => 0;
      expect(() => rollSixSidedDie(invalidRng)).toThrow(RangeError);
    });

    it('throws RangeError if RNG produces a value greater than 6', () => {
      const invalidRng: RandomSource = () => 7;
      expect(() => rollSixSidedDie(invalidRng)).toThrow(RangeError);
    });

    it('throws RangeError if RNG produces a non-integer float', () => {
      const invalidRng: RandomSource = () => 3.5;
      expect(() => rollSixSidedDie(invalidRng)).toThrow(RangeError);
    });
  });
});
