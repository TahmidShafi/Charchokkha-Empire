import { describe, expect, it, beforeEach } from 'vitest';
import { calculateStepPath, prefersReducedMotion } from '../src/utils/tokenMovement.js';
import { soundManager } from '../src/audio/soundManager.js';

describe('Token Movement Step Path Calculator', () => {
  it('returns empty path when from and to positions are identical', () => {
    expect(calculateStepPath(0, 0)).toEqual([]);
    expect(calculateStepPath(15, 15)).toEqual([]);
    expect(calculateStepPath(39, 39)).toEqual([]);
  });

  it('calculates sequential clockwise path for normal forward rolls', () => {
    // Player rolls 4 from space 0 (START)
    expect(calculateStepPath(0, 4)).toEqual([1, 2, 3, 4]);

    // Player rolls 7 from space 5 (Shongit Airport)
    expect(calculateStepPath(5, 12)).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });

  it('correctly wraps around past START (space 0)', () => {
    // Player on space 38 moves 4 spaces past START to space 2
    expect(calculateStepPath(38, 2)).toEqual([39, 0, 1, 2]);

    // Player on space 39 rolls 1 to land directly on START
    expect(calculateStepPath(39, 0)).toEqual([0]);
  });

  it('handles corner traversal correctly', () => {
    // Move across space 10 (In Prison)
    expect(calculateStepPath(8, 11)).toEqual([9, 10, 11]);

    // Move across space 20 (Vacation)
    expect(calculateStepPath(18, 22)).toEqual([19, 20, 21, 22]);

    // Move across space 30 (Go to Prison tile entry)
    expect(calculateStepPath(28, 31)).toEqual([29, 30, 31]);
  });

  it('jumps directly for direct rule transfers like Go to Prison (30 -> 10)', () => {
    // When arrested, player transfers from 30 directly to 10 (forward distance = 20 > 12)
    const arrestPath = calculateStepPath(30, 10);
    expect(arrestPath).toEqual([10]);
  });

  it('jumps directly for card warps spanning greater than 12 spaces', () => {
    // Advance to START from space 25 (forward distance = 15 > 12)
    const cardWarp = calculateStepPath(25, 0);
    expect(cardWarp).toEqual([0]);
  });
});

describe('Web Audio Synthesizer and Mute Manager', () => {
  beforeEach(() => {
    soundManager.setMuted(false);
  });

  it('toggles and persists mute state', () => {
    expect(soundManager.isMuted()).toBe(false);

    const mutedState = soundManager.toggleMuted();
    expect(mutedState).toBe(true);
    expect(soundManager.isMuted()).toBe(true);

    const unmutedState = soundManager.toggleMuted();
    expect(unmutedState).toBe(false);
    expect(soundManager.isMuted()).toBe(false);
  });

  it('handles sound playback without throwing when AudioContext is unavailable or in Node environment', () => {
    expect(() => soundManager.playDiceRoll()).not.toThrow();
    expect(() => soundManager.playStepHop()).not.toThrow();
    expect(() => soundManager.playBuyProperty()).not.toThrow();
    expect(() => soundManager.playRentPayment()).not.toThrow();
    expect(() => soundManager.playAuctionGavel()).not.toThrow();
    expect(() => soundManager.playGoToPrison()).not.toThrow();
    expect(() => soundManager.playTurnPing()).not.toThrow();
    expect(() => soundManager.playVictory()).not.toThrow();
  });

  it('respects muted state and bypasses audio generation', () => {
    soundManager.setMuted(true);
    expect(soundManager.isMuted()).toBe(true);

    // Audio methods exit early when muted
    soundManager.playDiceRoll();
    soundManager.playBuyProperty();
    expect(soundManager.isMuted()).toBe(true);
  });
});

describe('Accessibility & Reduced Motion Preferences', () => {
  it('safely queries prefersReducedMotion without throwing in any environment', () => {
    const prefers = prefersReducedMotion();
    expect(typeof prefers).toBe('boolean');
  });
});
