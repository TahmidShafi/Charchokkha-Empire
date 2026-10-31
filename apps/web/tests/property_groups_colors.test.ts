import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PROPERTY_GROUPS,
  getSpacePropertyGroup,
  getSpaceGroupColor,
  getPropertiesInGroup,
} from '../src/boardData';
import { CANONICAL_BOARD_SPACES } from '@charchokkha/game-engine';
import { Board } from '../src/components/Board';
import type { RoomSnapshot } from '@charchokkha/shared';

describe('10 Color-Coded Property Groups System', () => {
  it('correctly defines all 10 property groups with canonical property IDs and dark-theme palette', () => {
    const expectedGroups = [
      { id: 1, colorName: 'Rose', color: '#F472B6', propertyIds: [1, 3] },
      { id: 2, colorName: 'Orange', color: '#FB923C', propertyIds: [5, 7, 8] },
      { id: 3, colorName: 'Sky Blue', color: '#38BDF8', propertyIds: [10, 11] },
      { id: 4, colorName: 'Emerald', color: '#34D399', propertyIds: [13, 14, 16, 17] },
      { id: 5, colorName: 'Amber', color: '#FBBF24', propertyIds: [19, 21, 23] },
      { id: 6, colorName: 'Violet', color: '#A78BFA', propertyIds: [25, 27, 29] },
      { id: 7, colorName: 'Red', color: '#F87171', propertyIds: [31, 32] },
      { id: 8, colorName: 'Cyan', color: '#22D3EE', propertyIds: [34, 35] },
      { id: 9, colorName: 'Brown', color: '#C08457', propertyIds: [37, 38, 40, 41] },
      { id: 10, colorName: 'Silver', color: '#CBD5E1', propertyIds: [43, 45, 47] },
    ];

    expect(Object.keys(PROPERTY_GROUPS).length).toBe(10);

    for (const exp of expectedGroups) {
      const def = PROPERTY_GROUPS[exp.id];
      expect(def).toBeDefined();
      expect(def.id).toBe(exp.id);
      expect(def.colorName).toBe(exp.colorName);
      expect(def.color.toUpperCase()).toBe(exp.color.toUpperCase());
      expect(def.propertyIds).toEqual(exp.propertyIds);
    }
  });

  it('guarantees all 10 group colors are mutually distinct', () => {
    const colors = Object.values(PROPERTY_GROUPS).map((g) => g.color.toLowerCase());
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(10);
  });

  it('maps every one of the 28 purchasable city properties to its correct group', () => {
    const allAssignedIds = Object.values(PROPERTY_GROUPS).flatMap((g) => g.propertyIds);
    expect(allAssignedIds.length).toBe(28);

    // Verify all 28 correspond to type 'property' in CANONICAL_BOARD_SPACES
    for (const id of allAssignedIds) {
      const space = CANONICAL_BOARD_SPACES.find((s) => s.id === id);
      expect(space).toBeDefined();
      expect(space?.type).toBe('property');

      const groupDef = getSpacePropertyGroup(id);
      expect(groupDef).toBeDefined();
      expect(groupDef?.propertyIds).toContain(id);

      const color = getSpaceGroupColor(id);
      expect(color).toBe(groupDef?.color);
    }
  });

  it('every property in a group receives the exact same group color', () => {
    for (let groupId = 1; groupId <= 10; groupId++) {
      const propIds = getPropertiesInGroup(groupId);
      expect(propIds.length).toBeGreaterThan(0);

      const colors = propIds.map((id) => getSpaceGroupColor(id));
      const firstColor = colors[0];
      for (const color of colors) {
        expect(color).toBe(firstColor);
      }
    }
  });

  it('returns undefined for non-property spaces (corners, tax, cards, airports, utilities)', () => {
    const nonPropertySpaces = [0, 2, 4, 6, 9, 12, 15, 18, 20, 22, 24, 26, 28, 30, 33, 36, 39, 42, 44, 46];
    for (const id of nonPropertySpaces) {
      expect(getSpacePropertyGroup(id)).toBeUndefined();
      expect(getSpaceGroupColor(id)).toBeUndefined();
    }
  });

  it('renders permanent group color strip whether property is unowned or owned', () => {
    const mockSnapshotUnowned: RoomSnapshot = {
      code: 'PROPTEST1',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 1,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 2,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: true,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#22c55e', isHost: true, connected: true, seatIndex: 0 },
        { id: 'p2', nickname: 'Bob', avatar: '🎩', color: '#ec4899', isHost: false, connected: true, seatIndex: 1 },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1', 'p2'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll',
        lastDiceRoll: { die1: 1, die2: 2, total: 3, isDouble: false },
        startingSalary: 200,
        vacationPot: 0,
        players: {
          p1: { id: 'p1', position: 0, cash: 1500, inPrison: false, prisonTurns: 0, isBankrupt: false },
          p2: { id: 'p2', position: 0, cash: 1500, inPrison: false, prisonTurns: 0, isBankrupt: false },
        },
        properties: {},
        rules: {
          doubleRent: true,
          vacationCash: true,
          auction: true,
          noRentInPrison: false,
          mortgage: true,
          evenBuild: true,
        },
      },
    };

    const htmlUnowned = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'PROPTEST1',
        roomSnapshot: mockSnapshotUnowned,
        currentSessionId: 'p1',
        isHost: true,
        isRolling: false,
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
      })
    );

    // Space 1 is Rahattarpool (Group 1: Rose #F472B6)
    // Permanent group color strip is present even when unowned
    expect(htmlUnowned).toContain('tile-group-color-strip');
    expect(htmlUnowned).toContain('background-color:#F472B6');

    // Now test when owned by Alice (#22c55e)
    const mockSnapshotOwned: RoomSnapshot = {
      ...mockSnapshotUnowned,
      gameState: {
        ...mockSnapshotUnowned.gameState!,
        properties: {
          1: { ownerId: 'p1', houses: 0, isMortgaged: false },
        },
      },
    };

    const htmlOwned = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'PROPTEST1',
        roomSnapshot: mockSnapshotOwned,
        currentSessionId: 'p1',
        isHost: true,
        isRolling: false,
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
      })
    );

    // Group color strip is STILL permanent Rose #F472B6 (never changes to player color)
    expect(htmlOwned).toContain('background-color:#F472B6');
    // Owner indicator is present displaying Alice's player color (#22c55e)
    expect(htmlOwned).toContain('tile-owner-indicator');
    expect(htmlOwned).toContain('background-color:#22c55e');
  });

  it('renders houses/hotels without hiding group color strip', () => {
    const mockSnapshotBuildings: RoomSnapshot = {
      code: 'PROPTEST2',
      hostId: 'p1',
      state: 'in_progress',
      sequenceNumber: 2,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 2,
        isPrivate: false,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        vacationCash: true,
        auction: true,
        noRentInPrison: false,
        mortgage: true,
        evenBuild: true,
      },
      players: [
        { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#a855f7', isHost: true, connected: true, seatIndex: 0 },
        { id: 'p2', nickname: 'Bob', avatar: '🎩', color: '#ec4899', isHost: false, connected: true, seatIndex: 1 },
      ],
      gameState: {
        phase: 'in_progress',
        turnOrder: ['p1', 'p2'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll',
        lastDiceRoll: { die1: 3, die2: 3, total: 6, isDouble: true },
        startingSalary: 200,
        vacationPot: 0,
        players: {
          p1: { id: 'p1', position: 0, cash: 1500, inPrison: false, prisonTurns: 0, isBankrupt: false },
          p2: { id: 'p2', position: 0, cash: 1500, inPrison: false, prisonTurns: 0, isBankrupt: false },
        },
        properties: {
          1: { ownerId: 'p1', houses: 3, isMortgaged: false },
          3: { ownerId: 'p1', houses: 5, isMortgaged: false }, // Hotel
        },
        rules: {
          doubleRent: true,
          vacationCash: true,
          auction: true,
          noRentInPrison: false,
          mortgage: true,
          evenBuild: true,
        },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'PROPTEST2',
        roomSnapshot: mockSnapshotBuildings,
        currentSessionId: 'p1',
        isHost: true,
        isRolling: false,
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
      })
    );

    // Both buildings and group strip are present
    expect(html).toContain('tile-improvements-strip');
    expect(html).toContain('hotel-improvement-chip');
    expect(html).toContain('tile-group-color-strip');
    expect(html).toContain('background-color:#F472B6');
  });
});
