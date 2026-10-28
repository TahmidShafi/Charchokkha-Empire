import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Phase 8 — Resilience, Recovery, and Server-Side Validation Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;
  const activeSockets: ClientSocket[] = [];

  beforeAll(async () => {
    appServer = createAppServer({ port: 0, allowedOrigins: ['*'] });
    serverPort = await appServer.start(0);
  });

  afterAll(async () => {
    for (const socket of activeSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    await appServer.stop();
  });

  const connectClient = async (nickname: string, token?: string, port = serverPort) => {
    const socket: ClientSocket = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token },
    });
    activeSockets.push(socket);

    const session = await new Promise<SessionAuthenticatedPayload>((resolve) => {
      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, resolve);
    });

    return { socket, session, nickname };
  };

  // Helper to establish a 2-player active game
  const setupTwoPlayerGame = async (roomCodePrefix = 'RES') => {
    const host = await connectClient('HostAlice');
    const guest = await connectClient('GuestBob');

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: host.nickname, settings: { startingCash: 1500, maxPlayers: 4 } },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Room create failed');
    const roomCode = createRes.data.code;

    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: guest.nickname },
        resolve
      );
    });
    expect(joinRes.ok).toBe(true);

    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.GAME_START,
        { roomCode, requestId: `start_${Date.now()}` },
        resolve
      );
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) throw new Error('Start failed');

    const activeClient =
      startRes.data.gameState?.activePlayerId === host.session.sessionId ? host : guest;
    const inactiveClient = activeClient === host ? guest : host;

    return { host, guest, roomCode, activeClient, inactiveClient, initialSnapshot: startRes.data };
  };

  it('Scenario 1: Lost ACK retry returning identical snapshot via requestId without re-execution', async () => {
    const { roomCode, activeClient } = await setupTwoPlayerGame();

    const requestId = `roll_idempotency_${Date.now()}`;

    // First call: Roll dice
    const rollAck1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId },
        resolve
      );
    });
    expect(rollAck1.ok).toBe(true);
    if (!rollAck1.ok) throw new Error('Roll 1 failed');

    const seq1 = rollAck1.data.sequenceNumber;
    const dice1 = rollAck1.data.gameState?.lastDiceRoll;
    expect(dice1).toBeDefined();

    // Client retries with exact same requestId (simulating lost ACK)
    const rollAck2 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId },
        resolve
      );
    });
    expect(rollAck2.ok).toBe(true);
    if (!rollAck2.ok) throw new Error('Roll 2 failed');

    // Must return the cached snapshot: identical sequenceNumber and identical dice
    expect(rollAck2.data.sequenceNumber).toBe(seq1);
    expect(rollAck2.data.gameState?.lastDiceRoll).toEqual(dice1);
  });

  it('Scenario 2: Duplicate request idempotency on room settings update', async () => {
    const host = await connectClient('HostSettings');
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: host.nickname, settings: { startingCash: 1500 } },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    const requestId = `settings_req_${Date.now()}`;

    // Send identical request twice concurrently
    const [ack1, ack2] = await Promise.all([
      new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(
          SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
          { roomCode, settings: { startingCash: 2500 }, requestId },
          resolve
        );
      }),
      new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(
          SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
          { roomCode, settings: { startingCash: 2500 }, requestId },
          resolve
        );
      }),
    ]);

    expect(ack1.ok).toBe(true);
    expect(ack2.ok).toBe(true);
    if (ack1.ok && ack2.ok) {
      expect(ack1.data.sequenceNumber).toBe(ack2.data.sequenceNumber);
      expect(ack1.data.settings.startingCash).toBe(2500);
      expect(ack2.data.settings.startingCash).toBe(2500);
    }
  });

  it('Scenario 3: Client disconnect during processing & reconnect state consistency', async () => {
    const { roomCode, activeClient, inactiveClient } = await setupTwoPlayerGame();

    // Roll dice
    const rollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `roll_dc_${Date.now()}` },
        resolve
      );
    });
    expect(rollAck.ok).toBe(true);

    // Active client immediately disconnects
    activeClient.socket.disconnect();

    // Inactive client should still have valid room snapshot access
    const snapAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      inactiveClient.socket.emit(
        SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
        { roomCode },
        resolve
      );
    });
    expect(snapAck.ok).toBe(true);
    if (snapAck.ok) {
      const activePlayerRecord = snapAck.data.players.find(
        (p) => p.id === activeClient.session.sessionId
      );
      expect(activePlayerRecord?.connected).toBe(false);
    }

    // Active client reconnects with same token
    const reconnected = await connectClient('HostAliceReconnect', activeClient.session.token);
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnected.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'HostAlice' },
        resolve
      );
    });
    expect(joinRes.ok).toBe(true);
    if (joinRes.ok) {
      const reconnectedPlayer = joinRes.data.players.find(
        (p) => p.id === activeClient.session.sessionId
      );
      expect(reconnectedPlayer?.connected).toBe(true);
    }
  });

  it('Scenario 4: Fresh snapshot delivered upon reconnect with updated sequence number', async () => {
    const host = await connectClient('HostSeq');
    const guest = await connectClient('GuestSeq');

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: host.nickname },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: guest.nickname }, resolve);
    });

    // Guest disconnects
    guest.socket.disconnect();

    // Host updates settings twice while guest is offline
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
        { roomCode, settings: { startingCash: 3000 }, requestId: `s1_${Date.now()}` },
        resolve
      );
    });
    const updateRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
        { roomCode, settings: { maxPlayers: 6 }, requestId: `s2_${Date.now()}` },
        resolve
      );
    });
    expect(updateRes.ok).toBe(true);
    if (!updateRes.ok) throw new Error('Update failed');
    const latestSeq = updateRes.data.sequenceNumber;

    // Guest reconnects
    const guestReconnected = await connectClient('GuestSeq', guest.session.token);
    const reconnectAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guestReconnected.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: guest.nickname },
        resolve
      );
    });
    expect(reconnectAck.ok).toBe(true);
    if (reconnectAck.ok) {
      expect(reconnectAck.data.sequenceNumber).toBeGreaterThanOrEqual(latestSeq);
      expect(reconnectAck.data.settings.startingCash).toBe(3000);
      expect(reconnectAck.data.settings.maxPlayers).toBe(6);
    }
  });

  it('Scenario 5: Concurrent conflicting actions serialized cleanly without corrupting state', async () => {
    const { roomCode, host, guest } = await setupTwoPlayerGame();

    // Both host and guest fire end-turn requests simultaneously
    const [res1, res2] = await Promise.all([
      new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(
          SOCKET_EVENTS.GAME_END_TURN,
          { roomCode, requestId: `end_host_${Date.now()}` },
          resolve
        );
      }),
      new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        guest.socket.emit(
          SOCKET_EVENTS.GAME_END_TURN,
          { roomCode, requestId: `end_guest_${Date.now()}` },
          resolve
        );
      }),
    ]);

    // Exactly one or both are processed cleanly without crashing or corrupting
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    // At least one was rejected as not active or not allowed in turn
    const hasRejection = !res1.ok || !res2.ok;
    expect(hasRejection).toBe(true);
  });

  it('Scenario 6: Stale action rejected when sent by non-turn player', async () => {
    const { roomCode, inactiveClient } = await setupTwoPlayerGame();

    // Inactive player tries to roll dice
    const rollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      inactiveClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `stale_roll_${Date.now()}` },
        resolve
      );
    });

    expect(rollRes.ok).toBe(false);
    if (!rollRes.ok) {
      expect(rollRes.error.message.toLowerCase()).toContain('turn');
    }
  });

  it('Scenario 7: Spectator mutation attempts rejected with FORBIDDEN', async () => {
    const { roomCode } = await setupTwoPlayerGame();
    const spectator = await connectClient('SpectatorDan');

    const specJoin = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.ROOM_SPECTATE,
        { roomCode, nickname: spectator.nickname },
        resolve
      );
    });
    expect(specJoin.ok).toBe(true);

    // Spectator attempts to roll dice
    const rollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `spec_roll_${Date.now()}` },
        resolve
      );
    });
    expect(rollAck.ok).toBe(false);
    if (!rollAck.ok) {
      expect(rollAck.error.code).toBe('FORBIDDEN');
    }

    // Spectator attempts to buy property
    const buyAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.GAME_BUY_PROPERTY,
        { roomCode, requestId: `spec_buy_${Date.now()}` },
        resolve
      );
    });
    expect(buyAck.ok).toBe(false);
    if (!buyAck.ok) {
      expect(buyAck.error.code).toBe('FORBIDDEN');
    }

    // Spectator attempts to end turn
    const endAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      spectator.socket.emit(
        SOCKET_EVENTS.GAME_END_TURN,
        { roomCode, requestId: `spec_end_${Date.now()}` },
        resolve
      );
    });
    expect(endAck.ok).toBe(false);
    if (!endAck.ok) {
      expect(endAck.error.code).toBe('FORBIDDEN');
    }
  });

  it('Scenario 8: Unauthorized non-seated player mutation rejected', async () => {
    const { roomCode } = await setupTwoPlayerGame();
    const outsider = await connectClient('OutsiderMallory');

    // Outsider (not joined to roomCode) tries to roll dice
    const rollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      outsider.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `outsider_${Date.now()}` },
        resolve
      );
    });

    expect(rollAck.ok).toBe(false);
    if (!rollAck.ok) {
      expect(rollAck.error.code).toMatch(/FORBIDDEN|PLAYER_NOT_IN_GAME|ROOM_NOT_FOUND/);
    }
  });

  it('Scenario 9: Reconnection during finished match retains match standings and state', async () => {
    const { roomCode, host, guest } = await setupTwoPlayerGame();

    // Finish match by declaring bankruptcy for guest
    const bankRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
        { roomCode, requestId: `bank_${Date.now()}` },
        resolve
      );
    });
    expect(bankRes.ok).toBe(true);
    if (bankRes.ok) {
      expect(bankRes.data.state).toBe('finished');
      expect(bankRes.data.gameState?.winnerId).toBe(host.session.sessionId);
    }

    // Host disconnects
    host.socket.disconnect();

    // Host reconnects to the finished match
    const hostReconnected = await connectClient('HostAlice', host.session.token);
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      hostReconnected.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'HostAlice' },
        resolve
      );
    });
    expect(joinRes.ok).toBe(true);
    if (joinRes.ok) {
      expect(joinRes.data.state).toBe('finished');
      expect(joinRes.data.gameState?.phase).toBe('finished');
      expect(joinRes.data.gameState?.winnerId).toBe(host.session.sessionId);
      expect(joinRes.data.gameState?.eliminationOrder).toContain(guest.session.sessionId);
    }
  });

  it('Scenario 10: Duplicate rematch request idempotency returns identical state', async () => {
    const { roomCode, host, guest } = await setupTwoPlayerGame();

    // Finish game
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
        { roomCode, requestId: `bank_rematch_${Date.now()}` },
        resolve
      );
    });

    const rematchRequestId = `rematch_idem_${Date.now()}`;

    // Host fires rematch
    const rematch1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_REMATCH,
        { roomCode, requestId: rematchRequestId },
        resolve
      );
    });
    expect(rematch1.ok).toBe(true);
    if (!rematch1.ok) throw new Error('Rematch 1 failed');
    expect(rematch1.data.state).toBe('waiting');

    // Host retries with same requestId
    const rematch2 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_REMATCH,
        { roomCode, requestId: rematchRequestId },
        resolve
      );
    });
    expect(rematch2.ok).toBe(true);
    if (rematch2.ok) {
      expect(rematch2.data.sequenceNumber).toBe(rematch1.data.sequenceNumber);
      expect(rematch2.data.state).toBe('waiting');
    }
  });

  it('Scenario 11: Strictly monotonic sequence number progression across room lifecycle', async () => {
    const host = await connectClient('HostMonotonic');
    const guest = await connectClient('GuestMonotonic');

    const sequences: number[] = [];

    // 1. Create
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: host.nickname, settings: { startingCash: 1500 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    sequences.push(createRes.data.sequenceNumber);
    const roomCode = createRes.data.code;

    // 2. Settings update
    const setRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
        { roomCode, settings: { maxPlayers: 3 } },
        resolve
      );
    });
    if (setRes.ok) sequences.push(setRes.data.sequenceNumber);

    // 3. Join guest
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: guest.nickname }, resolve);
    });
    if (joinRes.ok) sequences.push(joinRes.data.sequenceNumber);

    // 4. Start game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    if (startRes.ok) sequences.push(startRes.data.sequenceNumber);

    // Verify strictly monotonic increase
    expect(sequences.length).toBe(4);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });

  it('Scenario 12: Server restart recovery via atomic disk persistence & session token preservation', async () => {
    const tempDir = path.join(os.tmpdir(), `charchokkha-persist-test-${Date.now()}`);

    // Start Server 1 with dedicated persistence dir
    const srv1 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port1 = await srv1.start(0);

    const client1 = await connectClient('AliceRestart', undefined, port1);
    const client2 = await connectClient('BobRestart', undefined, port1);

    // Create room and start game
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: client1.nickname, settings: { startingCash: 2000 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed on srv1');
    const roomCode = createRes.data.code;

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: client2.nickname }, resolve);
    });

    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);

    // Verify snapshot file exists on disk
    const roomSnapshotPath = path.join(tempDir, 'rooms', `room_${roomCode}.json`);
    expect(fs.existsSync(roomSnapshotPath)).toBe(true);

    const savedFileContent = JSON.parse(fs.readFileSync(roomSnapshotPath, 'utf8'));
    expect(savedFileContent.code).toBe(roomCode);
    expect(savedFileContent.state).toBe('in_progress');

    // Disconnect clients and stop Server 1
    client1.socket.disconnect();
    client2.socket.disconnect();
    await srv1.stop();

    // Start Server 2 pointing to the exact same persistence dir
    const srv2 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port2 = await srv2.start(0);

    try {
      // Client 1 connects to Server 2 with original token
      const client1Restored = await connectClient('AliceRestart', client1.session.token, port2);
      expect(client1Restored.session.sessionId).toBe(client1.session.sessionId);

      // Client 1 fetches restored room snapshot
      const snapRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1Restored.socket.emit(
          SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
          { roomCode },
          resolve
        );
      });

      expect(snapRes.ok).toBe(true);
      if (snapRes.ok) {
        expect(snapRes.data.code).toBe(roomCode);
        expect(snapRes.data.state).toBe('in_progress');
        expect(snapRes.data.players).toHaveLength(2);
        expect(snapRes.data.settings.startingCash).toBe(2000);
      }
    } finally {
      await srv2.stop();
      // Clean up temp dir
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error in test
      }
    }
  });
});
