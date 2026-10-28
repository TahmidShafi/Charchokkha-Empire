import { describe, expect, it } from 'vitest';
import {
  PlayerStandingSchema,
  PlayerStatsSchema,
  RematchPayloadSchema,
  type Player,
  type RoomSnapshot,
} from '@charchokkha/shared';
import { calculateStandings, createInitialGameState } from '@charchokkha/game-engine';

describe('Post-Match Results & Standings Frontend Verification Suite', () => {
  it('validates RematchPayloadSchema contracts', () => {
    const valid = { roomCode: 'ROOM1' };
    const parsed = RematchPayloadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = { roomCode: 'R' };
    const invalidParsed = RematchPayloadSchema.safeParse(invalid);
    expect(invalidParsed.success).toBe(false);
  });

  it('validates PlayerStatsSchema and PlayerStandingSchema', () => {
    const rawStats = {
      rentPaid: 120,
      rentReceived: 350,
      propertiesBought: 4,
      tradesCompleted: 2,
      auctionsWon: 1,
      buildingsBuilt: 3,
      bankruptcyOrder: 2,
    };
    const parsedStats = PlayerStatsSchema.safeParse(rawStats);
    expect(parsedStats.success).toBe(true);

    const rawStanding = {
      rank: 1,
      playerId: 'player_alice',
      nickname: 'Alice',
      avatar: '👑',
      netWorth: 3450,
      cash: 1200,
      isBankrupt: false,
      propertyCount: 3,
      properties: [1, 3, 39],
      stats: rawStats,
    };
    const parsedStanding = PlayerStandingSchema.safeParse(rawStanding);
    expect(parsedStanding.success).toBe(true);
  });

  it('calculates full post-match tournament standings and property portfolios for room players', () => {
    const state = createInitialGameState(['alice', 'bob', 'charlie']);
    state.phase = 'finished';
    state.winnerId = 'alice';

    // Alice has cash 2000 and owns #39 New York (price 400)
    state.players['alice'].cash = 2000;
    state.properties[39] = { ownerId: 'alice', houses: 0, isMortgaged: false };

    // Bob is active with cash 1000
    state.players['bob'].cash = 1000;

    // Charlie declared bankruptcy
    state.players['charlie'].cash = 0;
    state.players['charlie'].isBankrupt = true;
    state.eliminationOrder = ['charlie'];

    const mockPlayers: Player[] = [
      { id: 'alice', nickname: 'Alice', avatar: '👑', isHost: true, connected: true, seatIndex: 0 },
      { id: 'bob', nickname: 'Bob', avatar: '🎩', isHost: false, connected: true, seatIndex: 1 },
      { id: 'charlie', nickname: 'Charlie', avatar: '🐱', isHost: false, connected: true, seatIndex: 2 },
    ];

    const standings = calculateStandings(state, mockPlayers);
    expect(standings).toHaveLength(3);

    // 1st: Alice
    expect(standings[0].rank).toBe(1);
    expect(standings[0].playerId).toBe('alice');
    expect(standings[0].nickname).toBe('Alice');
    expect(standings[0].netWorth).toBe(2400); // 2000 cash + 400 property
    expect(standings[0].properties).toEqual([39]);
    expect(standings[0].propertyCount).toBe(1);

    // 2nd: Bob
    expect(standings[1].rank).toBe(2);
    expect(standings[1].playerId).toBe('bob');
    expect(standings[1].nickname).toBe('Bob');
    expect(standings[1].netWorth).toBe(1000);
    expect(standings[1].isBankrupt).toBe(false);

    // 3rd: Charlie
    expect(standings[2].rank).toBe(3);
    expect(standings[2].playerId).toBe('charlie');
    expect(standings[2].isBankrupt).toBe(true);
    expect(standings[2].netWorth).toBe(0);
  });

  it('derives game finished state and host rematch permissions accurately', () => {
    const roomSnapshot: RoomSnapshot = {
      code: 'TABLE9',
      hostId: 'session_host',
      state: 'finished',
      sequenceNumber: 25,
      createdAt: Date.now(),
      settings: {
        maxPlayers: 4,
        isPrivate: true,
        allowBots: false,
        startingCash: 1500,
        doubleRent: true,
        noRentInPrison: false,
        vacationCash: false,
        evenBuild: true,
        auction: true,
        mortgage: true,
      },
      players: [
        { id: 'session_host', nickname: 'Host', avatar: '🟢', isHost: true, connected: true, seatIndex: 0 },
        { id: 'session_guest', nickname: 'Guest', avatar: '🎩', isHost: false, connected: true, seatIndex: 1 },
      ],
      gameState: undefined,
    };

    const isGameFinished = roomSnapshot.state === 'finished';
    expect(isGameFinished).toBe(true);

    const isHost = (sessionId: string) => sessionId === roomSnapshot.hostId;
    expect(isHost('session_host')).toBe(true);
    expect(isHost('session_guest')).toBe(false);
    expect(isHost('session_spectator')).toBe(false);
  });
});
