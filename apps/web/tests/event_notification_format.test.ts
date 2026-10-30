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

  it('maps player guest IDs and bot IDs to clean player nicknames in ended turn events', () => {
    const mockPlayers = [
      { id: 'guest_b4e96b23772adefb', nickname: 'Alice', color: '#ff0000', isBot: false, isHost: true, connected: true },
      { id: 'guest_b38a69f61db74be2', nickname: 'Bob', color: '#00ff00', isBot: false, isHost: false, connected: true },
      { id: 'bot_5e34e85b', nickname: 'RoboBot', color: '#0000ff', isBot: true, isHost: false, connected: true },
    ] as any;

    const rawMsg1 = 'Player guest_b4e96b23772adefb ended turn. Active player is now guest_b38a69f61db74be2';
    expect(formatEventMessage(rawMsg1, mockPlayers)).toBe('Alice · Ended turn');

    const rawMsg2 = 'Player bot_5e34e85b ended turn. Active player is now guest_b4e96b23772adefb';
    expect(formatEventMessage(rawMsg2, mockPlayers)).toBe('RoboBot · Ended turn');
  });

  it('sanitizes unmapped guest and bot hex hashes gracefully', () => {
    const rawGuest = 'Player guest_deadbeef1234 ended turn. Active player is now guest_cafebabe5678';
    expect(formatEventMessage(rawGuest)).toBe('Player · Ended turn');

    const rawBot = 'Player bot_99887766 ended turn.';
    expect(formatEventMessage(rawBot)).toBe('Bot · Ended turn');
  });

  it('formats dice roll telemetry with player actor prefix', () => {
    const actor = { id: 'guest_123', nickname: 'Alice', color: '#ff0000', isBot: false, isHost: true, connected: true } as any;
    const rawRoll = 'Rolled 6 (3 + 3) and landed on Mithagoli.';
    expect(formatEventMessage(rawRoll, [actor], actor)).toBe('Alice · Rolled 6 (3 + 3) · landed on Mithagoli');

    // Without actor nickname, fallback to clean roll string
    expect(formatEventMessage(rawRoll)).toBe('Rolled 6 (3 + 3) · landed on Mithagoli');
  });

  it('formats auction bids, passes and bankruptcies cleanly', () => {
    expect(formatEventMessage('Alice bid $300')).toBe('Alice · Bid $300');
    expect(formatEventMessage('Bob passed in auction')).toBe('Bob · Passed auction');
    expect(formatEventMessage('Charlie declared bankruptcy')).toBe('Charlie · Declared bankruptcy');
  });

  it('handles empty or unrecognized fallback safely', () => {
    expect(formatEventMessage('')).toBe('');
    expect(formatEventMessage('Game started. Player 1 turn to roll.')).toBe('Game started. Player 1 turn to roll.');
  });
});

