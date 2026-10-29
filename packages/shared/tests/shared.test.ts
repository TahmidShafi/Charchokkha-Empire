import { describe, expect, it } from 'vitest';
import {
  CreateRoomPayloadSchema,
  HealthCheckResponseSchema,
  JoinRoomPayloadSchema,
  PingPayloadSchema,
  PongPayloadSchema,
  RoomSnapshotSchema,
  SendChatPayloadSchema,
  SocketErrorSchema,
  GameStateSchema,
  StartGamePayloadSchema,
  RollDicePayloadSchema,
  BuyPropertyPayloadSchema,
  EndTurnPayloadSchema,
  PLAYER_COLORS,
  PLAYER_COLOR_HEXES,
  PlayerSchema,
  SelectColorPayloadSchema,
} from '../src/index.js';

describe('Shared Zod Schemas', () => {
  describe('PingPayloadSchema', () => {
    it('accepts valid ping payloads', () => {
      const valid = {
        message: 'Smoke test message',
        timestamp: 1700000000000,
      };
      const result = PingPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Smoke test message');
        expect(result.data.timestamp).toBe(1700000000000);
      }
    });

    it('rejects empty messages', () => {
      const invalid = {
        message: '   ',
        timestamp: 1700000000000,
      };
      const result = PingPayloadSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects messages longer than 100 characters', () => {
      const invalid = {
        message: 'a'.repeat(101),
        timestamp: 1700000000000,
      };
      const result = PingPayloadSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects missing timestamp or non-positive timestamps', () => {
      expect(PingPayloadSchema.safeParse({ message: 'hello' }).success).toBe(false);
      expect(PingPayloadSchema.safeParse({ message: 'hello', timestamp: 0 }).success).toBe(false);
      expect(PingPayloadSchema.safeParse({ message: 'hello', timestamp: -5 }).success).toBe(false);
      expect(PingPayloadSchema.safeParse({ message: 'hello', timestamp: 'not-a-number' }).success).toBe(false);
    });
  });

  describe('PongPayloadSchema', () => {
    it('validates pong response', () => {
      const valid = {
        reply: 'pong',
        receivedAt: 1700000000000,
        echoMessage: 'Smoke test message',
      };
      const result = PongPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('HealthCheckResponseSchema', () => {
    it('validates health response', () => {
      const valid = {
        status: 'ok',
        service: 'charchokkha-server',
        uptime: 123.45,
        timestamp: new Date().toISOString(),
      };
      const result = HealthCheckResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects non-ok status', () => {
      const invalid = {
        status: 'degraded',
        service: 'charchokkha-server',
        uptime: 123,
        timestamp: new Date().toISOString(),
      };
      const result = HealthCheckResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('SocketErrorSchema', () => {
    it('validates error response', () => {
      const valid = {
        code: 'INVALID_PAYLOAD',
        message: 'Validation failed',
        details: { issues: ['bad field'] },
      };
      const result = SocketErrorSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('Milestone 2 Room & Session Schemas', () => {
    it('validates CreateRoomPayloadSchema with valid and invalid values', () => {
      expect(CreateRoomPayloadSchema.safeParse({ nickname: 'Hateful Escape' }).success).toBe(true);
      expect(CreateRoomPayloadSchema.safeParse({ nickname: '' }).success).toBe(false);
      expect(CreateRoomPayloadSchema.safeParse({ nickname: 'a'.repeat(30) }).success).toBe(false);
    });

    it('validates JoinRoomPayloadSchema', () => {
      expect(
        JoinRoomPayloadSchema.safeParse({
          roomCode: '6rk2v',
          nickname: 'Guest Player',
        }).success
      ).toBe(true);

      // Too short roomCode
      expect(
        JoinRoomPayloadSchema.safeParse({
          roomCode: '1',
          nickname: 'Guest Player',
        }).success
      ).toBe(false);
    });

    it('validates RoomSnapshotSchema with full state and players', () => {
      const snapshot = {
        code: '6rk2v',
        hostId: 'session-host-1',
        state: 'waiting' as const,
        sequenceNumber: 1,
        settings: {
          maxPlayers: 4,
          isPrivate: true,
          allowBots: false,
          startingCash: 1500,
        },
        players: [
          {
            id: 'session-host-1',
            nickname: 'Hateful Escape',
            avatar: '🟢',
            isHost: true,
            connected: true,
            seatIndex: 0,
          },
        ],
        createdAt: Date.now(),
      };

      const result = RoomSnapshotSchema.safeParse(snapshot);
      expect(result.success).toBe(true);
    });

    it('validates SendChatPayloadSchema', () => {
      expect(
        SendChatPayloadSchema.safeParse({
          roomCode: '6rk2v',
          text: 'Good luck have fun!',
        }).success
      ).toBe(true);

      expect(
        SendChatPayloadSchema.safeParse({
          roomCode: '6rk2v',
          text: '',
        }).success
      ).toBe(false);
    });

    it('validates GameStateSchema with turn order, players, and property ownership', () => {
      const validGameState = {
        phase: 'in_progress' as const,
        turnOrder: ['p1', 'p2'],
        currentTurnIndex: 0,
        activePlayerId: 'p1',
        turnPhase: 'need_roll' as const,
        lastDiceRoll: {
          die1: 3,
          die2: 4,
          total: 7,
          isDouble: false,
        },
        players: {
          p1: { id: 'p1', position: 7, cash: 1500, isBankrupt: false },
          p2: { id: 'p2', position: 0, cash: 1500, isBankrupt: false },
        },
        properties: {
          '1': 'p1',
        },
        lastActionMessage: 'Rolled 7',
        startingSalary: 200,
      };

      const res = GameStateSchema.safeParse(validGameState);
      expect(res.success).toBe(true);
    });

    it('validates Milestone 3 game action payloads', () => {
      expect(StartGamePayloadSchema.safeParse({ roomCode: 'ROOM1' }).success).toBe(true);
      expect(StartGamePayloadSchema.safeParse({ roomCode: '' }).success).toBe(false);

      expect(RollDicePayloadSchema.safeParse({ roomCode: 'ROOM1' }).success).toBe(true);
      expect(RollDicePayloadSchema.safeParse({}).success).toBe(false);

      expect(BuyPropertyPayloadSchema.safeParse({ roomCode: 'ROOM1' }).success).toBe(true);
      expect(EndTurnPayloadSchema.safeParse({ roomCode: 'ROOM1' }).success).toBe(true);
    });

    it('validates 8 canonical player colors and color payload schemas', () => {
      expect(PLAYER_COLORS).toHaveLength(8);
      expect(PLAYER_COLOR_HEXES).toHaveLength(8);

      const expectedColors = [
        '#C4E64A',
        '#FFC83D',
        '#FF8738',
        '#D7474D',
        '#559BD6',
        '#70DDE8',
        '#00A99A',
        '#69E653',
      ];
      expect(PLAYER_COLOR_HEXES).toEqual(expectedColors);

      const parsedPlayer = PlayerSchema.safeParse({
        id: 'p1',
        nickname: 'Alice',
        isHost: true,
        connected: true,
        seatIndex: 0,
        color: '#559BD6',
      });
      expect(parsedPlayer.success).toBe(true);
      if (parsedPlayer.success) {
        expect(parsedPlayer.data.color).toBe('#559BD6');
      }

      // Default color
      const defaultPlayer = PlayerSchema.safeParse({
        id: 'p2',
        nickname: 'Bob',
        isHost: false,
        connected: true,
        seatIndex: 1,
      });
      expect(defaultPlayer.success).toBe(true);
      if (defaultPlayer.success) {
        expect(defaultPlayer.data.color).toBe('#C4E64A');
      }

      expect(
        SelectColorPayloadSchema.safeParse({
          roomCode: 'ABCD',
          color: '#FF8738',
        }).success
      ).toBe(true);

      expect(
        CreateRoomPayloadSchema.safeParse({
          nickname: 'Host',
          color: '#C4E64A',
        }).success
      ).toBe(true);

      expect(
        JoinRoomPayloadSchema.safeParse({
          roomCode: 'ABCD',
          nickname: 'Guest',
          color: '#FFC83D',
        }).success
      ).toBe(true);
    });
  });
});
