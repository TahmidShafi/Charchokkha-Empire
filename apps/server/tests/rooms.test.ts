import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ChatMessageBroadcast,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { createAppServer } from '../src/server.js';

describe('Milestone 2 — Real Multiplayer Room Foundation Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;

  let client1: ClientSocket;
  let client2: ClientSocket;
  let client1Auth: SessionAuthenticatedPayload;
  let client2Auth: SessionAuthenticatedPayload;
  let testRoomCode: string;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    port = await appServer.start(0, '127.0.0.1');
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    await appServer.stop();
  });

  it('connects guest 1 and receives authenticated guest session token', async () => {
    client1 = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });

    const authPromise = new Promise<SessionAuthenticatedPayload>((resolve) => {
      client1.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        resolve(auth);
      });
    });

    await new Promise<void>((resolve) => client1.on('connect', () => resolve()));
    client1Auth = await authPromise;

    expect(client1Auth.sessionId).toBeDefined();
    expect(client1Auth.token).toBeDefined();
    expect(client1Auth.token.length).toBeGreaterThan(10);
  });

  it('connects guest 2 and receives a distinct secure guest session', async () => {
    client2 = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });

    const authPromise = new Promise<SessionAuthenticatedPayload>((resolve) => {
      client2.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        resolve(auth);
      });
    });

    await new Promise<void>((resolve) => client2.on('connect', () => resolve()));
    client2Auth = await authPromise;

    expect(client2Auth.sessionId).toBeDefined();
    expect(client2Auth.token).toBeDefined();
    expect(client2Auth.token).not.toBe(client1Auth.token);
    expect(client2Auth.sessionId).not.toBe(client1Auth.sessionId);
  });

  it('guest 1 creates a room and becomes the authoritative host with sequenceNumber 1', async () => {
    const payload = {
      nickname: 'Player Host',
      avatar: '🎩',
      settings: { maxPlayers: 2 },
    };

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.ROOM_CREATE, payload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      testRoomCode = ack.data.code;
      expect(testRoomCode).toBeDefined();
      expect(ack.data.hostId).toBe(client1Auth.sessionId);
      expect(ack.data.state).toBe('waiting');
      expect(ack.data.sequenceNumber).toBe(1);
      expect(ack.data.players.length).toBe(1);
      expect(ack.data.players[0].nickname).toBe('Player Host');
      expect(ack.data.players[0].isHost).toBe(true);
      expect(ack.data.players[0].seatIndex).toBe(0);
      expect(ack.data.settings.maxPlayers).toBe(2);
    }
  });

  it('guest 2 joins the room, both receive consistent updated membership with incremented sequenceNumber', async () => {
    const client1UpdatePromise = new Promise<RoomSnapshot>((resolve) => {
      client1.once(SOCKET_EVENTS.ROOM_UPDATED, (snapshot: RoomSnapshot) => {
        resolve(snapshot);
      });
    });

    const joinPayload = {
      roomCode: testRoomCode,
      nickname: 'Guest Player 2',
      avatar: '⛵',
    };

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.ROOM_JOIN, joinPayload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(true);
    const client1Snapshot = await client1UpdatePromise;

    if (ack.ok) {
      // Both clients receive consistent membership
      expect(ack.data.players.length).toBe(2);
      expect(client1Snapshot.players.length).toBe(2);
      expect(ack.data.sequenceNumber).toBe(2);
      expect(client1Snapshot.sequenceNumber).toBe(2);

      const guest2 = ack.data.players.find((p) => p.id === client2Auth.sessionId);
      expect(guest2).toBeDefined();
      expect(guest2?.nickname).toBe('Guest Player 2');
      expect(guest2?.seatIndex).toBe(1);
      expect(guest2?.isHost).toBe(false);
    }
  });

  it('rejects joining when room is at maximum capacity (maxPlayers=2)', async () => {
    // Connect third client
    const client3 = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => client3.on('connect', () => resolve()));

    const joinPayload = {
      roomCode: testRoomCode,
      nickname: 'Third Player',
    };

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client3.emit(SOCKET_EVENTS.ROOM_JOIN, joinPayload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('ROOM_FULL');
      expect(ack.error.message).toContain('capacity');
    }

    client3.disconnect();
  });

  it('prevents non-host from modifying room settings (server authorization)', async () => {
    const updatePayload = {
      roomCode: testRoomCode,
      settings: { maxPlayers: 4 },
    };

    // Client 2 (non-host) attempts to update settings
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.ROOM_UPDATE_SETTINGS, updatePayload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('FORBIDDEN');
      expect(ack.error.message).toContain('host');
    }
  });

  it('allows host to update room settings and broadcasts incremented sequenceNumber to room', async () => {
    const client2UpdatePromise = new Promise<RoomSnapshot>((resolve) => {
      client2.once(SOCKET_EVENTS.ROOM_UPDATED, (snapshot: RoomSnapshot) => {
        resolve(snapshot);
      });
    });

    const updatePayload = {
      roomCode: testRoomCode,
      settings: { maxPlayers: 6, isPrivate: false },
    };

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.ROOM_UPDATE_SETTINGS, updatePayload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(true);
    const client2Snapshot = await client2UpdatePromise;

    if (ack.ok) {
      expect(ack.data.settings.maxPlayers).toBe(6);
      expect(ack.data.settings.isPrivate).toBe(false);
      expect(ack.data.sequenceNumber).toBe(3);
      expect(client2Snapshot.sequenceNumber).toBe(3);
      expect(client2Snapshot.settings.maxPlayers).toBe(6);
    }
  });

  it('rejects invalid action payloads with INVALID_PAYLOAD code', async () => {
    // Malformed join payload (empty nickname, too short room code)
    const invalidJoin = {
      roomCode: 'X',
      nickname: '',
    };

    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.ROOM_JOIN, invalidJoin, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('INVALID_PAYLOAD');
    }
  });

  it('allows client to request a fresh room snapshot', async () => {
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(
        SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
        { roomCode: testRoomCode },
        (res: SocketAck<RoomSnapshot>) => {
          resolve(res);
        }
      );
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.code).toBe(testRoomCode);
      expect(ack.data.players.length).toBe(2);
      expect(ack.data.sequenceNumber).toBe(3);
    }
  });

  it('synchronizes real-time room chat between connected room members', async () => {
    const chatReceivePromise = new Promise<ChatMessageBroadcast>((resolve) => {
      client2.once(SOCKET_EVENTS.CHAT_MESSAGE, (msg: ChatMessageBroadcast) => {
        resolve(msg);
      });
    });

    const chatPayload = {
      roomCode: testRoomCode,
      text: 'Hello from host player!',
    };

    client1.emit(SOCKET_EVENTS.CHAT_SEND, chatPayload);
    const received = await chatReceivePromise;

    expect(received.roomCode).toBe(testRoomCode);
    expect(received.senderId).toBe(client1Auth.sessionId);
    expect(received.senderNickname).toBe('Player Host');
    expect(received.text).toBe('Hello from host player!');
  });

  it('supports player reconnecting to their existing seat via session token', async () => {
    // Client 2 disconnects
    client2.disconnect();

    // Reconnect using client 2's session token
    const reconnectedClient = Client(serverUrl, {
      auth: { token: client2Auth.token },
      transports: ['websocket'],
      reconnection: false,
    });

    const reauthPromise = new Promise<SessionAuthenticatedPayload>((resolve) => {
      reconnectedClient.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        resolve(auth);
      });
    });

    await new Promise<void>((resolve) => reconnectedClient.on('connect', () => resolve()));
    const reauth = await reauthPromise;

    // Confirms session token was recognized and restored
    expect(reauth.sessionId).toBe(client2Auth.sessionId);
    expect(reauth.currentRoomCode).toBe(testRoomCode);

    // Reconnected client requests snapshot or receives it
    const ack = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedClient.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode: testRoomCode, nickname: 'Guest Player 2' },
        (res: SocketAck<RoomSnapshot>) => {
          resolve(res);
        }
      );
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      // Confirms existing seat was preserved
      const seat = ack.data.players.find((p) => p.id === client2Auth.sessionId);
      expect(seat).toBeDefined();
      expect(seat?.seatIndex).toBe(1);
      expect(seat?.connected).toBe(true);
    }

    reconnectedClient.disconnect();
  });

  it('supports invite links case-insensitively: guest can join using lowercase room code', async () => {
    // Create a new room with capacity for 4 players
    const hostPayload = {
      nickname: 'Invite Host',
      settings: { maxPlayers: 4, isPrivate: true },
    };

    const hostAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.ROOM_CREATE, hostPayload, (res: SocketAck<RoomSnapshot>) => {
        resolve(res);
      });
    });

    expect(hostAck.ok).toBe(true);
    if (!hostAck.ok) return;

    const createdRoomCode = hostAck.data.code;
    const lowercaseCode = createdRoomCode.toLowerCase();

    // Connect a fresh guest client
    const inviteGuest = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => inviteGuest.on('connect', () => resolve()));

    // Guest joins using lowercase code and omits color (as an invite link does)
    const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      inviteGuest.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode: lowercaseCode,
          nickname: 'Invite Guest Player',
        },
        (res: SocketAck<RoomSnapshot>) => {
          resolve(res);
        }
      );
    });

    expect(joinAck.ok).toBe(true);
    if (joinAck.ok) {
      expect(joinAck.data.code).toBe(createdRoomCode);
      const joinedGuest = joinAck.data.players.find((p) => p.nickname === 'Invite Guest Player');
      expect(joinedGuest).toBeDefined();
      expect(joinedGuest?.color).toBeDefined();
      // Ensure guest color does not collide with host color
      const hostColor = joinAck.data.players.find((p) => p.isHost)?.color;
      expect(joinedGuest?.color).not.toBe(hostColor);
    }

    inviteGuest.disconnect();
  });

  it('returns ROOM_NOT_FOUND when joining with nonexistent or expired room code', async () => {
    const inviteGuest = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => inviteGuest.on('connect', () => resolve()));

    const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      inviteGuest.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode: 'NONEXIST9',
          nickname: 'Lost Guest',
        },
        (res: SocketAck<RoomSnapshot>) => {
          resolve(res);
        }
      );
    });

    expect(joinAck.ok).toBe(false);
    if (!joinAck.ok) {
      expect(joinAck.error.code).toBe('ROOM_NOT_FOUND');
      expect(joinAck.error.message).toContain('Room NONEXIST9 does not exist');
    }

    inviteGuest.disconnect();
  });
});
