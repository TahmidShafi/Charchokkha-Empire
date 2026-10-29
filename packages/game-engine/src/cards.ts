import { TOTAL_SPACES, getBoardSpace } from './board.js';
import type { GameState } from './engine.js';

export interface GameCard {
  id: string;
  deck: 'treasure' | 'chance';
  text: string;
  apply: (state: GameState, playerId: string) => string;
}

export const TREASURE_CARDS: GameCard[] = [
  {
    id: 'chest_1',
    deck: 'treasure',
    text: 'Bank error in your favor. Collect $200.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 200;
      return 'Bank error in your favor: Collected $200.';
    },
  },
  {
    id: 'chest_2',
    deck: 'treasure',
    text: "Doctor's fee. Pay $50.",
    apply: (state, playerId) => {
      const fee = Math.min(state.players[playerId].cash, 50);
      state.players[playerId].cash -= fee;
      if (state.rules.vacationCash) {
        state.vacationPot = (state.vacationPot ?? 0) + fee;
      }
      return `Doctor's fee: Paid $${fee}.`;
    },
  },
  {
    id: 'chest_3',
    deck: 'treasure',
    text: 'From sale of stock you get $50.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 50;
      return 'Stock sale: Received $50.';
    },
  },
  {
    id: 'chest_4',
    deck: 'treasure',
    text: 'Holiday fund matures. Receive $100.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 100;
      return 'Holiday fund matures: Received $100.';
    },
  },
  {
    id: 'chest_5',
    deck: 'treasure',
    text: 'Income tax refund. Collect $20.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 20;
      return 'Income tax refund: Collected $20.';
    },
  },
  {
    id: 'chest_6',
    deck: 'treasure',
    text: 'Life insurance matures. Collect $100.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 100;
      return 'Life insurance matures: Collected $100.';
    },
  },
  {
    id: 'chest_7',
    deck: 'treasure',
    text: 'Hospital fees. Pay $100.',
    apply: (state, playerId) => {
      const fee = Math.min(state.players[playerId].cash, 100);
      state.players[playerId].cash -= fee;
      if (state.rules.vacationCash) {
        state.vacationPot = (state.vacationPot ?? 0) + fee;
      }
      return `Hospital fees: Paid $${fee}.`;
    },
  },
  {
    id: 'chest_8',
    deck: 'treasure',
    text: 'You have won second prize in a beauty contest. Collect $10.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 10;
      return 'Beauty contest second prize: Collected $10.';
    },
  },
  {
    id: 'chest_9',
    deck: 'treasure',
    text: 'Go directly to Prison. Do not pass START, do not collect $200.',
    apply: (state, playerId) => {
      state.players[playerId].position = 12;
      state.players[playerId].inPrison = true;
      state.players[playerId].prisonTurns = 0;
      state.turnPhase = 'turn_ended';
      return 'Arrested: Sent directly to Prison!';
    },
  },
];

export const CHANCE_CARDS: GameCard[] = [
  {
    id: 'chance_1',
    deck: 'chance',
    text: 'Advance to START. Collect $200.',
    apply: (state, playerId) => {
      state.players[playerId].position = 0;
      state.players[playerId].cash += state.startingSalary;
      return 'Advance to START: Collected $200.';
    },
  },
  {
    id: 'chance_2',
    deck: 'chance',
    text: 'Bank pays you dividend of $50.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 50;
      return 'Bank dividend: Received $50.';
    },
  },
  {
    id: 'chance_3',
    deck: 'chance',
    text: 'Speeding fine. Pay $15.',
    apply: (state, playerId) => {
      const fee = Math.min(state.players[playerId].cash, 15);
      state.players[playerId].cash -= fee;
      if (state.rules.vacationCash) {
        state.vacationPot = (state.vacationPot ?? 0) + fee;
      }
      return `Speeding fine: Paid $${fee}.`;
    },
  },
  {
    id: 'chance_4',
    deck: 'chance',
    text: 'Your building loan matures. Collect $150.',
    apply: (state, playerId) => {
      state.players[playerId].cash += 150;
      return 'Building loan matures: Received $150.';
    },
  },
  {
    id: 'chance_5',
    deck: 'chance',
    text: 'Advance to Ghuna. If you pass START, collect $200.',
    apply: (state, playerId) => {
      const oldPos = state.players[playerId].position;
      const targetPos = 34; // Ghuna
      if (targetPos < oldPos) {
        state.players[playerId].cash += state.startingSalary;
      }
      state.players[playerId].position = targetPos;
      return 'Advanced to Ghuna.';
    },
  },
  {
    id: 'chance_6',
    deck: 'chance',
    text: 'Go directly to Prison. Do not pass START, do not collect $200.',
    apply: (state, playerId) => {
      state.players[playerId].position = 12;
      state.players[playerId].inPrison = true;
      state.players[playerId].prisonTurns = 0;
      state.turnPhase = 'turn_ended';
      return 'Arrested: Sent directly to Prison!';
    },
  },
];
