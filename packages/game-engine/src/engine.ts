import type { PlayerStats, PlayerStanding } from '@charchokkha/shared';
import {
  type BoardSpace,
  type PropertyGroup,
  calculateRentAmount,
  getBoardSpace,
  getGroupSpaces,
  hasColorMonopoly,
  isPurchasableSpace,
  TOTAL_SPACES,
} from './board.js';
import { CHANCE_CARDS, TREASURE_CARDS } from './cards.js';
import {
  type RandomSource,
  defaultRandomSource,
  rollDicePair,
} from './index.js';

export type GameLifecyclePhase = 'waiting' | 'starting' | 'in_progress' | 'finished' | 'abandoned';

export type TurnPhase = 'need_roll' | 'action_pending' | 'turn_ended' | 'in_auction';

export interface PlayerGameState {
  id: string;
  position: number;
  cash: number;
  isBankrupt: boolean;
  inPrison: boolean;
  prisonTurns: number;
  stats?: PlayerStats;
}

export interface LastDiceRoll {
  die1: number;
  die2: number;
  total: number;
  isDouble: boolean;
}

export interface PropertyRecord {
  ownerId: string;
  houses: number; // 0..4 = houses, 5 = hotel
  isMortgaged: boolean;
}

export interface AuctionState {
  spaceId: number;
  currentBid: number;
  highBidderId: string | null;
  activeBidders: string[];
}

export interface TradeOffer {
  id: string;
  senderId: string;
  receiverId: string;
  offeredCash: number;
  offeredPropertyIds: number[];
  requestedCash: number;
  requestedPropertyIds: number[];
}

export interface GameSettingsRules {
  doubleRent?: boolean;
  noRentInPrison?: boolean;
  vacationCash?: boolean;
  evenBuild?: boolean;
  auction?: boolean;
  mortgage?: boolean;
}

export interface GameState {
  phase: GameLifecyclePhase;
  turnOrder: string[];
  currentTurnIndex: number;
  activePlayerId: string;
  turnPhase: TurnPhase;
  lastDiceRoll: LastDiceRoll | null;
  players: Record<string, PlayerGameState>;
  properties: Record<number, PropertyRecord>;
  lastActionMessage?: string;
  startingSalary: number;
  auction: AuctionState | null;
  pendingTrade: TradeOffer | null;
  rules: GameSettingsRules;
  winnerId?: string;
  eliminationOrder?: string[];
  chestCardIndex: number;
  chanceCardIndex: number;
  vacationPot?: number;
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

export function getPropertyRecord(state: GameState, spaceId: number): PropertyRecord | undefined {
  const prop = state.properties[spaceId] as unknown;
  if (!prop) return undefined;
  if (typeof prop === 'string') {
    return { ownerId: prop, houses: 0, isMortgaged: false };
  }
  return prop as PropertyRecord;
}

export function getPropertyOwnerId(state: GameState, spaceId: number): string | undefined {
  const p = getPropertyRecord(state, spaceId);
  return p?.ownerId;
}

export function getOrCreatePlayerStats(player: PlayerGameState): PlayerStats {
  if (!player.stats) {
    player.stats = {
      rentPaid: 0,
      rentReceived: 0,
      propertiesBought: 0,
      tradesCompleted: 0,
      auctionsWon: 0,
      buildingsBuilt: 0,
    };
  }
  return player.stats;
}

export function createInitialGameState(
  playerIds: string[],
  startingCash: number = 1500,
  startingSalary: number = 200,
  rules: GameSettingsRules = {}
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
      inPrison: false,
      prisonTurns: 0,
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
    auction: null,
    pendingTrade: null,
    rules: { ...rules },
    chestCardIndex: 0,
    chanceCardIndex: 0,
    vacationPot: 0,
    eliminationOrder: [],
    lastActionMessage: 'Game started. Player 1 turn to roll.',
  };
}

export function cloneGameState(state: GameState): GameState {
  const clonedPlayers: Record<string, PlayerGameState> = {};
  for (const [id, player] of Object.entries(state.players)) {
    clonedPlayers[id] = {
      ...player,
      stats: player.stats ? { ...player.stats } : undefined,
    };
  }

  const clonedProperties: Record<number, PropertyRecord> = {};
  for (const [spaceIdStr, prop] of Object.entries(state.properties)) {
    const sId = Number(spaceIdStr);
    const rec = typeof prop === 'string' ? { ownerId: prop, houses: 0, isMortgaged: false } : prop;
    clonedProperties[sId] = { ...rec };
  }

  return {
    ...state,
    turnOrder: [...state.turnOrder],
    eliminationOrder: state.eliminationOrder ? [...state.eliminationOrder] : [],
    players: clonedPlayers,
    properties: clonedProperties,
    lastDiceRoll: state.lastDiceRoll ? { ...state.lastDiceRoll } : null,
    auction: state.auction ? { ...state.auction, activeBidders: [...state.auction.activeBidders] } : null,
    pendingTrade: state.pendingTrade
      ? {
          ...state.pendingTrade,
          offeredPropertyIds: [...state.pendingTrade.offeredPropertyIds],
          requestedPropertyIds: [...state.pendingTrade.requestedPropertyIds],
        }
      : null,
    rules: { ...state.rules },
    vacationPot: state.vacationPot ?? 0,
  };
}

/**
 * Authoritatively processes rolling dice and resulting movement.
 */
export function processRollDice(
  state: GameState,
  playerId: string,
  injectedDice?: [number, number],
  rng: RandomSource = defaultRandomSource
): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }

  if (state.activePlayerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to roll' } };
  }

  if (state.turnPhase !== 'need_roll') {
    return { success: false, state, error: { code: 'ALREADY_ROLLED', message: 'You have already rolled this turn' } };
  }

  const nextState = cloneGameState(state);
  const player = nextState.players[playerId];
  if (!player) {
    return { success: false, state, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found in game state' } };
  }

  // Roll dice
  let die1: number;
  let die2: number;
  if (injectedDice) {
    const [d1, d2] = injectedDice;
    if (!Number.isInteger(d1) || d1 < 1 || d1 > 6 || !Number.isInteger(d2) || d2 < 1 || d2 > 6) {
      return { success: false, state, error: { code: 'INVALID_DICE_VALUES', message: 'Dice values must be 1-6' } };
    }
    die1 = d1;
    die2 = d2;
  } else {
    const roll = rollDicePair(rng);
    die1 = roll.die1;
    die2 = roll.die2;
  }

  const diceTotal = die1 + die2;
  const isDouble = die1 === die2;
  nextState.lastDiceRoll = { die1, die2, total: diceTotal, isDouble };

  // Handle player in prison rolling
  if (player.inPrison) {
    if (isDouble) {
      player.inPrison = false;
      player.prisonTurns = 0;
      nextState.lastActionMessage = `Rolled double ${die1}s! Freed from prison.`;
    } else {
      player.prisonTurns += 1;
      if (player.prisonTurns < 3) {
        nextState.turnPhase = 'turn_ended';
        nextState.lastActionMessage = `Rolled ${diceTotal} (${die1} + ${die2}), no doubles. Remains in prison (attempt ${player.prisonTurns}/3).`;
        return { success: true, state: nextState };
      } else {
        // 3rd failed attempt: forced to pay $50 fine
        const fine = Math.min(player.cash, 50);
        player.cash -= fine;
        if (nextState.rules.vacationCash) {
          nextState.vacationPot = (nextState.vacationPot ?? 0) + fine;
        }
        player.inPrison = false;
        player.prisonTurns = 0;
        nextState.lastActionMessage = `3rd attempt failed. Paid $${fine} fine to leave prison.`;
      }
    }
  }

  // Move player
  const oldPos = player.position;
  const rawNewPos = oldPos + diceTotal;
  const passedStart = rawNewPos >= TOTAL_SPACES;
  const newPos = rawNewPos % TOTAL_SPACES;

  let salaryCollected = false;
  if (passedStart) {
    player.cash += nextState.startingSalary;
    salaryCollected = true;
  }

  player.position = newPos;
  const space = getBoardSpace(newPos);

  let actionSummary = `Rolled ${diceTotal} (${die1} + ${die2}) and landed on ${space.name}.`;
  if (salaryCollected) {
    actionSummary += ` Passed START and collected $${nextState.startingSalary}.`;
  }

  // Space resolution
  if (newPos === 30) {
    // Go to Prison
    player.position = 10;
    player.inPrison = true;
    player.prisonTurns = 0;
    nextState.turnPhase = 'turn_ended';
    actionSummary += ' Arrested! Sent to In Prison.';
  } else if (space.type === 'tax') {
    const taxAmount = space.price ?? 100;
    const payment = Math.min(player.cash, taxAmount);
    player.cash -= payment;
    if (nextState.rules.vacationCash) {
      nextState.vacationPot = (nextState.vacationPot ?? 0) + payment;
    }
    nextState.turnPhase = 'turn_ended';
    actionSummary += ` Paid $${payment} in tax.`;
  } else if (space.type === 'treasure') {
    const card = TREASURE_CARDS[nextState.chestCardIndex % TREASURE_CARDS.length];
    nextState.chestCardIndex += 1;
    const cardMsg = card.apply(nextState, playerId);
    actionSummary += ` Treasure Chest: "${card.text}" (${cardMsg})`;
    if (nextState.players[playerId].position !== 10) {
      nextState.turnPhase = 'turn_ended';
    }
  } else if (space.type === 'surprise') {
    const card = CHANCE_CARDS[nextState.chanceCardIndex % CHANCE_CARDS.length];
    nextState.chanceCardIndex += 1;
    const cardMsg = card.apply(nextState, playerId);
    actionSummary += ` Chance: "${card.text}" (${cardMsg})`;
    if (nextState.players[playerId].position !== 10) {
      nextState.turnPhase = 'turn_ended';
    }
  } else if (isPurchasableSpace(space)) {
    const propRecord = getPropertyRecord(nextState, newPos);
    if (!propRecord) {
      // Unowned: current player can purchase or decline (triggering auction)
      nextState.turnPhase = 'action_pending';
      actionSummary += ` Available to buy for $${space.price}.`;
    } else if (propRecord.ownerId !== playerId) {
      // Owned by opponent: compute authoritative rent
      const owner = nextState.players[propRecord.ownerId];
      const rentAmount = calculateRentAmount({
        space,
        ownerId: propRecord.ownerId,
        getPropertyOwner: (sId) => getPropertyOwnerId(nextState, sId),
        getHouses: (sId) => getPropertyRecord(nextState, sId)?.houses ?? 0,
        isMortgaged: (sId) => getPropertyRecord(nextState, sId)?.isMortgaged ?? false,
        diceTotal,
        doubleRentRule: nextState.rules.doubleRent ?? true,
        noRentInPrisonRule: nextState.rules.noRentInPrison,
        ownerInPrison: owner?.inPrison ?? false,
      });

      if (rentAmount > 0) {
        const rentPaid = Math.min(player.cash, rentAmount);
        player.cash -= rentPaid;
        getOrCreatePlayerStats(player).rentPaid += rentPaid;
        if (owner) {
          owner.cash += rentPaid;
          getOrCreatePlayerStats(owner).rentReceived += rentPaid;
        }
        actionSummary += ` Owned by ${owner?.id ?? 'player'}. Paid $${rentPaid} rent.`;
      } else {
        actionSummary += ' Property is mortgaged or rent-exempt; no rent owed.';
      }
      nextState.turnPhase = 'turn_ended';
    } else {
      // Owned by self
      nextState.turnPhase = 'turn_ended';
      actionSummary += ' You already own this property.';
    }
  } else {
    // Corners (START, In Prison, Vacation)
    if (newPos === 20 && nextState.rules.vacationCash && (nextState.vacationPot ?? 0) > 0) {
      const pot = nextState.vacationPot!;
      player.cash += pot;
      nextState.vacationPot = 0;
      actionSummary += ` Collected $${pot} from Vacation cash pot!`;
    }
    nextState.turnPhase = 'turn_ended';
  }

  nextState.lastActionMessage = actionSummary;
  return { success: true, state: nextState };
}

/**
 * Pay the $50 prison fine before rolling.
 */
export function processPayPrisonFine(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (state.activePlayerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn' } };
  }
  const player = state.players[playerId];
  if (!player || !player.inPrison) {
    return { success: false, state, error: { code: 'NOT_IN_PRISON', message: 'Player is not in prison' } };
  }
  if (player.cash < 50) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: 'Requires $50 to pay prison fine' } };
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];
  nextPlayer.cash -= 50;
  if (nextState.rules.vacationCash) {
    nextState.vacationPot = (nextState.vacationPot ?? 0) + 50;
  }
  nextPlayer.inPrison = false;
  nextPlayer.prisonTurns = 0;
  nextState.turnPhase = 'need_roll';
  nextState.lastActionMessage = `Player paid $50 fine and is freed from prison. Ready to roll.`;

  return { success: true, state: nextState };
}

/**
 * Authoritatively processes purchasing an unowned property.
 */
export function processBuyProperty(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (state.activePlayerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn' } };
  }
  if (state.turnPhase !== 'action_pending') {
    return { success: false, state, error: { code: 'CANNOT_BUY_NOW', message: 'Cannot buy property in current phase' } };
  }

  const player = state.players[playerId];
  const spaceId = player.position;
  const space = getBoardSpace(spaceId);

  if (!isPurchasableSpace(space) || !space.price) {
    return { success: false, state, error: { code: 'NOT_PURCHASABLE', message: 'Space cannot be purchased' } };
  }

  if (getPropertyOwnerId(state, spaceId)) {
    return { success: false, state, error: { code: 'ALREADY_OWNED', message: 'Space is already owned' } };
  }

  if (player.cash < space.price) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds to buy property' } };
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];
  nextPlayer.cash -= space.price;
  getOrCreatePlayerStats(nextPlayer).propertiesBought += 1;
  nextState.properties[spaceId] = { ownerId: playerId, houses: 0, isMortgaged: false };
  nextState.turnPhase = 'turn_ended';

  const actionSummary = `Purchased ${space.name} for $${space.price}. Balance: $${nextPlayer.cash}.`;
  nextState.lastActionMessage = actionSummary;

  return { success: true, state: nextState };
}

/**
 * Declines purchasing an unowned property, triggering an auction.
 */
export function processDeclineProperty(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (state.activePlayerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn' } };
  }
  if (state.turnPhase !== 'action_pending') {
    return { success: false, state, error: { code: 'CANNOT_DECLINE_NOW', message: 'No property available to decline' } };
  }

  const nextState = cloneGameState(state);
  const spaceId = nextState.players[playerId].position;
  const space = getBoardSpace(spaceId);

  // If room rule disables auction, simply end turn without starting auction
  if (state.rules.auction === false) {
    nextState.turnPhase = 'turn_ended';
    nextState.lastActionMessage = `Player chose not to buy ${space.name}.`;
    return { success: true, state: nextState };
  }

  // Start auction
  const activeBidders = nextState.turnOrder.filter((id) => !nextState.players[id].isBankrupt);
  nextState.auction = {
    spaceId,
    currentBid: 0,
    highBidderId: null,
    activeBidders,
  };
  nextState.turnPhase = 'in_auction';
  nextState.lastActionMessage = `Player declined to buy ${space.name}. Auction started!`;

  return { success: true, state: nextState };
}

/**
 * Place a bid in an ongoing auction.
 */
export function processAuctionBid(state: GameState, playerId: string, bidAmount: number): EngineActionResult {
  if (!state.auction) {
    return { success: false, state, error: { code: 'NO_ACTIVE_AUCTION', message: 'No active auction' } };
  }
  if (!state.auction.activeBidders.includes(playerId)) {
    return { success: false, state, error: { code: 'NOT_IN_AUCTION', message: 'You are not active in this auction' } };
  }
  if (bidAmount <= state.auction.currentBid) {
    return {
      success: false,
      state,
      error: { code: 'BID_TOO_LOW', message: `Bid must be greater than current bid ($${state.auction.currentBid})` },
    };
  }
  const player = state.players[playerId];
  if (!player || player.cash < bidAmount) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds for this bid' } };
  }

  const nextState = cloneGameState(state);
  nextState.auction!.currentBid = bidAmount;
  nextState.auction!.highBidderId = playerId;
  nextState.lastActionMessage = `Player ${playerId} bid $${bidAmount}.`;

  return { success: true, state: nextState };
}

/**
 * Pass in an ongoing auction.
 */
export function processAuctionPass(state: GameState, playerId: string): EngineActionResult {
  if (!state.auction) {
    return { success: false, state, error: { code: 'NO_ACTIVE_AUCTION', message: 'No active auction' } };
  }

  const nextState = cloneGameState(state);
  nextState.auction!.activeBidders = nextState.auction!.activeBidders.filter((id) => id !== playerId);

  const space = getBoardSpace(nextState.auction!.spaceId);
  const remainingCount = nextState.auction!.activeBidders.length;
  const highBidderId = nextState.auction!.highBidderId;

  if (remainingCount === 0) {
    // Everyone passed
    if (highBidderId && nextState.auction!.currentBid > 0) {
      const winner = nextState.players[highBidderId];
      winner.cash -= nextState.auction!.currentBid;
      const winnerStats = getOrCreatePlayerStats(winner);
      winnerStats.auctionsWon += 1;
      nextState.properties[space.id] = { ownerId: highBidderId, houses: 0, isMortgaged: false };
      nextState.lastActionMessage = `Auction ended! ${highBidderId} won ${space.name} for $${nextState.auction!.currentBid}.`;
    } else {
      nextState.lastActionMessage = `Auction ended with no bids. ${space.name} remains unowned.`;
    }
    nextState.auction = null;
    nextState.turnPhase = 'turn_ended';
  } else if (remainingCount === 1 && highBidderId !== null) {
    // Exactly 1 bidder remains and a bid has been made
    const winnerId = highBidderId;
    const winner = nextState.players[winnerId];
    winner.cash -= nextState.auction!.currentBid;
    const winnerStats = getOrCreatePlayerStats(winner);
    winnerStats.auctionsWon += 1;
    nextState.properties[space.id] = { ownerId: winnerId, houses: 0, isMortgaged: false };
    nextState.lastActionMessage = `Auction ended! ${winnerId} won ${space.name} for $${nextState.auction!.currentBid}.`;
    nextState.auction = null;
    nextState.turnPhase = 'turn_ended';
  } else {
    nextState.lastActionMessage = `Player ${playerId} passed in auction. ${remainingCount} bidder(s) remain.`;
  }

  return { success: true, state: nextState };
}

/**
 * Mortgages an unmortgaged property to receive 50% of its cost.
 */
export function processMortgageProperty(state: GameState, playerId: string, spaceId: number): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (state.rules.mortgage === false) {
    return { success: false, state, error: { code: 'MORTGAGE_DISABLED', message: 'Mortgaging is disabled by room rules' } };
  }
  const prop = getPropertyRecord(state, spaceId);
  if (!prop || prop.ownerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_OWNER', message: 'You do not own this property' } };
  }
  if (prop.isMortgaged) {
    return { success: false, state, error: { code: 'ALREADY_MORTGAGED', message: 'Property is already mortgaged' } };
  }
  if (prop.houses > 0) {
    return { success: false, state, error: { code: 'HAS_HOUSES', message: 'Must sell houses before mortgaging' } };
  }

  const space = getBoardSpace(spaceId);
  // Also verify no other property in color group has houses
  if (space.group) {
    const groupSpaces = getGroupSpaces(space.group);
    const hasAnyHouses = groupSpaces.some((s) => (getPropertyRecord(state, s.id)?.houses ?? 0) > 0);
    if (hasAnyHouses) {
      return { success: false, state, error: { code: 'GROUP_HAS_HOUSES', message: 'Must sell all houses in group before mortgaging' } };
    }
  }

  const mortgageValue = Math.floor((space.price ?? 0) / 2);
  const nextState = cloneGameState(state);
  nextState.players[playerId].cash += mortgageValue;
  nextState.properties[spaceId].isMortgaged = true;
  nextState.lastActionMessage = `Mortgaged ${space.name} for $${mortgageValue}.`;

  return { success: true, state: nextState };
}

/**
 * Unmortgages a mortgaged property by paying principal + 10% interest.
 */
export function processUnmortgageProperty(state: GameState, playerId: string, spaceId: number): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  const prop = getPropertyRecord(state, spaceId);
  if (!prop || prop.ownerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_OWNER', message: 'You do not own this property' } };
  }
  if (!prop.isMortgaged) {
    return { success: false, state, error: { code: 'NOT_MORTGAGED', message: 'Property is not mortgaged' } };
  }

  const space = getBoardSpace(spaceId);
  const cost = Math.ceil(((space.price ?? 0) / 2) * 1.1);
  const player = state.players[playerId];
  if (player.cash < cost) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: `Requires $${cost} to unmortgage` } };
  }

  const nextState = cloneGameState(state);
  nextState.players[playerId].cash -= cost;
  nextState.properties[spaceId].isMortgaged = false;
  nextState.lastActionMessage = `Unmortgaged ${space.name} for $${cost}.`;

  return { success: true, state: nextState };
}

/**
 * Builds a house or hotel following monopoly and even-building rules.
 */
export function processBuildHouse(state: GameState, playerId: string, spaceId: number): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  const prop = getPropertyRecord(state, spaceId);
  if (!prop || prop.ownerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_OWNER', message: 'You do not own this property' } };
  }
  const space = getBoardSpace(spaceId);
  if (space.type !== 'property' || !space.group || !space.houseCost) {
    return { success: false, state, error: { code: 'CANNOT_BUILD', message: 'Cannot build on this space type' } };
  }
  if (prop.houses >= 5) {
    return { success: false, state, error: { code: 'MAX_HOUSES', message: 'Property already has a hotel (max)' } };
  }

  // Monopoly check
  const monopoly = hasColorMonopoly(space.group, playerId, (sId) => getPropertyOwnerId(state, sId));
  if (!monopoly) {
    return { success: false, state, error: { code: 'NO_MONOPOLY', message: 'Must own all properties in color set to build' } };
  }

  // Check no property in group is mortgaged
  const groupSpaces = getGroupSpaces(space.group);
  const hasMortgaged = groupSpaces.some((s) => getPropertyRecord(state, s.id)?.isMortgaged);
  if (hasMortgaged) {
    return { success: false, state, error: { code: 'GROUP_MORTGAGED', message: 'Cannot build while any property in set is mortgaged' } };
  }

  // Even-building rule
  if (state.rules.evenBuild !== false) {
    const groupHouses = groupSpaces.map((s) => getPropertyRecord(state, s.id)?.houses ?? 0);
    const minHouses = Math.min(...groupHouses);
    if (prop.houses > minHouses) {
      return { success: false, state, error: { code: 'EVEN_BUILD_VIOLATION', message: 'Must build evenly across all properties in color group' } };
    }
  }

  const player = state.players[playerId];
  if (player.cash < space.houseCost) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: `Requires $${space.houseCost} to build` } };
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];
  nextPlayer.cash -= space.houseCost;
  getOrCreatePlayerStats(nextPlayer).buildingsBuilt += 1;
  nextState.properties[spaceId].houses += 1;
  const newCount = nextState.properties[spaceId].houses;
  const houseLabel = newCount === 5 ? 'Hotel' : `${newCount} House(s)`;
  nextState.lastActionMessage = `Built on ${space.name} (${houseLabel}) for $${space.houseCost}.`;

  return { success: true, state: nextState };
}

/**
 * Sells a house or hotel back to the bank for 50% value.
 */
export function processSellHouse(state: GameState, playerId: string, spaceId: number): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  const prop = getPropertyRecord(state, spaceId);
  if (!prop || prop.ownerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_OWNER', message: 'You do not own this property' } };
  }
  if (prop.houses <= 0) {
    return { success: false, state, error: { code: 'NO_HOUSES', message: 'Property has no houses to sell' } };
  }
  const space = getBoardSpace(spaceId);
  if (!space.group || !space.houseCost) {
    return { success: false, state, error: { code: 'CANNOT_SELL', message: 'Cannot sell on this space type' } };
  }

  // Reverse even building
  if (state.rules.evenBuild !== false) {
    const groupSpaces = getGroupSpaces(space.group);
    const groupHouses = groupSpaces.map((s) => getPropertyRecord(state, s.id)?.houses ?? 0);
    const maxHouses = Math.max(...groupHouses);
    if (prop.houses < maxHouses) {
      return { success: false, state, error: { code: 'EVEN_BUILD_VIOLATION', message: 'Must sell evenly across color group' } };
    }
  }

  const refund = Math.floor(space.houseCost / 2);
  const nextState = cloneGameState(state);
  nextState.players[playerId].cash += refund;
  nextState.properties[spaceId].houses -= 1;
  nextState.lastActionMessage = `Sold house on ${space.name} for $${refund}.`;

  return { success: true, state: nextState };
}

/**
 * Creates a trade offer between two players.
 */
export function processCreateTrade(
  state: GameState,
  senderId: string,
  trade: {
    receiverId: string;
    offeredCash: number;
    offeredPropertyIds: number[];
    requestedCash: number;
    requestedPropertyIds: number[];
  }
): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (senderId === trade.receiverId) {
    return { success: false, state, error: { code: 'INVALID_TRADE_PARTNER', message: 'Cannot trade with yourself' } };
  }

  const sender = state.players[senderId];
  const receiver = state.players[trade.receiverId];
  if (!sender || !receiver || sender.isBankrupt || receiver.isBankrupt) {
    return { success: false, state, error: { code: 'INVALID_PLAYER', message: 'Invalid trading participant' } };
  }

  if (sender.cash < trade.offeredCash) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: 'Cannot offer more cash than you have' } };
  }

  // Validate sender owns offered properties (and none have houses)
  for (const sId of trade.offeredPropertyIds) {
    const p = getPropertyRecord(state, sId);
    if (p?.ownerId !== senderId) {
      return { success: false, state, error: { code: 'NOT_PROPERTY_OWNER', message: `You do not own space ${sId}` } };
    }
    const space = getBoardSpace(sId);
    if (space.group) {
      const groupHouses = getGroupSpaces(space.group).some((s) => (getPropertyRecord(state, s.id)?.houses ?? 0) > 0);
      if (groupHouses) {
        return { success: false, state, error: { code: 'PROPERTY_HAS_HOUSES', message: 'Cannot trade properties with houses in group' } };
      }
    }
  }

  // Validate receiver owns requested properties (and none have houses)
  for (const sId of trade.requestedPropertyIds) {
    const p = getPropertyRecord(state, sId);
    if (p?.ownerId !== trade.receiverId) {
      return { success: false, state, error: { code: 'RECEIVER_NOT_OWNER', message: `Receiver does not own space ${sId}` } };
    }
    const space = getBoardSpace(sId);
    if (space.group) {
      const groupHouses = getGroupSpaces(space.group).some((s) => (getPropertyRecord(state, s.id)?.houses ?? 0) > 0);
      if (groupHouses) {
        return { success: false, state, error: { code: 'PROPERTY_HAS_HOUSES', message: 'Cannot trade properties with houses in group' } };
      }
    }
  }

  const nextState = cloneGameState(state);
  nextState.pendingTrade = {
    id: `trade_${Date.now()}`,
    senderId,
    receiverId: trade.receiverId,
    offeredCash: trade.offeredCash,
    offeredPropertyIds: [...trade.offeredPropertyIds],
    requestedCash: trade.requestedCash,
    requestedPropertyIds: [...trade.requestedPropertyIds],
  };
  nextState.lastActionMessage = `Trade offer sent to ${trade.receiverId}.`;

  return { success: true, state: nextState };
}

/**
 * Accepts a pending trade offer, transferring assets atomically.
 */
export function processAcceptTrade(state: GameState, receiverId: string): EngineActionResult {
  if (!state.pendingTrade || state.pendingTrade.receiverId !== receiverId) {
    return { success: false, state, error: { code: 'NO_TRADE_OFFER', message: 'No trade offer to accept' } };
  }
  const trade = state.pendingTrade;
  const sender = state.players[trade.senderId];
  const receiver = state.players[trade.receiverId];

  // Re-verify funds & ownership
  if (sender.cash < trade.offeredCash || receiver.cash < trade.requestedCash) {
    return { success: false, state, error: { code: 'INSUFFICIENT_FUNDS', message: 'One party has insufficient cash for trade' } };
  }
  for (const sId of trade.offeredPropertyIds) {
    if (getPropertyRecord(state, sId)?.ownerId !== trade.senderId) {
      return { success: false, state, error: { code: 'OWNERSHIP_CHANGED', message: 'Sender no longer owns offered property' } };
    }
  }
  for (const sId of trade.requestedPropertyIds) {
    if (getPropertyRecord(state, sId)?.ownerId !== trade.receiverId) {
      return { success: false, state, error: { code: 'OWNERSHIP_CHANGED', message: 'Receiver no longer owns requested property' } };
    }
  }

  const nextState = cloneGameState(state);
  const nextSender = nextState.players[trade.senderId];
  const nextReceiver = nextState.players[trade.receiverId];

  // Transfer cash
  nextSender.cash += trade.requestedCash - trade.offeredCash;
  nextReceiver.cash += trade.offeredCash - trade.requestedCash;

  getOrCreatePlayerStats(nextSender).tradesCompleted += 1;
  getOrCreatePlayerStats(nextReceiver).tradesCompleted += 1;

  // Transfer properties
  for (const sId of trade.offeredPropertyIds) {
    nextState.properties[sId].ownerId = trade.receiverId;
  }
  for (const sId of trade.requestedPropertyIds) {
    nextState.properties[sId].ownerId = trade.senderId;
  }

  nextState.pendingTrade = null;
  nextState.lastActionMessage = `Trade completed between ${trade.senderId} and ${trade.receiverId}.`;

  return { success: true, state: nextState };
}

/**
 * Rejects or cancels a pending trade.
 */
export function processRejectTrade(state: GameState, playerId: string): EngineActionResult {
  if (!state.pendingTrade) {
    return { success: false, state, error: { code: 'NO_TRADE_OFFER', message: 'No trade offer to reject' } };
  }
  if (state.pendingTrade.receiverId !== playerId && state.pendingTrade.senderId !== playerId) {
    return { success: false, state, error: { code: 'NOT_TRADE_PARTICIPANT', message: 'Not involved in trade' } };
  }

  const nextState = cloneGameState(state);
  nextState.pendingTrade = null;
  nextState.lastActionMessage = `Trade offer was declined/cancelled.`;

  return { success: true, state: nextState };
}

/**
 * Declares bankruptcy, transferring assets to creditor or clearing back to bank.
 */
export function processDeclareBankruptcy(state: GameState, playerId: string, creditorId?: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  const player = state.players[playerId];
  if (!player || player.isBankrupt) {
    return { success: false, state, error: { code: 'ALREADY_BANKRUPT', message: 'Player is already bankrupt' } };
  }

  const nextState = cloneGameState(state);
  const nextPlayer = nextState.players[playerId];
  nextPlayer.isBankrupt = true;

  if (!nextState.eliminationOrder) {
    nextState.eliminationOrder = [];
  }
  nextState.eliminationOrder.push(playerId);
  getOrCreatePlayerStats(nextPlayer).bankruptcyOrder = nextState.eliminationOrder.length;

  // Transfer cash and properties
  const creditor = creditorId ? nextState.players[creditorId] : undefined;
  if (creditor && !creditor.isBankrupt) {
    creditor.cash += nextPlayer.cash;
    nextPlayer.cash = 0;
    for (const [sIdStr, prop] of Object.entries(nextState.properties)) {
      const sId = Number(sIdStr);
      if (prop.ownerId === playerId) {
        prop.ownerId = creditor.id;
      }
    }
  } else {
    // Bankrupt to bank: all properties return to unowned
    nextPlayer.cash = 0;
    for (const [sIdStr, prop] of Object.entries(nextState.properties)) {
      const sId = Number(sIdStr);
      if (prop.ownerId === playerId) {
        delete nextState.properties[sId];
      }
    }
  }

  // Remove from turn order
  nextState.turnOrder = nextState.turnOrder.filter((id) => id !== playerId);

  // If only 1 player remains, finish game!
  if (nextState.turnOrder.length <= 1) {
    nextState.phase = 'finished';
    nextState.winnerId = nextState.turnOrder[0];
    nextState.lastActionMessage = `Player ${playerId} declared bankruptcy! Game over! Winner is ${nextState.winnerId}!`;
    return { success: true, state: nextState };
  }

  // Advance turn if bankrupt player was active
  if (nextState.activePlayerId === playerId) {
    const nextIndex = nextState.currentTurnIndex % nextState.turnOrder.length;
    nextState.currentTurnIndex = nextIndex;
    nextState.activePlayerId = nextState.turnOrder[nextIndex];
    nextState.turnPhase = 'need_roll';
  }

  nextState.lastActionMessage = `Player ${playerId} declared bankruptcy.`;
  return { success: true, state: nextState };
}

/**
 * Authoritatively ends active player's turn and advances turn sequence.
 */
export function processEndTurn(state: GameState, playerId: string): EngineActionResult {
  if (state.phase !== 'in_progress') {
    return { success: false, state, error: { code: 'GAME_NOT_IN_PROGRESS', message: 'Game is not in progress' } };
  }
  if (state.activePlayerId !== playerId) {
    return { success: false, state, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to end' } };
  }
  if (state.turnPhase === 'need_roll') {
    return { success: false, state, error: { code: 'MUST_ROLL_FIRST', message: 'You must roll before ending turn' } };
  }
  if (state.turnPhase === 'in_auction') {
    return { success: false, state, error: { code: 'AUCTION_IN_PROGRESS', message: 'Cannot end turn while auction is in progress' } };
  }

  const nextState = cloneGameState(state);
  const nextIndex = (nextState.currentTurnIndex + 1) % nextState.turnOrder.length;
  nextState.currentTurnIndex = nextIndex;
  nextState.activePlayerId = nextState.turnOrder[nextIndex];
  nextState.turnPhase = 'need_roll';
  nextState.lastDiceRoll = null;

  const actionSummary = `Player ${playerId} ended turn. Active player is now ${nextState.activePlayerId}.`;
  nextState.lastActionMessage = actionSummary;

  return { success: true, state: nextState };
}

export interface StandingsStateInput {
  phase?: GameLifecyclePhase | string;
  players: Record<string, PlayerGameState>;
  properties: Record<string | number, PropertyRecord | string>;
  winnerId?: string;
  eliminationOrder?: string[];
}

/**
 * Authoritatively calculates net worth for a player:
 * - Bankrupt player: 0
 * - Cash: player.cash
 * - Unmortgaged property: space.price
 * - Mortgaged property: Math.floor(space.price / 2)
 * - Houses (1-4): houses * houseCost
 * - Hotel (houses === 5): 5 * houseCost
 */
export function calculatePlayerNetWorth(
  state: {
    players: Record<string, PlayerGameState>;
    properties: Record<string | number, PropertyRecord | string>;
  },
  playerId: string
): number {
  const player = state.players[playerId];
  if (!player || player.isBankrupt) {
    return 0;
  }

  let total = player.cash;

  for (const [spaceIdStr, prop] of Object.entries(state.properties)) {
    const sId = Number(spaceIdStr);
    const rec = typeof prop === 'string' ? { ownerId: prop, houses: 0, isMortgaged: false } : prop;
    if (rec.ownerId === playerId) {
      const space = getBoardSpace(sId);
      if (space && space.price) {
        if (rec.isMortgaged) {
          total += Math.floor(space.price / 2);
        } else {
          total += space.price;
        }

        if (rec.houses > 0 && space.houseCost) {
          total += rec.houses * space.houseCost;
        }
      }
    }
  }

  return total;
}

/**
 * Calculates final competitive tournament player standings:
 * 1. Winner is #1 if state.winnerId is defined.
 * 2. Active (non-bankrupt) players ranked descending by net worth (tie-breaker: cash).
 * 3. Bankrupt players ranked in reverse order of elimination (last eliminated ranks higher).
 */
export function calculateStandings(
  state: StandingsStateInput,
  roomPlayers: Array<{ id: string; nickname?: string; avatar?: string }> = []
): PlayerStanding[] {
  const playerMap = new Map<string, { id: string; nickname: string; avatar: string }>();
  for (const rp of roomPlayers) {
    playerMap.set(rp.id, {
      id: rp.id,
      nickname: rp.nickname || `Player ${rp.id.slice(0, 4)}`,
      avatar: rp.avatar || '🟢',
    });
  }

  const allPlayerIds = Object.keys(state.players);

  // Group into active vs bankrupt
  const activeIds: string[] = [];
  const bankruptIds: string[] = [];

  for (const id of allPlayerIds) {
    if (state.players[id].isBankrupt) {
      bankruptIds.push(id);
    } else {
      activeIds.push(id);
    }
  }

  // Active players sorting:
  // If winnerId is set and is an active player, winnerId is placed first.
  // Other active players are sorted by netWorth desc, then cash desc, then deterministic ID.
  const isWinnerActive = Boolean(
    state.winnerId &&
    state.players[state.winnerId] &&
    !state.players[state.winnerId].isBankrupt
  );

  const activeWithNetWorth = activeIds.map((id) => ({
    id,
    netWorth: calculatePlayerNetWorth(state, id),
    cash: state.players[id].cash,
  }));

  activeWithNetWorth.sort((a, b) => {
    if (isWinnerActive && state.winnerId) {
      if (a.id === state.winnerId) return -1;
      if (b.id === state.winnerId) return 1;
    }
    if (b.netWorth !== a.netWorth) {
      return b.netWorth - a.netWorth;
    }
    if (b.cash !== a.cash) {
      return b.cash - a.cash;
    }
    return a.id.localeCompare(b.id);
  });

  // Bankrupt players sorting:
  // Reverse elimination order (last eliminated ranks higher).
  const elimOrder = state.eliminationOrder ?? [];
  bankruptIds.sort((a, b) => {
    const idxA = elimOrder.indexOf(a);
    const idxB = elimOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) {
      return idxB - idxA;
    }
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    const orderA = state.players[a]?.stats?.bankruptcyOrder ?? 0;
    const orderB = state.players[b]?.stats?.bankruptcyOrder ?? 0;
    if (orderA !== orderB) {
      return orderB - orderA;
    }
    return a.localeCompare(b);
  });

  const sortedPlayerIds = [
    ...activeWithNetWorth.map((p) => p.id),
    ...bankruptIds,
  ];

  const standings: PlayerStanding[] = sortedPlayerIds.map((id, index) => {
    const playerState = state.players[id];
    const rp = playerMap.get(id);

    // Collect owned properties
    const ownedProperties: number[] = [];
    for (const [spaceIdStr, prop] of Object.entries(state.properties)) {
      const sId = Number(spaceIdStr);
      const rec = typeof prop === 'string' ? { ownerId: prop } : prop;
      if (rec.ownerId === id) {
        ownedProperties.push(sId);
      }
    }
    ownedProperties.sort((a, b) => a - b);

    return {
      rank: index + 1,
      playerId: id,
      nickname: rp?.nickname || `Player ${id.slice(0, 4)}`,
      avatar: rp?.avatar || '🟢',
      netWorth: calculatePlayerNetWorth(state, id),
      cash: playerState.cash,
      isBankrupt: playerState.isBankrupt,
      propertyCount: ownedProperties.length,
      properties: ownedProperties,
      stats: playerState.stats
        ? { ...playerState.stats }
        : {
            rentPaid: 0,
            rentReceived: 0,
            propertiesBought: 0,
            tradesCompleted: 0,
            auctionsWon: 0,
            buildingsBuilt: 0,
          },
    };
  });

  return standings;
}
