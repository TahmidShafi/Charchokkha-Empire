import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import {
  HealthCheckResponseSchema,
  PingPayloadSchema,
  PongPayloadSchema,
  SOCKET_EVENTS,
  type PongPayload,
  type SocketAck,
} from '@charchokkha/shared';
import {
  getEngineInfo,
  rollDicePair,
  rollSixSidedDie,
  CANONICAL_BOARD_SPACES,
  createInitialGameState,
  processRollDice,
} from '@charchokkha/game-engine';
import { createAppServer } from '../apps/server/src/server.js';

describe('Root CI Smoke Test — Built Shared Packages & Socket.IO Flow', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    port = await appServer.start(0, '127.0.0.1');
    serverUrl = `http://127.0.0.1:${port}`;

    clientSocket = Client(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      clientSocket.on('connect', () => resolve());
      clientSocket.on('connect_error', (err) => reject(err));
    });
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    await appServer.stop();
  });

  it('imports shared schemas via built package export and validates schema structures', () => {
    expect(PingPayloadSchema).toBeDefined();
    expect(PongPayloadSchema).toBeDefined();
    expect(HealthCheckResponseSchema).toBeDefined();
    expect(SOCKET_EVENTS.SMOKE_PING).toBe('smoke:ping');

    const validPing = { message: 'CI built package test', timestamp: 123456789 };
    expect(PingPayloadSchema.safeParse(validPing).success).toBe(true);
  });

  it('imports game-engine functions via built package export', () => {
    expect(getEngineInfo).toBeDefined();
    expect(rollSixSidedDie).toBeDefined();
    expect(rollDicePair).toBeDefined();
    expect(CANONICAL_BOARD_SPACES).toHaveLength(48);

    const testState = createInitialGameState(['p1', 'p2'], 1500, 200);
    expect(testState.turnOrder).toEqual(['p1', 'p2']);
    const rollResult = processRollDice(testState, 'p1', [2, 3]);
    expect(rollResult.success).toBe(true);
    expect(rollResult.state.players['p1'].position).toBe(5);

    const info = getEngineInfo();
    expect(info.milestone).toBe(1);
  });

  it('executes six-sided die range assertion over 1,000 rolls with Node crypto.randomInt(1, 7)', () => {
    for (let i = 0; i < 1000; i++) {
      const roll = rollSixSidedDie((min, maxExclusive) => randomInt(min, maxExclusive));
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  it('performs end-to-end Socket.IO smoke request and receives valid pong response', async () => {
    const payload = {
      message: 'Smoke test payload via root CI test',
      timestamp: Date.now(),
    };

    const ack = await new Promise<SocketAck<PongPayload>>((resolve) => {
      clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, payload, (res: SocketAck<PongPayload>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.data.reply).toBe('pong');
      expect(ack.data.echoMessage).toBe('Smoke test payload via root CI test');
      expect(PongPayloadSchema.safeParse(ack.data).success).toBe(true);
    }
  });

  it('verifies server rejects invalid payload', async () => {
    const invalidPayload = {
      message: '', // invalid: empty
      timestamp: -1, // invalid: negative
    };

    const ack = await new Promise<SocketAck<PongPayload>>((resolve) => {
      clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, invalidPayload, (res: SocketAck<PongPayload>) => {
        resolve(res);
      });
    });

    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.error.code).toBe('INVALID_PAYLOAD');
      expect(ack.error.message).toContain('Payload validation failed');
    }
  });

  it('verifies health check endpoint returns 200 and matches HealthCheckResponseSchema', async () => {
    const res = await fetch(`${serverUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const parsed = HealthCheckResponseSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('creates and joins a multiplayer room in root smoke suite', async () => {
    const createAck = await new Promise<any>((resolve) => {
      clientSocket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'Smoke Player' },
        (res: any) => resolve(res)
      );
    });

    expect(createAck.ok).toBe(true);
    expect(createAck.data.code).toBeDefined();
    expect(createAck.data.sequenceNumber).toBe(1);
    expect(createAck.data.players[0].nickname).toBe('Smoke Player');
  });
});
