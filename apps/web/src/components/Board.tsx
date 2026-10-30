import { useState, useEffect, useRef } from 'react';
import {
  BOARD_SPACES,
  getSpaceBadge,
  formatTileDisplayName,
  type BoardSpace,
} from '../boardData';
import { getBoardSpace, getGroupSpaces, hasColorMonopoly } from '@charchokkha/game-engine';
import { type Player, type PropertyRecord, type RoomSnapshot } from '@charchokkha/shared';
import { soundManager } from '../audio/soundManager';
import { PlayerCharacter } from './PlayerCharacter';
import { calculateStepPath, prefersReducedMotion } from '../utils/tokenMovement';
import {
  TrophyIcon,
  CartIcon,
  TradeIcon,
  BankruptIcon,
  LockIcon,
  UnlockIcon,
  EyeIcon,
  CheckIcon,
  CloseIcon,
} from './Icons';

/**
 * Concise event message formatter for the central courtyard notification banner and ticker.
 * Transforms verbose engine action logs into compact, professional game telemetry strings
 * that strictly display player nicknames and executed actions (never internal session IDs).
 */
export function formatEventMessage(
  msg: string,
  players?: Player[],
  actor?: Player | null
): string {
  if (!msg) return '';

  let text = msg;

  // 1. Resolve player IDs (guest_xxx, bot_xxx, p1, etc.) to player nicknames
  if (players && players.length > 0) {
    for (const p of players) {
      if (p.id) {
        const name = p.nickname || 'Player';
        text = text.replaceAll(`Player ${p.id}`, name);
        text = text.replaceAll(p.id, name);
      }
    }
  }

  // 2. Sanitize any remaining unmapped guest_ or bot_ hex hashes
  text = text.replace(/Player\s+guest_[a-f0-9]{4,}/gi, 'Player');
  text = text.replace(/guest_[a-f0-9]{4,}/gi, 'Player');
  text = text.replace(/Player\s+bot_[a-f0-9]{4,}/gi, 'Bot');
  text = text.replace(/bot_[a-f0-9]{4,}/gi, 'Bot');

  // Ended turn: "Alice ended turn. Active player is now Bob." or "Player ended turn..."
  const endedTurnMatch = text.match(/^(.+?)\s+ended turn/i);
  if (endedTurnMatch) {
    const actorName = endedTurnMatch[1].replace(/^Player\s+/i, '').trim();
    return actorName ? `${actorName} · Ended turn` : 'Ended turn';
  }

  // Purchase: "Purchased Chattogram for $200"
  const buyMatch = text.match(/(?:(.+?)\s+)?Purchased\s+(.+?)\s+for\s+\$(\d+)/i);
  if (buyMatch) {
    return `${buyMatch[2]} · Bought for $${buyMatch[3]}`;
  }

  // Rent: "Player landed on Saint Martin. Owned by p2. Paid $50 rent." or "Paid $50 to Bob for rent on Saint Martin"
  const rentMatch =
    text.match(/landed on\s+(.+?)\..*?Paid\s+\$(\d+)\s+rent/i) ||
    text.match(/Paid\s+\$(\d+)\s+(?:to\s+.+?\s+)?for rent on\s+(.+)/i);
  if (rentMatch) {
    const isFirstNum = !isNaN(Number(rentMatch[1]));
    const prop = isFirstNum ? rentMatch[2] : rentMatch[1];
    const amount = isFirstNum ? rentMatch[1] : rentMatch[2];
    return `${prop} · Rent paid $${amount}`;
  }

  // Tax: "Player landed on Earnings Tax. Paid $100 in tax." or "Paid $100 for Earnings Tax"
  const taxMatch =
    text.match(/landed on\s+(.+?)\..*?Paid\s+\$(\d+)\s+in tax/i) ||
    text.match(/Paid\s+\$(\d+)\s+(?:for|in)\s+(.+?)(?:\.|$)/i);
  if (taxMatch) {
    const isFirstNum = !isNaN(Number(taxMatch[1]));
    const taxName = isFirstNum ? taxMatch[2] : taxMatch[1];
    const amount = isFirstNum ? taxMatch[1] : taxMatch[2];
    return `${taxName} · Paid $${amount}`;
  }

  // Vacation pot: "Collected $150 from Vacation cash pot!"
  const vacMatch = text.match(/Collected\s+\$(\d+)\s+from Vacation/i);
  if (vacMatch) {
    return `Vacation Pot · +$${vacMatch[1]}`;
  }

  // Rehab / Prison
  if (text.includes('Rolled double') && text.includes('Freed from prison')) {
    return 'Freed from Prison (Doubles!)';
  }
  if (text.includes('fine to leave prison') || text.includes('freed from prison')) {
    return 'Paid $50 Fine · Freed';
  }
  if (text.includes('Arrested') || text.includes('In Prison') || text.includes('Rehab')) {
    return 'Rehab Center · Arrested';
  }

  // Roll and land: "Rolled 6 (3 + 3) and landed on Mithagoli."
  const rollMatch = text.match(/Rolled\s+(\d+\s*\([^)]+\))\s*(?:and\s+)?landed on\s+(.+?)(?:\.|$)/i);
  if (rollMatch) {
    const actorPrefix = actor?.nickname ? `${actor.nickname} · ` : '';
    return `${actorPrefix}Rolled ${rollMatch[1]} · landed on ${rollMatch[2].trim()}`;
  }

  // Auction
  const auctionMatch = text.match(/Auction for\s+(.+?)\s+ended!\s+(.+?)\s+won with\s+\$(\d+)/i);
  if (auctionMatch) {
    return `Auction: ${auctionMatch[1]} · ${auctionMatch[2]} ($${auctionMatch[3]})`;
  }
  const bidMatch = text.match(/^(.+?)\s+bid\s+\$(\d+)/i);
  if (bidMatch) {
    return `${bidMatch[1].trim()} · Bid $${bidMatch[2]}`;
  }
  const passMatch = text.match(/^(.+?)\s+passed in auction/i);
  if (passMatch) {
    return `${passMatch[1].trim()} · Passed auction`;
  }

  // Trade completed
  if (text.includes('Trade completed')) {
    return 'Trade Completed ✓';
  }

  // Bankruptcy
  const bankruptMatch = text.match(/^(.+?)\s+declared bankruptcy/i);
  if (bankruptMatch) {
    return `${bankruptMatch[1].trim()} · Declared bankruptcy`;
  }

  // Salary
  const goMatch = text.match(/Collected\s+\$(\d+)\s+salary/i);
  if (goMatch) {
    return `START · +$${goMatch[1]}`;
  }

  // Declined property
  const declineMatch = text.match(/chose not to buy\s+(.+?)(?:\.|$)/i);
  if (declineMatch) {
    return `${declineMatch[1]} · Declined`;
  }

  // Default cleanup: strip "Player landed on " and "Active player is now..."
  let cleaned = text.replace(/^Player landed on\s+/i, '').trim();
  cleaned = cleaned.replace(/\s*Active player is now\s+.*$/i, '').trim();
  return cleaned.length > 44 ? `${cleaned.slice(0, 42)}…` : cleaned;
}

export interface BoardProps {
  roomCode: string;
  roomSnapshot: RoomSnapshot;
  currentSessionId: string;
  isHost: boolean;
  isSpectator?: boolean;
  onStartGame: () => void;
  onRollDice: () => void;
  onBuyProperty: () => void;
  onDeclineProperty: () => void;
  onAuctionBid: (bidAmount: number) => void;
  onAuctionPass: () => void;
  onPayPrisonFine: () => void;
  onMortgageProperty: (spaceId: number) => void;
  onUnmortgageProperty: (spaceId: number) => void;
  onBuildHouse: (spaceId: number) => void;
  onSellHouse: (spaceId: number) => void;
  onCreateTrade: (trade: {
    receiverId: string;
    offeredCash: number;
    offeredPropertyIds: number[];
    requestedCash: number;
    requestedPropertyIds: number[];
  }) => void;
  onAcceptTrade: () => void;
  onRejectTrade: () => void;
  onDeclareBankruptcy: () => void;
  onEndTurn: () => void;
  isRolling: boolean;
  isSubmittingAction?: boolean;
  onShowResults?: () => void;
}

export function Board({
  roomCode,
  roomSnapshot,
  currentSessionId,
  isHost,
  isSpectator = false,
  onStartGame,
  onRollDice,
  onBuyProperty,
  onDeclineProperty,
  onAuctionBid,
  onAuctionPass,
  onPayPrisonFine,
  onMortgageProperty,
  onUnmortgageProperty,
  onBuildHouse,
  onSellHouse,
  onCreateTrade,
  onAcceptTrade,
  onRejectTrade,
  onDeclareBankruptcy,
  onEndTurn,
  isRolling,
  isSubmittingAction = false,
  onShowResults,
}: BoardProps) {
  const gameState = roomSnapshot.gameState;
  const isGameStarted = (roomSnapshot.state === 'in_progress' || roomSnapshot.state === 'finished') && !!gameState;
  const isGameFinished = roomSnapshot.state === 'finished' || gameState?.phase === 'finished';
  const activePlayerId = gameState?.activePlayerId;
  const isMyTurn = !isSpectator && isGameStarted && activePlayerId === currentSessionId && !isGameFinished;
  const activePlayer = roomSnapshot.players.find((p: Player) => p.id === activePlayerId);
  const myPlayerState = gameState?.players[currentSessionId];
  const myPosition = myPlayerState?.position ?? 0;
  const turnPhase = gameState?.turnPhase ?? 'need_roll';

  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeTargetPlayerId, setTradeTargetPlayerId] = useState<string>('');
  const [tradeOfferedCash, setTradeOfferedCash] = useState<number>(0);
  const [tradeRequestedCash, setTradeRequestedCash] = useState<number>(0);
  const [tradeOfferedProps, setTradeOfferedProps] = useState<number[]>([]);
  const [tradeRequestedProps, setTradeRequestedProps] = useState<number[]>([]);

  // Animation & Audio State
  const [displayedPositions, setDisplayedPositions] = useState<Record<string, number>>({});
  const displayedPositionsRef = useRef<Record<string, number>>({});
  const [isDiceAnimating, setIsDiceAnimating] = useState(false);
  const [isTokenMoving, setIsTokenMoving] = useState(false);
  const [recentEventAlert, setRecentEventAlert] = useState<{
    id: string;
    text: string;
    type: 'purchase' | 'rent' | 'prison' | 'auction' | 'trade' | 'victory';
  } | null>(null);

  const prevRollKeyRef = useRef<string>('');
  const prevActionMsgRef = useRef<string>('');
  const prevActivePlayerRef = useRef<string | undefined>(activePlayerId);
  const movementIntervalsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const movementTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const diceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMountRef = useRef<boolean>(true);
  const alertTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track previous cash to show live balance increase (+) or deduction (-) animations
  const prevCashMapRef = useRef<Record<string, number>>({});
  const [cashDeltas, setCashDeltas] = useState<Record<string, { delta: number; key: number }>>({});

  useEffect(() => {
    if (!roomSnapshot.gameState?.players) return;
    const currentPlayers = roomSnapshot.gameState.players;
    const newDeltas: Record<string, { delta: number; key: number }> = {};
    let hasChanges = false;

    for (const player of roomSnapshot.players) {
      const pState = currentPlayers[player.id];
      const currentCash = pState ? pState.cash : roomSnapshot.settings.startingCash;
      const prevCash = prevCashMapRef.current[player.id];

      if (prevCash !== undefined && prevCash !== currentCash) {
        const delta = currentCash - prevCash;
        newDeltas[player.id] = { delta, key: Date.now() + Math.random() };
        hasChanges = true;
      }
      prevCashMapRef.current[player.id] = currentCash;
    }

    if (hasChanges) {
      setCashDeltas((prev) => ({ ...prev, ...newDeltas }));
      const timer = setTimeout(() => {
        setCashDeltas({});
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [roomSnapshot.gameState?.players, roomSnapshot.players, roomSnapshot.settings.startingCash]);

  // Courtyard activity feed matching reference UI stream
  const [activityFeed, setActivityFeed] = useState<Array<{
    id: string;
    text: string;
    player?: Player;
  }>>(() => [
    {
      id: 'init_start',
      text: 'Game started with a randomized players order. Good luck!',
    },
    {
      id: `init_room_${roomCode}`,
      text: `Joined room ${roomCode}`,
    },
  ]);

  useEffect(() => {
    if (!gameState?.lastActionMessage) return;
    let actionActor: Player | undefined;
    const endedMatch = gameState.lastActionMessage.match(/Player\s+([^\s]+)\s+ended turn/i);
    if (endedMatch) {
      actionActor = roomSnapshot.players.find((p) => p.id === endedMatch[1]);
    }
    if (!actionActor) {
      actionActor = activePlayer || roomSnapshot.players.find((p) => p.id === activePlayerId);
    }
    const msg = formatEventMessage(gameState.lastActionMessage, roomSnapshot.players, actionActor);
    if (!msg) return;
    setActivityFeed((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].text === msg) return prev;
      const matchingPlayer = actionActor || roomSnapshot.players.find(
        (p) => msg.includes(p.nickname) || p.id === activePlayerId
      );
      return [
        ...prev.slice(-6),
        {
          id: `${Date.now()}_${Math.random()}`,
          text: msg,
          player: matchingPlayer,
        },
      ];
    });
  }, [gameState?.lastActionMessage, roomSnapshot.players, activePlayerId, activePlayer]);

  const updatePosition = (playerId: string, pos: number) => {
    displayedPositionsRef.current[playerId] = pos;
    setDisplayedPositions((prev) => ({ ...prev, [playerId]: pos }));
  };

  // Synchronize displayed positions and trigger step animations
  useEffect(() => {
    // 1. Initial setup or reconnection / room reset: directly set server positions without historical replay
    if (isInitialMountRef.current || roomSnapshot.sequenceNumber <= 1) {
      const initialMap: Record<string, number> = {};
      roomSnapshot.players.forEach((p) => {
        initialMap[p.id] = gameState?.players[p.id]?.position ?? 0;
      });
      displayedPositionsRef.current = { ...initialMap };
      setDisplayedPositions(initialMap);
      setIsTokenMoving(false);
      setIsDiceAnimating(false);
      isInitialMountRef.current = false;
      prevActivePlayerRef.current = activePlayerId;
      if (gameState?.lastDiceRoll) {
        prevRollKeyRef.current = `${gameState.lastDiceRoll.die1}_${gameState.lastDiceRoll.die2}_${gameState.lastDiceRoll.total}_${roomSnapshot.sequenceNumber}`;
      }
      return;
    }

    const reduced = prefersReducedMotion();

    // 2. Animate dice when a new authoritative dice roll arrives
    let hasNewRoll = false;
    if (gameState?.lastDiceRoll) {
      const rollKey = `${gameState.lastDiceRoll.die1}_${gameState.lastDiceRoll.die2}_${gameState.lastDiceRoll.total}_${roomSnapshot.sequenceNumber}`;
      if (rollKey !== prevRollKeyRef.current && isGameStarted) {
        prevRollKeyRef.current = rollKey;
        hasNewRoll = true;
        soundManager.playDiceRoll();
        if (!reduced) {
          setIsDiceAnimating(true);
          if (diceTimeoutRef.current) clearTimeout(diceTimeoutRef.current);
          diceTimeoutRef.current = setTimeout(() => {
            setIsDiceAnimating(false);
          }, 550);
        }
      }
    }

    // 3. Tile-by-tile token stepping for each seated player
    roomSnapshot.players.forEach((p) => {
      const targetPos = gameState?.players[p.id]?.position ?? 0;
      const currentPos = displayedPositionsRef.current[p.id] ?? targetPos;

      if (targetPos === currentPos) return;

      // Clear any prior active timers for this player
      if (movementIntervalsRef.current[p.id]) {
        clearInterval(movementIntervalsRef.current[p.id]);
        delete movementIntervalsRef.current[p.id];
      }
      if (movementTimeoutsRef.current[p.id]) {
        clearTimeout(movementTimeoutsRef.current[p.id]);
        delete movementTimeoutsRef.current[p.id];
      }

      if (reduced) {
        // Immediate jump if reduced motion is requested
        updatePosition(p.id, targetPos);
        setIsTokenMoving(false);
        return;
      }

      const path = calculateStepPath(currentPos, targetPos);
      if (path.length === 0) {
        updatePosition(p.id, targetPos);
        setIsTokenMoving(false);
        return;
      }

      // If direct transfer (e.g. Go to Prison direct jump)
      if (path.length === 1) {
        updatePosition(p.id, targetPos);
        setIsTokenMoving(false);
        if (targetPos === 12) {
          soundManager.playGoToPrison();
        }
        return;
      }

      // Step along the path tile-by-tile
      setIsTokenMoving(true);
      const startDelay = hasNewRoll ? 300 : 0; // Brief delay while dice tumble

      movementTimeoutsRef.current[p.id] = setTimeout(() => {
        let stepIndex = 0;
        const stepInterval = setInterval(() => {
          if (stepIndex < path.length) {
            const nextTile = path[stepIndex];
            updatePosition(p.id, nextTile);
            soundManager.playStepHop();
            stepIndex++;
          } else {
            clearInterval(stepInterval);
            delete movementIntervalsRef.current[p.id];
            updatePosition(p.id, targetPos);
            setIsTokenMoving(false);
            if (targetPos === 12 && gameState?.players[p.id]?.inPrison) {
              soundManager.playGoToPrison();
            }
          }
        }, 95);

        movementIntervalsRef.current[p.id] = stepInterval;
      }, startDelay);
    });

    return () => {
      Object.values(movementIntervalsRef.current).forEach(clearInterval);
      movementIntervalsRef.current = {};
      Object.values(movementTimeoutsRef.current).forEach(clearTimeout);
      movementTimeoutsRef.current = {};
      if (diceTimeoutRef.current) {
        clearTimeout(diceTimeoutRef.current);
        diceTimeoutRef.current = null;
      }
    };
  }, [roomSnapshot.sequenceNumber, gameState?.lastDiceRoll, gameState?.players, isGameStarted]);

  // Audio & Feedback triggers for notable game events
  useEffect(() => {
    if (!isGameStarted || isGameFinished) return;

    // Turn transition to local player
    if (activePlayerId === currentSessionId && prevActivePlayerRef.current !== currentSessionId) {
      soundManager.playTurnPing();
    }
    prevActivePlayerRef.current = activePlayerId;

    // Action message audio & feedback triggers
    const currentActionMsg = gameState?.lastActionMessage;
    if (currentActionMsg && currentActionMsg !== prevActionMsgRef.current) {
      prevActionMsgRef.current = currentActionMsg;

      let eventType: 'purchase' | 'rent' | 'prison' | 'auction' | 'trade' | 'victory' | null = null;

      if (currentActionMsg.startsWith('Purchased')) {
        // Audio feedback on purchase, without redundant visual pop-up banner
        soundManager.playBuyProperty();
      } else if (currentActionMsg.includes('Paid $') && currentActionMsg.includes('rent')) {
        eventType = 'rent';
        soundManager.playRentPayment();
      } else if (currentActionMsg.includes('Arrested') || currentActionMsg.includes('In Prison')) {
        eventType = 'prison';
        soundManager.playGoToPrison();
      } else if (currentActionMsg.includes('Auction ended!')) {
        eventType = 'auction';
        soundManager.playAuctionGavel();
      } else if (currentActionMsg.includes('Trade completed')) {
        eventType = 'trade';
        soundManager.playBuyProperty();
      } else if (currentActionMsg.includes('Winner is') || currentActionMsg.includes('Game over')) {
        eventType = 'victory';
        soundManager.playVictory();
      }

      if (eventType) {
        if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
        setRecentEventAlert({
          id: `${Date.now()}_${eventType}`,
          text: currentActionMsg,
          type: eventType,
        });

        alertTimeoutRef.current = setTimeout(() => {
          setRecentEventAlert(null);
        }, 4500);
      }
    }
  }, [isGameStarted, isGameFinished, activePlayerId, currentSessionId, gameState?.lastActionMessage]);

  // Player positions and details for token rendering
  const playersWithTokens = roomSnapshot.players.map((p: Player) => {
    const pState = gameState?.players[p.id];
    const serverPos = pState ? pState.position : 0;
    const currentRenderPos = displayedPositions[p.id] ?? serverPos;
    return {
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      color: p.color || '#C4E64A',
      position: currentRenderPos,
      cash: pState ? pState.cash : roomSnapshot.settings.startingCash,
      isBankrupt: pState ? pState.isBankrupt : false,
      inPrison: pState ? pState.inPrison : false,
      isCurrent: p.id === currentSessionId,
    };
  });

  const dice = gameState?.lastDiceRoll ?? { die1: 3, die2: 5, total: 8, isDouble: false };

  // Current space details if purchasing
  const currentLandingSpace =
    isMyTurn && turnPhase === 'action_pending' ? getBoardSpace(myPosition) : undefined;
  const canAffordCurrentSpace =
    currentLandingSpace?.price != null && myPlayerState
      ? myPlayerState.cash >= currentLandingSpace.price
      : false;

  // Helper to extract PropertyRecord
  const getPropertyInfo = (spaceId: number): PropertyRecord | undefined => {
    const raw = gameState?.properties?.[String(spaceId)];
    if (!raw) return undefined;
    if (typeof raw === 'string') {
      return { ownerId: raw, houses: 0, isMortgaged: false };
    }
    return raw as PropertyRecord;
  };

  // 11x11 Grid mapping for 48 perimeter spaces (top, right, bottom, and left edges each have 11 spaces)
  const getSpaceGridCoords = (
    id: number
  ): { gridRow: number; gridColumn: number; edge: 'top' | 'right' | 'bottom' | 'left' | 'corner' } => {
    if (id === 0) return { gridRow: 1, gridColumn: 1, edge: 'corner' };
    if (id >= 1 && id <= 11) return { gridRow: 1, gridColumn: id + 1, edge: 'top' };
    if (id === 12) return { gridRow: 1, gridColumn: 11, edge: 'corner' };
    if (id >= 13 && id <= 23) return { gridRow: 0, gridColumn: 11, edge: 'right' };
    if (id === 24) return { gridRow: 11, gridColumn: 11, edge: 'corner' };
    if (id >= 25 && id <= 35) return { gridRow: 11, gridColumn: 36 - id, edge: 'bottom' };
    if (id === 36) return { gridRow: 11, gridColumn: 1, edge: 'corner' };
    return { gridRow: 0, gridColumn: 1, edge: 'left' };
  };

  const renderDiePips = (val: number) => {
    const pips = [];
    if (val === 1) {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '2 / 2' }} />);
    } else if (val === 2) {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="tactile-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 3) {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="tactile-pip" style={{ gridArea: '2 / 2' }} />);
      pips.push(<span key="3" className="tactile-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 4) {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="tactile-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="3" className="tactile-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="4" className="tactile-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 5) {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="tactile-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="3" className="tactile-pip" style={{ gridArea: '2 / 2' }} />);
      pips.push(<span key="4" className="tactile-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="5" className="tactile-pip" style={{ gridArea: '3 / 3' }} />);
    } else {
      pips.push(<span key="1" className="tactile-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="tactile-pip" style={{ gridArea: '2 / 1' }} />);
      pips.push(<span key="3" className="tactile-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="4" className="tactile-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="5" className="tactile-pip" style={{ gridArea: '2 / 3' }} />);
      pips.push(<span key="6" className="tactile-pip" style={{ gridArea: '3 / 3' }} />);
    }
    return pips;
  };

  const selectedSpace: BoardSpace | null = selectedSpaceId != null ? getBoardSpace(selectedSpaceId) : null;
  const selectedPropRecord = selectedSpaceId != null ? getPropertyInfo(selectedSpaceId) : undefined;
  const selectedOwner = selectedPropRecord ? roomSnapshot.players.find((p) => p.id === selectedPropRecord.ownerId) : undefined;
  const isSelectedOwnedByMe = selectedPropRecord?.ownerId === currentSessionId;

  // Monopoly & House calculations for selected property
  let hasMonopolyForSelected = false;
  let canBuildOnSelected = false;
  let canSellOnSelected = false;
  if (selectedSpace && selectedSpace.group && isSelectedOwnedByMe && gameState) {
    hasMonopolyForSelected = hasColorMonopoly(
      selectedSpace.group,
      currentSessionId,
      (sId) => getPropertyInfo(sId)?.ownerId
    );
    const groupSpaces = getGroupSpaces(selectedSpace.group);
    const hasMortgaged = groupSpaces.some((s) => getPropertyInfo(s.id)?.isMortgaged);
    const groupHouses = groupSpaces.map((s) => getPropertyInfo(s.id)?.houses ?? 0);
    const minHouses = Math.min(...groupHouses);
    const maxHouses = Math.max(...groupHouses);
    const curHouses = selectedPropRecord?.houses ?? 0;

    canBuildOnSelected =
      hasMonopolyForSelected &&
      !hasMortgaged &&
      curHouses < 5 &&
      curHouses === minHouses &&
      (myPlayerState?.cash ?? 0) >= (selectedSpace.houseCost ?? 0);

    canSellOnSelected = curHouses > 0 && curHouses === maxHouses;
  }

  const winnerPlayer = gameState?.winnerId
    ? roomSnapshot.players.find((p: Player) => p.id === gameState.winnerId)
    : undefined;

  const otherPlayers = roomSnapshot.players.filter((p: Player) => p.id !== currentSessionId);

  const renderTile = (space: BoardSpace, isInsideTrack = false) => {
    const coords = getSpaceGridCoords(space.id);
    const isCorner = coords.edge === 'corner';
    const tokensOnTile = playersWithTokens.filter((p) => p.position === space.id);
    const badge = getSpaceBadge(space.id);

    const propRecord = getPropertyInfo(space.id);
    const ownerPlayer = propRecord
      ? roomSnapshot.players.find((p: Player) => p.id === propRecord.ownerId)
      : undefined;

    // Corner presentation
    if (isCorner) {
      let cornerIcon = '🏁';
      let cornerModifier = 'corner-start';
      if (space.id === 12) {
        cornerIcon = '';
        cornerModifier = 'corner-prison';
      } else if (space.id === 24) {
        cornerIcon = '🍔';
        cornerModifier = 'corner-vacation';
      } else if (space.id === 36) {
        cornerIcon = '🚨';
        cornerModifier = 'corner-arrest';
      }

      return (
        <div
          key={space.id}
          id={`space-${space.id}`}
          className={`board-tile tile-corner ${cornerModifier}`}
          style={{ gridRow: coords.gridRow, gridColumn: coords.gridColumn }}
          tabIndex={0}
          role="button"
          aria-label={space.subtext ? `${space.name} (${space.subtext})` : space.name}
          onClick={() => setSelectedSpaceId(space.id)}
        >
          <div className="corner-content-box">
            {cornerIcon ? <span className="corner-icon-symbol" aria-hidden="true">{cornerIcon}</span> : null}
            <span className="corner-primary-label">{formatTileDisplayName(space)}</span>
            {space.subtext ? <span className="corner-sub-caption">{space.subtext}</span> : null}
          </div>

          {tokensOnTile.length > 0 && (
            <div className="tile-tokens-cluster">
              {tokensOnTile.map((p) => (
                <div
                  key={p.id}
                  className={`player-board-token ${p.id === currentSessionId ? 'token-is-me' : ''}`}
                  title={`${p.nickname} (${p.cash})`}
                  aria-label={`${p.nickname} token`}
                >
                  <PlayerCharacter
                    color={p.color || '#C4E64A'}
                    size={22}
                    isHopping={isTokenMoving && p.id === activePlayerId}
                    showGlow={p.id === currentSessionId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const inwardPositionClass = `inward-edge-${coords.edge}`;
    const isAirport = space.type === 'airport';
    const tileDisplayName = formatTileDisplayName(space);

    const tileStyle: React.CSSProperties = {
      ...(isInsideTrack
        ? {}
        : { gridRow: coords.gridRow, gridColumn: coords.gridColumn }),
      ...(ownerPlayer
        ? {
            borderColor: `${ownerPlayer.color}66`,
            boxShadow: `inset 0 0 6px ${ownerPlayer.color}26`,
          }
        : {}),
    };

    return (
      <div
        key={space.id}
        id={`space-${space.id}`}
        className={`board-tile tile-edge ${inwardPositionClass} ${coords.edge === 'top' || coords.edge === 'bottom' ? 'tile-edge-vertical' : 'tile-edge-horizontal'} ${propRecord?.isMortgaged ? 'tile-is-mortgaged' : ''} ${isAirport ? 'tile-type-airport' : ''}`}
        style={tileStyle}
        tabIndex={0}
        role="button"
        aria-label={`${space.name}, Price: ${space.price ?? 0}`}
        onClick={() => setSelectedSpaceId(space.id)}
      >
        {/* Ownership Strip: renders ONLY when the property is owned, matching the owner's player color */}
        {ownerPlayer && (
          <div
            className="tile-color-strip tile-ownership-strip"
            style={{
              backgroundColor: ownerPlayer.color,
              boxShadow: `0 0 8px ${ownerPlayer.color}88`,
            }}
            aria-hidden="true"
          />
        )}

        {/* Building indicators (Houses / Hotel) */}
        {propRecord && propRecord.houses > 0 && (
          <div className="tile-improvements-strip">
            {propRecord.houses === 5 ? (
              <span className="hotel-improvement-chip" title="Hotel">
                🏨 Hotel
              </span>
            ) : (
              <div className="houses-pips-row" title={`${propRecord.houses} House(s)`}>
                {Array.from({ length: propRecord.houses }).map((_, i) => (
                  <span key={i} className="house-pip-dot" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mortgaged Hatch Overlay */}
        {propRecord?.isMortgaged && (
          <div className="tile-mortgage-overlay">
            <span className="mortgage-stamp">MORTGAGE</span>
          </div>
        )}

        {/* Tile Core Content */}
        <div className="tile-body-box">
          {/* Neutral category emblem badge (NO country flags) */}
          {space.type !== 'property' && badge?.symbol ? (
            <span className="tile-category-badge" title={badge.label} aria-hidden="true">
              {badge.symbol}
            </span>
          ) : null}

          <span className={`tile-title-text ${isAirport ? 'tile-airport-name' : ''}`}>{tileDisplayName}</span>

          {space.price != null ? (
            <span className="tile-price-tag">${space.price}</span>
          ) : (
            space.subtext && <span className="tile-subtext-tag">{space.subtext}</span>
          )}
        </div>

        {/* Player Tokens Cluster */}
        {tokensOnTile.length > 0 && (
          <div className="tile-tokens-cluster">
            {tokensOnTile.map((p) => (
              <div
                key={p.id}
                className={`player-board-token ${p.id === currentSessionId ? 'token-is-me' : ''}`}
                title={`${p.nickname} (${p.cash})`}
                aria-label={`${p.nickname} token`}
              >
                <PlayerCharacter
                  color={p.color || '#C4E64A'}
                  size={22}
                  isHopping={isTokenMoving && p.id === activePlayerId}
                  showGlow={p.id === currentSessionId}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="board-outer-wrapper">
      <div className="board-grid-tabletop" role="region" aria-label="Game Board">
        {/* Corner 0: START */}
        {renderTile(BOARD_SPACES[0])}

        {/* Top Edge Track: 11 spaces from Rahattarpool (1) to Kaptai (11) */}
        <div
          className="board-top-edge-track"
          style={{
            gridRow: 1,
            gridColumn: '2 / 11',
            display: 'grid',
            gridTemplateColumns: 'repeat(11, 1fr)',
            height: '100%',
            width: '100%',
          }}
        >
          {BOARD_SPACES.slice(1, 12).map((space) => renderTile(space, true))}
        </div>

        {/* Corner 12: Utshob Rehab Center */}
        {renderTile(BOARD_SPACES[12])}

        {/* Right Edge Track: 11 spaces from Mern Sun (13) to Nanupur (23) */}
        <div
          className="board-right-edge-track"
          style={{
            gridRow: '2 / 11',
            gridColumn: 11,
            display: 'grid',
            gridTemplateRows: 'repeat(11, 1fr)',
            height: '100%',
            width: '100%',
          }}
        >
          {BOARD_SPACES.slice(13, 24).map((space) => renderTile(space, true))}
        </div>

        {/* Corner 24: Abesh Boobesh */}
        {renderTile(BOARD_SPACES[24])}

        {/* Bottom Edge Track: 11 spaces from Uttara (25) to Bashkhali (35) */}
        <div
          className="board-bottom-edge-track"
          style={{
            gridRow: 11,
            gridColumn: '2 / 11',
            display: 'grid',
            gridTemplateColumns: 'repeat(11, 1fr)',
            height: '100%',
            width: '100%',
          }}
        >
          {[...BOARD_SPACES.slice(25, 36)].reverse().map((space) => renderTile(space, true))}
        </div>

        {/* Corner 36: Go to Rehab */}
        {renderTile(BOARD_SPACES[36])}

        {/* Left Edge: Remaining Spaces 37 to 45 (Bogalake to Saint Martin) */}
        <div
          className="board-left-edge-track"
          style={{
            gridRow: '2 / 11',
            gridColumn: 1,
            display: 'grid',
            gridTemplateRows: 'repeat(11, 1fr)',
            height: '100%',
            width: '100%',
          }}
        >
          {[...BOARD_SPACES.slice(37, 48)].reverse().map((space) => renderTile(space, true))}
        </div>

        {/* Central Courtyard Stage */}
        <div className="board-courtyard-center">
          {/* Winner Celebration Banner */}
          {isGameFinished && (
            <div className="courtyard-victory-banner" role="status">
              <TrophyIcon size={24} className="victory-trophy-icon" />
              <div className="victory-text-stack">
                <span className="victory-headline">GAME OVER</span>
                <span className="victory-winner-name">
                  Winner: {winnerPlayer?.nickname ?? 'Champion'}!
                </span>
                {onShowResults && (
                  <button
                    type="button"
                    className="btn-courtyard-results"
                    onClick={onShowResults}
                  >
                    <span>View Standings & Stats</span>
                    <TrophyIcon size={14} style={{ marginLeft: 6 }} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Vacation Pot Indicator */}
          {roomSnapshot.settings.vacationCash && isGameStarted && !isGameFinished && (
            <div className="courtyard-vacation-pot-pill" title="Vacation Cash Pot">
              <span>Vacation Pot: <strong>${gameState?.vacationPot ?? 0}</strong></span>
            </div>
          )}

          {/* In Prison Status Notice */}
          {!isSpectator && myPlayerState?.inPrison && isMyTurn && !isGameFinished && (
            <div className="courtyard-prison-banner" role="alert">
              <LockIcon size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              <span>In Prison (Turn attempt {myPlayerState.prisonTurns}/3)</span>
            </div>
          )}

          {/* Active Auction Card Banner */}
          {gameState?.auction && (
            <div className="courtyard-auction-card" role="region" aria-label="Active Auction">
              <div className="auction-card-header">
                <span className="auction-prop-name">
                  Auction: {getBoardSpace(gameState.auction.spaceId).name}
                </span>
              </div>
              <div className="auction-bid-stats">
                <span className="auction-stat-label">Current Bid:</span>
                <span className="auction-stat-value">${gameState.auction.currentBid}</span>
              </div>
              <div className="auction-leader-text">
                {gameState.auction.highBidderId
                  ? `High Bidder: ${
                      roomSnapshot.players.find((p) => p.id === gameState.auction?.highBidderId)
                        ?.nickname ?? 'Player'
                    }`
                  : 'No bids placed yet'}
              </div>

              {isSpectator ? (
                <div className="auction-spectator-note">
                  <EyeIcon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  <span>Spectating Auction (Read-Only)</span>
                </div>
              ) : gameState.auction.activeBidders.includes(currentSessionId) ? (
                <div className="auction-buttons-row">
                  <button
                    type="button"
                    className="btn-primary-action btn-bid-action"
                    onClick={() => onAuctionBid((gameState.auction?.currentBid ?? 0) + 10)}
                    disabled={(myPlayerState?.cash ?? 0) < (gameState.auction?.currentBid ?? 0) + 10 || isSubmittingAction}
                  >
                    Bid ${(gameState.auction?.currentBid ?? 0) + 10}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary-action btn-pass-action"
                    onClick={onAuctionPass}
                    disabled={isSubmittingAction}
                  >
                    Pass
                  </button>
                </div>
              ) : (
                <div className="auction-passed-note">You passed this auction.</div>
              )}
            </div>
          )}

          {/* Tactile 3D Dice Pair Stage with Ground Drop Shadows (mirroring reference UI) */}
          <div
            className={`courtyard-dice-stage ${!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'dice-clickable' : ''}`}
            onClick={!isSpectator && isMyTurn && turnPhase === 'need_roll' && !isRolling ? onRollDice : undefined}
            title={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'Click to roll dice' : undefined}
            role={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'button' : undefined}
            aria-label="Roll dice pair"
            tabIndex={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 0 : -1}
          >
            <div className={`dice-cube-shadow-wrap die-cube-1 ${isRolling || isDiceAnimating ? 'is-rolling' : ''}`}>
              <div className="dice-tumbler">
                <div
                  className={`tactile-dice-cube val-${dice.die1}`}
                  role="img"
                  aria-label={`Die 1: ${dice.die1}`}
                >
                  <div className="dice-face face-1">{renderDiePips(1)}</div>
                  <div className="dice-face face-2">{renderDiePips(2)}</div>
                  <div className="dice-face face-3">{renderDiePips(3)}</div>
                  <div className="dice-face face-4">{renderDiePips(4)}</div>
                  <div className="dice-face face-5">{renderDiePips(5)}</div>
                  <div className="dice-face face-6">{renderDiePips(6)}</div>
                </div>
              </div>
              <div className="tactile-dice-ground-shadow" aria-hidden="true" />
            </div>
            <div className={`dice-cube-shadow-wrap die-cube-2 ${isRolling || isDiceAnimating ? 'is-rolling' : ''}`}>
              <div className="dice-tumbler">
                <div
                  className={`tactile-dice-cube val-${dice.die2}`}
                  role="img"
                  aria-label={`Die 2: ${dice.die2}`}
                >
                  <div className="dice-face face-1">{renderDiePips(1)}</div>
                  <div className="dice-face face-2">{renderDiePips(2)}</div>
                  <div className="dice-face face-3">{renderDiePips(3)}</div>
                  <div className="dice-face face-4">{renderDiePips(4)}</div>
                  <div className="dice-face face-5">{renderDiePips(5)}</div>
                  <div className="dice-face face-6">{renderDiePips(6)}</div>
                </div>
              </div>
              <div className="tactile-dice-ground-shadow" aria-hidden="true" />
            </div>
          </div>

          {/* Contextual Action Buttons (mirroring image (1), (2), (3)) */}
          <div className="courtyard-action-controls">
            {isSpectator ? (
              <div className="courtyard-player-playing-status" role="status">
                <EyeIcon size={15} className="spectator-eye" />
                <span className="playing-status-text">
                  {!isGameStarted
                    ? 'Waiting for host to start...'
                    : isGameFinished
                    ? 'Match Finished'
                    : `${activePlayer?.nickname ?? 'Player'} is playing...`}
                </span>
              </div>
            ) : !isGameStarted ? (
              isHost ? (
                <>
                  <button
                    id="btn-start-game"
                    type="button"
                    className="btn-primary-action btn-start-game-prominent"
                    onClick={onStartGame}
                    disabled={roomSnapshot.players.length < 2 || isSubmittingAction}
                  >
                    <span>Start Game</span>
                  </button>
                  {roomSnapshot.players.length < 2 && (
                    <span className="action-helper-warning">
                      Waiting for at least 2 players to start
                    </span>
                  )}
                </>
              ) : (
                <div className="courtyard-player-playing-status">
                  <span className="playing-status-text">Waiting for host to start...</span>
                </div>
              )
            ) : isGameFinished ? (
              <button
                type="button"
                className="btn-primary-action btn-view-results-action"
                onClick={onShowResults}
              >
                <TrophyIcon size={15} style={{ marginRight: 6 }} />
                <span>View Results</span>
              </button>
            ) : isMyTurn ? (
              isTokenMoving || isDiceAnimating ? (
                <div className="courtyard-player-playing-status" role="status" aria-live="polite">
                  <span className="playing-status-text">
                    {isDiceAnimating ? 'Rolling dice...' : 'Advancing to space...'}
                  </span>
                </div>
              ) : turnPhase === 'need_roll' ? (
                <>
                  {myPlayerState?.inPrison && (
                    <button
                      id="btn-pay-fine"
                      type="button"
                      className="btn-secondary-action btn-pay-prison-fine"
                      onClick={onPayPrisonFine}
                      disabled={(myPlayerState?.cash ?? 0) < 50 || isSubmittingAction}
                    >
                      <UnlockIcon size={14} style={{ marginRight: 6 }} />
                      <span>Pay $50 & Exit</span>
                    </button>
                  )}
                  <button
                    id="btn-roll-dice"
                    type="button"
                    className="btn-primary-action btn-roll-prominent"
                    onClick={onRollDice}
                    disabled={isRolling || isSubmittingAction}
                  >
                    <span>
                      {isRolling
                        ? 'Rolling...'
                        : myPlayerState?.inPrison
                        ? 'Roll for Doubles'
                        : 'Roll the dice'}
                    </span>
                  </button>
                </>
              ) : turnPhase === 'action_pending' && currentLandingSpace ? (
                <div className="courtyard-action-buttons-row">
                  <button
                    id="btn-end-turn"
                    type="button"
                    className="btn-primary-action btn-end-turn-action"
                    onClick={onDeclineProperty || onEndTurn}
                    disabled={isSubmittingAction}
                    title="End turn without buying"
                  >
                    <span className="courtyard-btn-icon" aria-hidden="true">✓</span>
                    <span>End turn</span>
                  </button>
                  <button
                    id="btn-buy-property"
                    type="button"
                    className="btn-primary-action btn-buy-btn"
                    onClick={onBuyProperty}
                    disabled={!canAffordCurrentSpace || isSubmittingAction}
                  >
                    <CartIcon size={13} className="courtyard-btn-icon" />
                    <span>Buy for ${currentLandingSpace.price}</span>
                  </button>
                  <button
                    id="btn-decline-property"
                    type="button"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ display: 'none' }}
                    onClick={onDeclineProperty}
                    disabled={isSubmittingAction}
                  >
                    Decline
                  </button>
                </div>
              ) : turnPhase === 'in_auction' ? (
                <div className="courtyard-player-playing-status">
                  <span className="playing-status-text">Auction in progress...</span>
                </div>
              ) : (
                <button
                  id="btn-end-turn"
                  type="button"
                  className="btn-primary-action btn-end-turn-action"
                  onClick={onEndTurn}
                  disabled={isSubmittingAction}
                >
                  <span className="courtyard-btn-icon" aria-hidden="true">✓</span>
                  <span>End turn</span>
                </button>
              )
            ) : (
              <div className="courtyard-player-playing-status" role="status">
                <div className="playing-avatar-wrap">
                  <PlayerCharacter
                    color={activePlayer?.color || '#C4E64A'}
                    size={16}
                    variant="blob"
                  />
                </div>
                <span className="playing-player-name">{activePlayer?.nickname ?? 'Player'}</span>
                <span className="playing-status-text">is playing...</span>
              </div>
            )}
          </div>

          {/* Courtyard Activity Feed Log (mirroring reference UI stream) */}
          <div className="courtyard-activity-feed" role="log" aria-label="Game Activity Log">
            {activityFeed.slice(-3).map((entry) => (
              <div key={entry.id} className="activity-feed-item">
                {entry.player && (
                  <span className="activity-item-avatar">
                    <PlayerCharacter color={entry.player.color || '#C4E64A'} size={12} variant="blob" />
                  </span>
                )}
                <span className="activity-item-text">{entry.text}</span>
              </div>
            ))}

            {/* Active Action Ticker for Server Action Messages */}
            {!recentEventAlert && gameState?.lastActionMessage && !gameState.lastActionMessage.startsWith('Purchased') && !gameState.lastActionMessage.includes('Available to buy') && (
              (() => {
                const formatted = formatEventMessage(gameState.lastActionMessage, roomSnapshot.players, activePlayer);
                const isAlreadyInFeed = activityFeed.slice(-1).some((e) => e.text === formatted);
                if (isAlreadyInFeed) return null;
                return (
                  <div className="courtyard-action-ticker activity-feed-item" aria-live="polite">
                    <span className="activity-item-text ticker-text">{formatted}</span>
                  </div>
                );
              })()
            )}
          </div>

          {/* Pending Trade Notification Banner */}
          {gameState?.pendingTrade && gameState.pendingTrade.receiverId === currentSessionId && (
            <div className="courtyard-trade-alert" role="alert">
              <div className="trade-alert-title">
                <strong>Trade Offer Received</strong> from{' '}
                {roomSnapshot.players.find((p) => p.id === gameState?.pendingTrade?.senderId)?.nickname ?? 'Player'}!
              </div>
              <div className="trade-alert-terms">
                Offered: ${gameState.pendingTrade.offeredCash} + {gameState.pendingTrade.offeredPropertyIds.length} properties
              </div>
              <div className="trade-alert-buttons">
                <button
                  type="button"
                  className="btn-primary-action btn-accept-trade"
                  onClick={onAcceptTrade}
                >
                  <CheckIcon size={14} style={{ marginRight: 4 }} />
                  <span>Accept</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary-action btn-reject-trade"
                  onClick={onRejectTrade}
                >
                  <CloseIcon size={13} style={{ marginRight: 4 }} />
                  <span>Decline</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Controls Bar Under the Board */}
      {!isSpectator && isGameStarted && !isGameFinished && (
        <div className="board-bottom-actions-bar" role="group" aria-label="Game Actions">
          <button
            type="button"
            id="btn-open-trade"
            className="btn-board-bottom-action btn-trade-action"
            onClick={() => setIsTradeModalOpen(true)}
            disabled={otherPlayers.length === 0 || isTokenMoving || isSubmittingAction}
            aria-label="Propose Trade"
          >
            <TradeIcon size={16} style={{ marginRight: 6 }} />
            <span>Trade</span>
          </button>

          {myPlayerState && !myPlayerState.isBankrupt && (
            <button
              type="button"
              id="btn-declare-bankruptcy"
              className="btn-board-bottom-action btn-bankrupt-action"
              disabled={isTokenMoving || isSubmittingAction}
              onClick={() => {
                if (
                  window.confirm(
                    'Are you sure you want to declare bankruptcy? Your remaining assets will be liquidated and you will exit the match.'
                  )
                ) {
                  onDeclareBankruptcy();
                }
              }}
              aria-label="Declare Bankruptcy"
            >
              <BankruptIcon size={16} style={{ marginRight: 6 }} />
              <span>Bankrupt</span>
            </button>
          )}
        </div>
      )}

      {/* Player Information Menu (In the below free space) */}
      <div className="board-player-info-menu" role="region" aria-label="Player Accounts & Status">
        <div className="player-info-menu-track player-info-menu-list">
          {roomSnapshot.players.map((p) => {
            const pState = roomSnapshot.gameState?.players[p.id];
            const isTurn = isGameStarted && !isGameFinished && roomSnapshot.gameState?.activePlayerId === p.id;
            const isMe = p.id === currentSessionId;
            const isBankrupt = pState?.isBankrupt;
            const inPrison = pState?.inPrison;
            const cash = pState ? pState.cash : roomSnapshot.settings.startingCash;
            const deltaObj = cashDeltas[p.id];

            return (
              <div
                key={p.id}
                className={`player-info-card player-info-row ${isTurn ? 'card-turn-active' : ''} ${isMe ? 'card-is-me' : ''} ${isBankrupt ? 'card-is-bankrupt' : ''}`}
                title={`${p.nickname} — Cash: $${cash}${isTurn ? ' (Current Turn)' : ''}`}
              >
                {/* Cyan active-turn accent bar on left edge */}
                {isTurn && <span className="player-row-turn-accent" aria-hidden="true" />}

                {/* Left Side: Avatar + Name + Badges */}
                <div className="player-row-left">
                  <div className="player-info-avatar-wrap">
                    <PlayerCharacter
                      color={p.color || '#C4E64A'}
                      size={24}
                      variant="blob"
                      showGlow={false}
                    />
                  </div>

                  <span className="player-info-name player-row-name">{p.nickname}</span>

                  {/* Room Host Gold Crown */}
                  {p.isHost && (
                    <span className="player-info-crown player-row-host-crown" title="Room Host">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 4l3 12h14l3-12-5 6-5-6-5 6z" />
                        <circle cx="12" cy="18" r="1" fill="#fbbf24" />
                      </svg>
                    </span>
                  )}

                  {/* AI Bot badge */}
                  {p.isBot && <span className="player-info-bot-tag player-row-bot-chip" title="AI Bot">BOT</span>}

                  {/* Current User [->] indicator badge */}
                  {isMe && (
                    <span className="player-info-me-tag player-row-me-badge" title="You">
                      <span>→]</span>
                    </span>
                  )}

                  {/* Bankrupt or Prison badges */}
                  {isBankrupt && <span className="player-info-bankrupt-badge">OUT</span>}
                  {!isBankrupt && inPrison && !isTurn && (
                    <span className="player-info-prison-badge" title="In Prison">
                      <LockIcon size={12} />
                    </span>
                  )}

                  {/* Turn badge for unit tests & screen readers */}
                  {isTurn && (
                    <span className="player-info-turn-badge sr-only" title="Active Turn">
                      {isMe ? 'YOUR TURN' : 'TURN'}
                    </span>
                  )}
                </div>

                {/* Right Side: Account Balance + Live Delta Notification */}
                <div className="player-row-right">
                  {deltaObj && (
                    <span
                      key={deltaObj.key}
                      className={`player-cash-delta-pill ${deltaObj.delta > 0 ? 'delta-increase' : 'delta-deduction'}`}
                      aria-live="polite"
                    >
                      {deltaObj.delta > 0 ? `+$${deltaObj.delta}` : `-$${Math.abs(deltaObj.delta)}`}
                    </span>
                  )}
                  <span className="player-info-balance player-row-balance font-mono">${cash}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Property Inspection & Management Modal / Bottom Sheet */}
      {selectedSpace && (
        <div
          className="modal-backdrop-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prop-modal-title"
          onClick={() => setSelectedSpaceId(null)}
        >
          <div className="dialog-card-surface prop-inspector-card" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header-row">
              <div className="prop-inspector-title-group">
                {selectedOwner && (
                  <span
                    className="prop-group-dot"
                    style={{
                      backgroundColor: selectedOwner.color,
                      boxShadow: `0 0 8px ${selectedOwner.color}88`,
                    }}
                    aria-hidden="true"
                  />
                )}
                {selectedSpace.type === 'airport' && (
                  <span className="prop-group-dot prop-group-dot-airport" aria-hidden="true">✈️</span>
                )}
                {selectedSpace.type === 'utility' && (
                  <span className="prop-group-dot prop-group-dot-airport" aria-hidden="true">
                    {selectedSpace.name.includes('Desi') ? '🐮' : selectedSpace.name.includes('Bhai') ? '🧱' : '🍗'}
                  </span>
                )}
                <h2 id="prop-modal-title" className="dialog-title-text">
                  {selectedSpace.type === 'airport'
                    ? `${selectedSpace.name.replace(/\s*airport\s*/i, '').trim()} Airport`
                    : selectedSpace.name}
                </h2>
                {isSpectator && (
                  <span className="prop-spectator-chip">
                    <EyeIcon size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Spectating
                  </span>
                )}
              </div>
              <button
                type="button"
                className="dialog-close-btn"
                onClick={() => setSelectedSpaceId(null)}
                aria-label="Close property details"
              >
                ✕
              </button>
            </div>

            <div className="prop-detail-stats-grid">
              <div className="prop-stat-box">
                <span className="stat-label">Purchase Price</span>
                <span className="stat-val font-mono">${selectedSpace.price ?? 0}</span>
              </div>

              <div className="prop-stat-box">
                <span className="stat-label">Ownership</span>
                <span className="stat-val" style={selectedOwner ? { color: selectedOwner.color } : {}}>
                  {selectedOwner ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <PlayerCharacter color={selectedOwner.color} size={16} />
                      {selectedOwner.nickname} {selectedPropRecord?.isMortgaged ? '(Mortgaged)' : ''}
                    </span>
                  ) : (
                    'Unowned'
                  )}
                </span>
              </div>
            </div>

            {selectedSpace.rentTiers && (
              <div className="prop-rent-schedule-card">
                <div className="rent-schedule-header">Rent Schedule</div>
                <div className="rent-tiers-grid">
                  <div className="rent-tier-item">
                    <span>Base Rent:</span> <strong className="font-mono">${selectedSpace.rentTiers[0]}</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>With 1 House:</span> <strong className="font-mono">${selectedSpace.rentTiers[1]}</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>With 2 Houses:</span> <strong className="font-mono">${selectedSpace.rentTiers[2]}</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>With 3 Houses:</span> <strong className="font-mono">${selectedSpace.rentTiers[3]}</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>With 4 Houses:</span> <strong className="font-mono">${selectedSpace.rentTiers[4]}</strong>
                  </div>
                  <div className="rent-tier-item rent-tier-hotel">
                    <span>With Hotel:</span> <strong className="font-mono">${selectedSpace.rentTiers[5]}</strong>
                  </div>
                </div>
                {selectedSpace.houseCost && (
                  <div className="house-cost-note">
                    Improvement Cost: ${selectedSpace.houseCost} per House / Hotel
                  </div>
                )}
              </div>
            )}

            {selectedSpace.type === 'airport' && (
              <div className="prop-rent-schedule-card">
                <div className="rent-schedule-header">✈️ Airport Transit Rent</div>
                <div className="rent-tiers-grid">
                  <div className="rent-tier-item">
                    <span>1 Airport Owned:</span> <strong className="font-mono">$25</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>2 Airports Owned:</span> <strong className="font-mono">$50</strong>
                  </div>
                  <div className="rent-tier-item">
                    <span>3 Airports Owned:</span> <strong className="font-mono">$100</strong>
                  </div>
                  <div className="rent-tier-item rent-tier-hotel">
                    <span>All 4 Airports Owned:</span> <strong className="font-mono">$200</strong>
                  </div>
                </div>
              </div>
            )}

            {selectedSpace.type === 'utility' && (
              <div className="prop-rent-schedule-card">
                <div className="rent-schedule-header">
                  {selectedSpace.name.includes('Desi') ? '🐮' : selectedSpace.name.includes('Bhai') ? '🧱' : '🍗'} Utility Rent Multiplier
                </div>
                <div className="rent-tiers-grid">
                  <div className="rent-tier-item">
                    <span>1 Utility Owned:</span> <strong className="font-mono">4× Dice Roll</strong>
                  </div>
                  <div className="rent-tier-item rent-tier-hotel">
                    <span>2+ Utilities Owned:</span> <strong className="font-mono">10× Dice Roll</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Management actions for owner */}
            {isSelectedOwnedByMe && isGameStarted && !isGameFinished && (
              <div className="prop-management-actions-group">
                {/* Mortgage / Unmortgage */}
                {!selectedPropRecord?.isMortgaged ? (
                  <button
                    type="button"
                    className="btn-secondary-action btn-manage-action"
                    disabled={(selectedPropRecord?.houses ?? 0) > 0}
                    onClick={() => onMortgageProperty(selectedSpace.id)}
                  >
                    <span>Mortgage Property</span>
                    <span className="font-mono">+${Math.floor((selectedSpace.price ?? 0) / 2)}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary-action btn-manage-action"
                    disabled={(myPlayerState?.cash ?? 0) < Math.ceil(((selectedSpace.price ?? 0) / 2) * 1.1)}
                    onClick={() => onUnmortgageProperty(selectedSpace.id)}
                  >
                    <span>Unmortgage Property</span>
                    <span className="font-mono">-${Math.ceil(((selectedSpace.price ?? 0) / 2) * 1.1)}</span>
                  </button>
                )}

                {/* Build House */}
                {selectedSpace.group && (
                  <div className="build-sell-buttons-row">
                    <button
                      type="button"
                      className="btn-primary-action btn-manage-action"
                      disabled={!canBuildOnSelected}
                      onClick={() => onBuildHouse(selectedSpace.id)}
                    >
                      <span>
                        Build {((selectedPropRecord?.houses ?? 0) === 4) ? 'Hotel' : 'House'}
                      </span>
                      <span className="font-mono">-${selectedSpace.houseCost ?? 0}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-secondary-action btn-manage-action"
                      disabled={!canSellOnSelected}
                      onClick={() => onSellHouse(selectedSpace.id)}
                    >
                      <span>
                        Sell {((selectedPropRecord?.houses ?? 0) === 5) ? 'Hotel' : 'House'}
                      </span>
                      <span className="font-mono">+${Math.floor((selectedSpace.houseCost ?? 0) / 2)}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade Proposal Modal */}
      {isTradeModalOpen && (
        <div
          className="modal-backdrop-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trade-modal-title"
          onClick={() => setIsTradeModalOpen(false)}
        >
          <div className="dialog-card-surface trade-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header-row">
              <h2 id="trade-modal-title" className="dialog-title-text">
                Propose Trade
              </h2>
              <button
                type="button"
                className="dialog-close-btn"
                onClick={() => setIsTradeModalOpen(false)}
                aria-label="Close trade modal"
              >
                ✕
              </button>
            </div>

            <div className="trade-form-content">
              <div className="trade-partner-select-box">
                <label htmlFor="trade-partner-select" className="input-field-label">
                  Select Trade Partner:
                </label>
                <select
                  id="trade-partner-select"
                  className="styled-select-input"
                  value={tradeTargetPlayerId}
                  onChange={(e) => setTradeTargetPlayerId(e.target.value)}
                >
                  <option value="">-- Choose Opponent --</option>
                  {otherPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname} (${gameState?.players[p.id]?.cash ?? 0})
                    </option>
                  ))}
                </select>
              </div>

              <div className="trade-columns-split">
                {/* Your Offer Column */}
                <div className="trade-offer-column">
                  <div className="trade-col-title">You Offer</div>
                  <div className="trade-cash-input-box">
                    <label htmlFor="input-trade-offered-cash" className="trade-field-sub">Cash ($):</label>
                    <input
                      id="input-trade-offered-cash"
                      type="number"
                      className="styled-text-input"
                      min={0}
                      max={myPlayerState?.cash ?? 0}
                      value={tradeOfferedCash}
                      onChange={(e) => setTradeOfferedCash(Math.max(0, Number(e.target.value)))}
                    />
                  </div>

                  <div className="trade-properties-box">
                    <div className="trade-field-sub">Properties:</div>
                    <div className="trade-props-badges-list">
                      {BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === currentSessionId).length === 0 ? (
                        <span className="no-props-note">No owned properties</span>
                      ) : (
                        BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === currentSessionId).map((s) => {
                          const isSelected = tradeOfferedProps.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`trade-prop-pill ${isSelected ? 'pill-selected' : ''}`}
                              onClick={() => {
                                setTradeOfferedProps(
                                  isSelected
                                    ? tradeOfferedProps.filter((id) => id !== s.id)
                                    : [...tradeOfferedProps, s.id]
                                );
                              }}
                            >
                              {s.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Requested Column */}
                <div className="trade-offer-column">
                  <div className="trade-col-title">You Request</div>
                  <div className="trade-cash-input-box">
                    <label htmlFor="input-trade-requested-cash" className="trade-field-sub">Cash ($):</label>
                    <input
                      id="input-trade-requested-cash"
                      type="number"
                      className="styled-text-input"
                      min={0}
                      value={tradeRequestedCash}
                      onChange={(e) => setTradeRequestedCash(Math.max(0, Number(e.target.value)))}
                    />
                  </div>

                  <div className="trade-properties-box">
                    <div className="trade-field-sub">Properties:</div>
                    <div className="trade-props-badges-list">
                      {!tradeTargetPlayerId ||
                      BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === tradeTargetPlayerId).length === 0 ? (
                        <span className="no-props-note">No partner properties</span>
                      ) : (
                        BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === tradeTargetPlayerId).map((s) => {
                          const isSelected = tradeRequestedProps.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`trade-prop-pill ${isSelected ? 'pill-selected' : ''}`}
                              onClick={() => {
                                setTradeRequestedProps(
                                  isSelected
                                    ? tradeRequestedProps.filter((id) => id !== s.id)
                                    : [...tradeRequestedProps, s.id]
                                );
                              }}
                            >
                              {s.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="dialog-btn-row">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setIsTradeModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary-action"
                  disabled={
                    !tradeTargetPlayerId ||
                    (tradeOfferedCash === 0 &&
                      tradeRequestedCash === 0 &&
                      tradeOfferedProps.length === 0 &&
                      tradeRequestedProps.length === 0)
                  }
                  onClick={() => {
                    onCreateTrade({
                      receiverId: tradeTargetPlayerId,
                      offeredCash: tradeOfferedCash,
                      offeredPropertyIds: tradeOfferedProps,
                      requestedCash: tradeRequestedCash,
                      requestedPropertyIds: tradeRequestedProps,
                    });
                    setIsTradeModalOpen(false);
                  }}
                >
                  Send Trade Proposal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
