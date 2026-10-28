import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Authoritative Rematch and Post-Match Transition Test Suite', () => {
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

  it('enforces host-only permissions and finished-state requirement for rematch', async () => {
    const host = await connectClient('HostAlice');
    const guest = await connectClient('GuestBob');
    const spectator = await connectClient('SpecCharlie');

    // 1. Host creates room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: host.nickname, settings: { startingCash: 1500 } },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Room create failed');
    const roomCode = createRes.data.code;

    // 2. Guest joins
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: guest.nickname }, resolve);
    });

    // 3. Rematch while room is 'waiting' -> rejected
    const earlyRematch = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, { roomCode }, resolve);
    });
    expect(earlyRematch.ok).toBe(false);
    if (!earlyRematch.ok) {
      expect(earlyRematch.error.code).toBe('REMATCH_FAILED');
    }

    // 4. Start game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);

    // 5. Spectator joins in-progress game
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.ROOM_SPECTATE, { roomCode, nickname: spectator.nickname }, resolve);
    });

    // 6. Rematch while in_progress -> rejected
    const inProgressRematch = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, { roomCode }, resolve);
    });
    expect(inProgressRematch.ok).toBe(false);

    // 7. Finish game authoritatively by bankrupting GuestBob
    const bankRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY, { roomCode }, resolve);
    });
    expect(bankRes.ok).toBe(true);
    if (bankRes.ok) {
      expect(bankRes.data.state).toBe('finished');
      expect(bankRes.data.gameState?.phase).toBe('finished');
      expect(bankRes.data.gameState?.winnerId).toBe(host.session.sessionId);
    }

    // 8. Spectator attempts rematch -> rejected with FORBIDDEN
    const specRematch = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, { roomCode }, resolve);
    });
    expect(specRematch.ok).toBe(false);
    if (!specRematch.ok) {
      expect(specRematch.error.code).toBe('FORBIDDEN');
    }

    // 9. Non-host player (guest) attempts rematch -> rejected with FORBIDDEN
    const guestRematch = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, { roomCode }, resolve);
    });
    expect(guestRematch.ok).toBe(false);
    if (!guestRematch.ok) {
      expect(guestRematch.error.code).toBe('FORBIDDEN');
    }

    // 10. Host triggers rematch -> succeeds!
    const roomUpdatedPromise = new Promise<RoomSnapshot>((resolve) => {
      guest.socket.on(SOCKET_EVENTS.ROOM_UPDATED, resolve);
    });

    const hostRematch = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, { roomCode }, resolve);
    });
    expect(hostRematch.ok).toBe(true);
    if (hostRematch.ok) {
      expect(hostRematch.data.state).toBe('waiting');
      expect(hostRematch.data.gameState).toBeUndefined();
      expect(hostRematch.data.players).toHaveLength(2);
    }

    const broadcastUpdate = await roomUpdatedPromise;
    expect(broadcastUpdate.state).toBe('waiting');
    expect(broadcastUpdate.gameState).toBeUndefined();

    // 11. Host can start a new match from the rematched room
    const restartRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(restartRes.ok).toBe(true);
    if (restartRes.ok) {
      expect(restartRes.data.state).toBe('in_progress');
      expect(restartRes.data.gameState).toBeDefined();
      expect(restartRes.data.gameState?.players[host.session.sessionId].cash).toBe(1500);
      expect(restartRes.data.gameState?.players[guest.session.sessionId].cash).toBe(1500);
    }

    host.socket.disconnect();
    guest.socket.disconnect();
    spectator.socket.disconnect();
  });
});
