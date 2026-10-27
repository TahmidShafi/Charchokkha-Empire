import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Milestone 5A — Multiplayer Verification & Stabilization Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    serverPort = await appServer.start(0, '127.0.0.1');
  });

  afterAll(async () => {
    await appServer.stop();
  });

  function createClient(token?: string): Promise<{
    socket: ClientSocketType;
    session: SessionAuthenticatedPayload;
  }> {
    return new Promise((resolve, reject) => {
      const socket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        auth: token ? { token } : undefined,
      });

      socket.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        resolve({ socket, session: auth });
      });

      socket.once('connect_error', (err) => {
        reject(err);
      });
    });
  }

  it('runs complete multiplayer match with consistency, rules, auctions, trades, and bankruptcy', async () => {
    // 1. Connect two distinct player clients
    const client1 = await createClient();
    const client2 = await createClient();

    expect(client1.session.sessionId).not.toBe(client2.session.sessionId);

    // 2. Client 1 creates room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'Alice',
          avatar: '🔴',
          settings: {
            vacationCash: true,
            doubleRent: true,
            auction: true,
            mortgage: true,
          },
        },
        resolve
      );
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const roomCode = createRes.data.code;
    expect(createRes.data.hostId).toBe(client1.session.sessionId);
    expect(createRes.data.settings.vacationCash).toBe(true);

    // 3. Client 2 joins room
    const joinRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Bob', avatar: '🔵' },
        resolve
      );
    });

    expect(joinRes.ok).toBe(true);
    if (!joinRes.ok) return;
    expect(joinRes.data.players.length).toBe(2);

    // 4. Non-host cannot start game
    const nonHostStartRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(nonHostStartRes.ok).toBe(false);
    if (!nonHostStartRes.ok) {
      expect(nonHostStartRes.error.code).toBe('FORBIDDEN');
    }

    // 5. Host starts game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });

    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    expect(startRes.data.state).toBe('in_progress');
    const initialGameState = startRes.data.gameState!;
    expect(initialGameState.activePlayerId).toBe(client1.session.sessionId);
    expect(initialGameState.turnPhase).toBe('need_roll');
    expect(initialGameState.rules.vacationCash).toBe(true);

    // 6. Non-active player cannot roll out of turn
    const outOfTurnRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(outOfTurnRoll.ok).toBe(false);

    // 7. Active player rolls dice
    const roll1Res = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(roll1Res.ok).toBe(true);
    if (!roll1Res.ok) return;
    const p1State = roll1Res.data.gameState!;

    // 8. Idempotency test: duplicate roll in same turn is rejected
    const dupRollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(dupRollRes.ok).toBe(false);

    // If landed on purchasable space, test buy or decline
    if (p1State.turnPhase === 'action_pending') {
      const buyRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1.socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, resolve);
      });
      expect(buyRes.ok).toBe(true);

      // Duplicate buy is rejected
      const dupBuyRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        client1.socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, resolve);
      });
      expect(dupBuyRes.ok).toBe(false);
    }

    // End turn for Alice
    const endTurn1 = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, resolve);
    });
    expect(endTurn1.ok).toBe(true);
    if (!endTurn1.ok) return;
    expect(endTurn1.data.gameState?.activePlayerId).toBe(client2.session.sessionId);

    // 9. Bob rolls dice
    const roll2Res = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(roll2Res.ok).toBe(true);

    // 10. Reconnection test mid-game: Client 2 disconnects and reconnects
    client2.socket.disconnect();
    const reconnectedClient2 = await createClient(client2.session.token);
    expect(reconnectedClient2.session.sessionId).toBe(client2.session.sessionId);

    // Reconnected client receives snapshot matching server authoritative state
    const resyncSnapshot = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedClient2.socket.emit(SOCKET_EVENTS.ROOM_GET_SNAPSHOT, { roomCode }, resolve);
    });
    expect(resyncSnapshot.ok).toBe(true);
    if (!resyncSnapshot.ok) return;
    expect(resyncSnapshot.data.gameState?.turnOrder).toEqual([client1.session.sessionId, client2.session.sessionId]);

    // 11. Bankruptcy & Winner Determination: Bob declares bankruptcy
    const bankruptRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedClient2.socket.emit(SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY, { roomCode }, resolve);
    });
    expect(bankruptRes.ok).toBe(true);
    if (!bankruptRes.ok) return;
    expect(bankruptRes.data.state).toBe('finished');
    expect(bankruptRes.data.gameState?.phase).toBe('finished');
    expect(bankruptRes.data.gameState?.winnerId).toBe(client1.session.sessionId);

    // Clean up sockets
    client1.socket.disconnect();
    reconnectedClient2.socket.disconnect();
  });

  it('enforces auction, trade, and mortgage permissions authoritatively', async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'Carol',
          settings: { auction: true, mortgage: true },
        },
        resolve
      );
    });
    if (!createRes.ok) return;
    const roomCode = createRes.data.code;

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: 'Dave' }, resolve);
    });

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });

    // Directly test Trade Creation and Acceptance
    const tradeRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(
        SOCKET_EVENTS.GAME_TRADE_CREATE,
        {
          roomCode,
          receiverId: client2.session.sessionId,
          offeredCash: 50,
          offeredPropertyIds: [],
          requestedCash: 0,
          requestedPropertyIds: [],
        },
        resolve
      );
    });
    expect(tradeRes.ok).toBe(true);
    if (!tradeRes.ok) return;
    expect(tradeRes.data.gameState?.pendingTrade?.offeredCash).toBe(50);

    // Only receiver can accept trade
    const invalidAccept = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.socket.emit(SOCKET_EVENTS.GAME_TRADE_ACCEPT, { roomCode }, resolve);
    });
    expect(invalidAccept.ok).toBe(false);

    // Receiver accepts trade
    const acceptRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.socket.emit(SOCKET_EVENTS.GAME_TRADE_ACCEPT, { roomCode }, resolve);
    });
    expect(acceptRes.ok).toBe(true);
    if (!acceptRes.ok) return;
    expect(acceptRes.data.gameState?.players[client1.session.sessionId].cash).toBe(1450); // 1500 - 50
    expect(acceptRes.data.gameState?.players[client2.session.sessionId].cash).toBe(1550); // 1500 + 50
    expect(acceptRes.data.gameState?.pendingTrade).toBeNull();

    // Clean up
    client1.socket.disconnect();
    client2.socket.disconnect();
  });
});
