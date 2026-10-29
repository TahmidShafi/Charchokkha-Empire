import { describe, expect, it } from 'vitest';
import { formatEventMessage } from '../src/components/Board.js';

describe('Courtyard Event Notification Formatter', () => {
  it('formats rent payment messages concisely with property and amount', () => {
    const rawMsg1 = 'Player landed on Saint Martin. Owned by p2. Paid $50 rent.';
    expect(formatEventMessage(rawMsg1)).toBe('Saint Martin · Rent paid $50');

    const rawMsg2 = 'Paid $50 to Bob for rent on Saint Martin';
    expect(formatEventMessage(rawMsg2)).toBe('Saint Martin · Rent paid $50');
  });

  it('formats tax payments concisely with category and amount', () => {
    const taxMsg1 = 'Player landed on Earnings Tax. Paid $100 in tax.';
    expect(formatEventMessage(taxMsg1)).toBe('Earnings Tax · Paid $100');

    const taxMsg2 = 'Paid $75 for Premium Tax';
    expect(formatEventMessage(taxMsg2)).toBe('Premium Tax · Paid $75');
  });

  it('formats property purchases into concise label', () => {
    const buyMsg = 'Purchased Chattogram for $200. Balance: $1150.';
    expect(formatEventMessage(buyMsg)).toBe('Chattogram · Bought for $200');
  });

  it('formats rehab and prison events cleanly', () => {
    const arrestMsg = 'Player landed on Go to Rehab. Arrested! Sent to In Prison.';
    expect(formatEventMessage(arrestMsg)).toBe('Rehab Center · Arrested');

    const doublesFreeMsg = 'Rolled double 4s! Freed from prison.';
    expect(formatEventMessage(doublesFreeMsg)).toBe('Freed from Prison (Doubles!)');

    const fineMsg = '3rd attempt failed. Paid $50 fine to leave prison.';
    expect(formatEventMessage(fineMsg)).toBe('Paid $50 Fine · Freed');
  });

  it('formats vacation pot collection', () => {
    const potMsg = 'Collected $150 from Vacation cash pot!';
    expect(formatEventMessage(potMsg)).toBe('Vacation Pot · +$150');
  });

  it('formats auction resolution', () => {
    const auctionMsg = 'Auction for Saint Martin ended! Bob won with $350';
    expect(formatEventMessage(auctionMsg)).toBe('Auction: Saint Martin · Bob ($350)');
  });

  it('formats trade completion', () => {
    const tradeMsg = 'Trade completed between Alice and Bob';
    expect(formatEventMessage(tradeMsg)).toBe('Trade Completed ✓');
  });

  it('formats START salary collection', () => {
    const salaryMsg = 'Passed Go! Collected $200 salary';
    expect(formatEventMessage(salaryMsg)).toBe('START · +$200');
  });

  it('handles empty or unrecognized fallback safely', () => {
    expect(formatEventMessage('')).toBe('');
    expect(formatEventMessage('Game started. Player 1 turn to roll.')).toBe('Game started. Player 1 turn to roll.');
  });
});

