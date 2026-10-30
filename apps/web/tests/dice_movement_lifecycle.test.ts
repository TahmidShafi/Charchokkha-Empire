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
    const fromPos = 44;
    const rolledTotal = 8;
    const toPos = (fromPos + rolledTotal) % TOTAL_SPACES; // (44 + 8) % 48 = 4

    const path = calculateStepPath(fromPos, toPos);
    expect(path).toHaveLength(8);
    expect(path).toEqual([45, 46, 47, 0, 1, 2, 3, 4]);
    expect(path[path.length - 1]).toBe(4);
  });

  it('handles direct jail arrest transfer without multi-tile traversal', () => {
    // Go to Rehab: Space 36 -> Space 12
    const arrestPath = calculateStepPath(36, 12);
    expect(arrestPath).toEqual([12]);
    expect(arrestPath).toHaveLength(1);
  });

  it('determines the correct landing space details once token finishes movement', () => {
    const destination = 3; // Space 3: Chandgaon
    const space = getBoardSpace(destination);

    expect(space).toBeDefined();
    expect(space.id).toBe(3);
    expect(space.name).toBe('Chandgaon');
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

  it('verifies 3D tactile dice face orientation transforms in CSS', async () => {
    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const cssPath = pathMod.resolve(__dirname, '../src/index.css');
    const css = fs.readFileSync(cssPath, 'utf-8');

    // Each value 1-6 must correctly orient that face to the TOP
    expect(css).toMatch(/\.tactile-dice-cube\.val-1\s*\{[^}]*rotateX\(0deg\)/);
    expect(css).toMatch(/\.tactile-dice-cube\.val-2\s*\{[^}]*rotateX\(90deg\)/);
    expect(css).toMatch(/\.tactile-dice-cube\.val-3\s*\{[^}]*rotateZ\(-90deg\)/);
    expect(css).toMatch(/\.tactile-dice-cube\.val-4\s*\{[^}]*rotateZ\(90deg\)/);
    expect(css).toMatch(/\.tactile-dice-cube\.val-5\s*\{[^}]*rotateX\(-90deg\)/);
    expect(css).toMatch(/\.tactile-dice-cube\.val-6\s*\{[^}]*rotateX\(180deg\)/);
  });
});
