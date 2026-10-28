import http from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  ChatMessageBroadcastSchema,
  CreateRoomPayloadSchema,
  GetSnapshotPayloadSchema,
  HealthCheckResponseSchema,
  JoinRoomPayloadSchema,
  SpectateRoomPayloadSchema,
  LeaveRoomPayloadSchema,
  PingPayloadSchema,
  SOCKET_EVENTS,
  SendChatPayloadSchema,
  UpdateSettingsPayloadSchema,
  StartGamePayloadSchema,
  RematchPayloadSchema,
  RollDicePayloadSchema,
  BuyPropertyPayloadSchema,
  DeclinePropertyPayloadSchema,
  AuctionBidPayloadSchema,
  AuctionPassPayloadSchema,
  PayPrisonFinePayloadSchema,
  MortgagePropertyPayloadSchema,
  UnmortgagePropertyPayloadSchema,
  BuildHousePayloadSchema,
  SellHousePayloadSchema,
  TradeCreatePayloadSchema,
  TradeAcceptPayloadSchema,
  TradeRejectPayloadSchema,
  DeclareBankruptcyPayloadSchema,
  EndTurnPayloadSchema,
  type ChatMessageBroadcast,
  type HealthCheckResponse,
  type PongPayload,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
  type SocketError,
} from '@charchokkha/shared';
import { RoomManager } from './roomManager.js';
import { serverMetrics } from './metrics.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  persistenceDir?: string;
}

export function createAppServer(options: ServerOptions = {}) {
  const allowedOrigins = options.allowedOrigins ?? [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const startTime = Date.now();
  const roomManager = new RoomManager(options.persistenceDir);

  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      const healthData: HealthCheckResponse = {
        status: 'ok',
        service: 'charchokkha-server',
        uptime: Math.round((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        metrics: serverMetrics.getSummary() as unknown as Record<string, unknown>,
      };

      const validation = HealthCheckResponseSchema.safeParse(healthData);
      if (!validation.success) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal health check validation failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(validation.data));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serverMetrics.getSummary()));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS not allowed'), false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    maxHttpBufferSize: 1e6, // 1MB maximum inbound payload size
  });

  io.on('connection', (socket: Socket) => {
    // 1. Authenticate guest session from handshake auth
    const clientAuthToken = typeof socket.handshake.auth?.token === 'string'
      ? socket.handshake.auth.token.trim()
      : undefined;

    const session = roomManager.getOrCreateSession(clientAuthToken, socket.id);

    // Never log guest tokens to console or analytics
    // eslint-disable-next-line no-console
    console.log(`[Socket.IO] Client connected: socket_id=${socket.id} session_id=${session.sessionId}`);

    // Inform client of authenticated guest identity
    const authPayload: SessionAuthenticatedPayload = {
      sessionId: session.sessionId,
      playerId: session.sessionId,
      token: session.token,
      nickname: session.nickname,
      currentRoomCode: session.currentRoomCode,
    };
    socket.emit(SOCKET_EVENTS.SESSION_AUTHENTICATED, authPayload);

    // If session was already in a room, re-attach socket to room
    if (session.currentRoomCode) {
      try {
        const snapshot = roomManager.getSnapshot(session.currentRoomCode);
        socket.join(`room:${snapshot.code}`);
        socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
        io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
        io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
          playerId: session.sessionId,
          nickname: session.nickname,
        });
      } catch {
        session.currentRoomCode = undefined;
      }
    }

    // --- Smoke Ping Handlers (Preserved from Milestone 1) ---
    const handlePing = (
      rawPayload: unknown,
      ack?: (response: SocketAck<PongPayload>) => void
    ) => {
      const parseResult = PingPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        const errorResponse: SocketError = {
          code: 'INVALID_PAYLOAD',
          message: 'Payload validation failed',
          details: parseResult.error.flatten(),
        };
        if (typeof ack === 'function') ack({ ok: false, error: errorResponse });
        socket.emit('error', errorResponse);
        return;
      }

      const pongResponse: PongPayload = {
        reply: 'pong',
        receivedAt: Date.now(),
        echoMessage: parseResult.data.message,
      };

      if (typeof ack === 'function') ack({ ok: true, data: pongResponse });
      socket.emit(SOCKET_EVENTS.SMOKE_PONG, pongResponse);
    };

    socket.on(SOCKET_EVENTS.SMOKE_PING, handlePing);
    socket.on('ping', handlePing);

    // --- Room: Create ---
    socket.on(
      SOCKET_EVENTS.ROOM_CREATE,
      (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = CreateRoomPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        try {
          const snapshot = roomManager.createRoom(
            session,
            parsed.data.nickname,
            parsed.data.avatar,
            parsed.data.settings
          );

          socket.join(`room:${snapshot.code}`);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }
          socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Failed to create room';
          const err: SocketError = { code: 'ROOM_CREATE_FAILED', message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Room: Join ---
    socket.on(
      SOCKET_EVENTS.ROOM_JOIN,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = JoinRoomPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();

        try {
          const room = roomManager.getRoom(roomCode);
          if (!room) {
            const err: SocketError = { code: 'ROOM_NOT_FOUND', message: `Room ${roomCode} does not exist` };
            if (typeof ack === 'function') ack({ ok: false, error: err });
            return;
          }

          if (parsed.data.asSpectator) {
            const { result: snapshot } = await roomManager.enqueueRoomAction(roomCode, () => {
              return roomManager.spectateRoom(session, roomCode, parsed.data.nickname);
            });

            socket.join(`room:${snapshot.code}`);

            if (typeof ack === 'function') {
              ack({ ok: true, data: snapshot });
            }

            socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_SPECTATOR_JOINED, {
              spectatorId: session.sessionId,
              nickname: session.nickname,
              spectatorCount: snapshot.spectatorCount ?? 0,
            });
            return;
          }

          // Apply join through per-room action queue
          const { result: { snapshot, isReconnect } } = await roomManager.enqueueRoomAction(roomCode, () => {
            return roomManager.joinRoom(
              session,
              roomCode,
              parsed.data.nickname,
              parsed.data.avatar
            );
          });

          socket.join(`room:${snapshot.code}`);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);

          if (isReconnect) {
            serverMetrics.recordReconnection(true);
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, {
              playerId: session.sessionId,
              nickname: session.nickname,
            });
          } else {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, {
              playerId: session.sessionId,
              nickname: session.nickname,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordReconnection(false);
          const msg = error instanceof Error ? error.message : 'Failed to join room';
          const code = msg.includes('capacity') ? 'ROOM_FULL' : 'ROOM_JOIN_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Room: Spectate ---
    socket.on(
      SOCKET_EVENTS.ROOM_SPECTATE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = SpectateRoomPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();

        try {
          const room = roomManager.getRoom(roomCode);
          if (!room) {
            const err: SocketError = { code: 'ROOM_NOT_FOUND', message: `Room ${roomCode} does not exist` };
            if (typeof ack === 'function') ack({ ok: false, error: err });
            return;
          }

          const { result: snapshot } = await roomManager.enqueueRoomAction(roomCode, () => {
            return roomManager.spectateRoom(session, roomCode, parsed.data.nickname);
          });

          socket.join(`room:${snapshot.code}`);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_SPECTATOR_JOINED, {
            spectatorId: session.sessionId,
            nickname: session.nickname,
            spectatorCount: snapshot.spectatorCount ?? 0,
          });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Failed to spectate room';
          const err: SocketError = { code: 'SPECTATE_FAILED', message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Room: Leave ---
    socket.on(
      SOCKET_EVENTS.ROOM_LEAVE,
      async (rawPayload: unknown, ack?: (response: SocketAck<{ leftCode: string }>) => void) => {
        const parsed = LeaveRoomPayloadSchema.safeParse(rawPayload ?? {});
        if (!parsed.success) {
          const err: SocketError = { code: 'INVALID_PAYLOAD', message: 'Invalid leave payload' };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const targetCode = parsed.data.roomCode ?? session.currentRoomCode;
        if (!targetCode) {
          if (typeof ack === 'function') ack({ ok: true, data: { leftCode: '' } });
          return;
        }

        const wasSpectator = Boolean(session.isSpectator);

        try {
          const { result: { leftCode, snapshot } } = await roomManager.enqueueRoomAction(targetCode, () => {
            return roomManager.leaveRoom(session, targetCode);
          });

          socket.leave(`room:${leftCode}`);

          if (typeof ack === 'function') {
            ack({ ok: true, data: { leftCode } });
          }

          if (snapshot) {
            io.to(`room:${leftCode}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
            if (wasSpectator) {
              io.to(`room:${leftCode}`).emit(SOCKET_EVENTS.ROOM_SPECTATOR_LEFT, {
                spectatorId: session.sessionId,
                nickname: session.nickname,
                spectatorCount: snapshot.spectatorCount ?? 0,
              });
            } else {
              io.to(`room:${leftCode}`).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                playerId: session.sessionId,
                nickname: session.nickname,
              });
            }
          }
        } catch {
          if (typeof ack === 'function') ack({ ok: true, data: { leftCode: targetCode } });
        }
      }
    );

    // --- Room: Update Settings (Host Only) ---
    socket.on(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = UpdateSettingsPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: updatedSnapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.updateSettings(session, roomCode, parsed.data.settings),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: updatedSnapshot });
          }

          io.to(`room:${updatedSnapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, updatedSnapshot);
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to update settings';
          const code = (msg.includes('host') || msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'SETTINGS_UPDATE_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Room: Get Snapshot (Resync on sequence gap) ---
    socket.on(
      SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
      (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = GetSnapshotPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = { code: 'INVALID_PAYLOAD', message: 'Invalid payload' };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        try {
          const snapshot = roomManager.getSnapshot(parsed.data.roomCode);
          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }
          socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : 'Snapshot failed';
          const err: SocketError = { code: 'ROOM_NOT_FOUND', message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Start (Host Only) ---
    socket.on(
      SOCKET_EVENTS.GAME_START,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = StartGamePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.startGame(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to start game';
          let code = 'GAME_START_FAILED';
          if (msg.includes('host') || msg.includes('Spectator') || msg.includes('not permitted')) code = 'FORBIDDEN';
          else if (msg.includes('At least 2 players')) code = 'INSUFFICIENT_PLAYERS';
          else if (msg.includes('already in progress')) code = 'GAME_ALREADY_STARTED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Room: Rematch (Host Only, Finished Room Only) ---
    socket.on(
      SOCKET_EVENTS.ROOM_REMATCH,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = RematchPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.rematchRoom(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to initiate rematch';
          let code = 'REMATCH_FAILED';
          if (msg.includes('host') || msg.includes('Spectator') || msg.includes('not permitted')) code = 'FORBIDDEN';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Roll Dice (Active Player Only) ---
    socket.on(
      SOCKET_EVENTS.GAME_ROLL_DICE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = RollDicePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.rollDice(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to roll dice';
          let code = 'ROLL_DICE_FAILED';
          if (msg.includes('Spectator') || msg.includes('not permitted')) code = 'FORBIDDEN';
          else if (msg.includes('not your turn')) code = 'NOT_YOUR_TURN';
          else if (msg.includes('already rolled')) code = 'ALREADY_ROLLED';
          else if (msg.includes('not in progress')) code = 'GAME_NOT_IN_PROGRESS';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Buy Property ---
    socket.on(
      SOCKET_EVENTS.GAME_BUY_PROPERTY,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = BuyPropertyPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.buyProperty(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to purchase property';
          let code = 'BUY_PROPERTY_FAILED';
          if (msg.includes('Spectator') || msg.includes('not permitted')) code = 'FORBIDDEN';
          else if (msg.includes('not your turn')) code = 'NOT_YOUR_TURN';
          else if (msg.includes('Insufficient funds')) code = 'INSUFFICIENT_FUNDS';
          else if (msg.includes('already owned')) code = 'ALREADY_OWNED';
          else if (msg.includes('cannot be purchased')) code = 'NOT_PURCHASABLE';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Decline Property (Start Auction) ---
    socket.on(
      SOCKET_EVENTS.GAME_DECLINE_PROPERTY,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = DeclinePropertyPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.declineProperty(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to decline property';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'DECLINE_PROPERTY_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Auction Bid ---
    socket.on(
      SOCKET_EVENTS.GAME_AUCTION_BID,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = AuctionBidPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.auctionBid(session, roomCode, parsed.data.bidAmount),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to place auction bid';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'AUCTION_BID_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Auction Pass ---
    socket.on(
      SOCKET_EVENTS.GAME_AUCTION_PASS,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = AuctionPassPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.auctionPass(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to pass auction';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'AUCTION_PASS_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Pay Prison Fine ---
    socket.on(
      SOCKET_EVENTS.GAME_PAY_PRISON_FINE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = PayPrisonFinePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.payPrisonFine(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to pay prison fine';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'PAY_PRISON_FINE_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Mortgage Property ---
    socket.on(
      SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = MortgagePropertyPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.mortgageProperty(session, roomCode, parsed.data.spaceId),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to mortgage property';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'MORTGAGE_PROPERTY_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Unmortgage Property ---
    socket.on(
      SOCKET_EVENTS.GAME_UNMORTGAGE_PROPERTY,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = UnmortgagePropertyPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.unmortgageProperty(session, roomCode, parsed.data.spaceId),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to unmortgage property';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'UNMORTGAGE_PROPERTY_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Build House ---
    socket.on(
      SOCKET_EVENTS.GAME_BUILD_HOUSE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = BuildHousePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.buildHouse(session, roomCode, parsed.data.spaceId),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to build house';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'BUILD_HOUSE_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Sell House ---
    socket.on(
      SOCKET_EVENTS.GAME_SELL_HOUSE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = SellHousePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.sellHouse(session, roomCode, parsed.data.spaceId),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to sell house';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'SELL_HOUSE_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Create Trade Offer ---
    socket.on(
      SOCKET_EVENTS.GAME_TRADE_CREATE,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = TradeCreatePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.createTrade(session, roomCode, {
              receiverId: parsed.data.receiverId,
              offeredCash: parsed.data.offeredCash,
              offeredPropertyIds: parsed.data.offeredPropertyIds,
              requestedCash: parsed.data.requestedCash,
              requestedPropertyIds: parsed.data.requestedPropertyIds,
            }),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to create trade offer';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'TRADE_CREATE_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Accept Trade Offer ---
    socket.on(
      SOCKET_EVENTS.GAME_TRADE_ACCEPT,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = TradeAcceptPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.acceptTrade(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to accept trade offer';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'TRADE_ACCEPT_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Reject Trade Offer ---
    socket.on(
      SOCKET_EVENTS.GAME_TRADE_REJECT,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = TradeRejectPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.rejectTrade(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to reject trade offer';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'TRADE_REJECT_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: Declare Bankruptcy ---
    socket.on(
      SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = DeclareBankruptcyPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.declareBankruptcy(session, roomCode, parsed.data.creditorId),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') ack({ ok: true, data: snapshot });
          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to declare bankruptcy';
          const code = (msg.includes('Spectator') || msg.includes('not permitted')) ? 'FORBIDDEN' : 'DECLARE_BANKRUPTCY_FAILED';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Game: End Turn ---
    socket.on(
      SOCKET_EVENTS.GAME_END_TURN,
      async (rawPayload: unknown, ack?: (response: SocketAck<RoomSnapshot>) => void) => {
        const parsed = EndTurnPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = {
            code: 'INVALID_PAYLOAD',
            message: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
            details: parsed.error.flatten(),
          };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const actionStart = performance.now();

        try {
          const { result: snapshot, isDuplicate } = await roomManager.enqueueRoomAction(
            roomCode,
            () => roomManager.endTurn(session, roomCode),
            parsed.data.requestId
          );

          serverMetrics.recordAction(performance.now() - actionStart, true, isDuplicate);

          if (typeof ack === 'function') {
            ack({ ok: true, data: snapshot });
          }

          io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snapshot);
          if (snapshot.gameState) {
            io.to(`room:${snapshot.code}`).emit(SOCKET_EVENTS.GAME_STATE_UPDATED, {
              roomCode: snapshot.code,
              sequenceNumber: snapshot.sequenceNumber,
              gameState: snapshot.gameState,
            });
          }
        } catch (error: unknown) {
          serverMetrics.recordAction(performance.now() - actionStart, false, false, true);
          const msg = error instanceof Error ? error.message : 'Failed to end turn';
          let code = 'END_TURN_FAILED';
          if (msg.includes('Spectator') || msg.includes('not permitted')) code = 'FORBIDDEN';
          else if (msg.includes('not your turn')) code = 'NOT_YOUR_TURN';
          else if (msg.includes('must roll')) code = 'MUST_ROLL_FIRST';
          const err: SocketError = { code, message: msg };
          if (typeof ack === 'function') ack({ ok: false, error: err });
        }
      }
    );

    // --- Chat: Send Message ---
    socket.on(
      SOCKET_EVENTS.CHAT_SEND,
      (rawPayload: unknown, ack?: (response: SocketAck<{ id: string }>) => void) => {
        const parsed = SendChatPayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          const err: SocketError = { code: 'INVALID_PAYLOAD', message: 'Invalid chat message' };
          if (typeof ack === 'function') ack({ ok: false, error: err });
          return;
        }

        const roomCode = parsed.data.roomCode.trim().toUpperCase();
        const broadcast: ChatMessageBroadcast = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          roomCode,
          senderId: session.sessionId,
          senderNickname: session.nickname,
          text: parsed.data.text,
          timestamp: Date.now(),
        };

        const validatedBroadcast = ChatMessageBroadcastSchema.safeParse(broadcast);
        if (validatedBroadcast.success) {
          io.to(`room:${roomCode}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, validatedBroadcast.data);
          if (typeof ack === 'function') ack({ ok: true, data: { id: broadcast.id } });
        }
      }
    );

    // --- Disconnect ---
    socket.on('disconnect', () => {
      const result = roomManager.handleSocketDisconnect(socket.id);
      if (result?.snapshot && result.roomCode) {
        io.to(`room:${result.roomCode}`).emit(SOCKET_EVENTS.ROOM_UPDATED, result.snapshot);
      }
      // eslint-disable-next-line no-console
      console.log(`[Socket.IO] Client disconnected: socket_id=${socket.id}`);
    });
  });

  const start = (port = options.port ?? 3001, host = options.host ?? '0.0.0.0'): Promise<number> => {
    return new Promise((resolve) => {
      httpServer.listen(port, host, () => {
        const address = httpServer.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        resolve(actualPort);
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      io.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });
  };

  return {
    httpServer,
    io,
    roomManager,
    start,
    stop,
  };
}
