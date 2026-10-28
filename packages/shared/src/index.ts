import { z } from 'zod';

/**
 * Socket event names used across the platform
 */
export const SOCKET_EVENTS = {
  // Smoke ping/pong
  SMOKE_PING: 'smoke:ping',
  SMOKE_PONG: 'smoke:pong',

  // Session & Auth
  SESSION_AUTHENTICATED: 'session:authenticated',

  // Room operations (Client -> Server)
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_SPECTATE: 'room:spectate',
  ROOM_REMATCH: 'room:rematch',
  ROOM_LEAVE: 'room:leave',
  ROOM_UPDATE_SETTINGS: 'room:update_settings',
  ROOM_GET_SNAPSHOT: 'room:get_snapshot',

  // Room updates (Server -> Client)
  ROOM_SNAPSHOT: 'room:snapshot',
  ROOM_UPDATED: 'room:updated',
  ROOM_PLAYER_JOINED: 'room:player_joined',
  ROOM_PLAYER_LEFT: 'room:player_left',
  ROOM_PLAYER_RECONNECTED: 'room:player_reconnected',
  ROOM_SPECTATOR_JOINED: 'room:spectator_joined',
  ROOM_SPECTATOR_LEFT: 'room:spectator_left',

  // Game operations (Client -> Server)
  GAME_START: 'game:start',
  GAME_ROLL_DICE: 'game:roll_dice',
  GAME_BUY_PROPERTY: 'game:buy_property',
  GAME_DECLINE_PROPERTY: 'game:decline_property',
  GAME_AUCTION_BID: 'game:auction_bid',
  GAME_AUCTION_PASS: 'game:auction_pass',
  GAME_PAY_PRISON_FINE: 'game:pay_prison_fine',
  GAME_MORTGAGE_PROPERTY: 'game:mortgage_property',
  GAME_UNMORTGAGE_PROPERTY: 'game:unmortgage_property',
  GAME_BUILD_HOUSE: 'game:build_house',
  GAME_SELL_HOUSE: 'game:sell_house',
  GAME_TRADE_CREATE: 'game:trade_create',
  GAME_TRADE_ACCEPT: 'game:trade_accept',
  GAME_TRADE_REJECT: 'game:trade_reject',
  GAME_DECLARE_BANKRUPTCY: 'game:declare_bankruptcy',
  GAME_END_TURN: 'game:end_turn',

  // Game updates (Server -> Client)
  GAME_STATE_UPDATED: 'game:state_updated',

  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_MESSAGE: 'chat:message',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/**
 * Shared error payload schema for rejected actions
 */
export const SocketErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type SocketError = z.infer<typeof SocketErrorSchema>;

/**
 * Standard socket acknowledgment wrapper
 */
export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: SocketError };

/* --------------------------------------------------------------------------
   Milestone 1 Contracts (Preserved)
   -------------------------------------------------------------------------- */

export const PingPayloadSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message must not be empty')
    .max(100, 'Message cannot exceed 100 characters'),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
});

export type PingPayload = z.infer<typeof PingPayloadSchema>;

export const PongPayloadSchema = z.object({
  reply: z.string(),
  receivedAt: z.number().int().positive(),
  echoMessage: z.string(),
});

export type PongPayload = z.infer<typeof PongPayloadSchema>;

export const HealthCheckResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  uptime: z.number().nonnegative(),
  timestamp: z.string(),
  metrics: z.record(z.string(), z.any()).optional(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

/* --------------------------------------------------------------------------
   Milestone 2 Contracts: Guest Identity, Rooms, Synchronization
   -------------------------------------------------------------------------- */

export const RoomLifecycleStateSchema = z.enum([
  'waiting',
  'starting',
  'in_progress',
  'finished',
  'abandoned',
]);

export type RoomLifecycleState = z.infer<typeof RoomLifecycleStateSchema>;

export const PlayerSchema = z.object({
  id: z.string(),
  nickname: z.string().trim().min(1).max(25),
  avatar: z.string().default('🟢'),
  isHost: z.boolean(),
  connected: z.boolean(),
  seatIndex: z.number().int().nonnegative(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const RoomSettingsSchema = z.object({
  maxPlayers: z.number().int().min(2).max(8).default(4),
  isPrivate: z.boolean().default(true),
  allowBots: z.boolean().default(false),
  startingCash: z.number().int().min(500).max(5000).default(1500),
  doubleRent: z.boolean().default(true),
  vacationCash: z.boolean().default(false),
  auction: z.boolean().default(true),
  noRentInPrison: z.boolean().default(false),
  mortgage: z.boolean().default(true),
  evenBuild: z.boolean().default(true),
});

export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

/* --------------------------------------------------------------------------
   Milestone 3 & 4 Contracts: Authoritative Game Engine & Actions
   -------------------------------------------------------------------------- */

export const TurnPhaseSchema = z.enum([
  'need_roll',
  'action_pending',
  'turn_ended',
  'in_auction',
]);

export type TurnPhase = z.infer<typeof TurnPhaseSchema>;

export const PlayerStatsSchema = z.object({
  rentPaid: z.number().int().nonnegative().default(0),
  rentReceived: z.number().int().nonnegative().default(0),
  propertiesBought: z.number().int().nonnegative().default(0),
  tradesCompleted: z.number().int().nonnegative().default(0),
  auctionsWon: z.number().int().nonnegative().default(0),
  buildingsBuilt: z.number().int().nonnegative().default(0),
  bankruptcyOrder: z.number().int().positive().optional(),
});

export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

export const PlayerStandingSchema = z.object({
  rank: z.number().int().positive(),
  playerId: z.string(),
  nickname: z.string(),
  avatar: z.string(),
  netWorth: z.number().int(),
  cash: z.number().int(),
  isBankrupt: z.boolean(),
  propertyCount: z.number().int().nonnegative(),
  properties: z.array(z.number().int()),
  stats: PlayerStatsSchema.optional(),
});

export type PlayerStanding = z.infer<typeof PlayerStandingSchema>;

export const PlayerGameStateSchema = z.object({
  id: z.string(),
  position: z.number().int().min(0).max(39),
  cash: z.number().int(),
  isBankrupt: z.boolean().default(false),
  inPrison: z.boolean().default(false),
  prisonTurns: z.number().int().default(0),
  stats: PlayerStatsSchema.optional(),
});

export type PlayerGameState = z.infer<typeof PlayerGameStateSchema>;

export const LastDiceRollSchema = z.object({
  die1: z.number().int().min(1).max(6),
  die2: z.number().int().min(1).max(6),
  total: z.number().int().min(2).max(12),
  isDouble: z.boolean(),
});

export type LastDiceRoll = z.infer<typeof LastDiceRollSchema>;

export const PropertyRecordSchema = z.object({
  ownerId: z.string(),
  houses: z.number().int().min(0).max(5).default(0),
  isMortgaged: z.boolean().default(false),
});

export type PropertyRecord = z.infer<typeof PropertyRecordSchema>;

export const AuctionStateSchema = z.object({
  spaceId: z.number().int().min(0).max(39),
  currentBid: z.number().int().nonnegative(),
  highBidderId: z.string().nullable(),
  activeBidders: z.array(z.string()),
});

export type AuctionState = z.infer<typeof AuctionStateSchema>;

export const TradeOfferSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  receiverId: z.string(),
  offeredCash: z.number().int().nonnegative(),
  offeredPropertyIds: z.array(z.number().int()),
  requestedCash: z.number().int().nonnegative(),
  requestedPropertyIds: z.array(z.number().int()),
});

export type TradeOffer = z.infer<typeof TradeOfferSchema>;

export const GameSettingsRulesSchema = z.object({
  doubleRent: z.boolean().optional(),
  noRentInPrison: z.boolean().optional(),
  vacationCash: z.boolean().optional(),
  evenBuild: z.boolean().optional(),
  auction: z.boolean().optional(),
  mortgage: z.boolean().optional(),
});

export type GameSettingsRules = z.infer<typeof GameSettingsRulesSchema>;

export const GameStateSchema = z.object({
  phase: RoomLifecycleStateSchema,
  turnOrder: z.array(z.string()),
  currentTurnIndex: z.number().int().nonnegative(),
  activePlayerId: z.string(),
  turnPhase: TurnPhaseSchema,
  lastDiceRoll: LastDiceRollSchema.nullable(),
  players: z.record(z.string(), PlayerGameStateSchema),
  properties: z.record(z.string(), z.union([PropertyRecordSchema, z.string()])), // normalized record or legacy string
  lastActionMessage: z.string().optional(),
  startingSalary: z.number().int().positive().default(200),
  auction: AuctionStateSchema.nullable().optional(),
  pendingTrade: TradeOfferSchema.nullable().optional(),
  rules: GameSettingsRulesSchema.optional(),
  winnerId: z.string().optional(),
  eliminationOrder: z.array(z.string()).optional(),
  chestCardIndex: z.number().int().optional(),
  chanceCardIndex: z.number().int().optional(),
  vacationPot: z.number().int().nonnegative().optional(),
});

export type GameState = z.infer<typeof GameStateSchema>;

export const RoomSnapshotSchema = z.object({
  code: z.string().trim().min(3).max(10),
  hostId: z.string(),
  state: RoomLifecycleStateSchema,
  sequenceNumber: z.number().int().nonnegative(),
  settings: RoomSettingsSchema,
  players: z.array(PlayerSchema),
  createdAt: z.number(),
  gameState: GameStateSchema.optional(),
  spectatorCount: z.number().int().nonnegative().optional(),
});

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

// Session Handshake & Auth
export const SessionAuthenticatedPayloadSchema = z.object({
  sessionId: z.string(),
  playerId: z.string(),
  token: z.string(),
  nickname: z.string(),
  currentRoomCode: z.string().optional(),
});

export type SessionAuthenticatedPayload = z.infer<typeof SessionAuthenticatedPayloadSchema>;

// Action Payloads: Room
export const CreateRoomPayloadSchema = z.object({
  nickname: z.string().trim().min(1, 'Nickname must not be empty').max(25, 'Nickname max 25 chars'),
  avatar: z.string().optional(),
  settings: RoomSettingsSchema.partial().optional(),
});

export type CreateRoomPayload = z.infer<typeof CreateRoomPayloadSchema>;

export const JoinRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(3, 'Room code must have at least 3 characters').max(10),
  nickname: z.string().trim().min(1, 'Nickname must not be empty').max(25),
  avatar: z.string().optional(),
  asSpectator: z.boolean().optional(),
});

export type JoinRoomPayload = z.infer<typeof JoinRoomPayloadSchema>;

export const SpectateRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(3, 'Room code must have at least 3 characters').max(10),
  nickname: z.string().trim().min(1).max(25).optional(),
});

export type SpectateRoomPayload = z.infer<typeof SpectateRoomPayloadSchema>;

export const LeaveRoomPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10).optional(),
});

export type LeaveRoomPayload = z.infer<typeof LeaveRoomPayloadSchema>;

export const UpdateSettingsPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  settings: RoomSettingsSchema.partial(),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type UpdateSettingsPayload = z.infer<typeof UpdateSettingsPayloadSchema>;

export const GetSnapshotPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  sinceSequence: z.number().int().nonnegative().optional(),
});

export type GetSnapshotPayload = z.infer<typeof GetSnapshotPayloadSchema>;

// Action Payloads: Game
export const RematchPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type RematchPayload = z.infer<typeof RematchPayloadSchema>;

export const StartGamePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type StartGamePayload = z.infer<typeof StartGamePayloadSchema>;

export const RollDicePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type RollDicePayload = z.infer<typeof RollDicePayloadSchema>;

export const BuyPropertyPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type BuyPropertyPayload = z.infer<typeof BuyPropertyPayloadSchema>;

export const DeclinePropertyPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type DeclinePropertyPayload = z.infer<typeof DeclinePropertyPayloadSchema>;

export const AuctionBidPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  bidAmount: z.number().int().positive('Bid amount must be a positive integer'),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type AuctionBidPayload = z.infer<typeof AuctionBidPayloadSchema>;

export const AuctionPassPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type AuctionPassPayload = z.infer<typeof AuctionPassPayloadSchema>;

export const PayPrisonFinePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type PayPrisonFinePayload = z.infer<typeof PayPrisonFinePayloadSchema>;

export const MortgagePropertyPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  spaceId: z.number().int().min(0).max(39),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type MortgagePropertyPayload = z.infer<typeof MortgagePropertyPayloadSchema>;

export const UnmortgagePropertyPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  spaceId: z.number().int().min(0).max(39),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type UnmortgagePropertyPayload = z.infer<typeof UnmortgagePropertyPayloadSchema>;

export const BuildHousePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  spaceId: z.number().int().min(0).max(39),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type BuildHousePayload = z.infer<typeof BuildHousePayloadSchema>;

export const SellHousePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  spaceId: z.number().int().min(0).max(39),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type SellHousePayload = z.infer<typeof SellHousePayloadSchema>;

export const TradeCreatePayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  receiverId: z.string().trim().min(1),
  offeredCash: z.number().int().nonnegative().default(0),
  offeredPropertyIds: z.array(z.number().int().min(0).max(39)).default([]),
  requestedCash: z.number().int().nonnegative().default(0),
  requestedPropertyIds: z.array(z.number().int().min(0).max(39)).default([]),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type TradeCreatePayload = z.infer<typeof TradeCreatePayloadSchema>;

export const TradeAcceptPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type TradeAcceptPayload = z.infer<typeof TradeAcceptPayloadSchema>;

export const TradeRejectPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type TradeRejectPayload = z.infer<typeof TradeRejectPayloadSchema>;

export const DeclareBankruptcyPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  creditorId: z.string().optional(),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type DeclareBankruptcyPayload = z.infer<typeof DeclareBankruptcyPayloadSchema>;

export const EndTurnPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  requestId: z.string().trim().min(1).max(64).optional(),
});

export type EndTurnPayload = z.infer<typeof EndTurnPayloadSchema>;

// Chat Payloads
export const SendChatPayloadSchema = z.object({
  roomCode: z.string().trim().min(3).max(10),
  text: z.string().trim().min(1, 'Chat message must not be empty').max(150, 'Max 150 characters'),
});

export type SendChatPayload = z.infer<typeof SendChatPayloadSchema>;

export const ChatMessageBroadcastSchema = z.object({
  id: z.string(),
  roomCode: z.string(),
  senderId: z.string(),
  senderNickname: z.string(),
  text: z.string(),
  timestamp: z.number(),
  isSystem: z.boolean().optional(),
});

export type ChatMessageBroadcast = z.infer<typeof ChatMessageBroadcastSchema>;
