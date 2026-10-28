import { describe, expect, it } from 'vitest';
import {
  calculatePlayerNetWorth,
  calculateStandings,
  createInitialGameState,
  processAcceptTrade,
  processAuctionPass,
  processBuildHouse,
  processBuyProperty,
  processCreateTrade,
  processDeclineProperty,
  processDeclareBankruptcy,
  processRollDice,
} from '../src/index.js';

describe('Player Net Worth and Standings Engine Unit Tests', () => {
  it('calculates net worth accurately according to Monopoly rules', () => {
    const state = createInitialGameState(['p1', 'p2']);

    // Initial state: starting cash 1500
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(1500);

    // Give p1 property #1 (Salvador, price: 60, houseCost: 50)
    state.properties[1] = { ownerId: 'p1', houses: 0, isMortgaged: false };
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(1500 + 60);

    // Mortgage property #1 -> 50% price (30)
    state.properties[1].isMortgaged = true;
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(1500 + 30);

    // Unmortgage and add 2 houses (2 * 50 = 100)
    state.properties[1].isMortgaged = false;
    state.properties[1].houses = 2;
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(1500 + 60 + 100);

    // Add hotel (5 houses equivalent -> 5 * 50 = 250)
    state.properties[1].houses = 5;
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(1500 + 60 + 250);

    // Bankrupt player has net worth 0
    state.players['p1'].isBankrupt = true;
    expect(calculatePlayerNetWorth(state, 'p1')).toBe(0);
  });

  it('determines competitive tournament standings with winner, active players, and reverse elimination bankruptcies', () => {
    const state = createInitialGameState(['p1', 'p2', 'p3', 'p4']);
    // Setup cash & properties:
    // p1: Winner (cash 2000)
    state.players['p1'].cash = 2000;
    state.winnerId = 'p1';

    // p2: Active, net worth 1800 (cash 1400 + property #39 New York price 400)
    state.players['p2'].cash = 1400;
    state.properties[39] = { ownerId: 'p2', houses: 0, isMortgaged: false };

    // p3: Bankrupt second (eliminationOrder index 1)
    state.players['p3'].cash = 0;
    state.players['p3'].isBankrupt = true;

    // p4: Bankrupt first (eliminationOrder index 0)
    state.players['p4'].cash = 0;
    state.players['p4'].isBankrupt = true;

    state.eliminationOrder = ['p4', 'p3'];

    const standings = calculateStandings(state, [
      { id: 'p1', nickname: 'Alice', avatar: '👑' },
      { id: 'p2', nickname: 'Bob', avatar: '🎩' },
      { id: 'p3', nickname: 'Charlie', avatar: '🐱' },
      { id: 'p4', nickname: 'Diana', avatar: '🚀' },
    ]);

    expect(standings).toHaveLength(4);

    // 1st: Alice (Winner)
    expect(standings[0].playerId).toBe('p1');
    expect(standings[0].rank).toBe(1);
    expect(standings[0].nickname).toBe('Alice');
    expect(standings[0].netWorth).toBe(2000);

    // 2nd: Bob (Active runner up)
    expect(standings[1].playerId).toBe('p2');
    expect(standings[1].rank).toBe(2);
    expect(standings[1].nickname).toBe('Bob');
    expect(standings[1].netWorth).toBe(1800);
    expect(standings[1].properties).toEqual([39]);
    expect(standings[1].propertyCount).toBe(1);

    // 3rd: Charlie (Bankrupt 2nd, later than Diana -> 3rd place)
    expect(standings[2].playerId).toBe('p3');
    expect(standings[2].rank).toBe(3);
    expect(standings[2].isBankrupt).toBe(true);

    // 4th: Diana (Bankrupt 1st, earliest eliminated -> 4th place)
    expect(standings[3].playerId).toBe('p4');
    expect(standings[3].rank).toBe(4);
    expect(standings[3].isBankrupt).toBe(true);
  });

  it('tracks stats authoritatively across purchases, rent, auctions, trades, and houses', () => {
    let state = createInitialGameState(['p1', 'p2']);

    // p1 lands on property #1 (Salvador, price 60)
    state.players['p1'].position = 1;
    state.turnPhase = 'action_pending';
    const buyRes = processBuyProperty(state, 'p1');
    expect(buyRes.success).toBe(true);
    state = buyRes.state;
    expect(state.players['p1'].stats?.propertiesBought).toBe(1);

    // p2 rolls and lands on Salvador (rent is 4)
    state.activePlayerId = 'p2';
    state.turnPhase = 'need_roll';
    state.players['p2'].position = 0;
    // roll [1, 0] doesn't exist, roll injected [1, 0]? Let's roll [1, 1] -> total 2, or move to position 1
    // Salvador is space 1. Let's move p2 from 39 to 1 with roll [1, 1] from 39: 39 + 2 = 41 % 40 = 1
    state.players['p2'].position = 39;
    const rollRes = processRollDice(state, 'p2', [1, 1]);
    expect(rollRes.success).toBe(true);
    state = rollRes.state;
    expect(state.players['p2'].position).toBe(1);
    expect(state.players['p2'].stats?.rentPaid).toBe(4);
    expect(state.players['p1'].stats?.rentReceived).toBe(4);

    // Auction victory: p2 declines space 3 (Rio)
    state.turnPhase = 'action_pending';
    state.players['p2'].position = 3;
    const declineRes = processDeclineProperty(state, 'p2');
    expect(declineRes.success).toBe(true);
    state = declineRes.state;
    expect(state.auction).not.toBeNull();

    // p2 wins auction by bidding and p1 passes
    state.auction!.currentBid = 50;
    state.auction!.highBidderId = 'p2';
    const passRes = processAuctionPass(state, 'p1');
    expect(passRes.success).toBe(true);
    state = passRes.state;
    expect(state.players['p2'].stats?.auctionsWon).toBe(1);
    expect(state.players['p2'].stats?.propertiesBought).toBe(1);

    // Trade between p1 and p2: p1 gives property 1 to p2, p2 gives property 3?
    // Wait, let's make p1 give property 1 to p2 in exchange for cash so p2 owns both 1 and 3!
    const tradeRes = processCreateTrade(state, 'p1', {
      receiverId: 'p2',
      offeredCash: 0,
      offeredPropertyIds: [1],
      requestedCash: 50,
      requestedPropertyIds: [],
    });
    expect(tradeRes.success).toBe(true);
    state = tradeRes.state;
    const acceptRes = processAcceptTrade(state, 'p2');
    expect(acceptRes.success).toBe(true);
    state = acceptRes.state;
    expect(state.players['p1'].stats?.tradesCompleted).toBe(1);
    expect(state.players['p2'].stats?.tradesCompleted).toBe(1);

    // p2 now owns both #1 and #3 (brown monopoly!)
    expect(state.properties[1].ownerId).toBe('p2');
    expect(state.properties[3].ownerId).toBe('p2');
    const buildRes = processBuildHouse(state, 'p2', 1);
    expect(buildRes.success).toBe(true);
    state = buildRes.state;
    expect(state.players['p2'].stats?.buildingsBuilt).toBe(1);

    // p1 goes bankrupt
    const bankRes = processDeclareBankruptcy(state, 'p1');
    expect(bankRes.success).toBe(true);
    state = bankRes.state;
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('p2');
    expect(state.eliminationOrder).toEqual(['p1']);
    expect(state.players['p1'].stats?.bankruptcyOrder).toBe(1);
  });
});
