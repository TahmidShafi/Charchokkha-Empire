import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Step 4 — Real Multiplayer E2E Integration Flow Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;

  beforeAll(async () => {
    appServer = createAppServer({ allowedOrigins: ['*'] });
    serverPort = await appServer.start(0, '127.0.0.1');
  });

  afterAll(async () => {
    await appServer.stop();
  });

  function connectClient(token?: string): Promise<{
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

  it('verifies the full 12-step multiplayer game lifecycle end-to-end', async () => {
    // -------------------------------------------------------------------------
    // Step 1: Player A joins using a guest nickname
    // -------------------------------------------------------------------------
    const playerA = await connectClient();
    expect(playerA.session.sessionId).toMatch(/^guest_/);
    expect(playerA.session.token).toBeTruthy();

    // -------------------------------------------------------------------------
    // Step 2: Player A creates a room
    // -------------------------------------------------------------------------
    const createRoomRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'Alice',
          avatar: '🎩',
          settings: {
            startingCash: 1500,
            doubleRent: true,
            vacationCash: true,
            auction: true,
            mortgage: true,
          },
        },
        resolve
      );
    });

    expect(createRoomRes.ok).toBe(true);
    if (!createRoomRes.ok) throw new Error('Failed to create room');
    const roomCode = createRoomRes.data.code;
    expect(createRoomRes.data.hostId).toBe(playerA.session.sessionId);
    expect(createRoomRes.data.state).toBe('waiting');
    expect(createRoomRes.data.players).toHaveLength(1);

    // Set up broadcast tracking for consistency verification
    let playerALatestSnapshot: RoomSnapshot = createRoomRes.data;
    let playerBLatestSnapshot: RoomSnapshot | null = null;

    playerA.socket.on(SOCKET_EVENTS.ROOM_UPDATED, (snap: RoomSnapshot) => {
      playerALatestSnapshot = snap;
    });

    // -------------------------------------------------------------------------
    // Step 3: Player B joins the room using its room code
    // -------------------------------------------------------------------------
    const playerB = await connectClient();
    expect(playerB.session.sessionId).not.toBe(playerA.session.sessionId);

    playerB.socket.on(SOCKET_EVENTS.ROOM_UPDATED, (snap: RoomSnapshot) => {
      playerBLatestSnapshot = snap;
    });

    const joinRoomRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerB.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'Bob', avatar: '⛵' },
        resolve
      );
    });

    expect(joinRoomRes.ok).toBe(true);
    if (!joinRoomRes.ok) throw new Error('Failed to join room');
    expect(joinRoomRes.data.players).toHaveLength(2);

    // -------------------------------------------------------------------------
    // Step 4: Both clients receive consistent player and room state
    // -------------------------------------------------------------------------
    // Give brief turn for socket broadcasts to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(playerALatestSnapshot.code).toBe(roomCode);
    expect(playerBLatestSnapshot?.code).toBe(roomCode);
    expect(playerALatestSnapshot.players.length).toBe(2);
    expect(playerBLatestSnapshot?.players.length).toBe(2);
    expect(playerALatestSnapshot.sequenceNumber).toBe(playerBLatestSnapshot?.sequenceNumber);
    expect(playerALatestSnapshot.hostId).toBe(playerA.session.sessionId);

    // -------------------------------------------------------------------------
    // Step 5: The game starts
    // -------------------------------------------------------------------------
    const startGameRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });

    expect(startGameRes.ok).toBe(true);
    if (!startGameRes.ok) throw new Error('Failed to start game');
    expect(startGameRes.data.state).toBe('in_progress');
    expect(startGameRes.data.gameState).toBeDefined();
    expect(startGameRes.data.gameState?.turnOrder).toEqual([
      playerA.session.sessionId,
      playerB.session.sessionId,
    ]);
    expect(startGameRes.data.gameState?.activePlayerId).toBe(playerA.session.sessionId);
    expect(startGameRes.data.gameState?.turnPhase).toBe('need_roll');

    // -------------------------------------------------------------------------
    // Step 6: A player rolls the dice and moves
    // -------------------------------------------------------------------------
    const rollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });

    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) throw new Error('Roll dice failed');
    const rolledState = rollRes.data.gameState!;
    expect(rolledState.lastDiceRoll).toBeDefined();
    expect(rolledState.lastDiceRoll?.total).toBeGreaterThanOrEqual(2);
    expect(rolledState.lastDiceRoll?.total).toBeLessThanOrEqual(12);
    const p1PosAfterRoll = rolledState.players[playerA.session.sessionId].position;
    expect(p1PosAfterRoll).toBe(rolledState.lastDiceRoll!.total);

    // -------------------------------------------------------------------------
    // Step 7: A legal property purchase succeeds
    // -------------------------------------------------------------------------
    // For deterministic purchase and rent verification:
    // Place Alice on Space 1 (Salvador: price $60, rent $2, unowned)
    const serverRoom = appServer.roomManager.getRoom(roomCode)!;
    serverRoom.gameState!.players[playerA.session.sessionId].position = 1;
    serverRoom.gameState!.turnPhase = 'action_pending';

    const p1CashBeforeBuy = serverRoom.gameState!.players[playerA.session.sessionId].cash;

    const buyRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, resolve);
    });

    expect(buyRes.ok).toBe(true);
    if (!buyRes.ok) throw new Error('Buy property failed');
    const stateAfterBuy = buyRes.data.gameState!;
    // Ownership verified
    const space1Record = stateAfterBuy.properties['1'];
    expect(space1Record).toBeDefined();
    const ownerId = typeof space1Record === 'string' ? space1Record : space1Record?.ownerId;
    expect(ownerId).toBe(playerA.session.sessionId);
    // Cash balance deducted correctly ($60 for Salvador)
    expect(stateAfterBuy.players[playerA.session.sessionId].cash).toBe(p1CashBeforeBuy - 60);
    expect(stateAfterBuy.turnPhase).toBe('turn_ended');

    // End Alice's turn
    const endTurnA = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, resolve);
    });
    expect(endTurnA.ok).toBe(true);

    // -------------------------------------------------------------------------
    // Step 9: Turns advance correctly
    // -------------------------------------------------------------------------
    expect(endTurnA.data.gameState?.activePlayerId).toBe(playerB.session.sessionId);
    expect(endTurnA.data.gameState?.turnPhase).toBe('need_roll');

    // -------------------------------------------------------------------------
    // Step 8: An applicable rent payment is processed correctly
    // -------------------------------------------------------------------------
    // Bob is active. We want Bob to roll and land on Space 1 (owned by Alice).
    // Bob starts on space 0; we set Bob to space 39 so rolling 2 (1+1) passes START and lands on space 1 (Salvador)
    const bobCashBeforeRent = serverRoom.gameState!.players[playerB.session.sessionId].cash;
    const aliceCashBeforeRent = serverRoom.gameState!.players[playerA.session.sessionId].cash;

    serverRoom.gameState!.players[playerB.session.sessionId].position = 39;

    // Bob rolls dice (injected [1, 1] = total 2, 39 + 2 = 41 % 40 = space 1)
    const bobRentRoll = appServer.roomManager.rollDice(
      playerB.session as any,
      roomCode,
      [1, 1]
    );

    expect(bobRentRoll.gameState?.players[playerB.session.sessionId].position).toBe(1);
    // Rent of $4 (canonical Salvador base rent) was deducted from Bob and credited to Alice!
    // Bob collected $200 passing Start, then paid $4 rent. Net Bob = +$196.
    expect(bobRentRoll.gameState?.players[playerB.session.sessionId].cash).toBe(bobCashBeforeRent + 200 - 4);
    // Alice collected $4 rent from Bob!
    expect(bobRentRoll.gameState?.players[playerA.session.sessionId].cash).toBe(aliceCashBeforeRent + 4);
    expect(bobRentRoll.gameState?.lastActionMessage).toContain('Paid $4 rent');

    // -------------------------------------------------------------------------
    // Step 10: A duplicate action request does not apply the same transaction twice
    // -------------------------------------------------------------------------
    // Bob has already rolled and resolved landing. turnPhase is 'turn_ended'.
    // Bob tries to roll again in the same turn:
    const dupRollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerB.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(dupRollRes.ok).toBe(false);
    if (!dupRollRes.ok) {
      expect(dupRollRes.error.code).toBe('ALREADY_ROLLED');
    }

    // Bob tries to buy property again:
    const dupBuyRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerB.socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, resolve);
    });
    expect(dupBuyRes.ok).toBe(false);

    // Balances and turnPhase remain untouched
    const currentSnap = appServer.roomManager.getRoom(roomCode)!;
    expect(currentSnap.gameState?.players[playerB.session.sessionId].cash).toBe(bobCashBeforeRent + 200 - 4);
    expect(currentSnap.gameState?.players[playerA.session.sessionId].cash).toBe(aliceCashBeforeRent + 4);

    // -------------------------------------------------------------------------
    // Step 11: A player refreshes or disconnects and reconnects
    // -------------------------------------------------------------------------
    // Bob disconnects socket
    playerB.socket.disconnect();
    await new Promise((r) => setTimeout(r, 20));

    // Alice observes Bob is temporarily disconnected
    expect(playerALatestSnapshot.players.find((p) => p.id === playerB.session.sessionId)?.connected).toBe(false);

    // Bob reconnects with existing session token (simulating browser reload)
    const reconnectedBob = await connectClient(playerB.session.token);
    expect(reconnectedBob.session.sessionId).toBe(playerB.session.sessionId);

    // Bob requests state snapshot
    const resyncAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedBob.socket.emit(SOCKET_EVENTS.ROOM_GET_SNAPSHOT, { roomCode }, resolve);
    });

    expect(resyncAck.ok).toBe(true);
    if (!resyncAck.ok) throw new Error('Resync snapshot failed');
    expect(resyncAck.data.gameState?.activePlayerId).toBe(playerB.session.sessionId);
    expect(resyncAck.data.gameState?.properties['1']).toBeDefined();

    // -------------------------------------------------------------------------
    // Step 12: The game continues without corrupting the room state
    // -------------------------------------------------------------------------
    // Reconnected Bob ends their turn
    const endTurnB = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      reconnectedBob.socket.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, resolve);
    });

    expect(endTurnB.ok).toBe(true);
    if (!endTurnB.ok) throw new Error('End turn failed');
    // Turn successfully returns to Alice
    expect(endTurnB.data.gameState?.activePlayerId).toBe(playerA.session.sessionId);
    expect(endTurnB.data.gameState?.turnPhase).toBe('need_roll');

    // Alice rolls dice and moves in the new round
    const round2Roll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      playerA.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
    });
    expect(round2Roll.ok).toBe(true);

    // Clean up
    playerA.socket.disconnect();
    reconnectedBob.socket.disconnect();
  });
});
