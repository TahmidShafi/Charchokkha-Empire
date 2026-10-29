import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  PLAYER_COLOR_HEXES,
  type GameState as SharedGameState,
  type Player,
  type RoomLifecycleState,
  type RoomSettings,
  type RoomSnapshot,
} from '@charchokkha/shared';
import {
  createInitialGameState,
  processAcceptTrade,
  processAuctionBid,
  processAuctionPass,
  processBuildHouse,
  processBuyProperty,
  processCreateTrade,
  processDeclineProperty,
  processDeclareBankruptcy,
  processEndTurn,
  processMortgageProperty,
  processPayPrisonFine,
  processRejectTrade,
  processRollDice,
  processSellHouse,
  processUnmortgageProperty,
  type GameState as EngineGameState,
  type RandomSource,
} from '@charchokkha/game-engine';
import { RoomPersistenceManager } from './roomPersistence.js';

export interface ProcessedActionRecord {
  requestId: string;
  snapshot: RoomSnapshot;
  timestamp: number;
}

export interface GuestSession {
  sessionId: string;
  token: string;
  nickname: string;
  avatar: string;
  socketId: string;
  connected: boolean;
  currentRoomCode?: string;
  isSpectator?: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface ServerPlayer extends Player {
  sessionId: string;
  joinedAt: number;
}

export interface ServerSpectator {
  sessionId: string;
  nickname: string;
  socketId: string;
  joinedAt: number;
}

export interface ServerRoom {
  code: string;
  hostSessionId: string;
  state: RoomLifecycleState;
  sequenceNumber: number;
  settings: RoomSettings;
  players: Map<string, ServerPlayer>; // Keyed by sessionId
  spectators: Map<string, ServerSpectator>; // Keyed by sessionId
  createdAt: number;
  actionQueue: Promise<void>;
  gameState?: EngineGameState;
  processedActions: Map<string, ProcessedActionRecord>;
}

export class RoomManager {
  private sessionsByToken = new Map<string, GuestSession>();
  private socketToSession = new Map<string, GuestSession>();
  private rooms = new Map<string, ServerRoom>();
  private persistence: RoomPersistenceManager;

  constructor(persistenceDir?: string) {
    this.persistence = new RoomPersistenceManager(persistenceDir);
    this.restorePersistedData();
  }

  private restorePersistedData(): void {
    const { rooms, sessions } = this.persistence.restoreRooms();
    for (const session of sessions) {
      this.sessionsByToken.set(session.token, session);
    }
    for (const room of rooms) {
      this.rooms.set(room.code, room);
    }
  }

  /**
   * Retrieves or creates a secure guest session using crypto tokens.
   */
  public getOrCreateSession(token?: string, socketId: string = ''): GuestSession {
    if (token && this.sessionsByToken.has(token)) {
      const existing = this.sessionsByToken.get(token)!;
      existing.socketId = socketId;
      existing.connected = true;
      existing.lastActiveAt = Date.now();
      if (socketId) {
        this.socketToSession.set(socketId, existing);
      }
      return existing;
    }

    const newToken = randomUUID();
    const sessionId = `guest_${randomBytes(8).toString('hex')}`;
    const newSession: GuestSession = {
      sessionId,
      token: newToken,
      nickname: 'Guest',
      avatar: '🟢',
      socketId,
      connected: true,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessionsByToken.set(newToken, newSession);
    if (socketId) {
      this.socketToSession.set(socketId, newSession);
    }
    return newSession;
  }

  public getSessionBySocketId(socketId: string): GuestSession | undefined {
    return this.socketToSession.get(socketId);
  }

  public getSessionByToken(token: string): GuestSession | undefined {
    return this.sessionsByToken.get(token);
  }

  /**
   * Per-room synchronized action queue with idempotency caching & persistence (ARCHITECTURE.md Section 6).
   */
  public async enqueueRoomAction<T>(
    roomCode: string,
    action: (room: ServerRoom) => T | Promise<T>,
    requestId?: string
  ): Promise<{ result: T; isDuplicate: boolean }> {
    const normalizedCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room) {
      throw new Error(`Room not found: ${normalizedCode}`);
    }

    // 1. Check idempotency cache first before queue wait
    if (requestId && room.processedActions.has(requestId)) {
      const cached = room.processedActions.get(requestId)!;
      return { result: cached.snapshot as unknown as T, isDuplicate: true };
    }

    let result!: T;
    let duplicateDetected = false;
    const previousQueue = room.actionQueue;

    const nextQueue = (async () => {
      try {
        await previousQueue;
      } catch {
        // Ignore previous errors in queue
      }

      // Check again inside queue in case concurrent duplicate arrived
      if (requestId && room.processedActions.has(requestId)) {
        const cached = room.processedActions.get(requestId)!;
        result = cached.snapshot as unknown as T;
        duplicateDetected = true;
        return;
      }

      result = await action(room);

      // Cache snapshot for idempotency
      if (requestId && result && typeof result === 'object' && 'sequenceNumber' in result) {
        room.processedActions.set(requestId, {
          requestId,
          snapshot: result as unknown as RoomSnapshot,
          timestamp: Date.now(),
        });

        // Bound to 50 entries per room
        if (room.processedActions.size > 50) {
          const firstKey = room.processedActions.keys().next().value;
          if (firstKey) room.processedActions.delete(firstKey);
        }
      }

      // Persist committed state and durable request idempotency cache
      try {
        this.persistence.saveRoom(room, this.sessionsByToken);
      } catch (err) {
        if (requestId) {
          room.processedActions.delete(requestId);
        }
        throw err;
      }
    })();

    room.actionQueue = nextQueue;
    await nextQueue;

    return { result, isDuplicate: duplicateDetected };
  }

  /**
   * Generates a 5-character readable unique room code.
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Creates a new authoritative room.
   */
  public createRoom(
    session: GuestSession,
    nickname: string,
    avatar: string = '🟢',
    colorOrSettings?: string | Partial<RoomSettings>,
    settingsOrUndefined?: Partial<RoomSettings>
  ): RoomSnapshot {
    let color: string | undefined;
    let settings: Partial<RoomSettings> | undefined;

    if (typeof colorOrSettings === 'object' && colorOrSettings !== null) {
      settings = colorOrSettings;
      color = undefined;
    } else {
      color = typeof colorOrSettings === 'string' ? colorOrSettings : undefined;
      settings = settingsOrUndefined;
    }

    // Leave previous room if any
    if (session.currentRoomCode && this.rooms.has(session.currentRoomCode)) {
      this.leaveRoom(session, session.currentRoomCode);
    }

    const code = this.generateRoomCode();
    session.nickname = nickname.trim() || session.nickname;
    session.avatar = avatar || session.avatar;

    const canonicalColor = color
      ? PLAYER_COLOR_HEXES.find((c) => c.toLowerCase() === color.trim().toLowerCase())
      : undefined;
    const chosenColor = canonicalColor || PLAYER_COLOR_HEXES[0];

    const finalSettings: RoomSettings = {
      maxPlayers: Math.min(Math.max(settings?.maxPlayers ?? 4, 2), 8),
      isPrivate: settings?.isPrivate ?? true,
      allowBots: settings?.allowBots ?? false,
      startingCash: settings?.startingCash ?? 1500,
      doubleRent: settings?.doubleRent ?? false,
      vacationCash: settings?.vacationCash ?? false,
      auction: settings?.auction ?? true,
      noRentInPrison: settings?.noRentInPrison ?? false,
      mortgage: settings?.mortgage ?? true,
      evenBuild: settings?.evenBuild ?? true,
    };

    const hostPlayer: ServerPlayer = {
      id: session.sessionId,
      sessionId: session.sessionId,
      nickname: session.nickname,
      avatar: session.avatar,
      color: chosenColor,
      isHost: true,
      connected: true,
      seatIndex: 0,
      joinedAt: Date.now(),
    };

    const room: ServerRoom = {
      code,
      hostSessionId: session.sessionId,
      state: 'waiting',
      sequenceNumber: 1,
      settings: finalSettings,
      players: new Map([[session.sessionId, hostPlayer]]),
      spectators: new Map(),
      createdAt: Date.now(),
      actionQueue: Promise.resolve(),
      processedActions: new Map(),
    };

    this.rooms.set(code, room);
    session.currentRoomCode = code;
    session.isSpectator = false;

    this.persistence.saveRoom(room, this.sessionsByToken);
    return this.toSnapshot(room);
  }

  /**
   * Joins an existing room or reconnects an existing seat.
   */
  public joinRoom(
    session: GuestSession,
    roomCode: string,
    nickname: string,
    avatar: string = '🟢',
    color?: string
  ): { snapshot: RoomSnapshot; isReconnect: boolean } {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    session.nickname = nickname.trim() || session.nickname;
    session.avatar = avatar || session.avatar;

    // Check if player is reconnecting to existing seat
    if (room.players.has(session.sessionId)) {
      if (room.state === 'abandoned') {
        throw new Error('Cannot join room: status is abandoned');
      }
      const existingPlayer = room.players.get(session.sessionId)!;
      existingPlayer.connected = true;
      existingPlayer.nickname = session.nickname;
      existingPlayer.avatar = session.avatar;
      session.currentRoomCode = code;
      session.isSpectator = false;
      room.sequenceNumber += 1;

      return {
        snapshot: this.toSnapshot(room),
        isReconnect: true,
      };
    }

    // Check if existing spectator is reconnecting
    if (room.spectators.has(session.sessionId)) {
      if (room.state === 'abandoned') {
        throw new Error('Cannot spectate room: status is abandoned');
      }
      const existingSpectator = room.spectators.get(session.sessionId)!;
      existingSpectator.socketId = session.socketId;
      session.isSpectator = true;
      session.currentRoomCode = code;
      return {
        snapshot: this.toSnapshot(room),
        isReconnect: true,
      };
    }

    if (room.state === 'abandoned' || room.state === 'finished') {
      throw new Error(`Cannot join room: status is ${room.state}`);
    }

    // Leave any other room
    if (session.currentRoomCode && session.currentRoomCode !== code) {
      this.leaveRoom(session, session.currentRoomCode);
    }

    // If session was a spectator in this room, remove from spectators
    if (room.spectators.has(session.sessionId)) {
      room.spectators.delete(session.sessionId);
    }
    session.isSpectator = false;

    // Enforce capacity on server
    if (room.players.size >= room.settings.maxPlayers) {
      throw new Error('Room is at maximum capacity');
    }

    const takenColors = new Set(
      Array.from(room.players.values()).map((p) => p.color?.toLowerCase()).filter(Boolean)
    );

    if (takenColors.size >= PLAYER_COLOR_HEXES.length) {
      throw new Error('All player colors are occupied in this room');
    }

    let chosenColor: string | undefined;
    if (color) {
      const canonical = PLAYER_COLOR_HEXES.find((c) => c.toLowerCase() === color.trim().toLowerCase());
      if (!canonical) {
        throw new Error(`Invalid player color: ${color}`);
      }
      if (takenColors.has(canonical.toLowerCase())) {
        throw new Error('Selected color is already taken in this room');
      }
      chosenColor = canonical;
    } else {
      chosenColor = PLAYER_COLOR_HEXES.find((c) => !takenColors.has(c.toLowerCase()));
      if (!chosenColor) {
        throw new Error('All player colors are occupied in this room');
      }
    }

    // Find lowest available seat index
    const takenSeats = new Set(Array.from(room.players.values()).map((p) => p.seatIndex));
    let nextSeat = 0;
    while (takenSeats.has(nextSeat)) {
      nextSeat++;
    }

    const newPlayer: ServerPlayer = {
      id: session.sessionId,
      sessionId: session.sessionId,
      nickname: session.nickname,
      avatar: session.avatar,
      color: chosenColor,
      isHost: false,
      connected: true,
      seatIndex: nextSeat,
      joinedAt: Date.now(),
    };

    room.players.set(session.sessionId, newPlayer);
    session.currentRoomCode = code;
    session.isSpectator = false;
    room.sequenceNumber += 1;

    return {
      snapshot: this.toSnapshot(room),
      isReconnect: false,
    };
  }

  /**
   * Joins a room as a read-only spectator without claiming a seat.
   */
  public spectateRoom(
    session: GuestSession,
    roomCode: string,
    nickname?: string
  ): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    if (nickname) {
      session.nickname = nickname.trim() || session.nickname;
    }

    // If existing spectator reconnecting
    if (room.spectators.has(session.sessionId)) {
      if (room.state === 'abandoned') {
        throw new Error('Cannot spectate room: status is abandoned');
      }
      const existing = room.spectators.get(session.sessionId)!;
      existing.socketId = session.socketId;
      session.isSpectator = true;
      session.currentRoomCode = code;
      return this.toSnapshot(room);
    }

    if (room.state === 'abandoned' || room.state === 'finished') {
      throw new Error(`Cannot spectate room: status is ${room.state}`);
    }

    // Leave any other room if different
    if (session.currentRoomCode && session.currentRoomCode !== code) {
      this.leaveRoom(session, session.currentRoomCode);
    }

    // If not already seated, register as spectator
    if (!room.players.has(session.sessionId)) {
      room.spectators.set(session.sessionId, {
        sessionId: session.sessionId,
        nickname: session.nickname,
        socketId: session.socketId,
        joinedAt: Date.now(),
      });
      session.isSpectator = true;
    }

    session.currentRoomCode = code;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Leaves a room. Migrates host or marks abandoned if needed.
   */
  public leaveRoom(
    session: GuestSession,
    roomCode?: string
  ): { leftCode: string; snapshot?: RoomSnapshot; abandoned: boolean } {
    const code = (roomCode ?? session.currentRoomCode ?? '').trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      session.currentRoomCode = undefined;
      session.isSpectator = false;
      return { leftCode: code, abandoned: false };
    }

    // Handle spectator departure
    if (room.spectators?.has(session.sessionId)) {
      room.spectators.delete(session.sessionId);
      session.currentRoomCode = undefined;
      session.isSpectator = false;
      room.sequenceNumber += 1;
      return {
        leftCode: code,
        snapshot: this.toSnapshot(room),
        abandoned: false,
      };
    }

    // Handle seated player departure
    room.players.delete(session.sessionId);
    session.currentRoomCode = undefined;
    session.isSpectator = false;
    room.sequenceNumber += 1;

    // If host left, migrate host to next active player
    if (room.hostSessionId === session.sessionId) {
      const remainingPlayers = Array.from(room.players.values());
      const nextHost = remainingPlayers.find((p) => p.connected) ?? remainingPlayers[0];
      if (nextHost) {
        room.hostSessionId = nextHost.sessionId;
        nextHost.isHost = true;
      }
    }

    // If room is empty of players, mark abandoned
    if (room.players.size === 0) {
      room.state = 'abandoned';
      this.persistence.deleteRoom(code);
      return { leftCode: code, abandoned: true };
    }

    this.persistence.saveRoom(room, this.sessionsByToken);
    return {
      leftCode: code,
      snapshot: this.toSnapshot(room),
      abandoned: false,
    };
  }

  /**
   * Host-only: updates room settings.
   */
  public updateSettings(
    session: GuestSession,
    roomCode: string,
    partial: Partial<RoomSettings>
  ): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    // Server-side authorization check: must be a seated player and host
    this.ensureSeatedPlayer(room, session);
    if (room.hostSessionId !== session.sessionId) {
      throw new Error('Only the room host can modify game settings');
    }
    if (room.state !== 'waiting') {
      throw new Error(`Cannot modify settings in status ${room.state}`);
    }

    if (partial.maxPlayers !== undefined) {
      room.settings.maxPlayers = Math.min(Math.max(partial.maxPlayers, 2), 8);
    }
    if (partial.isPrivate !== undefined) {
      room.settings.isPrivate = partial.isPrivate;
    }
    if (partial.allowBots !== undefined) {
      room.settings.allowBots = partial.allowBots;
    }
    if (partial.startingCash !== undefined) {
      room.settings.startingCash = partial.startingCash;
    }
    if (partial.doubleRent !== undefined) {
      room.settings.doubleRent = partial.doubleRent;
    }
    if (partial.vacationCash !== undefined) {
      room.settings.vacationCash = partial.vacationCash;
    }
    if (partial.auction !== undefined) {
      room.settings.auction = partial.auction;
    }
    if (partial.noRentInPrison !== undefined) {
      room.settings.noRentInPrison = partial.noRentInPrison;
    }
    if (partial.mortgage !== undefined) {
      room.settings.mortgage = partial.mortgage;
    }
    if (partial.evenBuild !== undefined) {
      room.settings.evenBuild = partial.evenBuild;
    }

    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Allows seated player to change their color while in waiting lobby.
   */
  public selectColor(session: GuestSession, roomCode: string, color: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    const player = this.ensureSeatedPlayer(room, session);
    if (room.state !== 'waiting') {
      throw new Error('Cannot change color after the match has started');
    }

    const canonical = PLAYER_COLOR_HEXES.find((c) => c.toLowerCase() === color.trim().toLowerCase());
    if (!canonical) {
      throw new Error(`Invalid player color: ${color}`);
    }

    // Check if another player in this room already has this color
    const conflict = Array.from(room.players.values()).find(
      (p) => p.sessionId !== session.sessionId && p.color?.toLowerCase() === canonical.toLowerCase()
    );
    if (conflict) {
      throw new Error('Selected color is already taken in this room');
    }

    player.color = canonical;
    room.sequenceNumber += 1;
    this.persistence.saveRoom(room, this.sessionsByToken);
    return this.toSnapshot(room);
  }

  /**
   * Retrieves public room snapshot. Never leaks tokens or private keys.
   */
  public getSnapshot(roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }
    return this.toSnapshot(room);
  }

  public getRoom(roomCode: string): ServerRoom | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  /**
   * Handles socket disconnect, marking player temporarily disconnected without losing seat,
   * or removing spectators cleanly.
   */
  public handleSocketDisconnect(socketId: string): {
    session: GuestSession;
    roomCode?: string;
    snapshot?: RoomSnapshot;
  } | null {
    const session = this.socketToSession.get(socketId);
    if (!session) return null;

    session.connected = false;
    this.socketToSession.delete(socketId);

    if (session.currentRoomCode) {
      const room = this.rooms.get(session.currentRoomCode);
      if (room) {
        if (room.spectators?.has(session.sessionId)) {
          room.spectators.delete(session.sessionId);
          room.sequenceNumber += 1;
          return {
            session,
            roomCode: room.code,
            snapshot: this.toSnapshot(room),
          };
        }

        if (room.players.has(session.sessionId)) {
          const player = room.players.get(session.sessionId)!;
          player.connected = false;
          room.sequenceNumber += 1;

          return {
            session,
            roomCode: room.code,
            snapshot: this.toSnapshot(room),
          };
        }
      }
    }

    return { session };
  }

  /**
   * Ensures the session is an active seated player in the room, rejecting spectators.
   */
  private ensureSeatedPlayer(room: ServerRoom, session: GuestSession): ServerPlayer {
    const player = room.players.get(session.sessionId);
    if (!player) {
      throw new Error('Spectators are not permitted to perform player actions');
    }
    return player;
  }

  /**
   * Host-only: starts the game if conditions are met.
   */
  public startGame(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    this.ensureSeatedPlayer(room, session);

    if (room.hostSessionId !== session.sessionId) {
      throw new Error('Only the room host can start the game');
    }

    if (room.state === 'in_progress') {
      throw new Error('Game is already in progress');
    }

    if (room.state !== 'waiting') {
      throw new Error(`Cannot start game in status ${room.state}`);
    }

    if (room.players.size < 2) {
      throw new Error('At least 2 players are required to start the game');
    }

    const orderedPlayers = Array.from(room.players.values())
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => p.sessionId);

    const initialGameState = createInitialGameState(
      orderedPlayers,
      room.settings.startingCash,
      200,
      {
        doubleRent: room.settings.doubleRent,
        noRentInPrison: room.settings.noRentInPrison,
        vacationCash: room.settings.vacationCash,
        evenBuild: room.settings.evenBuild,
        auction: room.settings.auction,
        mortgage: room.settings.mortgage,
      }
    );

    room.state = 'in_progress';
    room.gameState = initialGameState;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Host-only: resets the finished room back to 'waiting' for a rematch.
   */
  public rematchRoom(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    this.ensureSeatedPlayer(room, session);

    if (room.hostSessionId !== session.sessionId) {
      throw new Error('Only the room host can initiate a rematch');
    }

    if (room.state !== 'finished') {
      throw new Error(`Cannot rematch when game is in '${room.state}' state`);
    }

    room.state = 'waiting';
    room.gameState = undefined;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Authoritative dice roll for active player using server randomness.
   */
  public rollDice(
    session: GuestSession,
    roomCode: string,
    injectedDice?: [number, number]
  ): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    this.ensureSeatedPlayer(room, session);

    if (room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    if (room.gameState.activePlayerId !== session.sessionId) {
      throw new Error('It is not your turn to roll');
    }

    const serverCryptoRng: RandomSource = (min, maxExclusive) => randomInt(min, maxExclusive);

    const result = processRollDice(
      room.gameState,
      session.sessionId,
      injectedDice,
      serverCryptoRng
    );

    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to roll dice');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Authoritative property purchase for active player.
   */
  public buyProperty(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    this.ensureSeatedPlayer(room, session);

    if (room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    if (room.gameState.activePlayerId !== session.sessionId) {
      throw new Error('It is not your turn to purchase property');
    }

    const result = processBuyProperty(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to buy property');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Authoritative end turn action.
   */
  public endTurn(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    this.ensureSeatedPlayer(room, session);

    if (room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    if (room.gameState.activePlayerId !== session.sessionId) {
      throw new Error('It is not your turn to end');
    }

    const result = processEndTurn(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to end turn');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;

    return this.toSnapshot(room);
  }

  /**
   * Declines property purchase and initiates auction.
   */
  public declineProperty(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processDeclineProperty(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to decline property');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Places an auction bid.
   */
  public auctionBid(session: GuestSession, roomCode: string, bidAmount: number): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processAuctionBid(room.gameState, session.sessionId, bidAmount);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to place auction bid');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Passes on current auction.
   */
  public auctionPass(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processAuctionPass(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to pass auction');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Pays $50 prison fine before rolling.
   */
  public payPrisonFine(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processPayPrisonFine(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to pay prison fine');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Mortgages an owned property.
   */
  public mortgageProperty(session: GuestSession, roomCode: string, spaceId: number): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processMortgageProperty(room.gameState, session.sessionId, spaceId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to mortgage property');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Unmortgages an owned property.
   */
  public unmortgageProperty(session: GuestSession, roomCode: string, spaceId: number): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processUnmortgageProperty(room.gameState, session.sessionId, spaceId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to unmortgage property');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Builds house or hotel on owned property.
   */
  public buildHouse(session: GuestSession, roomCode: string, spaceId: number): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processBuildHouse(room.gameState, session.sessionId, spaceId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to build house');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Sells house or hotel back to bank.
   */
  public sellHouse(session: GuestSession, roomCode: string, spaceId: number): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processSellHouse(room.gameState, session.sessionId, spaceId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to sell house');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Creates a trade offer to another player.
   */
  public createTrade(
    session: GuestSession,
    roomCode: string,
    trade: {
      receiverId: string;
      offeredCash: number;
      offeredPropertyIds: number[];
      requestedCash: number;
      requestedPropertyIds: number[];
    }
  ): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processCreateTrade(room.gameState, session.sessionId, trade);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to create trade offer');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Accepts active trade offer.
   */
  public acceptTrade(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processAcceptTrade(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to accept trade offer');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Rejects or cancels active trade offer.
   */
  public rejectTrade(session: GuestSession, roomCode: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processRejectTrade(room.gameState, session.sessionId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to reject trade offer');
    }

    room.gameState = result.state;
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Declares bankruptcy, transferring assets to creditor or bank.
   */
  public declareBankruptcy(session: GuestSession, roomCode: string, creditorId?: string): RoomSnapshot {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      throw new Error('Game is not in progress');
    }

    this.ensureSeatedPlayer(room, session);

    const result = processDeclareBankruptcy(room.gameState, session.sessionId, creditorId);
    if (!result.success) {
      throw new Error(result.error?.message ?? 'Failed to declare bankruptcy');
    }

    room.gameState = result.state;
    if (result.state.phase === 'finished') {
      room.state = 'finished';
    }
    room.sequenceNumber += 1;
    return this.toSnapshot(room);
  }

  /**
   * Converts authoritative ServerRoom to safe, shared RoomSnapshot.
   */
  private toSnapshot(room: ServerRoom): RoomSnapshot {
    const safePlayers: Player[] = Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      color: p.color || PLAYER_COLOR_HEXES[p.seatIndex % 8],
      isHost: p.isHost,
      connected: p.connected,
      seatIndex: p.seatIndex,
    }));

    let safeGameState: SharedGameState | undefined = undefined;
    if (room.gameState) {
      safeGameState = {
        ...room.gameState,
        properties: Object.fromEntries(
          Object.entries(room.gameState.properties).map(([k, v]) => [String(k), v])
        ),
      };
    }

    return {
      code: room.code,
      hostId: room.hostSessionId,
      state: room.state,
      sequenceNumber: room.sequenceNumber,
      settings: { ...room.settings },
      players: safePlayers,
      spectatorCount: room.spectators?.size ?? 0,
      createdAt: room.createdAt,
      gameState: safeGameState,
    };
  }
}
