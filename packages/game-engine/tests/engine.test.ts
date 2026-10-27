import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BOARD_SPACES,
  createInitialGameState,
  getBoardSpace,
  processBuyProperty,
  processEndTurn,
  processRollDice,
} from '../src/index.js';

describe('Authoritative Game Engine — Milestone 3 Suite', () => {
  const p1 = 'player_1';
  const p2 = 'player_2';
  const p3 = 'player_3';

  it('verifies the board has 40 canonical spaces with unique IDs 0 to 39', () => {
    expect(CANONICAL_BOARD_SPACES).toHaveLength(40);
    CANONICAL_BOARD_SPACES.forEach((space, index) => {
      expect(space.id).toBe(index);
      expect(getBoardSpace(index).id).toBe(index);
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
      // Place p1 at space 37 (San Francisco)
      state.players[p1].position = 37;

      // Roll 5 -> 37 + 5 = 42 -> newPos 2 (Treasure), passed START (42 >= 40)
      const res = processRollDice(state, p1, [2, 3]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(2);
      expect(res.state.players[p1].cash).toBe(1700); // 1500 + 200
    });

    it('awards salary ($200) when landing exactly on START (space 0)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].position = 35; // JFK Airport

      // Roll 5 -> 35 + 5 = 40 -> newPos 0 (START)
      const res = processRollDice(state, p1, [2, 3]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(0);
      expect(res.state.players[p1].cash).toBe(1700);
    });

    it('handles moving across the last board space (39) to the first (0 and beyond)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].position = 39; // New York

      // Roll 2 -> 39 + 2 = 41 -> newPos 1 (Salvador)
      const res = processRollDice(state, p1, [1, 1]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(1);
      expect(res.state.players[p1].cash).toBe(1700);
    });

    it('sends player to In Prison (space 10) when landing on Go to Prison (space 30)', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.players[p1].position = 28;

      // Roll 2 -> 28 + 2 = 30 (Go to Prison)
      const res = processRollDice(state, p1, [1, 1]);

      expect(res.success).toBe(true);
      expect(res.state.players[p1].position).toBe(10); // In Prison
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

  describe('Property Purchasing & Rent', () => {
    it('allows active player to purchase an unowned property when having sufficient funds', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Roll 3 (1+2) to Rio (space 3, price 60)
      const rollRes = processRollDice(state, p1, [1, 2]);
      expect(rollRes.state.turnPhase).toBe('action_pending');

      const buyRes = processBuyProperty(rollRes.state, p1);
      expect(buyRes.success).toBe(true);
      expect(buyRes.state.players[p1].cash).toBe(1440); // 1500 - 60
      expect(buyRes.state.properties[3]).toBe(p1);
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

    it('rejects purchasing property if not active player', () => {
      const state = createInitialGameState([p1, p2], 1500);
      const rollRes = processRollDice(state, p1, [1, 2]); // Rio (space 3)

      const buyRes = processBuyProperty(rollRes.state, p2); // p2 tries to buy
      expect(buyRes.success).toBe(false);
      expect(buyRes.error?.code).toBe('NOT_YOUR_TURN');
    });

    it('collects rent when landing on another player owned property and pays to owner', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Give p1 ownership of space 3 (Rio: price 60, rent 4)
      state.properties[3] = p1;

      // End p1's turn
      state.turnPhase = 'turn_ended';
      const endRes = processEndTurn(state, p1);
      expect(endRes.state.activePlayerId).toBe(p2);

      // p2 rolls 3 -> lands on space 3 (Rio)
      const rollRes = processRollDice(endRes.state, p2, [1, 2]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p2].position).toBe(3);
      // p2 paid $4 rent to p1
      expect(rollRes.state.players[p2].cash).toBe(1496); // 1500 - 4
      expect(rollRes.state.players[p1].cash).toBe(1504); // 1500 + 4
      expect(rollRes.state.turnPhase).toBe('turn_ended');
    });

    it('handles rent payment when tenant has insufficient funds without going negative', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      // Give p1 space 39 (New York: rent 50)
      state.properties[39] = p1;
      // p2 has only $20
      state.players[p2].cash = 20;
      state.players[p2].position = 37;

      // Set turn to p2
      state.activePlayerId = p2;
      state.currentTurnIndex = 1;
      state.turnPhase = 'need_roll';

      // p2 rolls 2 -> lands on 39 (New York)
      const rollRes = processRollDice(state, p2, [1, 1]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p2].cash).toBe(0); // Paid all $20, not negative
      expect(rollRes.state.players[p1].cash).toBe(1520); // p1 received $20
      expect(rollRes.state.turnPhase).toBe('turn_ended');
    });

    it('does not charge rent when landing on your own property', () => {
      const state = createInitialGameState([p1, p2], 1500, 200);
      state.properties[3] = p1;

      // p1 rolls 3 -> lands on space 3 (Rio, owned by p1)
      const rollRes = processRollDice(state, p1, [1, 2]);

      expect(rollRes.success).toBe(true);
      expect(rollRes.state.players[p1].cash).toBe(1500); // Unchanged
      expect(rollRes.state.turnPhase).toBe('turn_ended');
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

    it('allows player to skip buying an unowned property and end turn', () => {
      const state = createInitialGameState([p1, p2]);
      // Roll to unowned Rio (space 3) -> action_pending
      const rollRes = processRollDice(state, p1, [1, 2]);
      expect(rollRes.state.turnPhase).toBe('action_pending');

      // Player decides to skip buying and ends turn
      const endRes = processEndTurn(rollRes.state, p1);
      expect(endRes.success).toBe(true);
      expect(endRes.state.activePlayerId).toBe(p2);
      expect(endRes.state.currentTurnIndex).toBe(1);
      expect(endRes.state.turnPhase).toBe('need_roll');
      expect(endRes.state.properties[3]).toBeUndefined(); // Still unowned
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
});
