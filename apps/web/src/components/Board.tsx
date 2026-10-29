import { useState, useEffect, useRef } from 'react';
import {
  BOARD_SPACES,
  getSpaceBadge,
  type BoardSpace,
} from '../boardData';
import { getBoardSpace, getGroupSpaces, hasColorMonopoly } from '@charchokkha/game-engine';
import { type Player, type PropertyRecord, type RoomSnapshot } from '@charchokkha/shared';
import { soundManager } from '../audio/soundManager';
import { PlayerCharacter } from './PlayerCharacter';
import { calculateStepPath, prefersReducedMotion } from '../utils/tokenMovement';

/**
 * Concise event message formatter for the central courtyard notification banner and ticker.
 * Transforms verbose engine action logs into compact, professional game telemetry strings.
 */
export function formatEventMessage(msg: string): string {
  if (!msg) return '';

  // Purchase: "Purchased Chattogram for $200"
  const buyMatch = msg.match(/Purchased\s+(.+?)\s+for\s+\$(\d+)/i);
  if (buyMatch) {
    return `${buyMatch[1]} · Bought for $${buyMatch[2]}`;
  }

  // Rent: "Player landed on Saint Martin. Owned by p2. Paid $50 rent." or "Paid $50 to Bob for rent on Saint Martin"
  const rentMatch =
    msg.match(/landed on\s+(.+?)\..*?Paid\s+\$(\d+)\s+rent/i) ||
    msg.match(/Paid\s+\$(\d+)\s+(?:to\s+.+?\s+)?for rent on\s+(.+)/i);
  if (rentMatch) {
    const isFirstNum = !isNaN(Number(rentMatch[1]));
    const prop = isFirstNum ? rentMatch[2] : rentMatch[1];
    const amount = isFirstNum ? rentMatch[1] : rentMatch[2];
    return `${prop} · Rent paid $${amount}`;
  }

  // Tax: "Player landed on Earnings Tax. Paid $100 in tax." or "Paid $100 for Earnings Tax"
  const taxMatch =
    msg.match(/landed on\s+(.+?)\..*?Paid\s+\$(\d+)\s+in tax/i) ||
    msg.match(/Paid\s+\$(\d+)\s+(?:for|in)\s+(.+?)(?:\.|$)/i);
  if (taxMatch) {
    const isFirstNum = !isNaN(Number(taxMatch[1]));
    const taxName = isFirstNum ? taxMatch[2] : taxMatch[1];
    const amount = isFirstNum ? taxMatch[1] : taxMatch[2];
    return `${taxName} · Paid $${amount}`;
  }

  // Vacation pot: "Collected $150 from Vacation cash pot!"
  const vacMatch = msg.match(/Collected\s+\$(\d+)\s+from Vacation/i);
  if (vacMatch) {
    return `Vacation Pot · +$${vacMatch[1]}`;
  }

  // Rehab / Prison
  if (msg.includes('Rolled double') && msg.includes('Freed from prison')) {
    return 'Freed from Prison (Doubles!)';
  }
  if (msg.includes('fine to leave prison') || msg.includes('freed from prison')) {
    return 'Paid $50 Fine · Freed';
  }
  if (msg.includes('Arrested') || msg.includes('In Prison') || msg.includes('Rehab')) {
    return 'Rehab Center · Arrested';
  }

  // Auction ended
  const auctionMatch = msg.match(/Auction for\s+(.+?)\s+ended!\s+(.+?)\s+won with\s+\$(\d+)/i);
  if (auctionMatch) {
    return `Auction: ${auctionMatch[1]} · ${auctionMatch[2]} ($${auctionMatch[3]})`;
  }

  // Trade completed
  if (msg.includes('Trade completed')) {
    return 'Trade Completed ✓';
  }

  // Salary
  const goMatch = msg.match(/Collected\s+\$(\d+)\s+salary/i);
  if (goMatch) {
    return `START · +$${goMatch[1]}`;
  }

  // Declined property
  const declineMatch = msg.match(/chose not to buy\s+(.+?)(?:\.|$)/i);
  if (declineMatch) {
    return `${declineMatch[1]} · Declined`;
  }

  // Default cleanup: strip "Player landed on "
  const cleaned = msg.replace(/^Player landed on\s+/i, '').trim();
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
          }, 320);
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
            <span className="corner-primary-label">{space.name}</span>
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
    const tileDisplayName = isAirport
      ? space.name.replace(/\s*airport\s*/i, '').trim()
      : space.name;

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
              <span className="victory-trophy-icon" aria-hidden="true">🏆</span>
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
                    View Standings & Stats 🏆
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Turn Status Banner */}
          {isGameStarted && !isGameFinished && (
            <div className="courtyard-turn-status-bar">
              {isSpectator ? (
                <span className="turn-indicator-badge turn-badge-spectator">
                  <span className="spectator-eye-icon" aria-hidden="true">👁️</span>
                  <span>Spectating — {activePlayer?.nickname ?? 'Player'}&apos;s turn</span>
                </span>
              ) : isMyTurn ? (
                <span className="turn-indicator-badge turn-badge-mine">
                  <span className="pulsing-turn-dot" aria-hidden="true" />
                  <span>🎯 YOUR TURN</span>
                </span>
              ) : (
                <span className="turn-indicator-badge turn-badge-waiting">
                  <span>⏳</span>
                  <span>{activePlayer?.nickname ?? 'Player'}&apos;s turn</span>
                </span>
              )}
            </div>
          )}

          {/* Vacation Pot Indicator */}
          {roomSnapshot.settings.vacationCash && isGameStarted && !isGameFinished && (
            <div className="courtyard-vacation-pot-pill" title="Vacation Cash Pot">
              <span aria-hidden="true">🌴</span>
              <span>Vacation Pot: <strong>${gameState?.vacationPot ?? 0}</strong></span>
            </div>
          )}

          {/* In Prison Status Notice */}
          {!isSpectator && myPlayerState?.inPrison && isMyTurn && !isGameFinished && (
            <div className="courtyard-prison-banner" role="alert">
              <span>⛓️ In Prison (Turn attempt {myPlayerState.prisonTurns}/3)</span>
            </div>
          )}

          {/* Active Auction Card Banner */}
          {gameState?.auction && (
            <div className="courtyard-auction-card" role="region" aria-label="Active Auction">
              <div className="auction-card-header">
                <span className="auction-gavel-icon" aria-hidden="true">🔨</span>
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
                  👁️ Spectating Auction (Read-Only)
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

          {/* Tactile 3D Dice Pair Stage */}
          <div
            className={`courtyard-dice-stage ${!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'dice-clickable' : ''}`}
            onClick={!isSpectator && isMyTurn && turnPhase === 'need_roll' && !isRolling ? onRollDice : undefined}
            title={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'Click to roll dice' : undefined}
            role={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 'button' : undefined}
            aria-label="Roll dice pair"
            tabIndex={!isSpectator && isMyTurn && turnPhase === 'need_roll' ? 0 : -1}
          >
            <div className={`tactile-dice-cube ${isRolling || isDiceAnimating ? 'rolling-wobble' : ''}`}>
              {renderDiePips(dice.die1)}
            </div>
            <div className={`tactile-dice-cube ${isRolling || isDiceAnimating ? 'rolling-wobble' : ''}`}>
              {renderDiePips(dice.die2)}
            </div>
          </div>

          {/* Interactive Event Feedback Pill */}
          {recentEventAlert && (
            <div
              className={`courtyard-event-feedback-pill event-pill-${recentEventAlert.type}`}
              role="status"
              aria-live="polite"
            >
              <span className="event-pill-text">{formatEventMessage(recentEventAlert.text)}</span>
            </div>
          )}

          {/* Contextual Action Buttons */}
          <div className="courtyard-action-controls">
            {isSpectator ? (
              <div className="spectator-controls-card" role="status">
                <span className="spectator-eye-large" aria-hidden="true">👁️</span>
                <span className="spectator-controls-text">
                  {!isGameStarted
                    ? 'Spectating Table — Waiting for host to start match'
                    : isGameFinished
                    ? 'Match Finished — Spectating complete'
                    : `Spectating Table — ${activePlayer?.nickname ?? 'Player'}'s turn`}
                </span>
              </div>
            ) : !isGameStarted ? (
              isHost ? (
                <>
                  <button
                    id="btn-start-game"
                    type="button"
                    className="btn-primary-action btn-start-game-large"
                    onClick={onStartGame}
                    disabled={roomSnapshot.players.length < 2 || isSubmittingAction}
                  >
                    <span>▶ Start Game</span>
                  </button>
                  {roomSnapshot.players.length < 2 && (
                    <span className="action-helper-warning">
                      Waiting for at least 2 players to start
                    </span>
                  )}
                </>
              ) : (
                <button type="button" className="btn-secondary-action btn-waiting-lock" disabled>
                  Waiting for host to start...
                </button>
              )
            ) : isGameFinished ? (
              <button
                type="button"
                className="btn-primary-action btn-view-results-action"
                onClick={onShowResults}
              >
                View Match Results 🏆
              </button>
            ) : isMyTurn ? (
              isTokenMoving || isDiceAnimating ? (
                <div className="landing-decision-card token-moving-stage-card" role="status" aria-live="polite">
                  <div className="decision-prop-info">
                    <span className="decision-title">
                      {isDiceAnimating ? 'Rolling dice...' : 'Advancing to space...'}
                    </span>
                    <span className="decision-cost">
                      {gameState?.lastDiceRoll
                        ? `Rolled ${gameState.lastDiceRoll.total} (${gameState.lastDiceRoll.die1} + ${gameState.lastDiceRoll.die2})`
                        : 'Moving...'}
                    </span>
                  </div>
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
                      🔓 Pay $50 Fine & Exit
                    </button>
                  )}
                  <button
                    id="btn-roll-dice"
                    type="button"
                    className="btn-primary-action btn-roll-prominent"
                    onClick={onRollDice}
                    disabled={isRolling || isSubmittingAction}
                  >
                    <span>🎲</span>
                    <span>
                      {isRolling
                        ? 'Rolling...'
                        : myPlayerState?.inPrison
                        ? 'Roll for Doubles'
                        : 'Roll Dice'}
                    </span>
                  </button>
                </>
              ) : turnPhase === 'action_pending' && currentLandingSpace ? (
                <div className="landing-decision-card">
                  <div className="decision-prop-info">
                    <span className="decision-title">Landed on {currentLandingSpace.name}</span>
                    <span className="decision-cost">Cost: ${currentLandingSpace.price}</span>
                  </div>

                  <div className="decision-btn-row">
                    <button
                      id="btn-buy-property"
                      type="button"
                      className="btn-primary-action btn-buy-btn"
                      onClick={onBuyProperty}
                      disabled={!canAffordCurrentSpace || isSubmittingAction}
                    >
                      Buy for ${currentLandingSpace.price}
                    </button>
                    <button
                      id="btn-decline-property"
                      type="button"
                      className="btn-secondary-action btn-decline-btn"
                      onClick={onDeclineProperty}
                      disabled={isSubmittingAction}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ) : turnPhase === 'in_auction' ? (
                <span className="auction-in-progress-note">Auction in progress...</span>
              ) : (
                <button
                  id="btn-end-turn"
                  type="button"
                  className="btn-primary-action btn-end-turn-action"
                  onClick={onEndTurn}
                  disabled={isSubmittingAction}
                >
                  <span>End Turn ⏭</span>
                </button>
              )
            ) : (
              <div className="waiting-turn-status-card">
                <span>Waiting for {activePlayer?.nickname ?? 'opponent'}...</span>
              </div>
            )}

            {/* In-Game Utility Buttons: Trade & Bankruptcy */}
            {!isSpectator && isGameStarted && !isGameFinished && (
              <div className="courtyard-sub-actions-row">
                <button
                  type="button"
                  id="btn-open-trade"
                  className="btn-secondary-action btn-utility-action"
                  onClick={() => setIsTradeModalOpen(true)}
                  disabled={otherPlayers.length === 0 || isTokenMoving || isSubmittingAction}
                >
                  <span>🤝 Trade</span>
                </button>

                {myPlayerState && !myPlayerState.isBankrupt && (
                  <button
                    type="button"
                    id="btn-declare-bankruptcy"
                    className="btn-danger-action btn-utility-action"
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
                  >
                    <span>🏳️ Bankrupt</span>
                  </button>
                )}
              </div>
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
                  Accept ✅
                </button>
                <button
                  type="button"
                  className="btn-secondary-action btn-reject-trade"
                  onClick={onRejectTrade}
                >
                  Decline ✕
                </button>
              </div>
            </div>
          )}

          {/* Action Log Message Ticker (suppress duplicate purchase message, and avoid displaying when recentEventAlert is active) */}
          {!recentEventAlert && gameState?.lastActionMessage && !gameState.lastActionMessage.startsWith('Purchased') && !gameState.lastActionMessage.includes('Available to buy') && (
            <div className="courtyard-action-ticker" aria-live="polite">
              <span className="ticker-dot" aria-hidden="true">•</span>
              <span className="ticker-text">{formatEventMessage(gameState.lastActionMessage)}</span>
            </div>
          )}

          <div className="courtyard-room-tag">Table {roomCode}</div>
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
                  <span className="prop-spectator-chip">👁️ Spectating</span>
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
