import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLAYER_COLORS, PLAYER_COLOR_HEXES, type RoomSnapshot } from '@charchokkha/shared';
import { PlayerCharacter } from '../src/components/PlayerCharacter.js';
import { Board } from '../src/components/Board.js';
import { LandingPage } from '../src/components/LandingPage.js';

describe('Player Character & Dynamic Ownership Colors Suite', () => {
  it('defines the 8 exact canonical player colors with matching hex codes', () => {
    expect(PLAYER_COLORS).toHaveLength(8);
    const expected = [
      { id: 'lime', name: 'Lime Green', hex: '#C4E64A' },
      { id: 'yellow', name: 'Golden Yellow', hex: '#FFC83D' },
      { id: 'orange', name: 'Orange', hex: '#FF8738' },
      { id: 'red', name: 'Red', hex: '#D7474D' },
      { id: 'blue', name: 'Blue', hex: '#559BD6' },
      { id: 'cyan', name: 'Cyan', hex: '#70DDE8' },
      { id: 'teal', name: 'Teal', hex: '#00A99A' },
      { id: 'bright_green', name: 'Bright Green', hex: '#69E653' },
    ];

    expect(PLAYER_COLORS).toEqual(expected);
    expect(PLAYER_COLOR_HEXES).toEqual(expected.map((c) => c.hex));
  });

  it('renders cute human-like SVG character completely filled with player color', () => {
    const testColor = '#FF8738'; // Orange
    const html = renderToStaticMarkup(
      React.createElement(PlayerCharacter, {
        color: testColor,
        size: 32,
        title: 'Player Token',
      })
    );

    // Human silhouette: SVG elements
    expect(html).toContain('<svg');
    expect(html).toContain('player-character-wrapper');
    // Filled with player color
    expect(html).toContain(`fill="${testColor}"`);
    // Ground shadow
    expect(html).toContain('ellipse');
    // Torso, legs, arms, head
    expect(html).toContain('rect');
    expect(html).toContain('path');
    expect(html).toContain('circle');
  });

  it('renders selection bounce, glow ring, and hopping animation states', () => {
    const selectedHtml = renderToStaticMarkup(
      React.createElement(PlayerCharacter, {
        color: '#559BD6',
        isSelected: true,
      })
    );
    expect(selectedHtml).toContain('character-selected');
    expect(selectedHtml).toContain('character-glow-ring');

    const hoppingHtml = renderToStaticMarkup(
      React.createElement(PlayerCharacter, {
        color: '#559BD6',
        isHopping: true,
      })
    );
    expect(hoppingHtml).toContain('character-hopping');

    const takenHtml = renderToStaticMarkup(
      React.createElement(PlayerCharacter, {
        color: '#D7474D',
        isTaken: true,
      })
    );
    expect(takenHtml).toContain('character-taken');
    expect(takenHtml).toContain('character-taken-mark');
  });

  it('renders landing page with 8-character color selection and marks taken colors', () => {
    const taken = ['#C4E64A', '#D7474D'];
    const html = renderToStaticMarkup(
      React.createElement(LandingPage, {
        nickname: 'Alice',
        onNicknameChange: () => {},
        onPlay: () => {},
        onCreatePrivate: () => {},
        onJoinByCode: () => {},
        takenColors: taken,
      })
    );

    expect(html).toContain('landing-character-picker');
    expect(html).toContain('character-preview-ring');
    expect(html).toContain('character-palette-row');

    // 8 swatch buttons
    for (const col of PLAYER_COLORS) {
      expect(html).toContain(col.name);
    }

    // Taken colors have chip-taken class and disabled attribute
    expect(html).toContain('chip-taken');
    expect(html).toContain('disabled=""');
  });

  it('verifies unowned properties have NO ownership strip or glow and keep dark-purple background', () => {
    const mockSnapshot: RoomSnapshot = {
      code: 'TEST1',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 1,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 4,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: false,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        {
          id: 'p1',
          nickname: 'Alice',
          avatar: '🟢',
          color: '#559BD6', // Blue
          isHost: true,
          connected: true,
          seatIndex: 0,
        },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll',
        lastDiceRoll: null,
        players: {
          p1: { id: 'p1', position: 0, cash: 1500, isBankrupt: false, inPrison: false, prisonTurns: 0 },
        },
        properties: {}, // ALL PROPERTIES UNOWNED!
        startingSalary: 200,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TEST1',
        roomSnapshot: mockSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
        isRolling: false,
        isSubmittingAction: false,
      })
    );

    // NO tile-ownership-strip should be rendered anywhere on the board!
    expect(html).not.toContain('tile-ownership-strip');
    expect(html).not.toContain('tile-ownership-chip');

    // Board tiles are present
    expect(html).toContain('id="space-1"'); // Rahattarpool
    expect(html).toContain('id="space-3"'); // Chandgaon
    expect(html).toContain('Rahattarpool');
    expect(html).toContain('Chandgaon');
  });

  it('renders dynamic ownership strip matching the owner player color when owned', () => {
    const aliceColor = '#FF8738'; // Orange
    const bobColor = '#00A99A'; // Teal

    const mockSnapshot: RoomSnapshot = {
      code: 'TEST2',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 2,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 4,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: false,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        {
          id: 'p1',
          nickname: 'Alice',
          avatar: '🟢',
          color: aliceColor,
          isHost: true,
          connected: true,
          seatIndex: 0,
        },
        {
          id: 'p2',
          nickname: 'Bob',
          avatar: '🎩',
          color: bobColor,
          isHost: false,
          connected: true,
          seatIndex: 1,
        },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1', 'p2'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll',
        lastDiceRoll: null,
        players: {
          p1: { id: 'p1', position: 0, cash: 1500, isBankrupt: false, inPrison: false, prisonTurns: 0 },
          p2: { id: 'p2', position: 0, cash: 1500, isBankrupt: false, inPrison: false, prisonTurns: 0 },
        },
        properties: {
          '1': { ownerId: 'p1', houses: 0, isMortgaged: false }, // Space 1 (Rahattarpool) owned by Alice
          '3': { ownerId: 'p2', houses: 0, isMortgaged: false }, // Space 3 (Chandgaon) owned by Bob
        },
        startingSalary: 200,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TEST2',
        roomSnapshot: mockSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
        isRolling: false,
        isSubmittingAction: false,
      })
    );

    // Space 1 owned by Alice: ownership strip background is Alice's color (#FF8738)
    expect(html).toContain('tile-ownership-strip');
    expect(html).toContain(`background-color:${aliceColor}`);
    expect(html).toContain(`background-color:${bobColor}`);

    // Ownership communicated through COLOR ONLY - NO owner nickname chips or text on tiles
    expect(html).not.toContain('tile-ownership-chip');
    expect(html).not.toContain('owner-name-abbr');

    // Tokens on board render human-like figurines
    expect(html).toContain('player-board-token');
    expect(html).toContain(`fill="${aliceColor}"`);
    expect(html).toContain(`fill="${bobColor}"`);
  });

  it('suppresses redundant purchase success notifications from the board ticker while preserving other action alerts', () => {
    const purchaseSnapshot: RoomSnapshot = {
      code: 'TEST3',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 3,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 4,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: false,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        { id: 'p1', nickname: 'Alice', avatar: '🟢', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'action_pending',
        lastDiceRoll: null,
        lastActionMessage: 'Purchased Rahattarpool for $60. Balance: $1440',
        players: {
          p1: { id: 'p1', position: 1, cash: 1440, isBankrupt: false, inPrison: false, prisonTurns: 0 },
        },
        properties: {
          '1': { ownerId: 'p1', houses: 0, isMortgaged: false },
        },
        startingSalary: 200,
      },
    };

    const purchaseHtml = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TEST3',
        roomSnapshot: purchaseSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
        isRolling: false,
        isSubmittingAction: false,
      })
    );

    // Redundant purchase message must NOT be shown in the central courtyard ticker
    expect(purchaseHtml).not.toContain('Purchased Rahattarpool for $60');
    expect(purchaseHtml).not.toContain('courtyard-action-ticker');

    // Rent action messages DO render in the courtyard action ticker
    const rentSnapshot: RoomSnapshot = {
      ...purchaseSnapshot,
      gameState: {
        ...purchaseSnapshot.gameState!,
        lastActionMessage: 'Paid $100 rent to Bob on Mithagoli',
      },
    };

    const rentHtml = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TEST3',
        roomSnapshot: rentSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
        isRolling: false,
        isSubmittingAction: false,
      })
    );

    expect(rentHtml).toContain('courtyard-action-ticker');
    expect(rentHtml).toContain('Paid $100 rent to Bob on Mithagoli');
  });

  it('renders orientation-specific classes for vertical and horizontal tiles', () => {
    const mockSnapshot: RoomSnapshot = {
      code: 'TEST4',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 4,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 4,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: false,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        { id: 'p1', nickname: 'Alice', avatar: '🟢', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll',
        lastDiceRoll: null,
        players: {
          p1: { id: 'p1', position: 0, cash: 1500, isBankrupt: false, inPrison: false, prisonTurns: 0 },
        },
        properties: {},
        startingSalary: 200,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TEST4',
        roomSnapshot: mockSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
        isRolling: false,
        isSubmittingAction: false,
      })
    );

    // Top and bottom track tiles receive tile-edge-vertical
    expect(html).toContain('tile-edge-vertical');
    // Left and right track tiles receive tile-edge-horizontal
    expect(html).toContain('tile-edge-horizontal');
    // Corner tiles receive tile-corner
    expect(html).toContain('tile-corner');
  });
});
