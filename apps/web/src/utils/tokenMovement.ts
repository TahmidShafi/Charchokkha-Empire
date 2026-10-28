/**
 * Calculates the forward tile-by-tile path between two board spaces.
 * 
 * In Charchokkha Empire, movement proceeds clockwise from space 0 to 39,
 * wrapping past START (space 0). Normal dice rolls result in 2 to 12 steps.
 * Distances greater than 12 (such as Go to Prison 30 -> 10, or Advance to START)
 * are treated as direct card or rule transfers.
 */
export function calculateStepPath(fromPos: number, toPos: number): number[] {
  const normalizedFrom = ((fromPos % 40) + 40) % 40;
  const normalizedTo = ((toPos % 40) + 40) % 40;

  if (normalizedFrom === normalizedTo) {
    return [];
  }

  const forwardDistance = (normalizedTo - normalizedFrom + 40) % 40;

  // Direct transfers (Go to Prison 30 -> 10, or long card warp) jump directly
  if (forwardDistance > 12) {
    return [normalizedTo];
  }

  const path: number[] = [];
  let curr = normalizedFrom;
  for (let i = 0; i < forwardDistance; i++) {
    curr = (curr + 1) % 40;
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
