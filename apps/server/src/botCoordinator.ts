import { randomUUID } from 'node:crypto';
import { type RoomSnapshot } from '@charchokkha/shared';
import { getBoardSpace, getPropertyOwnerId, hasColorMonopoly } from '@charchokkha/game-engine';
import { RoomManager, type ServerRoom, type GuestSession } from './roomManager.js';

interface RoomBotSchedule {
  timer: NodeJS.Timeout | null;
  actionInProgress: boolean;
  scheduledTurnKey: string;
  attemptCount: number;
}

export class BotCoordinator {
  private static testMode = false;
  private schedules = new Map<string, RoomBotSchedule>();

  constructor(private roomManager: RoomManager) {}

  public static setTestMode(enabled: boolean): void {
    BotCoordinator.testMode = enabled;
  }

  public static isTestMode(): boolean {
    return BotCoordinator.testMode;
  }

  private getOrCreateSchedule(roomCode: string): RoomBotSchedule {
    const key = roomCode.toUpperCase();
    let schedule = this.schedules.get(key);
    if (!schedule) {
      schedule = {
        timer: null,
        actionInProgress: false,
        scheduledTurnKey: '',
        attemptCount: 0,
      };
      this.schedules.set(key, schedule);
    }
    return schedule;
  }

  public clearRoom(roomCode: string): void {
    const key = roomCode.toUpperCase();
    const schedule = this.schedules.get(key);
    if (schedule) {
      if (schedule.timer) {
        clearTimeout(schedule.timer);
        schedule.timer = null;
      }
      this.schedules.delete(key);
    }
  }

  public onRoomStateUpdated(
    room: ServerRoom,
    emitUpdate: (snapshot: RoomSnapshot) => void
  ): void {
    const code = room.code;
    const schedule = this.getOrCreateSchedule(code);

    // 1. If room is not in progress or has no active game state, clean up and return
    if (room.state !== 'in_progress' || !room.gameState || room.gameState.phase !== 'in_progress') {
      this.clearRoom(code);
      return;
    }

    const gameState = room.gameState;

    // 2. Determine who needs to act
    const activePlayerId = gameState.activePlayerId;
    const activePlayer = room.players.get(activePlayerId);
    const isAuction = gameState.turnPhase === 'in_auction' && !!gameState.auction;

    let targetBotId: string | null = null;
    let actionType: 'normal_turn' | 'auction' = 'normal_turn';

    if (isAuction) {
      const auction = gameState.auction!;
      // Find an active bot bidder who does NOT already hold the high bid
      const candidateBot = auction.activeBidders.find(
        (id) => room.players.get(id)?.isBot && id !== auction.highBidderId
      );
      if (candidateBot) {
        targetBotId = candidateBot;
        actionType = 'auction';
      }
    } else if (activePlayer?.isBot) {
      targetBotId = activePlayerId;
      actionType = 'normal_turn';
    }

    // If no bot needs to act, cancel any pending timer
    if (!targetBotId) {
      if (schedule.timer) {
        clearTimeout(schedule.timer);
        schedule.timer = null;
      }
      schedule.scheduledTurnKey = '';
      schedule.attemptCount = 0;
      return;
    }

    // 3. Unique turn key to prevent duplicate timers and concurrent actions
    const auctionKey = gameState.auction
      ? `${gameState.auction.spaceId}:${gameState.auction.currentBid}:${gameState.auction.highBidderId}`
      : 'none';
    const turnKey = `${room.sequenceNumber}:${targetBotId}:${gameState.turnPhase}:${actionType}:${auctionKey}`;

    // If action is already executing, do not schedule another
    if (schedule.actionInProgress) {
      return;
    }

    // If timer is already armed for this exact state, avoid duplicate scheduling
    if (schedule.timer && schedule.scheduledTurnKey === turnKey) {
      return;
    }

    if (schedule.timer) {
      clearTimeout(schedule.timer);
      schedule.timer = null;
    }

    schedule.scheduledTurnKey = turnKey;

    // 4. Calculate delay based on testing speed profile
    let delayMs: number;
    if (BotCoordinator.testMode) {
      delayMs = 15;
    } else if (room.settings.botSpeed === 'slow') {
      delayMs = 2400 + Math.floor(Math.random() * 400); // 2.4s - 2.8s
    } else {
      delayMs = 650 + Math.floor(Math.random() * 250); // 650ms - 900ms
    }

    // 5. Schedule execution
    schedule.timer = setTimeout(async () => {
      schedule.timer = null;
      await this.executeBotAction(code, targetBotId!, actionType, turnKey, emitUpdate);
    }, delayMs);
  }

  private async executeBotAction(
    roomCode: string,
    botId: string,
    actionType: 'normal_turn' | 'auction',
    turnKey: string,
    emitUpdate: (snapshot: RoomSnapshot) => void
  ): Promise<void> {
    const schedule = this.getOrCreateSchedule(roomCode);
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.state !== 'in_progress' || !room.gameState) {
      return;
    }

    const botPlayer = room.players.get(botId);
    if (!botPlayer || !botPlayer.isBot) {
      return;
    }

    schedule.actionInProgress = true;
    schedule.attemptCount += 1;

    try {
      const botSession = this.roomManager.getBotSession(roomCode, botId);
      const requestId = `bot_req_${randomUUID().slice(0, 8)}`;

      // Execute via roomManager.enqueueRoomAction for synchronized serialization & idempotency
      const { result: updatedSnapshot } = await this.roomManager.enqueueRoomAction(
        roomCode,
        () => {
          const currentRoom = this.roomManager.getRoom(roomCode);
          if (!currentRoom || currentRoom.state !== 'in_progress' || !currentRoom.gameState) {
            throw new Error('Room state is no longer in progress');
          }

          const state = currentRoom.gameState;
          const botState = state.players[botId];
          if (!botState || botState.isBankrupt) {
            throw new Error('Bot is bankrupt or missing');
          }

          if (actionType === 'auction') {
            return this.decideAuctionAction(currentRoom, botSession, botId);
          } else {
            return this.decideTurnAction(currentRoom, botSession, botId);
          }
        },
        requestId
      );

      // Reset attempt count upon success
      schedule.attemptCount = 0;

      // Broadcast update to all room participants
      if (updatedSnapshot) {
        emitUpdate(updatedSnapshot);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[BotCoordinator] Action failure for bot ${botId} in room ${roomCode}: ${errMsg}`);

      // Bounded retry check: if we've failed 3 times on the same turn, attempt safe recovery
      if (schedule.attemptCount >= 3) {
        // eslint-disable-next-line no-console
        console.warn(`[BotCoordinator] Max attempts reached for ${botId} in ${roomCode}. Executing safe recovery.`);
        schedule.attemptCount = 0;
        await this.executeEmergencyFallback(roomCode, botId, emitUpdate);
      }
    } finally {
      schedule.actionInProgress = false;
    }

    // Check if subsequent bot action is now required (actionInProgress is now false)
    const currentRoom = this.roomManager.getRoom(roomCode);
    if (currentRoom) {
      this.onRoomStateUpdated(currentRoom, emitUpdate);
    }
  }

  private decideTurnAction(room: ServerRoom, botSession: GuestSession, botId: string): RoomSnapshot {
    const state = room.gameState!;
    const botState = state.players[botId];
    const phase = state.turnPhase;

    if (phase === 'need_roll') {
      if (botState.inPrison) {
        if (botState.cash >= 100) {
          return this.roomManager.payPrisonFine(botSession, room.code);
        } else {
          return this.roomManager.rollDice(botSession, room.code);
        }
      }
      return this.roomManager.rollDice(botSession, room.code);
    }

    if (phase === 'action_pending') {
      const space = getBoardSpace(botState.position);
      const price = space.price ?? 0;
      const reserve = price <= 120 ? 0 : 50;

      if (price > 0 && botState.cash >= price + reserve) {
        return this.roomManager.buyProperty(botSession, room.code);
      } else {
        return this.roomManager.declineProperty(botSession, room.code);
      }
    }

    if (phase === 'turn_ended') {
      // If cash is negative, mortgage unimproved properties to avoid bankruptcy
      if (botState.cash < 0) {
        const mortgageable = Object.entries(state.properties).find(([_, prop]) => {
          if (typeof prop === 'object' && prop.ownerId === botId && !prop.isMortgaged && prop.houses === 0) {
            return true;
          }
          return false;
        });

        if (mortgageable) {
          return this.roomManager.mortgageProperty(botSession, room.code, Number(mortgageable[0]));
        } else {
          return this.roomManager.declareBankruptcy(botSession, room.code);
        }
      }

      // If bot has monopoly and ample cash, build house
      if (botState.cash >= 400) {
        for (let spaceId = 0; spaceId < 48; spaceId++) {
          const space = getBoardSpace(spaceId);
          if (
            space.group &&
            space.houseCost &&
            hasColorMonopoly(space.group, botId, (sId) => getPropertyOwnerId(state, sId))
          ) {
            const prop = state.properties[spaceId];
            const houses = prop?.houses ?? 0;
            if (houses < 5 && botState.cash >= space.houseCost + 200) {
              try {
                return this.roomManager.buildHouse(botSession, room.code, spaceId);
              } catch (_) {
                // Ignore even-build or balance constraint and proceed
              }
            }
          }
        }
      }

      return this.roomManager.endTurn(botSession, room.code);
    }

    return this.roomManager.getSnapshot(room.code);
  }

  private decideAuctionAction(room: ServerRoom, botSession: GuestSession, botId: string): RoomSnapshot {
    const state = room.gameState!;
    const auction = state.auction;
    if (!auction) {
      return this.roomManager.getSnapshot(room.code);
    }

    const botState = state.players[botId];
    const space = getBoardSpace(auction.spaceId);
    const valuation = space.price ?? 100;
    const maxBotBid = Math.floor(valuation * 0.75);

    const nextBid = auction.currentBid + 10;
    if (nextBid <= maxBotBid && botState.cash >= nextBid + 30) {
      return this.roomManager.auctionBid(botSession, room.code, nextBid);
    } else {
      return this.roomManager.auctionPass(botSession, room.code);
    }
  }

  private async executeEmergencyFallback(
    roomCode: string,
    botId: string,
    emitUpdate: (snapshot: RoomSnapshot) => void
  ): Promise<void> {
    try {
      const botSession = this.roomManager.getBotSession(roomCode, botId);
      const { result } = await this.roomManager.enqueueRoomAction(roomCode, () => {
        const room = this.roomManager.getRoom(roomCode);
        if (!room || !room.gameState) return;
        const phase = room.gameState.turnPhase;
        if (phase === 'in_auction') {
          return this.roomManager.auctionPass(botSession, roomCode);
        } else if (phase === 'action_pending') {
          return this.roomManager.declineProperty(botSession, roomCode);
        } else if (phase === 'turn_ended') {
          return this.roomManager.endTurn(botSession, roomCode);
        } else if (phase === 'need_roll') {
          return this.roomManager.rollDice(botSession, roomCode);
        }
      });
      if (result) {
        emitUpdate(result);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[BotCoordinator] Emergency recovery failed in ${roomCode}:`, e);
    }
  }
}
