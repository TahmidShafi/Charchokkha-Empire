import { useState } from 'react';
import {
  BOARD_SPACES,
  PROPERTY_GROUP_COLORS,
} from '../boardData';
import { getBoardSpace, getGroupSpaces, hasColorMonopoly } from '@charchokkha/game-engine';
import { type Player, type PropertyRecord, type RoomSnapshot } from '@charchokkha/shared';

export interface BoardProps {
  roomCode: string;
  roomSnapshot: RoomSnapshot;
  currentSessionId: string;
  isHost: boolean;
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
}

export function Board({
  roomCode,
  roomSnapshot,
  currentSessionId,
  isHost,
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
}: BoardProps) {
  const gameState = roomSnapshot.gameState;
  const isGameStarted = (roomSnapshot.state === 'in_progress' || roomSnapshot.state === 'finished') && !!gameState;
  const isGameFinished = roomSnapshot.state === 'finished' || gameState?.phase === 'finished';
  const activePlayerId = gameState?.activePlayerId;
  const isMyTurn = isGameStarted && activePlayerId === currentSessionId && !isGameFinished;
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

  // Player positions and details for token rendering
  const playersWithTokens = roomSnapshot.players.map((p: Player) => {
    const pState = gameState?.players[p.id];
    return {
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      position: pState ? pState.position : 0,
      cash: pState ? pState.cash : roomSnapshot.settings.startingCash,
      isBankrupt: pState ? pState.isBankrupt : false,
      inPrison: pState ? pState.inPrison : false,
      isCurrent: p.id === currentSessionId,
    };
  });

  const dice = gameState?.lastDiceRoll ?? { die1: 3, die2: 4, total: 7, isDouble: false };

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

  // Space grid coordinates
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
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '2 / 2' }} />);
    } else if (val === 2) {
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="dice-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 3) {
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="dice-pip" style={{ gridArea: '2 / 2' }} />);
      pips.push(<span key="3" className="dice-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 4) {
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="dice-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="3" className="dice-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="4" className="dice-pip" style={{ gridArea: '3 / 3' }} />);
    } else if (val === 5) {
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="dice-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="3" className="dice-pip" style={{ gridArea: '2 / 2' }} />);
      pips.push(<span key="4" className="dice-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="5" className="dice-pip" style={{ gridArea: '3 / 3' }} />);
    } else {
      pips.push(<span key="1" className="dice-pip" style={{ gridArea: '1 / 1' }} />);
      pips.push(<span key="2" className="dice-pip" style={{ gridArea: '2 / 1' }} />);
      pips.push(<span key="3" className="dice-pip" style={{ gridArea: '3 / 1' }} />);
      pips.push(<span key="4" className="dice-pip" style={{ gridArea: '1 / 3' }} />);
      pips.push(<span key="5" className="dice-pip" style={{ gridArea: '2 / 3' }} />);
      pips.push(<span key="6" className="dice-pip" style={{ gridArea: '3 / 3' }} />);
    }
    return pips;
  };

  const selectedSpace = selectedSpaceId != null ? getBoardSpace(selectedSpaceId) : null;
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
    <div className="board-outer-frame">
      <div className="board-grid-11">
        {/* Render 40 Spaces */}
        {BOARD_SPACES.map((space) => {
          const coords = getSpaceGridCoords(space.id);
          const isCorner = coords.edge === 'corner';
          const groupColor = space.group ? PROPERTY_GROUP_COLORS[space.group] : undefined;
          const tokensOnTile = playersWithTokens.filter((p) => p.position === space.id);

          const propRecord = getPropertyInfo(space.id);
          const ownerPlayer = propRecord
            ? roomSnapshot.players.find((p: Player) => p.id === propRecord.ownerId)
            : undefined;

          // Corner presentation
          if (isCorner) {
            let cornerIcon = '🏠';
            let cornerClass = '';
            if (space.id === 0) {
              cornerIcon = '▶️';
              cornerClass = 'start-corner';
            } else if (space.id === 10) {
              cornerIcon = '⛓️';
            } else if (space.id === 20) {
              cornerIcon = '🌴';
            } else if (space.id === 30) {
              cornerIcon = '💀';
            }

            return (
              <div
                key={space.id}
                id={`space-${space.id}`}
                className="btile corner"
                style={{ gridRow: coords.gridRow, gridColumn: coords.gridColumn }}
              >
                <span style={{ fontSize: '1.25rem', marginBottom: '2px' }}>{cornerIcon}</span>
                <span className={`corner-label ${cornerClass}`}>{space.name}</span>
                <span className="corner-sub">{space.subtext}</span>

                {tokensOnTile.length > 0 && (
                  <div className="tile-token-spot">
                    {tokensOnTile.map((p) => (
                      <div
                        key={p.id}
                        className="player-token-avatar"
                        style={{
                          border: p.id === currentSessionId ? '2px solid #c084fc' : '2px solid #fff',
                        }}
                        title={`${p.nickname} ($${p.cash})`}
                      >
                        {p.avatar}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // Edge Tiles (Properties, Airports, Utilities, Taxes)
          return (
            <div
              key={space.id}
              id={`space-${space.id}`}
              className="btile"
              style={{ gridRow: coords.gridRow, gridColumn: coords.gridColumn, cursor: 'pointer' }}
              onClick={() => setSelectedSpaceId(space.id)}
            >
              {/* Color Bar on inner edge or top */}
              {groupColor && coords.edge !== 'top' && (
                <div className="tile-color-bar" style={{ backgroundColor: groupColor }} />
              )}

              {/* House / Hotel pips */}
              {propRecord && propRecord.houses > 0 && (
                <div className="tile-house-pips">
                  {propRecord.houses === 5 ? (
                    <span className="tile-hotel-pip">🏨</span>
                  ) : (
                    Array.from({ length: propRecord.houses }).map((_, i) => (
                      <span key={i} className="tile-house-pip" />
                    ))
                  )}
                </div>
              )}

              {/* Mortgaged Badge */}
              {propRecord && propRecord.isMortgaged && (
                <div className="tile-mortgaged-badge">MORTGAGED</div>
              )}

              <div className="tile-inner">
                <span className="tile-name">{space.name}</span>
                {space.price ? (
                  <span className="tile-price">{space.price}$</span>
                ) : (
                  space.subtext && <span className="tile-price">{space.subtext}</span>
                )}
              </div>

              {groupColor && coords.edge === 'top' && (
                <div
                  className="tile-color-bar"
                  style={{ backgroundColor: groupColor, marginTop: 'auto', marginBottom: 0 }}
                />
              )}

              {/* Ownership Badge */}
              {ownerPlayer && (
                <div
                  className="tile-owner-badge"
                  title={`Owned by ${ownerPlayer.nickname}`}
                >
                  <span>👑</span>
                  <span>{ownerPlayer.nickname.slice(0, 3)}</span>
                </div>
              )}

              {/* Player Tokens */}
              {tokensOnTile.length > 0 && (
                <div className="tile-token-spot">
                  {tokensOnTile.map((p) => (
                    <div
                      key={p.id}
                      className="player-token-avatar"
                      style={{
                        border: p.id === currentSessionId ? '2px solid #c084fc' : '2px solid #fff',
                      }}
                      title={`${p.nickname} ($${p.cash})`}
                    >
                      {p.avatar}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Center Courtyard */}
        <div className="board-inner-center">
          {/* Winner Celebration Banner */}
          {isGameFinished && (
            <div className="center-turn-banner" style={{ marginBottom: '1rem' }}>
              <div
                style={{
                  background: '#3b0764',
                  border: '2px solid #eab308',
                  padding: '0.6rem 1.2rem',
                  borderRadius: '12px',
                  color: '#fef08a',
                  fontWeight: 800,
                  fontSize: '1.1rem',
                  textAlign: 'center',
                  boxShadow: '0 0 20px rgba(234, 179, 8, 0.4)',
                }}
              >
                🏆 GAME OVER 🏆
                <div style={{ fontSize: '0.85rem', color: '#fff', marginTop: '4px' }}>
                  Winner: {winnerPlayer?.nickname ?? 'Champion'}!
                </div>
              </div>
            </div>
          )}

          {/* Turn indicator */}
          {isGameStarted && !isGameFinished && (
            <div className="center-turn-banner">
              {isMyTurn ? (
                <span className="turn-tag my-turn">🎯 Your Turn</span>
              ) : (
                <span className="turn-tag waiting-turn">
                  ⏳ {activePlayer?.nickname ?? 'Player'}&apos;s turn
                </span>
              )}
            </div>
          )}

          {/* Active Auction Card Banner */}
          {gameState?.auction && (
            <div className="auction-banner-card">
              <div className="auction-title">
                <span>🔨</span>
                <span>Auction: {getBoardSpace(gameState.auction.spaceId).name}</span>
              </div>
              <div className="auction-bid-text">
                Current Bid: ${gameState.auction.currentBid}
              </div>
              <div className="auction-bidder-text">
                {gameState.auction.highBidderId
                  ? `High Bidder: ${
                      roomSnapshot.players.find((p) => p.id === gameState.auction?.highBidderId)
                        ?.nickname ?? gameState.auction.highBidderId
                    }`
                  : 'No bids placed yet'}
              </div>

              {gameState.auction.activeBidders.includes(currentSessionId) ? (
                <div className="auction-btn-row">
                  <button
                    type="button"
                    className="btn-auction-bid"
                    onClick={() => onAuctionBid((gameState.auction?.currentBid ?? 0) + 10)}
                    disabled={(myPlayerState?.cash ?? 0) < (gameState.auction?.currentBid ?? 0) + 10}
                  >
                    Bid ${(gameState.auction?.currentBid ?? 0) + 10}
                  </button>
                  <button
                    type="button"
                    className="btn-auction-pass"
                    onClick={onAuctionPass}
                  >
                    Pass ✕
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  You passed this auction.
                </div>
              )}
            </div>
          )}

          {/* In Prison Status */}
          {myPlayerState?.inPrison && isMyTurn && !isGameFinished && (
            <div
              style={{
                background: '#451a03',
                border: '1px solid #d97706',
                borderRadius: '8px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.75rem',
                color: '#fef3c7',
                marginBottom: '0.5rem',
                textAlign: 'center',
              }}
            >
              ⛓️ You are In Prison (Attempt {myPlayerState.prisonTurns}/3)
            </div>
          )}

          {/* Authoritative 3D Dice Pair */}
          <div
            className="center-dice-group"
            onClick={isMyTurn && turnPhase === 'need_roll' && !isRolling ? onRollDice : undefined}
            title={isMyTurn && turnPhase === 'need_roll' ? 'Click to roll' : undefined}
            style={{ cursor: isMyTurn && turnPhase === 'need_roll' ? 'pointer' : 'default' }}
          >
            <div
              className="center-die"
              style={{ transform: isRolling ? 'rotate(180deg)' : 'rotate(-6deg)' }}
            >
              {renderDiePips(dice.die1)}
            </div>
            <div
              className="center-die"
              style={{ transform: isRolling ? 'rotate(-180deg)' : 'rotate(8deg)' }}
            >
              {renderDiePips(dice.die2)}
            </div>
          </div>

          {/* Action button controls */}
          <div className="center-action-buttons">
            {!isGameStarted ? (
              isHost ? (
                <>
                  <button
                    id="btn-start-game"
                    type="button"
                    className="btn-start-game"
                    onClick={onStartGame}
                    disabled={roomSnapshot.players.length < 2}
                  >
                    <span>▶</span> Start Game
                  </button>
                  {roomSnapshot.players.length < 2 && (
                    <span style={{ fontSize: '0.725rem', color: '#f87171', marginTop: '4px' }}>
                      Waiting for at least 2 players
                    </span>
                  )}
                </>
              ) : (
                <button type="button" className="btn-start-game btn-waiting" disabled>
                  Waiting for host to start...
                </button>
              )
            ) : isGameFinished ? (
              <button
                type="button"
                className="btn-start-game"
                onClick={() => window.location.reload()}
              >
                Return to Lobby
              </button>
            ) : isMyTurn ? (
              turnPhase === 'need_roll' ? (
                <>
                  {myPlayerState?.inPrison && (
                    <button
                      id="btn-pay-fine"
                      type="button"
                      className="btn-action-secondary"
                      style={{ width: '100%', marginBottom: '4px', borderColor: '#d97706', color: '#fef3c7' }}
                      onClick={onPayPrisonFine}
                      disabled={(myPlayerState?.cash ?? 0) < 50}
                    >
                      🔓 Pay $50 Fine & Exit
                    </button>
                  )}
                  <button
                    id="btn-roll-dice"
                    type="button"
                    className="btn-start-game"
                    onClick={onRollDice}
                    disabled={isRolling}
                  >
                    <span>🎲</span> {isRolling ? 'Rolling...' : myPlayerState?.inPrison ? 'Roll for Doubles' : 'Roll Dice'}
                  </button>
                </>
              ) : turnPhase === 'action_pending' ? (
                <>
                  <button
                    id="btn-buy-property"
                    type="button"
                    className="btn-start-game btn-buy"
                    onClick={onBuyProperty}
                    disabled={!canAffordCurrentSpace}
                  >
                    <span>🏢</span>{' '}
                    {canAffordCurrentSpace
                      ? `Buy ${currentLandingSpace?.name} ($${currentLandingSpace?.price})`
                      : `Can't Afford ($${currentLandingSpace?.price})`}
                  </button>
                  <button
                    id="btn-decline-property"
                    type="button"
                    className="btn-action-secondary"
                    onClick={onDeclineProperty}
                  >
                    🔨 Decline & Auction
                  </button>
                  <button
                    id="btn-end-turn"
                    type="button"
                    className="btn-action-secondary"
                    onClick={onEndTurn}
                  >
                    Skip & End Turn ➔
                  </button>
                </>
              ) : turnPhase === 'in_auction' ? (
                <span style={{ fontSize: '0.75rem', color: '#c4b5fd' }}>
                  Auction in progress...
                </span>
              ) : (
                <button
                  id="btn-end-turn"
                  type="button"
                  className="btn-start-game"
                  onClick={onEndTurn}
                >
                  <span>⏭</span> End Turn
                </button>
              )
            ) : (
              <button type="button" className="btn-start-game btn-waiting" disabled>
                Waiting for {activePlayer?.nickname ?? 'opponent'}...
              </button>
            )}

            {/* In-Game Utility Buttons: Trade & Bankruptcy */}
            {isGameStarted && !isGameFinished && (
              <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '6px' }}>
                <button
                  type="button"
                  id="btn-open-trade"
                  className="btn-action-secondary"
                  style={{ flex: 1, padding: '0.35rem' }}
                  onClick={() => setIsTradeModalOpen(true)}
                  disabled={otherPlayers.length === 0}
                >
                  🤝 Trade
                </button>
                {myPlayerState && !myPlayerState.isBankrupt && (
                  <button
                    type="button"
                    id="btn-declare-bankruptcy"
                    className="btn-action-secondary"
                    style={{ flex: 1, padding: '0.35rem', color: '#f87171', borderColor: '#7f1d1d' }}
                    onClick={() => {
                      if (window.confirm('Are you sure you want to declare bankruptcy? You will exit the match.')) {
                        onDeclareBankruptcy();
                      }
                    }}
                  >
                    🏳️ Bankrupt
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Pending Trade Notification Banner */}
          {gameState?.pendingTrade && gameState.pendingTrade.receiverId === currentSessionId && (
            <div
              style={{
                marginTop: '8px',
                background: '#1e1b4b',
                border: '1px solid #6366f1',
                borderRadius: '8px',
                padding: '0.5rem',
                fontSize: '0.75rem',
                color: '#e0e7ff',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                maxWidth: '250px',
                textAlign: 'center',
              }}
            >
              <div>
                <strong>Trade Offer:</strong> Received from{' '}
                {roomSnapshot.players.find((p) => p.id === gameState?.pendingTrade?.senderId)?.nickname ?? 'Player'}!
              </div>
              <div style={{ fontSize: '0.7rem', color: '#a5b4fc' }}>
                Offered: ${gameState.pendingTrade.offeredCash} + {gameState.pendingTrade.offeredPropertyIds.length} properties
              </div>
              <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                <button
                  type="button"
                  className="btn-auction-bid"
                  style={{ flex: 1, background: '#16a34a' }}
                  onClick={onAcceptTrade}
                >
                  Accept ✅
                </button>
                <button
                  type="button"
                  className="btn-auction-pass"
                  style={{ flex: 1 }}
                  onClick={onRejectTrade}
                >
                  Decline ✕
                </button>
              </div>
            </div>
          )}

          {/* Action Log Message */}
          {gameState?.lastActionMessage && (
            <div className="center-action-log">{gameState.lastActionMessage}</div>
          )}

          <div className="center-room-joined-tag">Joined room {roomCode}</div>
        </div>
      </div>

      {/* Property Inspection & Management Modal */}
      {selectedSpace && (
        <div className="modal-overlay" onClick={() => setSelectedSpaceId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {selectedSpace.group && (
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '3px',
                      backgroundColor: PROPERTY_GROUP_COLORS[selectedSpace.group],
                      display: 'inline-block',
                    }}
                  />
                )}
                <span>{selectedSpace.name}</span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedSpaceId(null)}
              >
                ✕
              </button>
            </div>

            <div className="prop-detail-row">
              <span>Price:</span>
              <span style={{ fontWeight: 700, color: '#fff' }}>${selectedSpace.price ?? 0}</span>
            </div>

            <div className="prop-detail-row">
              <span>Status:</span>
              <span style={{ fontWeight: 600, color: selectedPropRecord ? '#86efac' : '#94a3b8' }}>
                {selectedPropRecord
                  ? `Owned by ${
                      roomSnapshot.players.find((p) => p.id === selectedPropRecord.ownerId)?.nickname ?? 'Player'
                    } ${selectedPropRecord.isMortgaged ? '(Mortgaged)' : ''}`
                  : 'Unowned'}
              </span>
            </div>

            {selectedSpace.rentTiers && (
              <div className="prop-rent-tiers">
                <div style={{ fontWeight: 700, marginBottom: '2px', color: '#c4b5fd' }}>Rent Schedule:</div>
                <div className="prop-detail-row">
                  <span>Base Rent:</span> <span>${selectedSpace.rentTiers[0]}</span>
                </div>
                <div className="prop-detail-row">
                  <span>With 1 House:</span> <span>${selectedSpace.rentTiers[1]}</span>
                </div>
                <div className="prop-detail-row">
                  <span>With 2 Houses:</span> <span>${selectedSpace.rentTiers[2]}</span>
                </div>
                <div className="prop-detail-row">
                  <span>With 3 Houses:</span> <span>${selectedSpace.rentTiers[3]}</span>
                </div>
                <div className="prop-detail-row">
                  <span>With 4 Houses:</span> <span>${selectedSpace.rentTiers[4]}</span>
                </div>
                <div className="prop-detail-row">
                  <span>With Hotel:</span> <span>${selectedSpace.rentTiers[5]}</span>
                </div>
                {selectedSpace.houseCost && (
                  <div className="prop-detail-row" style={{ marginTop: '4px', borderTop: '1px solid #2e264d', paddingTop: '4px' }}>
                    <span>House / Hotel Cost:</span> <span>${selectedSpace.houseCost} each</span>
                  </div>
                )}
              </div>
            )}

            {/* Management actions for owner */}
            {isSelectedOwnedByMe && isGameStarted && !isGameFinished && (
              <div className="prop-actions-group">
                {/* Mortgage / Unmortgage */}
                {!selectedPropRecord?.isMortgaged ? (
                  <button
                    type="button"
                    className="btn-modal-action"
                    disabled={(selectedPropRecord?.houses ?? 0) > 0}
                    onClick={() => onMortgageProperty(selectedSpace.id)}
                  >
                    <span>Mortgage Property</span>
                    <span>+${Math.floor((selectedSpace.price ?? 0) / 2)}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-modal-action"
                    disabled={(myPlayerState?.cash ?? 0) < Math.ceil(((selectedSpace.price ?? 0) / 2) * 1.1)}
                    onClick={() => onUnmortgageProperty(selectedSpace.id)}
                  >
                    <span>Unmortgage Property</span>
                    <span>-${Math.ceil(((selectedSpace.price ?? 0) / 2) * 1.1)}</span>
                  </button>
                )}

                {/* Build House */}
                {selectedSpace.group && (
                  <>
                    <button
                      type="button"
                      className="btn-modal-action"
                      disabled={!canBuildOnSelected}
                      onClick={() => onBuildHouse(selectedSpace.id)}
                    >
                      <span>
                        Build {((selectedPropRecord?.houses ?? 0) === 4) ? 'Hotel' : 'House'}
                      </span>
                      <span>-${selectedSpace.houseCost ?? 0}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-modal-action"
                      disabled={!canSellOnSelected}
                      onClick={() => onSellHouse(selectedSpace.id)}
                    >
                      <span>
                        Sell {((selectedPropRecord?.houses ?? 0) === 5) ? 'Hotel' : 'House'}
                      </span>
                      <span>+${Math.floor((selectedSpace.houseCost ?? 0) / 2)}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade Proposal Modal */}
      {isTradeModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTradeModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Propose Trade</div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsTradeModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
              <div>
                <label style={{ display: 'block', color: '#c4b5fd', marginBottom: '3px' }}>
                  Select Trade Partner:
                </label>
                <select
                  value={tradeTargetPlayerId}
                  onChange={(e) => setTradeTargetPlayerId(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#120e24',
                    border: '1px solid #483a73',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '0.4rem',
                  }}
                >
                  <option value="">-- Choose Player --</option>
                  {otherPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname} (${gameState?.players[p.id]?.cash ?? 0})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', color: '#c4b5fd', marginBottom: '3px' }}>
                  Offered Cash ($):
                </label>
                <input
                  type="number"
                  min={0}
                  max={myPlayerState?.cash ?? 0}
                  value={tradeOfferedCash}
                  onChange={(e) => setTradeOfferedCash(Math.max(0, Number(e.target.value)))}
                  style={{
                    width: '100%',
                    background: '#120e24',
                    border: '1px solid #483a73',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '0.4rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#c4b5fd', marginBottom: '3px' }}>
                  Requested Cash ($):
                </label>
                <input
                  type="number"
                  min={0}
                  value={tradeRequestedCash}
                  onChange={(e) => setTradeRequestedCash(Math.max(0, Number(e.target.value)))}
                  style={{
                    width: '100%',
                    background: '#120e24',
                    border: '1px solid #483a73',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '0.4rem',
                  }}
                />
              </div>

              {/* Select offered properties */}
              {BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === currentSessionId).length > 0 && (
                <div>
                  <label style={{ display: 'block', color: '#c4b5fd', marginBottom: '3px' }}>
                    Offer Properties:
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === currentSessionId).map((s) => {
                      const isSelected = tradeOfferedProps.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setTradeOfferedProps(
                              isSelected ? tradeOfferedProps.filter((id) => id !== s.id) : [...tradeOfferedProps, s.id]
                            );
                          }}
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isSelected ? '#7c3aed' : '#1e1838',
                            border: isSelected ? '1px solid #c4b5fd' : '1px solid #483a73',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Select requested properties from partner */}
              {tradeTargetPlayerId && BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === tradeTargetPlayerId).length > 0 && (
                <div>
                  <label style={{ display: 'block', color: '#c4b5fd', marginBottom: '3px' }}>
                    Request Properties:
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {BOARD_SPACES.filter((s) => getPropertyInfo(s.id)?.ownerId === tradeTargetPlayerId).map((s) => {
                      const isSelected = tradeRequestedProps.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setTradeRequestedProps(
                              isSelected ? tradeRequestedProps.filter((id) => id !== s.id) : [...tradeRequestedProps, s.id]
                            );
                          }}
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isSelected ? '#7c3aed' : '#1e1838',
                            border: isSelected ? '1px solid #c4b5fd' : '1px solid #483a73',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="btn-start-game"
                style={{ marginTop: '0.6rem', width: '100%', justifyContent: 'center' }}
                disabled={!tradeTargetPlayerId || (tradeOfferedCash === 0 && tradeRequestedCash === 0 && tradeOfferedProps.length === 0 && tradeRequestedProps.length === 0)}
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
                Send Offer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
