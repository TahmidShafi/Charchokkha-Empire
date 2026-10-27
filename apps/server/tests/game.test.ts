import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { createAppServer } from '../src/server.js';

describe('Milestone 3 — Authoritative Game Engine Server Integration Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;

  let client1: ClientSocket; // Host
  let client2: ClientSocket; // Player 2
  let client1Auth: SessionAuthenticatedPayload;
  let client2Auth: SessionAuthenticatedPayload;
  let gameRoomCode: string;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    port = await appServer.start(0, '127.0.0.1');
    serverUrl = `http://127.0.0.1:${port}`;

    // Connect Client 1 (Host)
    client1 = Client(serverUrl, { transports: ['websocket'], reconnection: false });
    const auth1Promise = new Promise<SessionAuthenticatedPayload>((res) => {
      client1.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, res);
    });
    await new Promise<void>((res) => client1.on('connect', () => res()));
    client1Auth = await auth1Promise;

    // Connect Client 2 (Player 2)
    client2 = Client(serverUrl, { transports: ['websocket'], reconnection: false });
    const auth2Promise = new Promise<SessionAuthenticatedPayload>((res) => {
      client2.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, res);
    });
    await new Promise<void>((res) => client2.on('connect', () => res()));
    client2Auth = await auth2Promise;
  });

  afterAll(async () => {
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    await appServer.stop();
  });

  it('creates a room with Client 1 as host', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'HostPlayer', avatar: '🎩', settings: { startingCash: 1500 } },
        resolve
      );
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      gameRoomCode = ack.data.code;
      expect(ack.data.state).toBe('waiting');
      expect(ack.data.players).toHaveLength(1);
    }
  });

  it('rejects game start when minimum player count (< 2) is not met', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_START, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('INSUFFICIENT_PLAYERS');
    }
  });

  it('client 2 joins the room', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode: gameRoomCode, nickname: 'SecondPlayer', avatar: '🏎️' },
        resolve
      );
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.players).toHaveLength(2);
      expect(ack.data.state).toBe('waiting');
    }
  });

  it('rejects game start attempt by non-host (Client 2)', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_START, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('FORBIDDEN');
    }
  });

  it('host starts the game: transitions waiting -> in_progress and synchronizes state to both clients', async () => {
    const updateClient2Promise = new Promise<RoomSnapshot>((resolve) => {
      client2.once(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_START, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.state).toBe('in_progress');
      expect(ack.data.gameState).toBeDefined();
      expect(ack.data.gameState?.turnOrder).toEqual([client1Auth.sessionId, client2Auth.sessionId]);
      expect(ack.data.gameState?.activePlayerId).toBe(client1Auth.sessionId);
      expect(ack.data.gameState?.turnPhase).toBe('need_roll');
      expect(ack.data.gameState?.players[client1Auth.sessionId].cash).toBe(1500);
      expect(ack.data.gameState?.players[client2Auth.sessionId].cash).toBe(1500);
    }

    const c2Snapshot = await updateClient2Promise;
    expect(c2Snapshot.state).toBe('in_progress');
    expect(c2Snapshot.gameState?.activePlayerId).toBe(client1Auth.sessionId);
    expect(c2Snapshot.sequenceNumber).toBe(ack.ok ? ack.data.sequenceNumber : -1);
  });

  it('rejects starting the same game twice', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_START, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('GAME_ALREADY_STARTED');
    }
  });

  it('rejects roll dice action from the wrong player (Client 2 out of turn)', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('NOT_YOUR_TURN');
    }
  });

  it('rejects ending turn before rolling dice', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('MUST_ROLL_FIRST');
    }
  });

  it('authoritatively rolls dice for active player (Client 1) and updates position', async () => {
    const updateClient2Promise = new Promise<RoomSnapshot>((resolve) => {
      client2.once(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    const prevSeq = appServer.roomManager.getSnapshot(gameRoomCode).sequenceNumber;

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      const gs = ack.data.gameState!;
      expect(ack.data.sequenceNumber).toBe(prevSeq + 1);
      expect(gs.lastDiceRoll).toBeDefined();
      expect(gs.lastDiceRoll!.die1).toBeGreaterThanOrEqual(1);
      expect(gs.lastDiceRoll!.die1).toBeLessThanOrEqual(6);
      expect(gs.lastDiceRoll!.die2).toBeGreaterThanOrEqual(1);
      expect(gs.lastDiceRoll!.die2).toBeLessThanOrEqual(6);
      expect(gs.lastDiceRoll!.total).toBe(gs.lastDiceRoll!.die1 + gs.lastDiceRoll!.die2);

      const p1Pos = gs.players[client1Auth.sessionId].position;
      expect(p1Pos).toBe(gs.lastDiceRoll!.total % 40);
      expect(gs.turnPhase).not.toBe('need_roll');
    }

    const c2Snapshot = await updateClient2Promise;
    expect(c2Snapshot.gameState?.players[client1Auth.sessionId].position).toBe(
      ack.ok ? ack.data.gameState?.players[client1Auth.sessionId].position : -1
    );
  });

  it('rejects duplicate roll attempts on the same turn', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('ALREADY_ROLLED');
    }
  });

  it('allows buying property if landed on unowned property, or ending turn cleanly', async () => {
    const snapshot = appServer.roomManager.getSnapshot(gameRoomCode);
    const gs = snapshot.gameState!;

    if (gs.turnPhase === 'action_pending') {
      // Landed on unowned property! Buy it.
      const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode: gameRoomCode }, resolve);
      });

      expect(ack.ok).toBe(true);
      if (ack.ok) {
        expect(ack.data.gameState?.turnPhase).toBe('turn_ended');
      }
    }

    // End turn
    const endAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode: gameRoomCode }, resolve);
    });

    expect(endAck.ok).toBe(true);
    if (endAck.ok) {
      // Turn order advanced to Client 2
      expect(endAck.data.gameState?.activePlayerId).toBe(client2Auth.sessionId);
      expect(endAck.data.gameState?.turnPhase).toBe('need_roll');
    }
  });

  it('now allows Client 2 to roll on their turn', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.gameState?.players[client2Auth.sessionId].position).toBeGreaterThan(0);
    }
  });

  it('rejects invalid action payloads with INVALID_PAYLOAD', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_START, { roomCode: '' }, resolve);
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('INVALID_PAYLOAD');
    }
  });

  it('preserves room snapshot and sequence synchronization on get_snapshot', async () => {
    const current = appServer.roomManager.getSnapshot(gameRoomCode);
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.ROOM_GET_SNAPSHOT, { roomCode: gameRoomCode }, resolve);
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.sequenceNumber).toBe(current.sequenceNumber);
      expect(ack.data.gameState?.phase).toBe('in_progress');
    }
  });
});
