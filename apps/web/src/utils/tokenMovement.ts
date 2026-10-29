import { TOTAL_SPACES } from '@charchokkha/game-engine';

/**
 * Calculates the forward tile-by-tile path between two board spaces.
 * 
 * In Charchokkha Empire, movement proceeds clockwise from space 0 to TOTAL_SPACES - 1,
 * wrapping past START (space 0). Normal dice rolls result in 2 to 12 steps.
 * Distances greater than 12 (such as Go to Rehab or long card warps)
 * are treated as direct card or rule transfers.
 */
export function calculateStepPath(fromPos: number, toPos: number, totalSpaces = TOTAL_SPACES): number[] {
  const normalizedFrom = ((fromPos % totalSpaces) + totalSpaces) % totalSpaces;
  const normalizedTo = ((toPos % totalSpaces) + totalSpaces) % totalSpaces;

  if (normalizedFrom === normalizedTo) {
    return [];
  }

  const forwardDistance = (normalizedTo - normalizedFrom + totalSpaces) % totalSpaces;

  // Direct transfers (Go to Rehab 32 -> 12, or long card warp) jump directly
  if (forwardDistance > 12) {
    return [normalizedTo];
  }

  const path: number[] = [];
  let curr = normalizedFrom;
  for (let i = 0; i < forwardDistance; i++) {
    curr = (curr + 1) % totalSpaces;
    path.push(curr);
  }

  return path;
}

/**
 * Checks whether the user has requested reduced motion.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
