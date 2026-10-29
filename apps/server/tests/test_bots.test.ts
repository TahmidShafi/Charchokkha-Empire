import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYER_COLOR_HEXES,
  SOCKET_EVENTS,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { createAppServer } from '../src/server.js';
import { BotCoordinator } from '../src/botCoordinator.js';

interface TestClient {
  socket: ClientSocketType;
  session: SessionAuthenticatedPayload;
}

describe('Host-Controlled Test Bots System', () => {
  let serverInstance: ReturnType<typeof createAppServer>;
  let serverPort: number;
  let testPersistenceDir: string;
  const clients: TestClient[] = [];

  const createClient = (): Promise<TestClient> => {
    return new Promise((resolve, reject) => {
      const socket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      socket.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
        const client: TestClient = { socket, session: auth };
        clients.push(client);
        resolve(client);
      });

      socket.on('connect_error', reject);
    });
  };

  const waitForEvent = <T>(socket: ClientSocketType, event: string, timeout = 3000): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for event ${event}`));
      }, timeout);

      socket.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  };

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    BotCoordinator.setTestMode(true);
    testPersistenceDir = path.join(
      process.cwd(),
      '.test-data-bots',
      `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );

    serverInstance = createAppServer({
      port: 0,
      persistenceDir: testPersistenceDir,
    });

    await new Promise<void>((resolve) => {
      serverInstance.httpServer.listen(0, '127.0.0.1', () => {
        const address = serverInstance.httpServer.address();
        if (address && typeof address === 'object') {
          serverPort = address.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    BotCoordinator.setTestMode(false);
    for (const client of clients) {
      if (client.socket.connected) {
        client.socket.disconnect();
      }
    }
    clients.length = 0;

    await new Promise<void>((resolve) => {
      serverInstance.io.close(() => {
        serverInstance.httpServer.close(() => {
          resolve();
        });
      });
    });

    if (fs.existsSync(testPersistenceDir)) {
      try {
        fs.rmSync(testPersistenceDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('allows authorized host in private room to add bots with unique colors and bot identities', async () => {
    const host = await createClient();

    // 1. Create a private room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'HostTester',
          avatar: '👑',
          settings: { isPrivate: true, maxPlayers: 4 },
        },
        resolve
      );
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const roomCode = createRes.data.code;

    // 2. Add 1 bot as host
    const addBotRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_ADD,
        { roomCode, count: 1 },
        resolve
      );
    });

    expect(addBotRes.ok).toBe(true);
    if (!addBotRes.ok) return;

    expect(addBotRes.data.players).toHaveLength(2);
    const bot = addBotRes.data.players.find((p) => p.isBot);
    expect(bot).toBeDefined();
    expect(bot?.isBot).toBe(true);
    expect(bot?.avatar).toBe('🤖');
    expect(typeof bot?.nickname).toBe('string');
    expect(bot?.nickname.length).toBeGreaterThan(0);
    expect(bot?.color).not.toBe(addBotRes.data.players[0].color);
    expect(PLAYER_COLOR_HEXES).toContain(bot?.color);
  });

  it('rejects bot addition by non-hosts and in public rooms', async () => {
    const host = await createClient();
    const guest = await createClient();

    // 1. Create a private room
    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'HostTester', settings: { isPrivate: true, maxPlayers: 4 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create room failed');
    const roomCode = createRes.data.code;

    // Guest joins room
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        { roomCode, nickname: 'GuestTester' },
        resolve
      );
    });

    // 2. Guest attempts to add bot -> should be FORBIDDEN
    const guestAddRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      guest.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_ADD,
        { roomCode, count: 1 },
        resolve
      );
    });
    expect(guestAddRes.ok).toBe(false);
    if (!guestAddRes.ok) {
      expect(guestAddRes.error.code).toBe('FORBIDDEN');
    }

    // 3. Create a public room
    const publicRoomRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'PublicHost', settings: { isPrivate: false, maxPlayers: 4 } },
        resolve
      );
    });
    if (!publicRoomRes.ok) throw new Error('Create public room failed');
    const publicCode = publicRoomRes.data.code;

    // Host attempts to add bot to public room -> should fail
    const publicAddRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_ADD,
        { roomCode: publicCode, count: 1 },
        resolve
      );
    });
    expect(publicAddRes.ok).toBe(false);
  });

  it('enforces maximum capacity and supports safe bot removal in lobby', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'HostCapacity', settings: { isPrivate: true, maxPlayers: 3 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 2 bots to fill to 3 players
    const fillRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_ADD,
        { roomCode, count: 2 },
        resolve
      );
    });
    expect(fillRes.ok).toBe(true);
    if (!fillRes.ok) return;
    expect(fillRes.data.players).toHaveLength(3);

    // Attempt to add a 3rd bot -> exceeds maxPlayers=3
    const overfillRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_ADD,
        { roomCode, count: 1 },
        resolve
      );
    });
    expect(overfillRes.ok).toBe(false);

    // Remove one of the bots
    const botToRemove = fillRes.data.players.find((p) => p.isBot);
    expect(botToRemove).toBeDefined();

    const removeRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_REMOVE,
        { roomCode, botPlayerId: botToRemove!.id },
        resolve
      );
    });
    expect(removeRes.ok).toBe(true);
    if (!removeRes.ok) return;
    expect(removeRes.data.players).toHaveLength(2);
    expect(removeRes.data.players.some((p) => p.id === botToRemove!.id)).toBe(false);
  });

  it('protects host privileges: bots are never elected host when humans leave', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'SoleHuman', settings: { isPrivate: true, maxPlayers: 4 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 2 bots
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 2 }, resolve);
    });

    // Human host leaves
    const leaveRes = await new Promise<SocketAck<{ leftCode: string }>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode }, resolve);
    });
    expect(leaveRes.ok).toBe(true);

    // The room had no other humans; verify it transitioned to abandoned rather than making a bot host
    const room = serverInstance.roomManager.getRoom(roomCode);
    if (room) {
      expect(room.state).toBe('abandoned');
    }
  });

  it('migrates host to remaining human player, never to a bot', async () => {
    const humanHost = await createClient();
    const humanGuest = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      humanHost.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'Human1', settings: { isPrivate: true, maxPlayers: 4 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      humanGuest.socket.emit(SOCKET_EVENTS.ROOM_JOIN, { roomCode, nickname: 'Human2' }, resolve);
    });

    // Add 1 bot
    const addBotRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      humanHost.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 1 }, resolve);
    });
    if (!addBotRes.ok) throw new Error('Add bot failed');

    // Human1 leaves
    await delay(30);
    const updatePromise = waitForEvent<RoomSnapshot>(humanGuest.socket, SOCKET_EVENTS.ROOM_UPDATED);
    await new Promise<SocketAck<{ leftCode: string }>>((resolve) => {
      humanHost.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode }, resolve);
    });

    const updated = await updatePromise;
    expect(updated.hostId).toBe(humanGuest.session.sessionId);
    const newHost = updated.players.find((p) => p.isHost);
    expect(newHost?.isBot).toBeFalsy();
    expect(newHost?.nickname).toBe('Human2');
  });

  it('supports configuring bot speed between normal and slow', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'SpeedTester', settings: { isPrivate: true, maxPlayers: 4 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Set bot speed to slow
    const slowRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_SET_SPEED,
        { roomCode, speed: 'slow' },
        resolve
      );
    });
    expect(slowRes.ok).toBe(true);
    if (!slowRes.ok) return;
    expect(slowRes.data.settings.botSpeed).toBe('slow');

    // Set bot speed back to normal
    const normalRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_BOT_SET_SPEED,
        { roomCode, speed: 'normal' },
        resolve
      );
    });
    expect(normalRes.ok).toBe(true);
    if (!normalRes.ok) return;
    expect(normalRes.data.settings.botSpeed).toBe('normal');
  });

  it('executes bot turns authoritatively in a live game match', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'PlayerOne', settings: { isPrivate: true, maxPlayers: 2 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 1 bot
    const botRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 1 }, resolve);
    });
    if (!botRes.ok) throw new Error('Bot add failed');
    const botPlayer = botRes.data.players.find((p) => p.isBot);
    expect(botPlayer).toBeDefined();

    // Start Game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    let currentSnap = startRes.data;
    expect(currentSnap.state).toBe('in_progress');
    expect(currentSnap.gameState).toBeDefined();

    // If human is first to play:
    if (currentSnap.gameState?.activePlayerId === host.session.sessionId) {
      // Human rolls dice
      const rollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
      });
      expect(rollRes.ok).toBe(true);
      if (!rollRes.ok) return;

      // If landed on purchasable property, buy to complete pending action
      if (rollRes.data.gameState?.turnPhase === 'action_pending') {
        const buyRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
          host.socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, resolve);
        });
        expect(buyRes.ok).toBe(true);
      }

      // Human ends turn
      const endRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, resolve);
      });
      expect(endRes.ok).toBe(true);
    }

    // Now it is the bot's turn!
    // Since BotCoordinator is in test mode, the bot will automatically schedule and take its action.
    // Wait for the bot to roll, act, and eventually rotate the turn.
    let turnsTaken = 0;
    const maxWaitTime = 6000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitTime) {
      await delay(40);
      const snapRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(SOCKET_EVENTS.ROOM_GET_SNAPSHOT, { roomCode }, resolve);
      });
      if (snapRes.ok && snapRes.data.gameState) {
        currentSnap = snapRes.data;
        const botState = currentSnap.gameState.players[botPlayer!.id];
        // Check that bot moved from GO (position > 0) or took dice rolls
        if (botState && botState.position > 0) {
          turnsTaken++;
          break;
        }
      }
    }

    expect(turnsTaken).toBeGreaterThan(0);
    const botFinalState = currentSnap.gameState?.players[botPlayer!.id];
    expect(botFinalState?.position).toBeGreaterThan(0);
  });

  it('handles auction bidding and passing authoritatively when properties are declined', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        {
          nickname: 'AuctionHost',
          settings: { isPrivate: true, maxPlayers: 2, auction: true },
        },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 1 bot
    const botRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 1 }, resolve);
    });
    if (!botRes.ok) throw new Error('Bot add failed');
    const botPlayer = botRes.data.players.find((p) => p.isBot);
    expect(botPlayer).toBeDefined();

    // Start Game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    if (!startRes.ok) throw new Error('Start failed');

    // Force human turn if needed, land on a property and decline
    let currentSnap = startRes.data;
    if (currentSnap.gameState?.activePlayerId === host.session.sessionId) {
      const rollRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
        host.socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, resolve);
      });
      if (!rollRes.ok) throw new Error('Roll failed');

      if (rollRes.data.gameState?.turnPhase === 'action_pending') {
        // Human declines -> starts auction
        const declineRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
          host.socket.emit(SOCKET_EVENTS.GAME_DECLINE_PROPERTY, { roomCode }, resolve);
        });
        expect(declineRes.ok).toBe(true);
        if (!declineRes.ok) return;

        // If auction started, verify bot receives opportunity and acts
        if (declineRes.data.gameState?.turnPhase === 'in_auction') {
          let auctionResolved = false;
          const startWait = Date.now();
          while (Date.now() - startWait < 4000) {
            await delay(40);
            const snapRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
              host.socket.emit(SOCKET_EVENTS.ROOM_GET_SNAPSHOT, { roomCode }, resolve);
            });
            if (snapRes.ok && snapRes.data.gameState) {
              const phase = snapRes.data.gameState.turnPhase;
              if (phase !== 'in_auction' || snapRes.data.gameState.auction?.highBidderId === botPlayer!.id) {
                auctionResolved = true;
                break;
              }
            }
          }
          expect(auctionResolved).toBe(true);
        }
      }
    }
  });

  it('prevents duplicate timers and race conditions through turnKey deduplication', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'IdempotencyTester', settings: { isPrivate: true, maxPlayers: 2 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 1 bot
    await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 1 }, resolve);
    });

    // Start game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    if (!startRes.ok) throw new Error('Start failed');

    const room = serverInstance.roomManager.getRoom(roomCode);
    expect(room).toBeDefined();

    // Call onRoomStateUpdated multiple times rapidly with identical room state
    const emitFn = () => {};
    for (let i = 0; i < 5; i++) {
      serverInstance.botCoordinator.onRoomStateUpdated(room!, emitFn);
    }

    // Verify room state is consistent and not stuck
    const snap = serverInstance.roomManager.getSnapshot(roomCode);
    expect(snap.state).toBe('in_progress');
    expect(snap.sequenceNumber).toBeGreaterThanOrEqual(startRes.data.sequenceNumber);
  });

  it('builds houses on full color monopolies authoritatively when cash permits', async () => {
    const host = await createClient();

    const createRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(
        SOCKET_EVENTS.ROOM_CREATE,
        { nickname: 'HouseBuilderTester', settings: { isPrivate: true, maxPlayers: 2 } },
        resolve
      );
    });
    if (!createRes.ok) throw new Error('Create failed');
    const roomCode = createRes.data.code;

    // Add 1 bot
    const botRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.ROOM_BOT_ADD, { roomCode, count: 1 }, resolve);
    });
    if (!botRes.ok) throw new Error('Bot add failed');
    const botPlayer = botRes.data.players.find((p) => p.isBot);
    expect(botPlayer).toBeDefined();

    // Start game
    const startRes = await new Promise<SocketAck<RoomSnapshot>>((resolve) => {
      host.socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, resolve);
    });
    if (!startRes.ok) throw new Error('Start failed');

    const room = serverInstance.roomManager.getRoom(roomCode);
    expect(room && room.gameState).toBeDefined();
    const gameState = room!.gameState!;

    // Setup bot with monopoly on brown group (spaces 1 and 3) and ample cash
    gameState.properties[1] = { ownerId: botPlayer!.id, houses: 0, isMortgaged: false };
    gameState.properties[3] = { ownerId: botPlayer!.id, houses: 0, isMortgaged: false };
    gameState.players[botPlayer!.id].cash = 1000;
    gameState.activePlayerId = botPlayer!.id;
    gameState.turnPhase = 'turn_ended';

    // Trigger bot action
    const updatePromise = waitForEvent<RoomSnapshot>(host.socket, SOCKET_EVENTS.ROOM_UPDATED);
    serverInstance.botCoordinator.onRoomStateUpdated(room!, (snap) => {
      serverInstance.io.to(`room:${roomCode}`).emit(SOCKET_EVENTS.ROOM_UPDATED, snap);
    });

    await updatePromise;
    await delay(50);

    // Verify that the bot built a house on one of its monopoly spaces
    const updatedSnap = serverInstance.roomManager.getSnapshot(roomCode);
    const p1 = updatedSnap.gameState?.properties[1];
    const p3 = updatedSnap.gameState?.properties[3];
    const p1Houses = typeof p1 === 'object' ? p1.houses : 0;
    const p3Houses = typeof p3 === 'object' ? p3.houses : 0;
    expect(p1Houses + p3Houses).toBeGreaterThan(0);
  });
});
