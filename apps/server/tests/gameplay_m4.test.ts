import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { createAppServer } from '../src/server.js';

describe('Milestone 4 — Core Gameplay Server Integration Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;

  let client1: ClientSocket; // Host / Player 1
  let client2: ClientSocket; // Player 2
  let client1Auth: SessionAuthenticatedPayload;
  let client2Auth: SessionAuthenticatedPayload;
  let roomCode: string;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    port = await appServer.start(0, '127.0.0.1');
    serverUrl = `http://127.0.0.1:${port}`;

    // Connect Client 1
    client1 = Client(serverUrl, { transports: ['websocket'], reconnection: false });
    const auth1Promise = new Promise<SessionAuthenticatedPayload>((res) => {
      client1.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, res);
    });
    await new Promise<void>((res) => client1.on('connect', () => res()));
    client1Auth = await auth1Promise;

    // Connect Client 2
    client2 = Client(serverUrl, { transports: ['websocket'], reconnection: false });
    const auth2Promise = new Promise<SessionAuthenticatedPayload>((res) => {
      client2.once(SOCKET_EVENTS.SESSION_AUTHENTICATED, res);
    });
    await new Promise<void>((res) => client2.on('connect', () => res()));
    client2Auth = await auth2Promise;
  });

  afterAll(async () => {
    if (client1?.connected) client1.disconnect();
    if (client2?.connected) client2.disconnect();
    await appServer.stop();
  });

  it('sets up room and starts game with 2 players', async () => {
    const createAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'P1', avatar: '🎩', settings: { startingCash: 1500 } },
        resolve
      );
    });
    expect(createAck.ok).toBe(true);
    if (!createAck.ok) return;
    roomCode = createAck.data.code;

    const joinAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: 'P2', avatar: '🏎️' }, resolve);
    });
    expect(joinAck.ok).toBe(true);

    const startAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startAck.ok).toBe(true);
  });

  it('declining an unowned property starts an authoritative auction', async () => {
    const serverRoom = appServer.roomManager.getRoom(roomCode)!;
    // Position P1 on space 1 (Salvador, price 60) and set phase to action_pending
    serverRoom.gameState!.players[client1Auth.sessionId].position = 1;
    serverRoom.gameState!.turnPhase = 'action_pending';

    const declineAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_DECLINE_PROPERTY, { roomCode }, resolve);
    });

    expect(declineAck.ok).toBe(true);
    if (declineAck.ok) {
      expect(declineAck.data.gameState?.turnPhase).toBe('in_auction');
      expect(declineAck.data.gameState?.auction).toBeDefined();
      expect(declineAck.data.gameState?.auction?.spaceId).toBe(1);
      expect(declineAck.data.gameState?.auction?.activeBidders).toContain(client1Auth.sessionId);
      expect(declineAck.data.gameState?.auction?.activeBidders).toContain(client2Auth.sessionId);
    }
  });

  it('handles auction bidding and pass to award property to high bidder', async () => {
    // P2 bids $40
    const bidAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_AUCTION_BID, { roomCode, bidAmount: 40 }, resolve);
    });
    expect(bidAck.ok).toBe(true);
    if (bidAck.ok) {
      expect(bidAck.data.gameState?.auction?.currentBid).toBe(40);
      expect(bidAck.data.gameState?.auction?.highBidderId).toBe(client2Auth.sessionId);
    }

    // P1 passes in auction
    const passAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_AUCTION_PASS, { roomCode }, resolve);
    });
    expect(passAck.ok).toBe(true);
    if (passAck.ok) {
      expect(passAck.data.gameState?.auction).toBeNull();
      expect(passAck.data.gameState?.turnPhase).toBe('turn_ended');
      expect(passAck.data.gameState?.players[client2Auth.sessionId].cash).toBe(1460); // 1500 - 40
      const prop1 = passAck.data.gameState?.properties['1'];
      const owner = typeof prop1 === 'object' ? prop1.ownerId : prop1;
      expect(owner).toBe(client2Auth.sessionId);
    }

    // End P1's turn
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, resolve);
    });
  });

  it('allows mortgaging and unmortgaging a property over socket', async () => {
    // P2 owns space 1 (price 60). Mortgage value = 30.
    const mortAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY, { roomCode, spaceId: 1 }, resolve);
    });

    expect(mortAck.ok).toBe(true);
    if (mortAck.ok) {
      expect(mortAck.data.gameState?.players[client2Auth.sessionId].cash).toBe(1490); // 1460 + 30
      const prop1 = mortAck.data.gameState?.properties['1'];
      expect(typeof prop1 === 'object' && prop1.isMortgaged).toBe(true);
    }

    // Unmortgage space 1 (costs 50% + 10% = 33)
    const unmortAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_UNMORTGAGE_PROPERTY, { roomCode, spaceId: 1 }, resolve);
    });

    expect(unmortAck.ok).toBe(true);
    if (unmortAck.ok) {
      expect(unmortAck.data.gameState?.players[client2Auth.sessionId].cash).toBe(1457); // 1490 - 33
      const prop1 = unmortAck.data.gameState?.properties['1'];
      expect(typeof prop1 === 'object' && prop1.isMortgaged).toBe(false);
    }
  });

  it('allows building a house when monopoly conditions are satisfied', async () => {
    const serverRoom = appServer.roomManager.getRoom(roomCode)!;
    // Give P2 ownership of space 3 (Rio) as well -> P2 now has brown monopoly!
    serverRoom.gameState!.properties[3] = {
      ownerId: client2Auth.sessionId,
      houses: 0,
      isMortgaged: false,
    };

    // Build house on space 1 (Salvador, houseCost = 50)
    const buildAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_BUILD_HOUSE, { roomCode, spaceId: 1 }, resolve);
    });

    expect(buildAck.ok).toBe(true);
    if (buildAck.ok) {
      expect(buildAck.data.gameState?.players[client2Auth.sessionId].cash).toBe(1407); // 1457 - 50
      const prop1 = buildAck.data.gameState?.properties['1'];
      expect(typeof prop1 === 'object' && prop1.houses).toBe(1);
    }
  });

  it('creates, validates, and accepts a trade offer between players', async () => {
    // Attempting to trade space 3 while space 1 has a house should be rejected
    const invalidTradeAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(
        SOCKET_EVENTS.GAME_TRADE_CREATE,
        {
          roomCode,
          receiverId: client1Auth.sessionId,
          offeredCash: 100,
          offeredPropertyIds: [3],
          requestedCash: 200,
          requestedPropertyIds: [],
        },
        resolve
      );
    });
    expect(invalidTradeAck.ok).toBe(false);
    if (!invalidTradeAck.ok) {
      expect(invalidTradeAck.error.code).toBe('TRADE_CREATE_FAILED');
    }

    // P2 sells the house on space 1 first (refund 25)
    const sellAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(SOCKET_EVENTS.GAME_SELL_HOUSE, { roomCode, spaceId: 1 }, resolve);
    });
    expect(sellAck.ok).toBe(true);

    // Now trade can be created successfully
    const createAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client2.emit(
        SOCKET_EVENTS.GAME_TRADE_CREATE,
        {
          roomCode,
          receiverId: client1Auth.sessionId,
          offeredCash: 100,
          offeredPropertyIds: [3],
          requestedCash: 200,
          requestedPropertyIds: [],
        },
        resolve
      );
    });

    expect(createAck.ok).toBe(true);
    if (createAck.ok) {
      expect(createAck.data.gameState?.pendingTrade).toBeDefined();
      expect(createAck.data.gameState?.pendingTrade?.offeredCash).toBe(100);
    }

    // P1 accepts the trade
    const acceptAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_TRADE_ACCEPT, { roomCode }, resolve);
    });

    expect(acceptAck.ok).toBe(true);
    if (acceptAck.ok) {
      expect(acceptAck.data.gameState?.pendingTrade).toBeNull();
      // P1 received space 3
      const prop3 = acceptAck.data.gameState?.properties['3'];
      const owner3 = typeof prop3 === 'object' ? prop3.ownerId : prop3;
      expect(owner3).toBe(client1Auth.sessionId);
    }
  });

  it('allows paying prison fine when in prison', async () => {
    const serverRoom = appServer.roomManager.getRoom(roomCode)!;
    // Set P1 in prison and active player
    serverRoom.gameState!.activePlayerId = client1Auth.sessionId;
    serverRoom.gameState!.currentTurnIndex = 0;
    serverRoom.gameState!.turnPhase = 'need_roll';
    serverRoom.gameState!.players[client1Auth.sessionId].inPrison = true;
    serverRoom.gameState!.players[client1Auth.sessionId].position = 12;
    const initialCash = serverRoom.gameState!.players[client1Auth.sessionId].cash;

    const fineAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(SOCKET_EVENTS.GAME_PAY_PRISON_FINE, { roomCode }, resolve);
    });

    expect(fineAck.ok).toBe(true);
    if (fineAck.ok) {
      expect(fineAck.data.gameState?.players[client1Auth.sessionId].inPrison).toBe(false);
      expect(fineAck.data.gameState?.players[client1Auth.sessionId].cash).toBe(initialCash - 50);
      expect(fineAck.data.gameState?.turnPhase).toBe('need_roll');
    }
  });

  it('resolves bankruptcy and transitions game to finished with winner declared', async () => {
    // P1 declares bankruptcy to creditor P2
    const bankAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      client1.emit(
        SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
        { roomCode, creditorId: client2Auth.sessionId },
        resolve
      );
    });

    expect(bankAck.ok).toBe(true);
    if (bankAck.ok) {
      expect(bankAck.data.state).toBe('finished');
      expect(bankAck.data.gameState?.phase).toBe('finished');
      expect(bankAck.data.gameState?.winnerId).toBe(client2Auth.sessionId);
      expect(bankAck.data.gameState?.players[client1Auth.sessionId].isBankrupt).toBe(true);
      // All properties of P1 transferred to P2
      const prop3 = bankAck.data.gameState?.properties['3'];
      const owner3 = typeof prop3 === 'object' ? prop3.ownerId : prop3;
      expect(owner3).toBe(client2Auth.sessionId);
    }
  });
});
