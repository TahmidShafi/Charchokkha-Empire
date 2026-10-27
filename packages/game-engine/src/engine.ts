import {
  type BoardSpace,
  CANONICAL_BOARD_SPACES,
  getBoardSpace,
  isPurchasableSpace,
  TOTAL_SPACES,
} from './board.js';
import {
  type RandomSource,
  defaultRandomSource,
  rollDicePair,
} from './index.js';

export type GameLifecyclePhase = 'waiting' | 'starting' | 'in_progress' | 'finished' | 'abandoned';

export type TurnPhase = 'need_roll' | 'action_pending' | 'turn_ended';

export interface PlayerGameState {
  id: string;
  position: number;
  cash: number;
  isBankrupt: boolean;
}

export interface LastDiceRoll {
  die1: number;
  die2: number;
  total: number;
  isDouble: boolean;
}

export interface GameState {
  phase: GameLifecyclePhase;
  turnOrder: string[];
  currentTurnIndex: number;
  activePlayerId: string;
  turnPhase: TurnPhase;
  lastDiceRoll: LastDiceRoll | null;
  players: Record<string, PlayerGameState>;
  properties: Record<number, string>; // spaceId -> ownerPlayerId
  lastActionMessage?: string;
  startingSalary: number;
}

export interface EngineActionResult {
  success: boolean;
  state: GameState;
  error?: {
    code: string;
    message: string;
  };
  event?: {
    type: string;
    description: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Creates the initial authoritative GameState for a room.
 */
export function createInitialGameState(
  playerIds: string[],
  startingCash: number = 1500,
  startingSalary: number = 200
): GameState {
  if (playerIds.length < 2) {
    throw new Error('A minimum of 2 players is required to start a game.');
  }

  const players: Record<string, PlayerGameState> = {};
  for (const id of playerIds) {
    players[id] = {
      id,
      position: 0,
      cash: startingCash,
      isBankrupt: false,
    };
  }

  const turnOrder = [...playerIds];

  return {
    phase: 'in_progress',
    turnOrder,
    currentTurnIndex: 0,
    activePlayerId: turnOrder[0],
    turnPhase: 'need_roll',
    lastDiceRoll: null,
    players,
    properties: {},
    startingSalary,
    lastActionMessage: 'Game started. Player 1 turn to roll.',
  };
}

function cloneGameState(state: GameState): GameState {
  const clonedPlayers: Record<string, PlayerGameState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    clonedPlayers[id] = { ...player };
  }

  return {
    ...state,
    turnOrder: [...state.turnOrder],
    players: clonedPlayers,
    properties: { ...state.properties },
    lastDiceRoll: state.lastDiceRoll ? { ...state.lastDiceRoll } : null,
  };
}

/**
 * Authoritatively applies a dice roll and movement to the game state.
 * Supports injected dice for deterministic testing.
 */
export function processRollDice(
  state: GameState,
  playerId: string,
  injectedDice?: [number, number],
  rng: RandomSource = defaultRandomSource
): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return {
      success: false,
      state,
      error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' },
    };
  }

  if (state.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to roll' },
    };
  }

  if (state.turnPhase !== 'need_roll') {
    return {
      success: false,
      state,
      error: { code: 'ALREADY_ROLLED', message: 'You have already rolled this turn' },
    };
  }

  const player = state.players[playerId];
  if (!player) {
    return {
      success: false,
      state,
      error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found in game state' },
    };
  }

  // Roll dice
  let die1: number;
  let die2: number;
  if (injectedDice) {
    const [d1, d2] = injectedDice;
    if (!Number.isInteger(d1) || d1 < 1 || d1 > 6 || !Number.isInteger(d2) || d2 < 1 || d2 > 6) {
      return {
        success: false,
        state,
        error: { code: 'INVALID_DICE_VALUES', message: 'Injected dice must be integers between 1 and 6' },
      };
    }
    die1 = d1;
    die2 = d2;
  } else {
    const roll = rollDicePair(rng);
    die1 = roll.die1;
    die2 = roll.die2;
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];
  const diceTotal = die1 + die2;
  const isDouble = die1 === die2;

  nextState.lastDiceRoll = {
    die1,
    die2,
    total: diceTotal,
    isDouble,
  };

  const oldPos = nextPlayer.position;
  const rawNewPos = oldPos + diceTotal;
  const passedStart = rawNewPos >= TOTAL_SPACES;
  const newPos = rawNewPos % TOTAL_SPACES;

  // Passing START rule: collect salary
  let salaryCollected = false;
  if (passedStart) {
    nextPlayer.cash += nextState.startingSalary;
    salaryCollected = true;
  }

  nextPlayer.position = newPos;
  const space = getBoardSpace(newPos);

  let actionSummary = `Rolled ${diceTotal} (${die1} + ${die2}) and landed on ${space.name}.`;
  if (salaryCollected) {
    actionSummary += ` Passed START and collected $${nextState.startingSalary}.`;
  }

  // Space resolution
  if (newPos === 30) {
    // "Go to Prison": move to space 10
    nextPlayer.position = 10;
    nextState.turnPhase = 'turn_ended';
    actionSummary += ' Arrested! Sent to In Prison.';
  } else if (space.type === 'tax') {
    const taxAmount = space.price ?? 100;
    const payment = Math.min(nextPlayer.cash, taxAmount);
    nextPlayer.cash -= payment;
    nextState.turnPhase = 'turn_ended';
    actionSummary += ` Paid $${payment} in tax.`;
  } else if (isPurchasableSpace(space)) {
    const ownerId = nextState.properties[newPos];
    if (!ownerId) {
      // Unowned: current player can purchase or pass
      nextState.turnPhase = 'action_pending';
      actionSummary += ` Available to buy for $${space.price}.`;
    } else if (ownerId !== playerId) {
      // Owned by opponent: pay rent
      const rentAmount = space.rent ?? 0;
      const rentPaid = Math.min(nextPlayer.cash, rentAmount);
      nextPlayer.cash -= rentPaid;
      if (nextState.players[ownerId]) {
        nextState.players[ownerId].cash += rentPaid;
      }
      nextState.turnPhase = 'turn_ended';
      actionSummary += ` Owned by another player. Paid $${rentPaid} rent.`;
    } else {
      // Owned by current player
      nextState.turnPhase = 'turn_ended';
      actionSummary += ' You already own this property.';
    }
  } else {
    // Corners, treasure, surprise
    nextState.turnPhase = 'turn_ended';
  }

  nextState.lastActionMessage = actionSummary;

  return {
    success: true,
    state: nextState,
    event: {
      type: 'dice_rolled',
      description: actionSummary,
      details: {
        die1,
        die2,
        total: diceTotal,
        newPosition: nextPlayer.position,
        salaryCollected,
      },
    },
  };
}

/**
 * Authoritatively processes a property purchase for the active player.
 */
export function processBuyProperty(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return {
      success: false,
      state,
      error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' },
    };
  }

  if (state.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to purchase property' },
    };
  }

  if (state.turnPhase !== 'action_pending') {
    return {
      success: false,
      state,
      error: { code: 'CANNOT_BUY_NOW', message: 'Cannot buy property in current turn phase' },
    };
  }

  const player = state.players[playerId];
  if (!player) {
    return {
      success: false,
      state,
      error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found in game state' },
    };
  }

  const spaceId = player.position;
  const space = getBoardSpace(spaceId);

  if (!isPurchasableSpace(space) || !space.price) {
    return {
      success: false,
      state,
      error: { code: 'NOT_PURCHASABLE', message: `Space ${space.name} cannot be purchased` },
    };
  }

  if (state.properties[spaceId]) {
    return {
      success: false,
      state,
      error: { code: 'ALREADY_OWNED', message: `Space ${space.name} is already owned` },
    };
  }

  if (player.cash < space.price) {
    return {
      success: false,
      state,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: `Insufficient funds: requires $${space.price}, you have $${player.cash}`,
      },
    };
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];

  nextPlayer.cash -= space.price;
  nextState.properties[spaceId] = playerId;
  nextState.turnPhase = 'turn_ended';

  const actionSummary = `Purchased ${space.name} for $${space.price}. Balance: $${nextPlayer.cash}.`;
  nextState.lastActionMessage = actionSummary;

  return {
    success: true,
    state: nextState,
    event: {
      type: 'property_bought',
      description: actionSummary,
      details: {
        spaceId,
        propertyName: space.name,
        price: space.price,
        remainingCash: nextPlayer.cash,
      },
    },
  };
}

/**
 * Authoritatively ends the active player's turn and advances turn order.
 */
export function processEndTurn(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return {
      success: false,
      state,
      error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' },
    };
  }

  if (state.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to end' },
    };
  }

  if (state.turnPhase === 'need_roll') {
    return {
      success: false,
      state,
      error: { code: 'MUST_ROLL_FIRST', message: 'You must roll the dice before ending your turn' },
    };
  }

  const nextState = cloneGameState(state);
  const nextIndex = (nextState.currentTurnIndex + 1) % nextState.turnOrder.length;
  nextState.currentTurnIndex = nextIndex;
  nextState.activePlayerId = nextState.turnOrder[nextIndex];
  nextState.turnPhase = 'need_roll';
  nextState.lastDiceRoll = null;

  const actionSummary = `Player ${playerId} ended turn. Active player is now ${nextState.activePlayerId}.`;
  nextState.lastActionMessage = actionSummary;

  return {
    success: true,
    state: nextState,
    event: {
      type: 'turn_ended',
      description: actionSummary,
      details: {
        previousPlayerId: playerId,
        nextPlayerId: nextState.activePlayerId,
      },
    },
  };
}
