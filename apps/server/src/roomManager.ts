import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
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

export interface GuestSession {
  sessionId: string;
  token: string;
  nickname: string;
  avatar: string;
  socketId: string;
  connected: boolean;
  currentRoomCode?: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface ServerPlayer extends Player {
  sessionId: string;
  joinedAt: number;
}

export interface ServerRoom {
  code: string;
  hostSessionId: string;
  state: RoomLifecycleState;
  sequenceNumber: number;
  settings: RoomSettings;
  players: Map<string, ServerPlayer>; // Keyed by sessionId
  createdAt: number;
  actionQueue: Promise<void>;
  gameState?: EngineGameState;
}

export class RoomManager {
  private sessionsByToken = new Map<string, GuestSession>();
  private socketToSession = new Map<string, GuestSession>();
  private rooms = new Map<string, ServerRoom>();

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
   * Per-room synchronized action queue (ARCHITECTURE.md Section 6).
   */
  public async enqueueRoomAction<T>(
    roomCode: string,
    action: (room: ServerRoom) => T | Promise<T>
  ): Promise<T> {
    const normalizedCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room) {
      throw new Error(`Room not found: ${normalizedCode}`);
    }

    let result!: T;
    const previousQueue = room.actionQueue;

    const nextQueue = (async () => {
      try {
        await previousQueue;
      } catch {
        // Ignore previous errors in queue
      }
      result = await action(room);
    })();

    room.actionQueue = nextQueue;
    await nextQueue;
    return result;
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
    settings?: Partial<RoomSettings>
  ): RoomSnapshot {
    // Leave previous room if any
    if (session.currentRoomCode && this.rooms.has(session.currentRoomCode)) {
      this.leaveRoom(session, session.currentRoomCode);
    }

    const code = this.generateRoomCode();
    session.nickname = nickname.trim() || session.nickname;
    session.avatar = avatar || session.avatar;

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
      createdAt: Date.now(),
      actionQueue: Promise.resolve(),
    };

    this.rooms.set(code, room);
    session.currentRoomCode = code;

    return this.toSnapshot(room);
  }

  /**
   * Joins an existing room or reconnects an existing seat.
   */
  public joinRoom(
    session: GuestSession,
    roomCode: string,
    nickname: string,
    avatar: string = '🟢'
  ): { snapshot: RoomSnapshot; isReconnect: boolean } {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      throw new Error(`Room not found: ${code}`);
    }

    if (room.state === 'abandoned' || room.state === 'finished') {
      throw new Error(`Cannot join room: status is ${room.state}`);
    }

    session.nickname = nickname.trim() || session.nickname;
    session.avatar = avatar || session.avatar;

    // Check if player is reconnecting to existing seat
    if (room.players.has(session.sessionId)) {
      const existingPlayer = room.players.get(session.sessionId)!;
      existingPlayer.connected = true;
      existingPlayer.nickname = session.nickname;
      existingPlayer.avatar = session.avatar;
      session.currentRoomCode = code;
      room.sequenceNumber += 1;

      return {
        snapshot: this.toSnapshot(room),
        isReconnect: true,
      };
    }

    // Leave any other room
    if (session.currentRoomCode && session.currentRoomCode !== code) {
      this.leaveRoom(session, session.currentRoomCode);
    }

    // Enforce capacity on server
    if (room.players.size >= room.settings.maxPlayers) {
      throw new Error('Room is at maximum capacity');
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
      isHost: false,
      connected: true,
      seatIndex: nextSeat,
      joinedAt: Date.now(),
    };

    room.players.set(session.sessionId, newPlayer);
    session.currentRoomCode = code;
    room.sequenceNumber += 1;

    return {
      snapshot: this.toSnapshot(room),
      isReconnect: false,
    };
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
      return { leftCode: code, abandoned: false };
    }

    room.players.delete(session.sessionId);
    session.currentRoomCode = undefined;
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

    // If room is empty, mark abandoned
    if (room.players.size === 0) {
      room.state = 'abandoned';
      return { leftCode: code, abandoned: true };
    }

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

    // Server-side authorization check: must be host
    if (room.hostSessionId !== session.sessionId) {
      throw new Error('Only the room host can modify game settings');
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
   * Handles socket disconnect, marking player temporarily disconnected without losing seat.
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
      if (room && room.players.has(session.sessionId)) {
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

    return { session };
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
      createdAt: room.createdAt,
      gameState: safeGameState,
    };
  }
}
