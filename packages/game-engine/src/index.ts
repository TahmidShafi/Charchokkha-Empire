/**
 * Injectable random number generator function.
 * Generates an integer in the range [min, maxExclusive), matching Node's crypto.randomInt(min, maxExclusive).
 */
export type RandomSource = (min: number, maxExclusive: number) => number;

/**
 * Default pure TypeScript fallback random source for browser/preview contexts.
 */
export const defaultRandomSource: RandomSource = (min: number, maxExclusive: number): number => {
  return Math.floor(Math.random() * (maxExclusive - min)) + min;
};

/**
 * Rolls a single six-sided die producing an integer from 1 to 6.
 * Accepts an injectable RandomSource for deterministic testing.
 */
export function rollSixSidedDie(rng: RandomSource = defaultRandomSource): number {
  const result = rng(1, 7);
  if (!Number.isInteger(result) || result < 1 || result > 6) {
    throw new RangeError(`Die roll returned invalid value: ${result}. Expected an integer from 1 through 6.`);
  }
  return result;
}

/**
 * Result of rolling a standard pair of six-sided dice.
 */
export interface DiceRollResult {
  die1: number;
  die2: number;
  total: number;
  isDouble: boolean;
}

/**
 * Rolls a pair of six-sided dice using the given random source.
 */
export function rollDicePair(rng: RandomSource = defaultRandomSource): DiceRollResult {
  const die1 = rollSixSidedDie(rng);
  const die2 = rollSixSidedDie(rng);
  return {
    die1,
    die2,
    total: die1 + die2,
    isDouble: die1 === die2,
  };
}

/**
 * Minimal engine metadata.
 */
export interface EngineInfo {
  name: string;
  version: string;
  milestone: number;
}

export function getEngineInfo(): EngineInfo {
  return {
    name: 'Charchokkha Empire Game Engine',
    version: '0.3.0',
    milestone: 1,
  };
}

// Re-export Board, Cards, and Engine logic
export * from './board.js';
export * from './cards.js';
export * from './engine.js';

