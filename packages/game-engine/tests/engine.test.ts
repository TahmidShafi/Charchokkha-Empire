import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BOARD_SPACES,
  calculateRentAmount,
  createInitialGameState,
  getBoardSpace,
  hasColorMonopoly,
  processAcceptTrade,
  processAuctionBid,
  processAuctionPass,
  processBuildHouse,
  processBuyProperty,
  processCreateTrade,
  processDeclineProperty,
  processDeclareBankruptcy,
  processEndTurn,
  processMortgageProperty,
  processPayPrisonFine,
  processRejectTrade,
  processRollDice,
  processSellHouse,
  processUnmortgageProperty,
} from '../src/index.js';

describe('Authoritative Game Engine — Milestone 4 Suite', () => {
  const p1 = 'player_1';
  const p2 = 'player_2';
  const p3 = 'player_3';

  it('verifies the board has 48 canonical spaces with unique IDs 0 to 47 without country flags', () => {
    expect(CANONICAL_BOARD_SPACES).toHaveLength(48);
    CANONICAL_BOARD_SPACES.forEach((space, index) => {
      expect(space.id).toBe(index);
      expect(getBoardSpace(index).id).toBe(index);
      expect((space as any).flag).toBeUndefined();
    });
  });

  describe('Game Initialization & Turn Order', () => {
    it('requires at least 2 players to start a game', () => {
      expect(() => createInitialGameState([p1])).toThrow(
        /minimum of 2 players is required/i
      );
    });

    it('initializes game state with defined turn order, starting cash, and zero position', () => {
      const state = createInitialGameState([p1, p2, p3], 1500, 200);

      expect(state.phase).toBe('in_progress');
      expect(state.turnOrder).toEqual([p1, p2, p3]);
      expect(state.currentTurnIndex).toBe(0);
      expect(state.activePlayerId).toBe(p1);
      expect(state.turnPhase).toBe('need_roll');
      expect(state.lastDiceRoll).toBeNull();
      expect(state.properties).toEqual({});
      expect(state.startingSalary).toBe(200);

      [p1, p2, p3].forEach((id) => {
        expect(state.players[id]).toEqual({
          id,
          position: 0,
          cash: 1500,
          isBankrupt: false,
          inPrison: false,
          prisonTurns: 0,
        });
      });
    });
  });

  describe('Dice & Movement', () => {
    it('moves active player normally according to injected dice', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      const res = processRollDice(state, p1, [3, 4]); // 7

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(7); // Haifa
      expect(res.state.lastDiceRoll).toEqual({
        die1: 3,
        die2: 4,
        total: 7,
        isDouble: false,
      });
      // Haifa is unowned property, price 110
      expect(res.state.turnPhase).toBe('action_pending');
      expect(res.state.players[p1].cash).toBe(1500); // No rent, not bought yet
    });

    it('rejects attempt to roll out of turn', () => {
      const state = createInitialGameState([p1, p2]);
      const res = processRollDice(state, p2, [2, 3]);

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('NOT_YOUR_TURN');
      expect(res.state.players[p2].position).toBe(0);
    });

    it('rejects duplicate roll attempts on the same turn', () => {
      const state = createInitialGameState([p1, p2]);
      const res1 = processRollDice(state, p1, [1, 2]); // total 3
      expect(res1.success).toBe(true);

      const res2 = processRollDice(res1.state, p1, [2, 2]);
      expect(res2.success).toBe(false);
      expect(res2.error?.code).toBe('ALREADY_ROLLED');
    });

    it('awards salary ($200) when passing the starting space across the perimeter', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Place p1 at space 45 (Lake Bilash)
      state.players[p1].position = 45;

      // Roll 4 -> 45 + 4 = 49 -> newPos 1 (Rahattarpool), passed START (49 >= 48)
      const res = processRollDice(state, p1, [2, 2]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(1);
      expect(res.state.players[p1].cash).toBe(1700); // 1500 + 200
    });

    it('awards salary ($200) when landing exactly on START (space 0)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].position = 42; // Gudaraghat Airport

      // Roll 6 -> 42 + 6 = 48 -> newPos 0 (START)
      const res = processRollDice(state, p1, [3, 3]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(0);
      expect(res.state.players[p1].cash).toBe(1700);
    });

    it('sends player to In Prison (space 12) when landing on Go to Prison (space 36)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].position = 34;

      // Roll 2 -> 34 + 2 = 36 (Go to Rehab)
      const res = processRollDice(state, p1, [1, 1]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(12); // In Prison
      expect(res.state.players[p1].inPrison).toBe(true);
      expect(res.state.turnPhase).toBe('turn_ended');
    });

    it('deducts tax when landing on tax spaces without going negative', () => {
      const state = createInitialGameState([p1, p2], 50, 200); // Only $50 cash
      state.players[p1].position = 0;

      // Roll 4 -> Earnings Tax (space 4, tax $100)
      const res = processRollDice(state, p1, [2, 2]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(4);
      expect(res.state.players[p1].cash).toBe(0); // Deducted 50, balance does not go negative
      expect(res.state.turnPhase).toBe('turn_ended');
    });
  });

  describe('Property Purchasing & Rent Calculations', () => {
    it('allows active player to purchase an unowned property when having sufficient funds', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Roll 3 (1+2) to Rio (space 3, price 60)
      const rollRes = processRollDice(state, p1, [1, 2]);
      expect(rollRes.state.turnPhase).toBe('action_pending');

      const buyRes = processBuyProperty(rollRes.state, p1);
      expect(buyRes.success).toBe(true);
      expect(buyRes.state.players[p1].cash).toBe(1440); // 1500 - 60
      expect(buyRes.state.properties[3]).toEqual({ ownerId: p1, houses: 0, isMortgaged: false });
      expect(buyRes.state.turnPhase).toBe('turn_ended');
    });

    it('rejects property purchase when player has insufficient funds', () => {
      const state = createInitialGameState([p1, p2], 50, 200); // Only $50, Rio costs $60
      const rollRes = processRollDice(state, p1, [1, 2]);

      const buyRes = processBuyProperty(rollRes.state, p1);
      expect(buyRes.success).toBe(false);
      expect(buyRes.error?.code).toBe('INSUFFICIENT_FUNDS');
      expect(buyRes.state.properties[3]).toBeUndefined();
      expect(buyRes.state.players[p1].cash).toBe(50);
    });

    it('collects unimproved base rent when landing on another player owned property', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Give p1 space 3 (Rio: price 60, base rent 4)
      state.properties[3] = { ownerId: p1, houses: 0, isMortgaged: false };

      // End p1's turn
      state.turnPhase = 'turn_ended';
      const endRes = processEndTurn(state, p1);
      expect(endRes.state.activePlayerId).toBe(p2);

      // p2 rolls 3 -> lands on space 3 (Rio)
      const rollRes = processRollDice(endRes.state, p2, [1, 2]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p2].position).toBe(3);
      expect(rollRes.state.players[p2].cash).toBe(1496); // 1500 - 4
      expect(rollRes.state.players[p1].cash).toBe(1504); // 1500 + 4
    });

    it('doubles base rent on unimproved properties when owner has full color monopoly', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Brown group is space 1 (Salvador, rent 2) and space 3 (Rio, rent 4)
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.properties[3] = { ownerId: p1, houses: 0, isMortgaged: false };

      expect(hasColorMonopoly('brown', p1, (id) => state.properties[id]?.ownerId)).toBe(true);

      // p2 rolls 3 -> lands on Rio (space 3). Base rent is 4, monopoly doubles to 8.
      state.activePlayerId = p2;
      state.currentTurnIndex = 1;
      const rollRes = processRollDice(state, p2, [1, 2]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p2].cash).toBe(1492); // 1500 - 8
      expect(rollRes.state.players[p1].cash).toBe(1508); // 1500 + 8
    });

    it('calculates tiered rent for houses (1-4) and hotel (5)', () => {
      // Space 3 (Rio) rent tiers: [4, 20, 60, 180, 320, 450]
      const rio = getBoardSpace(3);
      const getOwner = () => p1;

      // 1 house: tier index 1 = 20
      const rent1H = calculateRentAmount({
        space: rio,
        ownerId: p1,
        getPropertyOwner: getOwner,
        getHouses: () => 1,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rent1H).toBe(20);

      // Hotel (5 houses): tier index 5 = 450
      const rentHotel = calculateRentAmount({
        space: rio,
        ownerId: p1,
        getPropertyOwner: getOwner,
        getHouses: () => 5,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rentHotel).toBe(450);
    });

    it('scales airport rent according to count of airports owned (25, 50, 100, 200)', () => {
      // Airports: 6, 18, 29, 39
      const airportSpace = getBoardSpace(6);
      const ownedAirports: number[] = [6];

      const rent1 = calculateRentAmount({
        space: airportSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (ownedAirports.includes(id) ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rent1).toBe(25);

      ownedAirports.push(18);
      const rent2 = calculateRentAmount({
        space: airportSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (ownedAirports.includes(id) ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rent2).toBe(50);

      ownedAirports.push(30);
      const rent3 = calculateRentAmount({
        space: airportSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (ownedAirports.includes(id) ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rent3).toBe(100);

      ownedAirports.push(42);
      const rent4 = calculateRentAmount({
        space: airportSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (ownedAirports.includes(id) ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 7,
      });
      expect(rent4).toBe(200);
    });

    it('scales utility rent by 4x dice for 1 utility and 10x dice for 2 utilities', () => {
      // Utilities: 15 (Desi Fresh), 22 (Bhai Bhai), 33 (7 dayz)
      const utilSpace = getBoardSpace(15);

      // 1 utility with diceTotal 8 -> 8 * 4 = 32
      const rent1Util = calculateRentAmount({
        space: utilSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (id === 15 ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 8,
      });
      expect(rent1Util).toBe(32);

      // 2 utilities with diceTotal 8 -> 8 * 10 = 80
      const rent2Utils = calculateRentAmount({
        space: utilSpace,
        ownerId: p1,
        getPropertyOwner: (id) => (id === 15 || id === 33 ? p1 : undefined),
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 8,
      });
      expect(rent2Utils).toBe(80);
    });

    it('charges 0 rent if the property is mortgaged', () => {
      const rio = getBoardSpace(3);
      const rent = calculateRentAmount({
        space: rio,
        ownerId: p1,
        getPropertyOwner: () => p1,
        getHouses: () => 0,
        isMortgaged: () => true, // mortgaged!
        diceTotal: 7,
      });
      expect(rent).toBe(0);
    });

    it('charges 0 rent if owner is in prison when noRentInPrison rule is active', () => {
      const rio = getBoardSpace(3);
      const rent = calculateRentAmount({
        space: rio,
        ownerId: p1,
        getPropertyOwner: () => p1,
        getHouses: () => 0,
        isMortgaged: () => false,
        diceTotal: 7,
        noRentInPrisonRule: true,
        ownerInPrison: true,
      });
      expect(rent).toBe(0);
    });
  });

  describe('Prison Rules & Escape Mechanics', () => {
    it('allows paying $50 fine to get out of prison before rolling', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].inPrison = true;
      state.players[p1].position = 10;

      const fineRes = processPayPrisonFine(state, p1);
      expect(fineRes.success).toBe(true);
      expect(fineRes.state.players[p1].inPrison).toBe(false);
      expect(fineRes.state.players[p1].cash).toBe(1450); // 1500 - 50
      expect(fineRes.state.turnPhase).toBe('need_roll');
    });

    it('frees player from prison when rolling doubles', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].inPrison = true;
      state.players[p1].position = 10;

      // Roll double 3s (total 6) -> lands on 16 (Vienna)
      const rollRes = processRollDice(state, p1, [3, 3]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p1].inPrison).toBe(false);
      expect(rollRes.state.players[p1].position).toBe(16);
      expect(rollRes.state.players[p1].cash).toBe(1500); // No fine paid
    });

    it('keeps player in prison when rolling non-doubles on attempts 1 and 2', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].inPrison = true;
      state.players[p1].position = 10;

      // Attempt 1: non-doubles
      const roll1 = processRollDice(state, p1, [1, 2]);
      expect(roll1.success).toBe(true);
      expect(roll1.state.players[p1].inPrison).toBe(true);
      expect(roll1.state.players[p1].prisonTurns).toBe(1);
      expect(roll1.state.players[p1].position).toBe(10);
      expect(roll1.state.turnPhase).toBe('turn_ended');
    });

    it('forces player to pay $50 fine and leave prison on 3rd failed attempt', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].inPrison = true;
      state.players[p1].prisonTurns = 2; // Already failed twice
      state.players[p1].position = 10;

      // Attempt 3: non-doubles 1+3=4 -> lands on 14 (Athens)
      const roll3 = processRollDice(state, p1, [1, 3]);
      expect(roll3.success).toBe(true);
      expect(roll3.state.players[p1].inPrison).toBe(false);
      expect(roll3.state.players[p1].prisonTurns).toBe(0);
      expect(roll3.state.players[p1].cash).toBe(1450); // 1500 - 50 fine
      expect(roll3.state.players[p1].position).toBe(14);
    });
  });

  describe('Mortgages & Unmortgages', () => {
    it('allows mortgaging an unmortgaged property to receive 50% cash', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Give p1 space 1 (Salvador: price 60)
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };

      const mortRes = processMortgageProperty(state, p1, 1);
      expect(mortRes.success).toBe(true);
      expect(mortRes.state.players[p1].cash).toBe(1530); // 1500 + 30
      expect(mortRes.state.properties[1].isMortgaged).toBe(true);
    });

    it('rejects mortgaging if property has houses', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[1] = { ownerId: p1, houses: 1, isMortgaged: false };

      const mortRes = processMortgageProperty(state, p1, 1);
      expect(mortRes.success).toBe(false);
      expect(mortRes.error?.code).toBe('HAS_HOUSES');
    });

    it('allows unmortgaging by paying 50% principal + 10% interest (55%)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Salvador: price 60. 50% = 30. 10% interest = 3. Total = 33.
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: true };

      const unmortRes = processUnmortgageProperty(state, p1, 1);
      expect(unmortRes.success).toBe(true);
      expect(unmortRes.state.players[p1].cash).toBe(1467); // 1500 - 33
      expect(unmortRes.state.properties[1].isMortgaged).toBe(false);
    });
  });

  describe('House & Hotel Construction', () => {
    it('rejects building without a complete color monopoly', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Only own 1 of 2 brown properties
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };

      const buildRes = processBuildHouse(state, p1, 1);
      expect(buildRes.success).toBe(false);
      expect(buildRes.error?.code).toBe('NO_MONOPOLY');
    });

    it('builds house when monopoly is owned and enforces even-building', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Own both brown properties (space 1 Salvador, space 3 Rio). House cost is 50.
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.properties[3] = { ownerId: p1, houses: 0, isMortgaged: false };

      // Build 1st house on space 1
      const buildRes1 = processBuildHouse(state, p1, 1);
      expect(buildRes1.success).toBe(true);
      expect(buildRes1.state.properties[1].houses).toBe(1);
      expect(buildRes1.state.players[p1].cash).toBe(1450); // 1500 - 50

      // Cannot build 2nd house on space 1 before space 3 has 1 house (even-building)
      const buildRes2 = processBuildHouse(buildRes1.state, p1, 1);
      expect(buildRes2.success).toBe(false);
      expect(buildRes2.error?.code).toBe('EVEN_BUILD_VIOLATION');

      // Build 1st house on space 3 -> allowed
      const buildRes3 = processBuildHouse(buildRes1.state, p1, 3);
      expect(buildRes3.success).toBe(true);
      expect(buildRes3.state.properties[3].houses).toBe(1);
    });

    it('sells house back for 50% refund obeying even-selling rule', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[1] = { ownerId: p1, houses: 2, isMortgaged: false };
      state.properties[3] = { ownerId: p1, houses: 1, isMortgaged: false };

      // Selling on space 3 violates even-selling (space 1 has 2 houses)
      const sellInvalid = processSellHouse(state, p1, 3);
      expect(sellInvalid.success).toBe(false);
      expect(sellInvalid.error?.code).toBe('EVEN_BUILD_VIOLATION');

      // Selling on space 1 succeeds: refund is 50/2 = 25
      const sellValid = processSellHouse(state, p1, 1);
      expect(sellValid.success).toBe(true);
      expect(sellValid.state.properties[1].houses).toBe(1);
      expect(sellValid.state.players[p1].cash).toBe(1525);
    });
  });

  describe('Auctions', () => {
    it('starts an auction when player declines to buy unowned property', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // p1 lands on Rio (space 3)
      const rollRes = processRollDice(state, p1, [1, 2]);
      expect(rollRes.state.turnPhase).toBe('action_pending');

      const declineRes = processDeclineProperty(rollRes.state, p1);
      expect(declineRes.success).toBe(true);
      expect(declineRes.state.turnPhase).toBe('in_auction');
      expect(declineRes.state.auction).toEqual({
        spaceId: 3,
        currentBid: 0,
        highBidderId: null,
        activeBidders: [p1, p2],
      });
    });

    it('processes bids and awards property to the sole remaining bidder upon pass', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      const rollRes = processRollDice(state, p1, [1, 2]);
      const declineRes = processDeclineProperty(rollRes.state, p1);

      // p2 bids 50
      const bidRes = processAuctionBid(declineRes.state, p2, 50);
      expect(bidRes.success).toBe(true);
      expect(bidRes.state.auction?.currentBid).toBe(50);
      expect(bidRes.state.auction?.highBidderId).toBe(p2);

      // p1 passes -> p2 wins auction
      const passRes = processAuctionPass(bidRes.state, p1);
      expect(passRes.success).toBe(true);
      expect(passRes.state.auction).toBeNull();
      expect(passRes.state.properties[3]).toEqual({ ownerId: p2, houses: 0, isMortgaged: false });
      expect(passRes.state.players[p2].cash).toBe(1450); // 1500 - 50
      expect(passRes.state.turnPhase).toBe('turn_ended');
    });

    it('leaves property unowned if all players pass without any bids', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      const rollRes = processRollDice(state, p1, [1, 2]);
      const declineRes = processDeclineProperty(rollRes.state, p1);

      // p1 passes
      const pass1 = processAuctionPass(declineRes.state, p1);
      // p2 passes
      const pass2 = processAuctionPass(pass1.state, p2);

      expect(pass2.success).toBe(true);
      expect(pass2.state.auction).toBeNull();
      expect(pass2.state.properties[3]).toBeUndefined();
      expect(pass2.state.turnPhase).toBe('turn_ended');
    });
  });

  describe('Trading', () => {
    it('creates trade offer, validates ownership and funds, and executes atomic swap on accept', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.properties[3] = { ownerId: p2, houses: 0, isMortgaged: false };

      // p1 offers space 1 + $100 for p2's space 3
      const tradeRes = processCreateTrade(state, p1, {
        receiverId: p2,
        offeredCash: 100,
        offeredPropertyIds: [1],
        requestedCash: 0,
        requestedPropertyIds: [3],
      });

      expect(tradeRes.success).toBe(true);
      expect(tradeRes.state.pendingTrade).toBeDefined();

      // p2 accepts trade
      const acceptRes = processAcceptTrade(tradeRes.state, p2);
      expect(acceptRes.success).toBe(true);
      expect(acceptRes.state.pendingTrade).toBeNull();

      // Check cash balances
      expect(acceptRes.state.players[p1].cash).toBe(1400); // 1500 - 100
      expect(acceptRes.state.players[p2].cash).toBe(1600); // 1500 + 100

      // Check ownership swap
      expect(acceptRes.state.properties[1].ownerId).toBe(p2);
      expect(acceptRes.state.properties[3].ownerId).toBe(p1);
    });

    it('allows trade rejection/cancellation', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };

      const tradeRes = processCreateTrade(state, p1, {
        receiverId: p2,
        offeredCash: 50,
        offeredPropertyIds: [1],
        requestedCash: 0,
        requestedPropertyIds: [],
      });

      const rejectRes = processRejectTrade(tradeRes.state, p2);
      expect(rejectRes.success).toBe(true);
      expect(rejectRes.state.pendingTrade).toBeNull();
      expect(rejectRes.state.properties[1].ownerId).toBe(p1);
      expect(rejectRes.state.players[p1].cash).toBe(1500);
    });
  });

  describe('Bankruptcy & Game Over', () => {
    it('transfers assets to creditor and finishes game when only 1 player remains', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.players[p1].cash = 300;

      // p1 declares bankruptcy to creditor p2
      const bankRes = processDeclareBankruptcy(state, p1, p2);
      expect(bankRes.success).toBe(true);
      expect(bankRes.state.players[p1].isBankrupt).toBe(true);
      expect(bankRes.state.players[p2].cash).toBe(1800); // 1500 + 300
      expect(bankRes.state.properties[1].ownerId).toBe(p2); // property transferred
      expect(bankRes.state.phase).toBe('finished');
      expect(bankRes.state.winnerId).toBe(p2);
    });
  });

  describe('Turn Management & End Turn', () => {
    it('prevents ending turn before rolling dice', () => {
      const state = createInitialGameState([p1, p2]);
      const endRes = processEndTurn(state, p1);

      expect(endRes.success).toBe(false);
      expect(endRes.error?.code).toBe('MUST_ROLL_FIRST');
      expect(endRes.state.activePlayerId).toBe(p1);
    });

    it('cycles turn order back to player 1 after all players have played', () => {
      const state = createInitialGameState([p1, p2]);

      // Turn 1: P1
      const p1Roll = processRollDice(state, p1, [1, 2]);
      const p1End = processEndTurn(p1Roll.state, p1);
      expect(p1End.state.activePlayerId).toBe(p2);

      // Turn 2: P2
      const p2Roll = processRollDice(p1End.state, p2, [2, 3]);
      const p2End = processEndTurn(p2Roll.state, p2);
      expect(p2End.state.activePlayerId).toBe(p1);
      expect(p2End.state.currentTurnIndex).toBe(0);
    });
  });

  describe('Configurable Room Rules Enforcement', () => {
    it('accumulates tax and penalty fines into vacationPot and awards them on space 20', () => {
      const state = createInitialGameState([p1, p2], 1500, 200, { vacationCash: true });
      expect(state.vacationPot).toBe(0);

      // P1 rolls 4 -> lands on space 4 (Tax, price 100)
      const taxRoll = processRollDice(state, p1, [1, 3]);
      expect(taxRoll.success).toBe(true);
      expect(taxRoll.state.players[p1].position).toBe(4);
      expect(taxRoll.state.players[p1].cash).toBe(1400); // 1500 - 100
      expect(taxRoll.state.vacationPot).toBe(100);

      // P2 is in prison and pays $50 fine
      taxRoll.state.players[p2].inPrison = true;
      taxRoll.state.activePlayerId = p2;
      const fineRes = processPayPrisonFine(taxRoll.state, p2);
      expect(fineRes.success).toBe(true);
      expect(fineRes.state.players[p2].cash).toBe(1450); // 1500 - 50
      expect(fineRes.state.vacationPot).toBe(150); // 100 + 50

      // P2 moves to space 12, rolls 12 to land directly on space 24 (Vacation)
      fineRes.state.players[p2].position = 12;
      fineRes.state.activePlayerId = p2;
      fineRes.state.turnPhase = 'need_roll';
      const vacationRoll = processRollDice(fineRes.state, p2, [6, 6]);
      expect(vacationRoll.success).toBe(true);
      expect(vacationRoll.state.players[p2].position).toBe(24);
      expect(vacationRoll.state.players[p2].cash).toBe(1600); // 1450 + 150 pot
      expect(vacationRoll.state.vacationPot).toBe(0); // Pot emptied
    });

    it('ends turn without auction when rules.auction is false and property is declined', () => {
      const state = createInitialGameState([p1, p2], 1500, 200, { auction: false });
      // P1 rolls 3 -> lands on space 3 (Rio, purchasable)
      const rollRes = processRollDice(state, p1, [1, 2]); // roll 3
      expect(rollRes.success).toBe(true);
      expect(rollRes.state.turnPhase).toBe('action_pending');

      const declineRes = processDeclineProperty(rollRes.state, p1);
      expect(declineRes.success).toBe(true);
      expect(declineRes.state.auction).toBeNull();
      expect(declineRes.state.turnPhase).toBe('turn_ended');
    });

    it('rejects mortgaging when rules.mortgage is false', () => {
      const state = createInitialGameState([p1, p2], 1500, 200, { mortgage: false });
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };

      const mortRes = processMortgageProperty(state, p1, 1);
      expect(mortRes.success).toBe(false);
      expect(mortRes.error?.code).toBe('MORTGAGE_DISABLED');
    });

    it('does not double unimproved rent on monopoly when doubleRent rule is false', () => {
      const state = createInitialGameState([p1, p2], 1500, 200, { doubleRent: false });
      state.properties[1] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.properties[3] = { ownerId: p1, houses: 0, isMortgaged: false };

      // P2 lands on Rio (space 3, base rent 4)
      state.activePlayerId = p2;
      state.currentTurnIndex = 1;
      const rollRes = processRollDice(state, p2, [1, 2]); // lands on 3
      expect(rollRes.success).toBe(true);
      // Rent is base rent 4, not 8!
      expect(rollRes.state.players[p2].cash).toBe(1496);
      expect(rollRes.state.players[p1].cash).toBe(1504);
    });

    it('exempts opponent from rent when owner is in prison and noRentInPrison rule is true', () => {
      const state = createInitialGameState([p1, p2], 1500, 200, { noRentInPrison: true });
      state.properties[3] = { ownerId: p1, houses: 0, isMortgaged: false };
      state.players[p1].inPrison = true;

      // P2 lands on space 3
      state.activePlayerId = p2;
      state.currentTurnIndex = 1;
      const rollRes = processRollDice(state, p2, [1, 2]);
      expect(rollRes.success).toBe(true);
      // No rent paid!
      expect(rollRes.state.players[p2].cash).toBe(1500);
      expect(rollRes.state.players[p1].cash).toBe(1500);
    });
  });
});
