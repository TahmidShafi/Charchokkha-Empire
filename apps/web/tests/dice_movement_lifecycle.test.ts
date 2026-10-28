import { describe, expect, it } from 'vitest';
import { calculateStepPath, prefersReducedMotion } from '../src/utils/tokenMovement.js';
import { getBoardSpace, TOTAL_SPACES } from '@charchokkha/game-engine';

describe('Dice Roll and Token Movement Lifecycle Suite', () => {
  it('calculates full stepwise trajectory for normal dice roll', () => {
    const fromPos = 0;
    const rolledTotal = 7;
    const toPos = (fromPos + rolledTotal) % TOTAL_SPACES;

    const path = calculateStepPath(fromPos, toPos);
    expect(path).toHaveLength(7);
    expect(path).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(path[path.length - 1]).toBe(toPos);
  });

  it('calculates wrapped trajectory across START (space 0)', () => {
    const fromPos = 36;
    const rolledTotal = 8;
    const toPos = (fromPos + rolledTotal) % TOTAL_SPACES; // (36 + 8) % 40 = 4

    const path = calculateStepPath(fromPos, toPos);
    expect(path).toHaveLength(8);
    expect(path).toEqual([37, 38, 39, 0, 1, 2, 3, 4]);
    expect(path[path.length - 1]).toBe(4);
  });

  it('handles direct jail arrest transfer without multi-tile traversal', () => {
    // Go to Prison: Space 30 -> Space 10
    const arrestPath = calculateStepPath(30, 10);
    expect(arrestPath).toEqual([10]);
    expect(arrestPath).toHaveLength(1);
  });

  it('determines the correct landing space details once token finishes movement', () => {
    const destination = 3; // Space 3: Rio
    const space = getBoardSpace(destination);

    expect(space).toBeDefined();
    expect(space.id).toBe(3);
    expect(space.name).toBe('Rio');
    expect(space.type).toBe('property');
    expect(space.price).toBe(60);
  });

  it('ensures zero-step path when player has not moved', () => {
    const path = calculateStepPath(15, 15);
    expect(path).toEqual([]);
  });

  it('handles maximum normal double dice roll of 12 steps', () => {
    const path = calculateStepPath(0, 12);
    expect(path).toHaveLength(12);
    expect(path[0]).toBe(1);
    expect(path[11]).toBe(12);
  });

  it('queries prefersReducedMotion without throwing', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean');
  });
});
