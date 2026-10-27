import {
  BOARD_SPACES,
  PROPERTY_GROUP_COLORS,
} from '../boardData';
import { getBoardSpace } from '@charchokkha/game-engine';
import { type RoomSnapshot } from '@charchokkha/shared';

export interface BoardProps {
  roomCode: string;
  roomSnapshot: RoomSnapshot;
  currentSessionId: string;
  isHost: boolean;
  onStartGame: () => void;
  onRollDice: () => void;
  onBuyProperty: () => void;
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
  onEndTurn,
  isRolling,
}: BoardProps) {
  const gameState = roomSnapshot.gameState;
  const isGameStarted = roomSnapshot.state === 'in_progress' && !!gameState;
  const activePlayerId = gameState?.activePlayerId;
  const isMyTurn = isGameStarted && activePlayerId === currentSessionId;
  const activePlayer = roomSnapshot.players.find((p) => p.id === activePlayerId);
  const myPlayerState = gameState?.players[currentSessionId];
  const myPosition = myPlayerState?.position ?? 0;
  const turnPhase = gameState?.turnPhase ?? 'need_roll';

  // Player positions and details for token rendering
  const playersWithTokens = roomSnapshot.players.map((p) => {
    const pState = gameState?.players[p.id];
    return {
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      position: pState ? pState.position : 0,
      cash: pState ? pState.cash : roomSnapshot.settings.startingCash,
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

  // Returns grid position and orientation class
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

  // Helper to render die face
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

  return (
    <div className="board-outer-frame">
      <div className="board-grid-11">
        {/* Render 40 Spaces */}
        {BOARD_SPACES.map((space) => {
          const coords = getSpaceGridCoords(space.id);
          const isCorner = coords.edge === 'corner';
          const groupColor = space.group ? PROPERTY_GROUP_COLORS[space.group] : undefined;
          const tokensOnTile = playersWithTokens.filter((p) => p.position === space.id);

          const ownerId = gameState?.properties?.[String(space.id)];
          const ownerPlayer = ownerId
            ? roomSnapshot.players.find((p) => p.id === ownerId)
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
              style={{ gridRow: coords.gridRow, gridColumn: coords.gridColumn }}
            >
              {/* Color Bar on inner edge or top */}
              {groupColor && coords.edge !== 'top' && (
                <div className="tile-color-bar" style={{ backgroundColor: groupColor }} />
              )}

              <div className="tile-inner">
                {space.flag && <span className="tile-flag-icon">{space.flag}</span>}
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
          {/* Turn indicator */}
          {isGameStarted && (
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
            ) : isMyTurn ? (
              turnPhase === 'need_roll' ? (
                <button
                  id="btn-roll-dice"
                  type="button"
                  className="btn-start-game"
                  onClick={onRollDice}
                  disabled={isRolling}
                >
                  <span>🎲</span> {isRolling ? 'Rolling...' : 'Roll Dice'}
                </button>
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
                    id="btn-end-turn"
                    type="button"
                    className="btn-action-secondary"
                    onClick={onEndTurn}
                  >
                    Skip & End Turn ➔
                  </button>
                </>
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
          </div>

          {/* Action Log Message */}
          {gameState?.lastActionMessage && (
            <div className="center-action-log">{gameState.lastActionMessage}</div>
          )}

          <div className="center-room-joined-tag">Joined room {roomCode}</div>
        </div>
      </div>
    </div>
  );
}
