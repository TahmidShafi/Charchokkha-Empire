import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createAppServer } from '../src/server.js';
import {
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';

describe('Server Authoritative Dice Roll and Movement Synchronization Suite', () => {
  let appServer: ReturnType<typeof createAppServer>;
  let serverPort: number;
  const activeSockets: ClientSocket[] = [];

  beforeAll(async () => {
    appServer = createAppServer({ port: 0, allowedOrigins: ['*'] });
    serverPort = await appServer.start(0);
  });

  afterAll(async () => {
    for (const socket of activeSockets) {
      if (socket.connected) socket.disconnect();
    }
    await appServer.stop();
  });

  const connectClient = async (nickname: string) => {
    const socket: ClientSocket = ioc(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: undefined },
    });
    activeSockets.push(socket);

    const session = await new Promise<SessionAuthenticatedPayload>((resolve) => {
      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, resolve);
    });

    return { socket, session, nickname };
  };

  it('immediately updates authoritative player position upon roll and preserves flow across subsequent actions', async () => {
    const host = await connectClient('RollAlice');
    const guest = await connectClient('RollBob');

    // 1. Create Room & Join
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

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: guest.nickname }, resolve);
    });

    // 2. Start Game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) throw new Error('Start failed');

    const activeId = startRes.data.gameState!.activePlayerId;
    const activeClient = activeId === host.session.sessionId ? host : guest;
    const inactiveClient = activeClient === host ? guest : host;

    // Initial position is 0
    expect(startRes.data.gameState!.players[activeId].position).toBe(0);

    // Set up broadcast listener on the other player's socket for the subsequent roll
    const broadcastPromise = new Promise<RoomSnapshot>((resolve) => {
      const handler = (snap: RoomSnapshot) => {
        if (snap.sequenceNumber > startRes.data.sequenceNumber) {
          inactiveClient.socket.off(SOCKET_EVENTS.ROOM_UPDATED, handler);
          resolve(snap);
        }
      };
      inactiveClient.socket.on(SOCKET_EVENTS.ROOM_UPDATED, handler);
    });

    const rollRequestId = `roll_test_${Date.now()}`;

    // 3. Active player rolls dice
    const rollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: rollRequestId },
        resolve
      );
    });

    expect(rollAck.ok).toBe(true);
    if (!rollAck.ok) throw new Error('Roll failed');

    // VERIFY: The server immediately updates and returns the new position in the response!
    const rollSnapshot = rollAck.data;
    const diceRoll = rollSnapshot.gameState?.lastDiceRoll;
    expect(diceRoll).toBeDefined();
    expect(diceRoll!.total).toBeGreaterThanOrEqual(2);
    expect(diceRoll!.total).toBeLessThanOrEqual(12);

    const expectedNewPos = diceRoll!.total % 40;
    const actualNewPos = rollSnapshot.gameState?.players[activeId].position;
    // Note: Space 8 is a Chance card space whose first card is "Advance to START" (Space 0)
    if (expectedNewPos === 8) {
      expect(actualNewPos).toBe(0);
    } else {
      expect(actualNewPos).toBe(expectedNewPos);
    }

    // VERIFY: Broadcast update sent to other players also contains the exact updated position
    const broadcastSnapshot = await broadcastPromise;
    expect(broadcastSnapshot.gameState?.players[activeId].position).toBe(actualNewPos);
    expect(broadcastSnapshot.sequenceNumber).toBe(rollSnapshot.sequenceNumber);

    // 4. Duplicate roll request with the same requestId does not re-roll or advance position again
    const dupRollAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: rollRequestId },
        resolve
      );
    });
    expect(dupRollAck.ok).toBe(true);
    if (dupRollAck.ok) {
      expect(dupRollAck.data.sequenceNumber).toBe(rollSnapshot.sequenceNumber);
      expect(dupRollAck.data.gameState?.players[activeId].position).toBe(expectedNewPos);
      expect(dupRollAck.data.gameState?.lastDiceRoll).toEqual(diceRoll);
    }

    // 5. Non-turn player attempt to roll is rejected
    const nonTurnRoll = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      inactiveClient.socket.emit(
        SOCKET_EVENTS.GAME_ROLL_DICE,
        { roomCode, requestId: `bad_roll_${Date.now()}` },
        resolve
      );
    });
    expect(nonTurnRoll.ok).toBe(false);

    // 6. Action flow continuation after movement:
    // If the space is unowned property, active player can purchase or decline
    if (rollSnapshot.gameState?.turnPhase === 'action_pending') {
      const buyAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        activeClient.socket.emit(
          SOCKET_EVENTS.GAME_BUY_PROPERTY,
          { roomCode, requestId: `buy_${Date.now()}` },
          resolve
        );
      });
      expect(buyAck.ok).toBe(true);
      if (buyAck.ok) {
        expect(buyAck.data.gameState?.properties[actualNewPos]?.ownerId).toBe(activeId);
        expect(buyAck.data.gameState?.turnPhase).toBe('turn_ended');
      }
    }

    // 7. End turn transitions to next player
    const endTurnAck = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      activeClient.socket.emit(
        SOCKET_EVENTS.GAME_END_TURN,
        { roomCode, requestId: `end_${Date.now()}` },
        resolve
      );
    });
    expect(endTurnAck.ok).toBe(true);
    if (endTurnAck.ok) {
      expect(endTurnAck.data.gameState?.activePlayerId).toBe(inactiveClient.session.sessionId);
      expect(endTurnAck.data.gameState?.turnPhase).toBe('need_roll');
    }
  });
});
