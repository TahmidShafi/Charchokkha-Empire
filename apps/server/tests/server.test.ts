import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import {
  HealthCheckResponseSchema,
  PongPayloadSchema,
  SOCKET_EVENTS,
  type HealthCheckResponse,
  type PongPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { rollSixSidedDie } from '@charchokkha/game-engine';
import { createAppServer } from '../src/server.js';

describe('Server & Socket.IO Smoke Test Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    appServer = createAppServer({
      allowedOrigins: ['*'],
    });
    // Listen on ephemeral port 0 to prevent conflicts
    port = await appServer.start(0, '127.0.0.1');
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    await appServer.stop();
  });

  describe('HTTP Health Endpoint', () => {
    it('GET /health returns 200 with schema-valid health data', async () => {
      const response = await fetch(`${serverUrl}/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const json = (await response.json()) as HealthCheckResponse;
      const parseResult = HealthCheckResponseSchema.safeParse(json);
      expect(parseResult.success).toBe(true);
      if (parseResult.success) {
        expect(parseResult.data.status).toBe('ok');
        expect(parseResult.data.service).toBe('charchokkha-server');
        expect(typeof parseResult.data.uptime).toBe('number');
        expect(new Date(parseResult.data.timestamp).getTime()).not.toBeNaN();
      }
    });

    it('GET /api/health also returns 200', async () => {
      const response = await fetch(`${serverUrl}/api/health`);
      expect(response.status).toBe(200);
    });

    it('returns 404 for unknown routes', async () => {
      const response = await fetch(`${serverUrl}/unknown-route`);
      expect(response.status).toBe(404);
    });
  });

  describe('Socket.IO Smoke Flow & Validation', () => {
    it('establishes a working socket connection', async () => {
      clientSocket = Client(serverUrl, {
        transports: ['websocket'],
        reconnection: false,
      });

      await new Promise<void>((resolve, reject) => {
        clientSocket.on('connect', () => resolve());
        clientSocket.on('connect_error', (err) => reject(err));
      });

      expect(clientSocket.connected).toBe(true);
    });

    it('successfully processes valid smoke:ping payload via acknowledgment callback', async () => {
      const payload = {
        message: 'Smoke test connection verified',
        timestamp: Date.now(),
      };

      const ackResponse = await new Promise<SocketAck<PongPayload>>((resolve) => {
        clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, payload, (ack: SocketAck<PongPayload>) => {
          resolve(ack);
        });
      });

      expect(ackResponse.ok).toBe(true);
      if (ackResponse.ok) {
        const parseResult = PongPayloadSchema.safeParse(ackResponse.data);
        expect(parseResult.success).toBe(true);
        expect(ackResponse.data.reply).toBe('pong');
        expect(ackResponse.data.echoMessage).toBe('Smoke test connection verified');
        expect(typeof ackResponse.data.receivedAt).toBe('number');
      }
    });

    it('receives emitted smoke:pong event on valid ping', async () => {
      const payload = {
        message: 'Testing broadcast pong',
        timestamp: Date.now(),
      };

      const pongPromise = new Promise<PongPayload>((resolve) => {
        clientSocket.once(SOCKET_EVENTS.SMOKE_PONG, (pong: PongPayload) => {
          resolve(pong);
        });
      });

      clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, payload);
      const pong = await pongPromise;

      expect(pong.reply).toBe('pong');
      expect(pong.echoMessage).toBe('Testing broadcast pong');
    });

    it('rejects invalid payload and returns error response', async () => {
      // Missing timestamp and empty message
      const invalidPayload = {
        message: '   ',
      };

      const ackResponse = await new Promise<SocketAck<PongPayload>>((resolve) => {
        clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, invalidPayload, (ack: SocketAck<PongPayload>) => {
          resolve(ack);
        });
      });

      expect(ackResponse.ok).toBe(false);
      if (!ackResponse.ok) {
        expect(ackResponse.error.code).toBe('INVALID_PAYLOAD');
        expect(ackResponse.error.message).toContain('Payload validation failed');
      }
    });

    it('rejects completely malformed payload (non-object)', async () => {
      const ackResponse = await new Promise<SocketAck<PongPayload>>((resolve) => {
        clientSocket.emit(SOCKET_EVENTS.SMOKE_PING, 'not-an-object', (ack: SocketAck<PongPayload>) => {
          resolve(ack);
        });
      });

      expect(ackResponse.ok).toBe(false);
      if (!ackResponse.ok) {
        expect(ackResponse.error.code).toBe('INVALID_PAYLOAD');
      }
    });
  });

  describe('Server integration with game-engine and crypto.randomInt', () => {
    it('executes rollSixSidedDie with crypto.randomInt(1, 7) within [1, 6] range', () => {
      for (let i = 0; i < 100; i++) {
        const roll = rollSixSidedDie((min, maxExclusive) => randomInt(min, maxExclusive));
        expect(Number.isInteger(roll)).toBe(true);
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(6);
      }
    });
  });
});
