import { useState, useEffect, useRef } from 'react';
import {
  BOARD_SPACES,
  PROPERTY_GROUP_COLORS,
  getSpaceBadge,
  type BoardSpace,
} from '../boardData';
import { getBoardSpace, getGroupSpaces, hasColorMonopoly } from '@charchokkha/game-engine';
import { type Player, type PropertyRecord, type RoomSnapshot } from '@charchokkha/shared';
import { soundManager } from '../audio/soundManager';
import { calculateStepPath, prefersReducedMotion } from '../utils/tokenMovement';

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
  const [isDiceAnimating, setIsDiceAnimating] = useState(false);
  const [recentEventAlert, setRecentEventAlert] = useState<{
    id: string;
    text: string;
    type: 'purchase' | 'rent' | 'prison' | 'auction' | 'trade' | 'victory';
  } | null>(null);

  const prevRollKeyRef = useRef<string>('');
  const prevActionMsgRef = useRef<string>('');
  const prevActivePlayerRef = useRef<string | undefined>(activePlayerId);
  const movementIntervalsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const isInitialMountRef = useRef<boolean>(true);
  const alertTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize displayed positions and trigger step animations
  useEffect(() => {
    // 1. Initial setup or reconnection / room reset: directly set server positions without historical replay
    if (isInitialMountRef.current || roomSnapshot.sequenceNumber <= 1) {
      const initialMap: Record<string, number> = {};
      roomSnapshot.players.forEach((p) => {
        initialMap[p.id] = gameState?.players[p.id]?.position ?? 0;
      });
      setDisplayedPositions(initialMap);
      isInitialMountRef.current = false;
      prevActivePlayerRef.current = activePlayerId;
      if (gameState?.lastDiceRoll) {
        prevRollKeyRef.current = `${gameState.lastDiceRoll.die1}_${gameState.lastDiceRoll.die2}_${gameState.lastDiceRoll.total}_${roomSnapshot.sequenceNumber}`;
      }
      return;
    }

    // 2. Animate dice when a new authoritative dice roll arrives
    if (gameState?.lastDiceRoll) {
      const rollKey = `${gameState.lastDiceRoll.die1}_${gameState.lastDiceRoll.die2}_${gameState.lastDiceRoll.total}_${roomSnapshot.sequenceNumber}`;
      if (rollKey !== prevRollKeyRef.current && isGameStarted) {
        prevRollKeyRef.current = rollKey;
        soundManager.playDiceRoll();
        if (!prefersReducedMotion()) {
          setIsDiceAnimating(true);
          const diceTimer = setTimeout(() => setIsDiceAnimating(false), 450);
          return () => clearTimeout(diceTimer);
        }
      }
    }

    // 3. Tile-by-tile token stepping for each seated player
    const reduced = prefersReducedMotion();
    roomSnapshot.players.forEach((p) => {
      const targetPos = gameState?.players[p.id]?.position ?? 0;
      const currentPos = displayedPositions[p.id] ?? targetPos;

      if (targetPos === currentPos) return;

      // Clear any prior active movement timer for this player
      if (movementIntervalsRef.current[p.id]) {
        clearInterval(movementIntervalsRef.current[p.id]);
        delete movementIntervalsRef.current[p.id];
      }

      if (reduced) {
        // Immediate jump if reduced motion is requested
        setDisplayedPositions((prev) => ({ ...prev, [p.id]: targetPos }));
        return;
      }

      const path = calculateStepPath(currentPos, targetPos);
      if (path.length === 0) {
        setDisplayedPositions((prev) => ({ ...prev, [p.id]: targetPos }));
        return;
      }

      // If direct transfer (e.g. Go to Prison direct jump)
      if (path.length === 1) {
        setDisplayedPositions((prev) => ({ ...prev, [p.id]: targetPos }));
        if (targetPos === 10) {
          soundManager.playGoToPrison();
        }
        return;
      }

      // Step along the path tile-by-tile
      let stepIndex = 0;
      const stepInterval = setInterval(() => {
        if (stepIndex < path.length) {
          const nextTile = path[stepIndex];
          setDisplayedPositions((prev) => ({ ...prev, [p.id]: nextTile }));
          soundManager.playStepHop();
          stepIndex++;
        } else {
          clearInterval(stepInterval);
          delete movementIntervalsRef.current[p.id];
          setDisplayedPositions((prev) => ({ ...prev, [p.id]: targetPos }));
        }
      }, 105);

      movementIntervalsRef.current[p.id] = stepInterval;
    });

    return () => {
      Object.values(movementIntervalsRef.current).forEach(clearInterval);
      movementIntervalsRef.current = {};
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
        eventType = 'purchase';
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

  // 11x11 Grid mapping for 40 perimeter spaces
  const getSpaceGridCoords = (
    id: number
  ): { gridRow: number; gridColumn: number; edge: 'top' | 'right' | 'bottom' | 'left' | 'corner' } => {
    if (id === 0) return { gridRow: 1, gridColumn: 1, edge: 'corner' };
    if (id >= 1 && id <= 9) return { gridRow: 1, gridColumn: id + 1, edge: 'top' };
    if (id === 10) return { gridRow: 1, gridColumn: 11, edge: 'corner' };
    if (id >= 11 && id <= 19) return { gridRow: id - 9, gridColumn: 11, edge: 'right' };
    if (id === 20) return { gridRow: 11, gridColumn: 11, edge: 'corner' };
    if (id >= 21 && id <= 29) return { gridRow: 11, gridColumn: 31 - id, edge: 'bottom' };
    if (id === 30) return { gridRow: 11, gridColumn: 1, edge: 'corner' };
    return { gridRow: 41 - id, gridColumn: 1, edge: 'left' };
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

  return (
    <div className="board-outer-wrapper">
      <div className="board-grid-tabletop" role="region" aria-label="Game Board">
        {/* Render 40 Canonical Spaces */}
        {BOARD_SPACES.map((space) => {
          const coords = getSpaceGridCoords(space.id);
          const isCorner = coords.edge === 'corner';
          const groupColor = space.group ? PROPERTY_GROUP_COLORS[space.group] : undefined;
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
            if (space.id === 10) {
              cornerIcon = '⛓️';
              cornerModifier = 'corner-prison';
            } else if (space.id === 20) {
              cornerIcon = '🌴';
              cornerModifier = 'corner-vacation';
            } else if (space.id === 30) {
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
                aria-label={`${space.name} (${space.subtext || ''})`}
                onClick={() => setSelectedSpaceId(space.id)}
              >
                <div className="corner-content-box">
                  <span className="corner-icon-symbol" aria-hidden="true">{cornerIcon}</span>
                  <span className="corner-primary-label">{space.name}</span>
                  <span className="corner-sub-caption">{space.subtext}</span>
                </div>

                {tokensOnTile.length > 0 && (
                  <div className="tile-tokens-cluster">
                    {tokensOnTile.map((p) => (
                      <div
                        key={p.id}
                        className={`player-board-token ${p.id === currentSessionId ? 'token-is-me' : ''}`}
                        title={`${p.nickname} ($${p.cash})`}
                        aria-label={`${p.nickname} token`}
                      >
                        {p.avatar}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // Inward-facing color bar placement:
          // Top edge: color bar on bottom
          // Right edge: color bar on left
          // Bottom edge: color bar on top
          // Left edge: color bar on right
          const inwardPositionClass = `inward-edge-${coords.edge}`;

          return (
            <div
              key={space.id}
              id={`space-${space.id}`}
              className={`board-tile tile-edge ${inwardPositionClass} ${propRecord?.isMortgaged ? 'tile-is-mortgaged' : ''}`}
              style={{ gridRow: coords.gridRow, gridColumn: coords.gridColumn }}
              tabIndex={0}
              role="button"
              aria-label={`${space.name}, Price: $${space.price ?? 0}`}
              onClick={() => setSelectedSpaceId(space.id)}
            >
              {/* Inward-facing color strip */}
              {groupColor && (
                <div
                  className="tile-color-strip"
                  style={{ backgroundColor: groupColor }}
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
                <span className="tile-category-badge" title={badge.label} aria-hidden="true">
                  {badge.symbol}
                </span>

                <span className="tile-title-text">{space.name}</span>

                {space.price != null ? (
                  <span className="tile-price-tag">${space.price}</span>
                ) : (
                  space.subtext && <span className="tile-subtext-tag">{space.subtext}</span>
                )}
              </div>

              {/* Owner Chip */}
              {ownerPlayer && (
                <div
                  className="tile-ownership-chip"
                  title={`Owned by ${ownerPlayer.nickname}`}
                >
                  <span className="owner-crown-icon" aria-hidden="true">👑</span>
                  <span className="owner-name-abbr">{ownerPlayer.nickname.slice(0, 4)}</span>
                </div>
              )}

              {/* Player Tokens Cluster */}
              {tokensOnTile.length > 0 && (
                <div className="tile-tokens-cluster">
                  {tokensOnTile.map((p) => (
                    <div
                      key={p.id}
                      className={`player-board-token ${p.id === currentSessionId ? 'token-is-me' : ''}`}
                      title={`${p.nickname} ($${p.cash})`}
                      aria-label={`${p.nickname} token`}
                    >
                      {p.avatar}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

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
                    disabled={(myPlayerState?.cash ?? 0) < (gameState.auction?.currentBid ?? 0) + 10}
                  >
                    Bid ${(gameState.auction?.currentBid ?? 0) + 10}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary-action btn-pass-action"
                    onClick={onAuctionPass}
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
              <span className="event-pill-text">{recentEventAlert.text}</span>
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
              turnPhase === 'need_roll' ? (
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
                  disabled={otherPlayers.length === 0}
                >
                  <span>🤝 Trade</span>
                </button>

                {myPlayerState && !myPlayerState.isBankrupt && (
                  <button
                    type="button"
                    id="btn-declare-bankruptcy"
                    className="btn-danger-action btn-utility-action"
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

          {/* Action Log Message Ticker */}
          {gameState?.lastActionMessage && (
            <div className="courtyard-action-ticker" aria-live="polite">
              <span className="ticker-dot" aria-hidden="true">•</span>
              <span className="ticker-text">{gameState.lastActionMessage}</span>
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
                {selectedSpace.group && (
                  <span
                    className="prop-group-dot"
                    style={{ backgroundColor: PROPERTY_GROUP_COLORS[selectedSpace.group] }}
                    aria-hidden="true"
                  />
                )}
                <h2 id="prop-modal-title" className="dialog-title-text">
                  {selectedSpace.name}
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
                <span className="stat-val">
                  {selectedPropRecord
                    ? `${roomSnapshot.players.find((p) => p.id === selectedPropRecord.ownerId)?.nickname ?? 'Player'} ${
                        selectedPropRecord.isMortgaged ? '(Mortgaged)' : ''
                      }`
                    : 'Unowned'}
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
