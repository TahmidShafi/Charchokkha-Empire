import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Multiplayer Lifecycle Beta Audit Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;

  beforeAll(async () => {
    appServer = createAppServer({ port: 0, allowedOrigins: ['*'] });
    serverPort = await appServer.start(0);
  });

  afterAll(async () => {
    await appServer.stop();
  });

  const connectClient = async (nickname: string, token?: string) => {
    const socket: ClientSocket = ioc(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token },
    });

    const session = await new Promise<SessionAuthenticatedPayload>((resolve) => {
      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, resolve);
    });

    return { socket, session, nickname };
  };

  it('rejects invalid room codes on join, spectate, and get_snapshot with clear ROOM_NOT_FOUND error', async () => {
    const client = await connectClient('TesterNonExistent');

    // 1. Join non-existent room
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode: 'ZZZZ', nickname: client.nickname },
        resolve
      );
    });
    expect(joinRes.ok).toBe(false);
    if (!joinRes.ok) {
      expect(joinRes.error.code).toBe('ROOM_NOT_FOUND');
    }

    // 2. Spectate non-existent room
    const specRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client.socket.emit(
        SOCKET_EVENTS.ROOM_SPECTATE,
        { roomCode: 'NOPE', nickname: client.nickname },
        resolve
      );
    });
    expect(specRes.ok).toBe(false);
    if (!specRes.ok) {
      expect(specRes.error.code).toBe('ROOM_NOT_FOUND');
    }

    // 3. Get snapshot of non-existent room
    const snapRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client.socket.emit(
        SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
        { roomCode: 'GONE' },
        resolve
      );
    });
    expect(snapRes.ok).toBe(false);
    if (!snapRes.ok) {
      expect(snapRes.error.code).toBe('ROOM_NOT_FOUND');
    }

    client.socket.disconnect();
  });

  it('verifies full-room capacity enforcement, spectator joining, and turn / idempotency checks', async () => {
    const host = await connectClient('HostAlice');
    const player2 = await connectClient('PlayerBob');
    const playerOverflow = await connectClient('OverflowCarol');
    const spectator = await connectClient('SpectatorDan');

    // 1. Host creates 2-player max room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: host.nickname,
          settings: { maxPlayers: 2, startingCash: 1500 },
        },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // 2. Player 2 joins (2/2 capacity)
    const joinP2 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      player2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: player2.nickname },
        resolve
      );
    });
    expect(joinP2.ok).toBe(true);
    if (joinP2.ok) {
      expect(joinP2.data.players.length).toBe(2);
    }

    // 3. Player 3 attempts to join as seated player -> rejected with ROOM_FULL
    const joinP3 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerOverflow.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: playerOverflow.nickname },
        resolve
      );
    });
    expect(joinP3.ok).toBe(false);
    if (!joinP3.ok) {
      expect(joinP3.error.code).toBe('ROOM_FULL');
    }

    // 4. Spectator joins full room -> succeeds without consuming player seat
    const joinSpec = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: spectator.nickname, asSpectator: true },
        resolve
      );
    });
    expect(joinSpec.ok).toBe(true);
    if (joinSpec.ok) {
      expect(joinSpec.data.players.length).toBe(2);
      expect(joinSpec.data.spectatorCount).toBe(1);
    }

    // 5. Spectator attempts to start game -> rejected with FORBIDDEN
    const specStart = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(specStart.ok).toBe(false);

    // 6. Host starts game
    const hostStart = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(hostStart.ok).toBe(true);
    if (!hostStart.ok) throw new Error('Start failed');

    const activePlayerId = hostStart.data.gameState!.activePlayerId;
    const nonActiveClient = activePlayerId === host.session.sessionId ? player2 : host;
    const activeClient = activePlayerId === host.session.sessionId ? host : player2;

    // 7. Non-active player attempts to roll dice -> rejected with NOT_YOUR_TURN
    const wrongTurnRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      nonActiveClient.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(wrongTurnRoll.ok).toBe(false);
    if (!wrongTurnRoll.ok) {
      expect(wrongTurnRoll.error.code).toBe('NOT_YOUR_TURN');
    }

    // 8. Spectator attempts to roll dice -> rejected with FORBIDDEN
    const specRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(specRoll.ok).toBe(false);
    if (!specRoll.ok) {
      expect(specRoll.error.code).toBe('FORBIDDEN');
    }

    // 9. Active player rolls dice -> succeeds
    const firstRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(firstRoll.ok).toBe(true);

    // 10. Active player attempts duplicate roll in same turn (unless rolled doubles)
    if (firstRoll.ok && !firstRoll.data.gameState?.lastDiceRoll?.isDouble) {
      const duplicateRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        activeClient.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
      });
      expect(duplicateRoll.ok).toBe(false);
      if (!duplicateRoll.ok) {
        expect(duplicateRoll.error.code).toBe('ALREADY_ROLLED');
      }
    }

    // 11. Match completion: declare bankruptcy to finish match
    const bankRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      player2.socket.emit(SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY, { roomCode }, resolve);
    });
    expect(bankRes.ok).toBe(true);
    if (bankRes.ok) {
      expect(bankRes.data.state).toBe('finished');
      expect(bankRes.data.gameState?.phase).toBe('finished');
      expect(bankRes.data.gameState?.winnerId).toBe(host.session.sessionId);
    }

    // 12. Spectator refreshes / reconnects during finished match
    spectator.socket.disconnect();

    const reconnectedSpectator = await connectClient('SpectatorDan', spectator.session.token);
    const specReconnectSnap = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedSpectator.socket.emit(
        SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
        { roomCode },
        resolve
      );
    });
    expect(specReconnectSnap.ok).toBe(true);
    if (specReconnectSnap.ok) {
      expect(specReconnectSnap.data.state).toBe('finished');
      expect(specReconnectSnap.data.gameState?.phase).toBe('finished');
      expect(specReconnectSnap.data.gameState?.winnerId).toBe(host.session.sessionId);
      expect(specReconnectSnap.data.gameState?.eliminationOrder).toContain(player2.session.sessionId);
    }

    host.socket.disconnect();
    player2.socket.disconnect();
    playerOverflow.socket.disconnect();
    reconnectedSpectator.socket.disconnect();
  });
});
