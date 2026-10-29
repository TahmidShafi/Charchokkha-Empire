import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYER_COLORS,
  PLAYER_COLOR_HEXES,
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { createAppServer } from '../src/server.js';

interface TestClient {
  socket: ClientSocketType;
  session: SessionAuthenticatedPayload;
}

describe('Phase 10 — Player Colors and Server Authority', () => {
  let serverInstance: ReturnType<typeof createAppServer>;
  let serverPort: number;
  let testPersistenceDir: string;
  const clients: TestClient[] = [];

  const createClient = (): Promise<TestClient> => {
    return new Promise((resolve, reject) => {
      const socket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        const client: TestClient = { socket, session: auth };
        clients.push(client);
        resolve(client);
      });

      socket.on('connect_error', reject);
    });
  };

  beforeEach(async () => {
    testPersistenceDir = path.join(
      process.cwd(),
      '.test-data-colors',
      `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );

    serverInstance = createAppServer({
      port: 0,
      persistenceDir: testPersistenceDir,
    });

    await new Promise<void>((resolve) => {
      serverInstance.httpServer.listen(0, '127.0.0.1', () => {
        const address = serverInstance.httpServer.address();
        if (address && typeof address === 'object') {
          serverPort = address.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.socket.connected) {
        client.socket.disconnect();
      }
    }
    clients.length = 0;

    await new Promise<void>((resolve) => {
      serverInstance.io.close(() => {
        serverInstance.httpServer.close(() => resolve());
      });
    });

    try {
      if (fs.existsSync(testPersistenceDir)) {
        fs.rmSync(testPersistenceDir, { recursive: true, force: true });
      }
    } catch {
      // Ignored
    }
  });

  it('assigns selected color on room creation or defaults to Lime Green (#C4E64A)', async () => {
    const host = await createClient();

    // 1. Host creates with Golden Yellow
    const ack1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'YellowHost',
          color: '#FFC83D',
        },
        resolve
      );
    });

    expect(ack1.ok).toBe(true);
    if (ack1.ok) {
      expect(ack1.data.players[0].color).toBe('#FFC83D');
    }
  });

  it('prevents two players from selecting the same color in a room', async () => {
    const host = await createClient();
    const guest1 = await createClient();
    const guest2 = await createClient();

    const hostAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'Alice',
          color: '#FF8738', // Orange
        },
        resolve
      );
    });
    expect(hostAck.ok).toBe(true);
    const roomCode = hostAck.ok ? hostAck.data.code : '';

    // Guest 1 selects Red
    const join1Ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest1.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: 'Bob',
          color: '#D7474D', // Red
        },
        resolve
      );
    });
    expect(join1Ack.ok).toBe(true);
    if (join1Ack.ok) {
      expect(join1Ack.data.players[1].color).toBe('#D7474D');
    }

    // Guest 2 tries to select Orange (already taken by Alice)
    const join2Duplicate = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: 'Charlie',
          color: '#FF8738', // Duplicate!
        },
        resolve
      );
    });
    expect(join2Duplicate.ok).toBe(false);
    if (!join2Duplicate.ok) {
      expect(join2Duplicate.error.message).toContain('already taken');
    }

    // Guest 2 joins with available color Blue
    const join2Valid = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode,
          nickname: 'Charlie',
          color: '#559BD6', // Blue
        },
        resolve
      );
    });
    expect(join2Valid.ok).toBe(true);
  });

  it('allows players to change color in lobby via ROOM_SELECT_COLOR if available', async () => {
    const host = await createClient();
    const guest = await createClient();

    const hostAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'Host', color: '#C4E64A' },
        resolve
      );
    });
    const roomCode = hostAck.ok ? hostAck.data.code : '';

    const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Guest', color: '#559BD6' },
        resolve
      );
    });
    expect(joinAck.ok).toBe(true);

    // Guest switches from Blue to Teal
    const selectAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_SELECT_COLOR,
        { roomCode, color: '#00A99A' },
        resolve
      );
    });
    expect(selectAck.ok).toBe(true);
    if (selectAck.ok) {
      const g = selectAck.data.players.find((p) => p.id === guest.session.sessionId);
      expect(g?.color).toBe('#00A99A');
    }

    // Guest tries to switch to Lime Green (taken by Host)
    const conflictAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_SELECT_COLOR,
        { roomCode, color: '#C4E64A' },
        resolve
      );
    });
    expect(conflictAck.ok).toBe(false);
    if (!conflictAck.ok) {
      expect(conflictAck.error.message).toContain('already taken');
    }
  });

  it('restores assigned color across reconnection and server restart', async () => {
    const host = await createClient();
    const guest = await createClient();

    const hostAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'Host', color: '#70DDE8' }, // Cyan
        resolve
      );
    });
    const roomCode = hostAck.ok ? hostAck.data.code : '';

    const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Guest', color: '#69E653' }, // Bright Green
        resolve
      );
    });
    expect(joinAck.ok).toBe(true);

    // Disconnect guest
    guest.socket.disconnect();

    // Reconnect guest
    const reconnectedGuest = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: guest.session.token },
    });

    const joinAgain = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedGuest.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Guest' },
        resolve
      );
    });
    expect(joinAgain.ok).toBe(true);
    if (joinAgain.ok) {
      const gPlayer = joinAgain.data.players.find((p) => p.id === guest.session.sessionId);
      expect(gPlayer?.color).toBe('#69E653');
      expect(gPlayer?.connected).toBe(true);
    }

    reconnectedGuest.disconnect();

    // Restart server using same persistence dir
    await new Promise<void>((resolve) => {
      serverInstance.io.close(() => {
        serverInstance.httpServer.close(() => resolve());
      });
    });

    const restartedServer = createAppServer({
      port: 0,
      persistenceDir: testPersistenceDir,
    });

    await new Promise<void>((resolve) => {
      restartedServer.httpServer.listen(0, '127.0.0.1', () => {
        const address = restartedServer.httpServer.address();
        if (address && typeof address === 'object') {
          serverPort = address.port;
        }
        resolve();
      });
    });

    // Reconnect host to restarted server
    const hostReconnected = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: host.session.token },
    });

    const restoredSnapshot = await new Promise<RoomSnapshot>((resolve) => {
      hostReconnected.on(SOCKET_EVENTS.ROOM_SNAPSHOT, resolve);
    });

    const restoredHost = restoredSnapshot.players.find((p) => p.id === host.session.sessionId);
    const restoredGuest = restoredSnapshot.players.find((p) => p.id === guest.session.sessionId);
    expect(restoredHost?.color).toBe('#70DDE8');
    expect(restoredGuest?.color).toBe('#69E653');

    hostReconnected.disconnect();
    await new Promise<void>((resolve) => {
      restartedServer.io.close(() => {
        restartedServer.httpServer.close(() => resolve());
      });
    });
  });

  it('releases a color when a player leaves the room so another player can choose it', async () => {
    const host = await createClient();
    const guest1 = await createClient();
    const guest2 = await createClient();

    const hostAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'Host', color: '#C4E64A' },
        resolve
      );
    });
    const roomCode = hostAck.ok ? hostAck.data.code : '';

    // Guest 1 joins with Red
    const join1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest1.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Guest1', color: '#D7474D' },
        resolve
      );
    });
    expect(join1.ok).toBe(true);

    // Guest 1 leaves the room
    const leaveAck = await new Promise<SocketAck<void>>((resolve) => {
      guest1.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode }, resolve);
    });
    expect(leaveAck.ok).toBe(true);

    // Now Guest 2 can join with Red!
    const join2 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Guest2', color: '#D7474D' },
        resolve
      );
    });
    expect(join2.ok).toBe(true);
    if (join2.ok) {
      const g2 = join2.data.players.find((p) => p.id === guest2.session.sessionId);
      expect(g2?.color).toBe('#D7474D');
    }
  });
});
