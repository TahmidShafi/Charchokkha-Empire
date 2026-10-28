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

describe('Comprehensive Room Restoration, Durable Idempotency, and Fail-Safe Suite', () => {
  const activeSockets: ClientSocket[] = [];

  afterAll(() => {
    for (const socket of activeSockets) {
      if (socket.connected) socket.disconnect();
    }
  });

  const connectClient = async (serverPort: number, nickname: string, token?: string) => {
    const socket: ClientSocket = ioc(`http://localhost:${serverPort}`, {
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

  it('Verifies complete room restoration, multi-turn continuation, and field preservation', async () => {
    const tempDir = path.join(os.tmpdir(), `charchokkha-full-restore-${Date.now()}`);

    // Phase 1: Server 1 - Run multi-turn game
    const srv1 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port1 = await srv1.start(0);

    const client1 = await connectClient(port1, 'AliceBuilder');
    const client2 = await connectClient(port1, 'BobInvestor');

    // Create room with custom settings
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: client1.nickname,
          settings: { startingCash: 2500, doubleRent: true, mortgage: true },
        },
        resolve
      );
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Client 2 joins
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: client2.nickname },
        resolve
      );
    });

    // Start game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) throw new Error('Start failed');

    const firstActiveId = startRes.data.gameState!.activePlayerId;
    const activeClient1 = firstActiveId === client1.session.sessionId ? client1 : client2;
    const inactiveClient1 = activeClient1 === client1 ? client2 : client1;

    // Turn 1: Active player rolls dice (e.g. inject [1, 2] to land on space 3 / Oriental Ave)
    const rollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient1.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `roll_turn1_${Date.now()}` },
        resolve
      );
    });
    expect(rollAck.ok).toBe(true);
    if (!rollAck.ok) throw new Error('Roll failed');

    const landedSpace = rollAck.data.gameState!.players[activeClient1.session.sessionId].position;

    // If landed on purchasable property, buy it
    let boughtSpaceId: number | null = null;
    if (rollAck.data.gameState!.turnPhase === 'buy_or_auction') {
      const buyAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        activeClient1.socket.emit(
          SOCKET_EVENTS.GAME_BUY_PROPERTY,
          { roomCode, requestId: `buy_turn1_${Date.now()}` },
          resolve
        );
      });
      expect(buyAck.ok).toBe(true);
      boughtSpaceId = landedSpace;

      // Mortgage the newly acquired property to test mortgage state persistence
      const mortAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        activeClient1.socket.emit(
          SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY,
          { roomCode, spaceId: boughtSpaceId, requestId: `mort_turn1_${Date.now()}` },
          resolve
        );
      });
      expect(mortAck.ok).toBe(true);
    }

    // End turn 1
    const endTurnAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient1.socket.emit(
        SOCKET_EVENTS.GAME_END_TURN,
        { roomCode, requestId: `end_turn1_${Date.now()}` },
        resolve
      );
    });
    expect(endTurnAck.ok).toBe(true);
    if (!endTurnAck.ok) throw new Error('End turn failed');

    // Snapshot pre-restart state
    const preRestart = endTurnAck.data;
    const preActivePlayerId = preRestart.gameState!.activePlayerId;
    const preSequence = preRestart.sequenceNumber;
    expect(preActivePlayerId).toBe(inactiveClient1.session.sessionId);

    // Stop Server 1 (simulating process termination)
    client1.socket.disconnect();
    client2.socket.disconnect();
    await srv1.stop();

    // Phase 2: Server 2 - Start fresh process with same data dir
    const srv2 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port2 = await srv2.start(0);

    try {
      // Reconnect both clients with tokens
      const client1Restored = await connectClient(port2, client1.nickname, client1.session.token);
      const client2Restored = await connectClient(port2, client2.nickname, client2.session.token);

      expect(client1Restored.session.sessionId).toBe(client1.session.sessionId);
      expect(client2Restored.session.sessionId).toBe(client2.session.sessionId);

      // Reconnect to room
      const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1Restored.socket.emit(
          SOCKET_EVENTS.ROOM_JOIN,
          { roomCode, nickname: client1.nickname },
          resolve
        );
      });
      expect(joinAck.ok).toBe(true);
      if (!joinAck.ok) throw new Error('Join failed on restored server');

      const restored = joinAck.data;

      // VERIFY ALL ENGINE & ROOM FIELDS:
      expect(restored.code).toBe(roomCode);
      expect(restored.state).toBe('in_progress');
      expect(restored.hostId).toBe(client1.session.sessionId);
      expect(restored.settings.startingCash).toBe(2500);
      expect(restored.settings.doubleRent).toBe(true);
      expect(restored.settings.mortgage).toBe(true);
      expect(restored.sequenceNumber).toBeGreaterThanOrEqual(preSequence);

      // Players
      expect(restored.players).toHaveLength(2);
      const p1 = restored.players.find((p) => p.id === client1.session.sessionId);
      const p2 = restored.players.find((p) => p.id === client2.session.sessionId);
      expect(p1).toBeDefined();
      expect(p2).toBeDefined();

      // Game state
      expect(restored.gameState).toBeDefined();
      expect(restored.gameState!.phase).toBe('in_progress');
      expect(restored.gameState!.activePlayerId).toBe(preActivePlayerId);
      expect(restored.gameState!.currentTurnIndex).toBe(preRestart.gameState!.currentTurnIndex);
      expect(restored.gameState!.turnOrder).toEqual(preRestart.gameState!.turnOrder);

      // Property ownership & mortgage verification
      if (boughtSpaceId !== null) {
        const prop = restored.gameState!.properties[boughtSpaceId];
        expect(prop).toBeDefined();
        expect(prop.ownerId).toBe(activeClient1.session.sessionId);
        expect(prop.isMortgaged).toBe(true);
      }

      // Phase 3: Complete another valid turn on the restored server!
      const activeClientRestored =
        preActivePlayerId === client1.session.sessionId ? client1Restored : client2Restored;

      const turn2Roll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        activeClientRestored.socket.emit(
          SOCKET_EVENTS.GAME_ROLL_DICE,
          { roomCode, requestId: `roll_turn2_${Date.now()}` },
          resolve
        );
      });
      expect(turn2Roll.ok).toBe(true);
      if (!turn2Roll.ok) throw new Error('Restored server turn 2 roll failed');

      expect(turn2Roll.data.sequenceNumber).toBeGreaterThan(restored.sequenceNumber);
      expect(turn2Roll.data.gameState!.lastDiceRoll).toBeDefined();
    } finally {
      await srv2.stop();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });

  it('Verifies request idempotency survives a server restart without re-executing mutations', async () => {
    const tempDir = path.join(os.tmpdir(), `charchokkha-idem-restart-${Date.now()}`);

    const srv1 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port1 = await srv1.start(0);

    const client1 = await connectClient(port1, 'HostIdem');
    const client2 = await connectClient(port1, 'GuestIdem');

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: client1.nickname, settings: { startingCash: 1500 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: client2.nickname }, resolve);
    });

    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);

    const activeId = startRes.data.gameState!.activePlayerId;
    const activeClient = activeId === client1.session.sessionId ? client1 : client2;

    const durableRequestId = `roll_durable_${Date.now()}`;

    // Execute roll dice on Server 1
    const rollRes1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: durableRequestId },
        resolve
      );
    });
    expect(rollRes1.ok).toBe(true);
    if (!rollRes1.ok) throw new Error('Roll failed');
    const committedSeq = rollRes1.data.sequenceNumber;
    const committedDice = rollRes1.data.gameState!.lastDiceRoll;

    // Simulate lost ACK by immediately stopping Server 1
    client1.socket.disconnect();
    client2.socket.disconnect();
    await srv1.stop();

    // Start Server 2 from same persistence directory
    const srv2 = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port2 = await srv2.start(0);

    try {
      // Client reconnects with original token
      const reconnectedActive = await connectClient(
        port2,
        activeClient.nickname,
        activeClient.session.token
      );

      // Client retries with the SAME durableRequestId
      const retryRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        reconnectedActive.socket.emit(
          SOCKET_EVENTS.GAME_ROLL_DICE,
          { roomCode, requestId: durableRequestId },
          resolve
        );
      });

      // Must succeed and return the EXACT cached snapshot without error
      expect(retryRes.ok).toBe(true);
      if (retryRes.ok) {
        expect(retryRes.data.sequenceNumber).toBe(committedSeq);
        expect(retryRes.data.gameState?.lastDiceRoll).toEqual(committedDice);
      }
    } finally {
      await srv2.stop();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });

  it('Verifies corrupted, invalid, and expired room files are safely skipped without crashing', async () => {
    const tempDir = path.join(os.tmpdir(), `charchokkha-corrupt-test-${Date.now()}`);
    const roomsDir = path.join(tempDir, 'rooms');
    fs.mkdirSync(roomsDir, { recursive: true });

    // 1. File with malformed JSON
    fs.writeFileSync(path.join(roomsDir, 'room_BAD1.json'), '{ not valid json :::', 'utf-8');

    // 2. File with unsupported schemaVersion
    fs.writeFileSync(
      path.join(roomsDir, 'room_BAD2.json'),
      JSON.stringify({ schemaVersion: 99, code: 'BAD2', state: 'waiting' }),
      'utf-8'
    );

    // 3. File missing required invariant fields
    fs.writeFileSync(
      path.join(roomsDir, 'room_BAD3.json'),
      JSON.stringify({ schemaVersion: 1, code: 'BAD3' /* missing host, settings, players */ }),
      'utf-8'
    );

    // 4. Expired file (>24h old)
    fs.writeFileSync(
      path.join(roomsDir, 'room_EXPR.json'),
      JSON.stringify({
        schemaVersion: 1,
        persistedAt: Date.now() - 30 * 60 * 60 * 1000,
        code: 'EXPR',
        hostSessionId: 'g_exp',
        state: 'waiting',
        settings: { maxPlayers: 4 },
        players: [],
      }),
      'utf-8'
    );

    // Server boots cleanly despite corrupt files in storage
    const srv = createAppServer({ port: 0, persistenceDir: tempDir, allowedOrigins: ['*'] });
    const port = await srv.start(0);

    try {
      const client = await connectClient(port, 'RobustUser');
      const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client.socket.emit(SOCKET_EVENTS.ROOM_CREATE, { nickname: client.nickname }, resolve);
      });
      expect(createRes.ok).toBe(true);

      // Expired file should have been deleted
      expect(fs.existsSync(path.join(roomsDir, 'room_EXPR.json'))).toBe(false);
    } finally {
      await srv.stop();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  });

  it('Verifies metrics telemetry calculations and ensures health endpoints do not leak secrets', async () => {
    const srv = createAppServer({ port: 0, allowedOrigins: ['*'] });
    const port = await srv.start(0);

    try {
      const client1 = await connectClient(port, 'MetricsAlice');
      const client2 = await connectClient(port, 'MetricsBob');

      // Create room & perform actions to generate latency metrics
      const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1.socket.emit(
          SOCKET_EVENTS.ROOM_CREATE,
          { nickname: client1.nickname, settings: { startingCash: 1500 } },
          resolve
        );
      });
      if (!createRes.ok) throw new Error('Create failed');
      const roomCode = createRes.data.code;

      await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client2.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: client2.nickname }, resolve);
      });

      // Query GET /health
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();

      expect(healthJson.status).toBe('ok');
      expect(healthJson.metrics).toBeDefined();
      expect(healthJson.metrics.totalActions).toBeGreaterThanOrEqual(2);
      expect(typeof healthJson.metrics.p50Ms).toBe('number');
      expect(typeof healthJson.metrics.p95Ms).toBe('number');
      expect(typeof healthJson.metrics.p99Ms).toBe('number');
      expect(healthJson.metrics.p50Ms).toBeLessThanOrEqual(healthJson.metrics.p95Ms);
      expect(healthJson.metrics.p95Ms).toBeLessThanOrEqual(healthJson.metrics.p99Ms);

      // Verify no guest tokens or session tokens leaked in health payload
      const healthStr = JSON.stringify(healthJson);
      expect(healthStr).not.toContain(client1.session.token);
      expect(healthStr).not.toContain(client2.session.token);

      // Query GET /api/metrics
      const metricsRes = await fetch(`http://127.0.0.1:${port}/api/metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsJson = await metricsRes.json();
      expect(metricsJson.totalActions).toBeGreaterThanOrEqual(2);
      expect(metricsJson.errorRate).toBe(0);
    } finally {
      await srv.stop();
    }
  });
});
