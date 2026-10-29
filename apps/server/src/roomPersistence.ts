import fs from 'node:fs';
import path from 'node:path';
import { PLAYER_COLOR_HEXES, type RoomLifecycleState, type RoomSettings } from '@charchokkha/shared';
import type { GameState as EngineGameState } from '@charchokkha/game-engine';
import type { GuestSession, ProcessedActionRecord, ServerPlayer, ServerRoom, ServerSpectator } from './roomManager.js';

export interface PersistedPlayerRecord extends ServerPlayer {
  token?: string;
}

export interface PersistedRoomRecord {
  schemaVersion: 1;
  persistedAt: number;
  code: string;
  hostSessionId: string;
  state: RoomLifecycleState;
  sequenceNumber: number;
  settings: RoomSettings;
  players: PersistedPlayerRecord[];
  spectators: ServerSpectator[];
  createdAt: number;
  gameState?: EngineGameState;
  processedActions?: ProcessedActionRecord[];
}

export interface RestorationResult {
  rooms: ServerRoom[];
  sessions: GuestSession[];
}

export class RoomPersistenceManager {
  private roomsDir: string;
  private maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours expiry for inactive rooms

  constructor(baseDir?: string) {
    const root = baseDir || process.env.DATA_DIR || path.join(process.cwd(), '.charchokkha-data');
    this.roomsDir = path.join(root, 'rooms');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.roomsDir)) {
      fs.mkdirSync(this.roomsDir, { recursive: true });
    }
  }

  /**
   * Atomically saves a room and its seated player session tokens to disk.
   */
  public saveRoom(room: ServerRoom, sessions: Map<string, GuestSession>): void {
    try {
      this.ensureDir();
      const playersList: PersistedPlayerRecord[] = Array.from(room.players.values()).map((p) => {
        // Find player's token from session
        let token: string | undefined;
        for (const session of sessions.values()) {
          if (session.sessionId === p.sessionId) {
            token = session.token;
            break;
          }
        }
        return {
          ...p,
          connected: false, // On restart, marked disconnected until client reconnects
          token,
        };
      });

      const spectatorsList: ServerSpectator[] = Array.from(room.spectators.values()).map((s) => ({
        ...s,
        socketId: '', // Reset socket id on restart
      }));

      const record: PersistedRoomRecord = {
        schemaVersion: 1,
        persistedAt: Date.now(),
        code: room.code,
        hostSessionId: room.hostSessionId,
        state: room.state,
        sequenceNumber: room.sequenceNumber,
        settings: { ...room.settings },
        players: playersList,
        spectators: spectatorsList,
        createdAt: room.createdAt,
        gameState: room.gameState ? JSON.parse(JSON.stringify(room.gameState)) : undefined,
        processedActions: Array.from(room.processedActions.values()),
      };

      const finalPath = path.join(this.roomsDir, `room_${room.code}.json`);
      const tmpPath = path.join(this.roomsDir, `room_${room.code}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);

      try {
        fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
        
        // Atomic replace
        try {
          fs.renameSync(tmpPath, finalPath);
        } catch {
          // Fallback for Windows cross-lock replacement
          fs.copyFileSync(tmpPath, finalPath);
          fs.unlinkSync(tmpPath);
        }
      } catch (writeErr) {
        try {
          if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
          }
        } catch {
          // Ignore temp unlink error
        }
        throw new Error(`Failed to persist room ${room.code}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
      }
    } catch (err) {
      // Re-throw persistence errors so mutations are not acknowledged if not durably saved
      throw err;
    }
  }

  /**
   * Deletes a room file when abandoned or removed.
   */
  public deleteRoom(roomCode: string): void {
    try {
      const filePath = path.join(this.roomsDir, `room_${roomCode.toUpperCase()}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignored
    }
  }

  /**
   * Restores persisted rooms and guest sessions upon server startup.
   */
  public restoreRooms(): RestorationResult {
    const result: RestorationResult = {
      rooms: [],
      sessions: [],
    };

    if (!fs.existsSync(this.roomsDir)) {
      return result;
    }

    try {
      const files = fs.readdirSync(this.roomsDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.startsWith('room_') || !file.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.roomsDir, file);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw) as PersistedRoomRecord;

          // Invariant validation
          if (
            data.schemaVersion !== 1 ||
            !data.code ||
            !data.hostSessionId ||
            !data.state ||
            !data.settings ||
            !Array.isArray(data.players)
          ) {
            // eslint-disable-next-line no-console
            console.warn(`[RoomPersistence] Skipping invalid snapshot: ${file}`);
            continue;
          }

          // Expiration check (>24h untouched)
          if (now - data.persistedAt > this.maxAgeMs) {
            fs.unlinkSync(filePath);
            continue;
          }

          // Rebuild ServerRoom
          const playersMap = new Map<string, ServerPlayer>();
          for (const p of data.players) {
            playersMap.set(p.sessionId, {
              id: p.id,
              sessionId: p.sessionId,
              nickname: p.nickname,
              avatar: p.avatar,
              color: p.color || PLAYER_COLOR_HEXES[p.seatIndex % 8],
              isHost: p.isHost,
              connected: false, // Wait for socket reconnection
              seatIndex: p.seatIndex,
              joinedAt: p.joinedAt,
            });

            // Restore guest session if token exists
            if (p.token) {
              result.sessions.push({
                sessionId: p.sessionId,
                token: p.token,
                nickname: p.nickname,
                avatar: p.avatar || '🟢',
                socketId: '',
                connected: false,
                createdAt: p.joinedAt,
                lastActiveAt: now,
                currentRoomCode: data.code,
                isSpectator: false,
              });
            }
          }

          const spectatorsMap = new Map<string, ServerSpectator>();
          if (Array.isArray(data.spectators)) {
            for (const s of data.spectators) {
              spectatorsMap.set(s.sessionId, {
                sessionId: s.sessionId,
                nickname: s.nickname,
                socketId: '',
                joinedAt: s.joinedAt,
              });
            }
          }

          const processedActionsMap = new Map<string, ProcessedActionRecord>();
          if (Array.isArray(data.processedActions)) {
            for (const item of data.processedActions) {
              if (item && typeof item.requestId === 'string' && item.snapshot) {
                processedActionsMap.set(item.requestId, item);
              }
            }
          }

          const serverRoom: ServerRoom = {
            code: data.code,
            hostSessionId: data.hostSessionId,
            state: data.state,
            sequenceNumber: data.sequenceNumber,
            settings: data.settings,
            players: playersMap,
            spectators: spectatorsMap,
            createdAt: data.createdAt,
            gameState: data.gameState,
            actionQueue: Promise.resolve(),
            processedActions: processedActionsMap,
          };

          result.rooms.push(serverRoom);
        } catch (readErr) {
          // eslint-disable-next-line no-console
          console.warn(`[RoomPersistence] Error reading ${file}:`, readErr);
        }
      }
    } catch (dirErr) {
      // eslint-disable-next-line no-console
      console.warn('[RoomPersistence] Error scanning directory:', dirErr);
    }

    return result;
  }
}
