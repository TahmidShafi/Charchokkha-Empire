import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Real-Time Authoritative Spectator Mode Test Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;

  beforeAll(async () => {
    appServer = createAppServer({ port: 0, allowedOrigins: ['*'] });
    serverPort = await appServer.start(0);
  });

  afterAll(async () => {
    await appServer.stop();
  });

  const connectClient = async (nickname: string) => {
    const socket: ClientSocket = ioc(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: undefined },
    });

    const session = await new Promise<SessionAuthenticatedPayload>((resolve) => {
      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, resolve);
    });

    return { socket, session, nickname };
  };

  it('allows spectator to join active or full room without occupying a seat and enforces read-only mode', async () => {
    const host = await connectClient('HostAlice');
    const player2 = await connectClient('PlayerBob');
    const spectator = await connectClient('SpectatorCharlie');

    // 1. Host creates a 2-player max room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: host.nickname,
          settings: { maxPlayers: 2 },
        },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create room failed');
    const roomCode = createRes.data.code;

    // 2. Player 2 joins room as seated player (capacity now full: 2/2)
    const joinP2 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      player2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: player2.nickname,
        },
        resolve
      );
    });
    expect(joinP2.ok).toBe(true);
    if (!joinP2.ok) throw new Error('Player 2 join failed');
    expect(joinP2.data.players.length).toBe(2);

    // Verify 3rd player cannot join as a seated player due to capacity
    const overflowPlayer = await connectClient('PlayerDave');
    const overflowJoin = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      overflowPlayer.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: overflowPlayer.nickname,
        },
        resolve
      );
    });
    expect(overflowJoin.ok).toBe(false);
    if (!overflowJoin.ok) {
      expect(overflowJoin.error.code).toBe('ROOM_FULL');
    }

    // 3. Spectator joins room via ROOM_SPECTATE
    const spectateRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.ROOM_SPECTATE,
        {
          roomCode,
          nickname: spectator.nickname,
        },
        resolve
      );
    });
    expect(spectateRes.ok).toBe(true);
    if (!spectateRes.ok) throw new Error('Spectate failed');

    const specSnapshot = spectateRes.data;
    // CRITICAL: Spectator does NOT occupy a seat
    expect(specSnapshot.players.length).toBe(2);
    expect(specSnapshot.players.some((p) => p.id === spectator.session.sessionId)).toBe(false);
    expect(specSnapshot.spectatorCount).toBe(1);

    // 4. Spectator tries to update room settings -> rejected with FORBIDDEN
    const updateSettingsRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
        {
          roomCode,
          settings: { startingCash: 5000 },
        },
        resolve
      );
    });
    expect(updateSettingsRes.ok).toBe(false);
    if (!updateSettingsRes.ok) {
      expect(updateSettingsRes.error.code).toBe('FORBIDDEN');
    }

    // 5. Spectator tries to start game -> rejected with FORBIDDEN
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(false);
    if (!startRes.ok) {
      expect(startRes.error.code).toBe('FORBIDDEN');
    }

    // 6. Host starts the game
    const hostStartRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(hostStartRes.ok).toBe(true);

    // 7. Verify spectator receives GAME_STATE_UPDATED live
    const spectatorReceivedUpdatePromise = new Promise<{ roomCode: string; gameState: unknown }>((resolve) => {
      spectator.socket.on(SOCKET_EVENTS.GAME_STATE_UPDATED, resolve);
    });

    // Host rolls dice
    const hostRollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(hostRollRes.ok).toBe(true);

    const receivedUpdate = await spectatorReceivedUpdatePromise;
    expect(receivedUpdate.roomCode).toBe(roomCode);
    expect(receivedUpdate.gameState).toBeDefined();

    // 8. CRITICAL: Test all mutating actions from spectator and ensure all return FORBIDDEN
    const testActionForbidden = async (event: string, payload: unknown) => {
      const res = await new Promise<SocketAck<unknown>>((resolve) => {
        spectator.socket.emit(event, payload, resolve);
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('FORBIDDEN');
      }
    };

    await testActionForbidden(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_DECLINE_PROPERTY, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_END_TURN, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_AUCTION_BID, { roomCode, bidAmount: 100 });
    await testActionForbidden(SOCKET_EVENTS.GAME_AUCTION_PASS, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_PAY_PRISON_FINE, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY, { roomCode, spaceId: 1 });
    await testActionForbidden(SOCKET_EVENTS.GAME_UNMORTGAGE_PROPERTY, { roomCode, spaceId: 1 });
    await testActionForbidden(SOCKET_EVENTS.GAME_BUILD_HOUSE, { roomCode, spaceId: 1 });
    await testActionForbidden(SOCKET_EVENTS.GAME_SELL_HOUSE, { roomCode, spaceId: 1 });
    await testActionForbidden(SOCKET_EVENTS.GAME_TRADE_CREATE, {
      roomCode,
      receiverId: player2.session.sessionId,
      offeredCash: 100,
      offeredPropertyIds: [],
      requestedCash: 0,
      requestedPropertyIds: [],
    });
    await testActionForbidden(SOCKET_EVENTS.GAME_TRADE_ACCEPT, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_TRADE_REJECT, { roomCode });
    await testActionForbidden(SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY, { roomCode });

    // 9. Spectator leaves room
    const hostReceivedUpdatedSnapshotPromise = new Promise<RoomSnapshot>((resolve) => {
      host.socket.on(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    const leaveRes = await new Promise<SocketAck<{ leftCode: string }>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode }, resolve);
    });
    expect(leaveRes.ok).toBe(true);

    const updatedAfterLeave = await hostReceivedUpdatedSnapshotPromise;
    expect(updatedAfterLeave.spectatorCount).toBe(0);
    expect(updatedAfterLeave.players.length).toBe(2);

    // 10. Clean up sockets
    host.socket.disconnect();
    player2.socket.disconnect();
    spectator.socket.disconnect();
    overflowPlayer.socket.disconnect();
  });

  it('supports joining as spectator via room:join with asSpectator: true', async () => {
    const host = await connectClient('HostAlice2');
    const spectator = await connectClient('SpectatorBob2');

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: host.nickname,
          settings: { maxPlayers: 4 },
        },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create room failed');
    const roomCode = createRes.data.code;

    // Host listens for the update when spectator joins
    const hostJoinedUpdatePromise = new Promise<RoomSnapshot>((resolve) => {
      host.socket.once(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    // Join with asSpectator: true
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: spectator.nickname,
          asSpectator: true,
        },
        resolve
      );
    });

    expect(joinRes.ok).toBe(true);
    if (!joinRes.ok) throw new Error('Spectate via join failed');
    expect(joinRes.data.players.length).toBe(1);
    expect(joinRes.data.spectatorCount).toBe(1);
    expect(joinRes.data.players[0].id).toBe(host.session.sessionId);

    const joinUpdate = await hostJoinedUpdatePromise;
    expect(joinUpdate.spectatorCount).toBe(1);

    // Host listens for the update when spectator disconnects
    const hostDisconnectUpdatePromise = new Promise<RoomSnapshot>((resolve) => {
      host.socket.once(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    spectator.socket.disconnect();

    const updatedSnap = await hostDisconnectUpdatePromise;
    expect(updatedSnap.spectatorCount).toBe(0);
    expect(updatedSnap.players.length).toBe(1);

    host.socket.disconnect();
  });
});
