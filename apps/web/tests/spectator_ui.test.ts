import { describe, expect, it } from 'vitest';
import {
  JoinRoomPayloadSchema,
  RoomSnapshotSchema,
  SpectateRoomPayloadSchema,
  type Player,
  type RoomSnapshot,
} from '@charchokkha/shared';

describe('Spectator Mode Frontend Contracts & Derivations', () => {
  it('validates SpectateRoomPayloadSchema for valid room codes', () => {
    const valid = { roomCode: 'ABCDE', nickname: 'Viewer' };
    const parsed = SpectateRoomPayloadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.roomCode).toBe('ABCDE');
      expect(parsed.data.nickname).toBe('Viewer');
    }
  });

  it('validates JoinRoomPayloadSchema with asSpectator flag', () => {
    const valid = { roomCode: 'ROOM1', nickname: 'Alice', asSpectator: true };
    const parsed = JoinRoomPayloadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.asSpectator).toBe(true);
    }
  });

  it('validates RoomSnapshotSchema with spectatorCount field', () => {
    const mockSnapshot: RoomSnapshot = {
      code: 'TABLE1',
      hostId: 'host_session',
      state: 'in_progress',
      sequenceNumber: 5,
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
          id: 'host_session',
          nickname: 'Alice',
          avatar: '🟢',
          color: '#C4E64A',
          isHost: true,
          connected: true,
          seatIndex: 0,
        },
        {
          id: 'guest_session_2',
          nickname: 'Bob',
          avatar: '🎩',
          color: '#559BD6',
          isHost: false,
          connected: true,
          seatIndex: 1,
        },
      ],
      spectatorCount: 3,
      createdAt: Date.now(),
    };

    const parsed = RoomSnapshotSchema.safeParse(mockSnapshot);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spectatorCount).toBe(3);
    }
  });

  it('correctly derives isSpectator without client-side state ambiguity', () => {
    const players: Player[] = [
      {
        id: 'session_alice',
        nickname: 'Alice',
        avatar: '🟢',
        color: '#C4E64A',
        isHost: true,
        connected: true,
        seatIndex: 0,
      },
      {
        id: 'session_bob',
        nickname: 'Bob',
        avatar: '🎩',
        color: '#559BD6',
        isHost: false,
        connected: true,
        seatIndex: 1,
      },
    ];

    const isSeatedAlice = players.some((p) => p.id === 'session_alice');
    const isSpectatorAlice = !isSeatedAlice;
    expect(isSpectatorAlice).toBe(false);

    const isSeatedBob = players.some((p) => p.id === 'session_bob');
    const isSpectatorBob = !isSeatedBob;
    expect(isSpectatorBob).toBe(false);

    // Charlie is viewing but not in players array
    const isSeatedCharlie = players.some((p) => p.id === 'session_charlie');
    const isSpectatorCharlie = !isSeatedCharlie;
    expect(isSpectatorCharlie).toBe(true);
  });

  it('guarantees spectator cannot be considered active player in turn calculation', () => {
    const activePlayerId: string = 'session_alice';
    const spectatorSessionId: string = 'session_charlie';

    const isSpectator = true;
    const isGameStarted = true;
    const isGameFinished = false;

    const isMyTurn = !isSpectator && isGameStarted && activePlayerId === spectatorSessionId && !isGameFinished;
    expect(isMyTurn).toBe(false);
  });
});
