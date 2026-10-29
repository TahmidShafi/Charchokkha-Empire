import React, { useEffect, useMemo, useState } from 'react';
import type { Player, RoomSnapshot } from '@charchokkha/shared';
import {
  calculateStandings,
  getBoardSpace,
} from '@charchokkha/game-engine';
import { PROPERTY_GROUP_COLORS, getSpaceBadge } from '../boardData';
import { PlayerCharacter } from './PlayerCharacter';

export interface PostMatchResultsProps {
  roomSnapshot: RoomSnapshot;
  currentSessionId: string;
  isHost: boolean;
  isSpectator: boolean;
  onRematch?: () => void;
  onToggleBoardView: () => void;
  onLeaveRoom: () => void;
}

export const PostMatchResults: React.FC<PostMatchResultsProps> = ({
  roomSnapshot,
  currentSessionId,
  isHost,
  isSpectator,
  onRematch,
  onToggleBoardView,
  onLeaveRoom,
}) => {
  const [activeTab, setActiveTab] = useState<'standings' | 'stats' | 'properties'>('standings');
  const gameState = roomSnapshot.gameState;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onToggleBoardView();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggleBoardView]);

  const standings = useMemo(() => {
    if (!gameState) return [];
    return calculateStandings(gameState, roomSnapshot.players);
  }, [gameState, roomSnapshot.players]);

  const winnerStanding = standings.length > 0 ? standings[0] : undefined;
  const winnerPlayer = winnerStanding
    ? roomSnapshot.players.find((p: Player) => p.id === winnerStanding.playerId)
    : undefined;

  // Determine game conclusion reason
  const conclusionReason = useMemo(() => {
    if (!gameState) return 'Match Finished';
    const playersList = Object.values(gameState.players);
    const bankruptCount = playersList.filter((p) => p.isBankrupt).length;
    const totalPlayers = playersList.length;

    if (totalPlayers > 1 && bankruptCount >= totalPlayers - 1) {
      return 'Elimination Victory — All opponents declared bankruptcy';
    }
    if (gameState.lastActionMessage?.includes('declared bankruptcy')) {
      return 'Elimination Victory — Opponent declared bankruptcy';
    }
    return 'Match Concluded Authoritatively';
  }, [gameState]);

  const formatCurrency = (val: number) => `$${val.toLocaleString()}`;

  return (
    <div
      className="post-match-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-match-title"
    >
      <div className="post-match-modal">
        {/* Top Header & Winner Podium Banner */}
        <header className="post-match-header">
          <div className="winner-podium-spotlight">
            <div className="winner-crown-wrapper" aria-hidden="true">
              <span className="winner-trophy-emoji">🏆</span>
              <span className="winner-crown-emoji">👑</span>
            </div>

            <div className="winner-identity-block">
              <span className="winner-avatar-badge" aria-hidden="true">
                <PlayerCharacter
                  color={winnerPlayer?.color || winnerStanding?.color || '#FFC83D'}
                  size={36}
                  showGlow
                />
              </span>
              <div className="winner-text-details">
                <span className="winner-eyebrow">CHAMPION OF CHARCHOKKHA</span>
                <h2 id="post-match-title" className="winner-nickname">
                  {winnerStanding?.nickname || winnerPlayer?.nickname || 'Champion'}
                </h2>
                <span className="game-conclusion-pill" role="status">
                  {conclusionReason}
                </span>
              </div>
            </div>

            {winnerStanding && (
              <div className="winner-wealth-summary">
                <div className="wealth-metric">
                  <span className="wealth-label">Final Net Worth</span>
                  <span className="wealth-value net-worth-highlight">
                    {formatCurrency(winnerStanding.netWorth)}
                  </span>
                </div>
                <div className="wealth-metric">
                  <span className="wealth-label">Liquid Cash</span>
                  <span className="wealth-value">{formatCurrency(winnerStanding.cash)}</span>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="post-match-tabs" role="tablist" aria-label="Match Results Tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'standings'}
            className={`results-tab-btn ${activeTab === 'standings' ? 'active' : ''}`}
            onClick={() => setActiveTab('standings')}
          >
            🏅 Final Standings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'stats'}
            className={`results-tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            📊 Match Statistics
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'properties'}
            className={`results-tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
            onClick={() => setActiveTab('properties')}
          >
            🏙️ Property Portfolios
          </button>
        </nav>

        {/* Tab Panel: Final Standings */}
        {activeTab === 'standings' && (
          <section className="results-panel" role="tabpanel" aria-label="Final Standings">
            <div className="standings-leaderboard">
              {standings.map((standing) => {
                const isMe = standing.playerId === currentSessionId;
                const isHostPlayer = roomSnapshot.hostId === standing.playerId;
                const rankMedal =
                  standing.rank === 1
                    ? '🥇'
                    : standing.rank === 2
                    ? '🥈'
                    : standing.rank === 3
                    ? '🥉'
                    : `#${standing.rank}`;

                return (
                  <div
                    key={standing.playerId}
                    className={`standing-row-card standing-rank-${standing.rank} ${
                      isMe ? 'standing-is-me' : ''
                    } ${standing.isBankrupt ? 'standing-is-bankrupt' : ''}`}
                  >
                    <div className="standing-rank-badge" aria-label={`Rank ${standing.rank}`}>
                      <span className="rank-text">{rankMedal}</span>
                    </div>

                    <div className="standing-player-info">
                      <span className="standing-avatar" aria-hidden="true">
                        <PlayerCharacter
                          color={standing.color || roomSnapshot.players.find((p) => p.id === standing.playerId)?.color || '#C4E64A'}
                          size={24}
                        />
                      </span>
                      <div className="standing-name-col">
                        <div className="standing-name-row">
                          <span className="standing-nickname">{standing.nickname}</span>
                          {isMe && <span className="badge-tag tag-you">YOU</span>}
                          {isHostPlayer && <span className="badge-tag tag-host">HOST</span>}
                        </div>
                        <span className="standing-status-label">
                          {standing.isBankrupt
                            ? `💀 Bankrupt (Eliminated #${standing.stats?.bankruptcyOrder ?? '—'})`
                            : standing.rank === 1
                            ? '👑 Victorious Empire'
                            : 'Active Empire'}
                        </span>
                      </div>
                    </div>

                    <div className="standing-finances-info">
                      <div className="finance-col">
                        <span className="finance-label">Net Worth</span>
                        <span className="finance-value net-worth-text">
                          {formatCurrency(standing.netWorth)}
                        </span>
                      </div>
                      <div className="finance-col">
                        <span className="finance-label">Cash</span>
                        <span className="finance-value">{formatCurrency(standing.cash)}</span>
                      </div>
                      <div className="finance-col">
                        <span className="finance-label">Properties</span>
                        <span className="finance-value">{standing.propertyCount}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tab Panel: Match Statistics */}
        {activeTab === 'stats' && (
          <section className="results-panel" role="tabpanel" aria-label="Match Statistics">
            <div className="stats-comparison-grid">
              {standings.map((standing) => {
                const isMe = standing.playerId === currentSessionId;
                const s = standing.stats;

                return (
                  <div
                    key={standing.playerId}
                    className={`player-stats-card ${isMe ? 'standing-is-me' : ''}`}
                  >
                    <div className="stats-card-header">
                      <span className="stats-avatar" aria-hidden="true">
                        <PlayerCharacter
                          color={standing.color || roomSnapshot.players.find((p) => p.id === standing.playerId)?.color || '#C4E64A'}
                          size={24}
                        />
                      </span>
                      <span className="stats-player-name">
                        {standing.nickname}
                        {isMe && <span className="badge-tag tag-you">YOU</span>}
                      </span>
                    </div>

                    <div className="stats-metric-tiles">
                      <div className="stat-tile">
                        <span className="stat-tile-label">Rent Collected</span>
                        <span className="stat-tile-value rent-received">
                          {formatCurrency(s?.rentReceived ?? 0)}
                        </span>
                      </div>
                      <div className="stat-tile">
                        <span className="stat-tile-label">Rent Paid</span>
                        <span className="stat-tile-value rent-paid">
                          {formatCurrency(s?.rentPaid ?? 0)}
                        </span>
                      </div>
                      <div className="stat-tile">
                        <span className="stat-tile-label">Properties Bought</span>
                        <span className="stat-tile-value">{s?.propertiesBought ?? 0}</span>
                      </div>
                      <div className="stat-tile">
                        <span className="stat-tile-label">Auctions Won</span>
                        <span className="stat-tile-value">{s?.auctionsWon ?? 0}</span>
                      </div>
                      <div className="stat-tile">
                        <span className="stat-tile-label">Trades Completed</span>
                        <span className="stat-tile-value">{s?.tradesCompleted ?? 0}</span>
                      </div>
                      <div className="stat-tile">
                        <span className="stat-tile-label">Buildings Built</span>
                        <span className="stat-tile-value">{s?.buildingsBuilt ?? 0}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tab Panel: Property Portfolios */}
        {activeTab === 'properties' && (
          <section className="results-panel" role="tabpanel" aria-label="Property Portfolios">
            <div className="portfolios-container">
              {standings.map((standing) => {
                const isMe = standing.playerId === currentSessionId;

                return (
                  <div
                    key={standing.playerId}
                    className={`portfolio-card ${isMe ? 'standing-is-me' : ''}`}
                  >
                    <div className="portfolio-header">
                      <div className="portfolio-player-tag">
                        <span aria-hidden="true">{standing.avatar}</span>
                        <span className="portfolio-name">{standing.nickname}</span>
                        {isMe && <span className="badge-tag tag-you">YOU</span>}
                      </div>
                      <span className="portfolio-count-tag">
                        {standing.properties.length} Properties
                      </span>
                    </div>

                    {standing.properties.length === 0 ? (
                      <p className="no-properties-message">No properties owned at match conclusion.</p>
                    ) : (
                      <div className="property-chips-grid">
                        {standing.properties.map((spaceId) => {
                          const space = getBoardSpace(spaceId);
                          const badge = getSpaceBadge(spaceId);
                          const propRecord = gameState?.properties[spaceId];
                          const isMortgaged =
                            typeof propRecord === 'object' && propRecord !== null
                              ? propRecord.isMortgaged
                              : false;
                          const houses =
                            typeof propRecord === 'object' && propRecord !== null
                              ? propRecord.houses
                              : 0;
                          const groupColor = space.group
                            ? PROPERTY_GROUP_COLORS[space.group]
                            : '#64748b';

                          return (
                            <div
                              key={spaceId}
                              className={`property-chip ${isMortgaged ? 'property-mortgaged' : ''}`}
                            >
                              <div
                                className="property-color-bar"
                                style={{ backgroundColor: groupColor }}
                              />
                              <div className="property-chip-body">
                                <div className="property-chip-top">
                                  {space.type !== 'property' && badge?.symbol ? (
                                    <span className="property-badge-symbol" aria-hidden="true">
                                      {badge.symbol}
                                    </span>
                                  ) : null}
                                  <span className="property-chip-name">{space.name}</span>
                                </div>
                                <div className="property-chip-bottom">
                                  <span className="property-chip-price">${space.price}</span>
                                  {isMortgaged && (
                                    <span className="chip-mortgaged-pill">MORTGAGED</span>
                                  )}
                                  {houses > 0 && (
                                    <span className="chip-houses-pill">
                                      {houses === 5 ? '🏨 Hotel' : `🏠 x${houses}`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Footer Actions */}
        <footer className="post-match-footer">
          <div className="footer-action-buttons">
            {/* Host-only Rematch */}
            {isHost && (
              <button
                type="button"
                className="btn-results-action btn-results-rematch"
                onClick={onRematch}
                id="btn-post-match-rematch"
              >
                <span>Play Again / Rematch 🔄</span>
              </button>
            )}

            {/* Waiting indicator for non-hosts / spectators */}
            {!isHost && (
              <div className="results-waiting-banner" role="status">
                <span className="pulsing-waiting-dot" aria-hidden="true" />
                <span>
                  {isSpectator
                    ? 'Spectating — Waiting for host to start a rematch...'
                    : 'Waiting for host to start a rematch...'}
                </span>
              </div>
            )}

            {/* Inspect Board Toggle */}
            <button
              type="button"
              className="btn-results-action btn-results-inspect"
              onClick={onToggleBoardView}
              id="btn-inspect-board"
            >
              <span>Inspect Tabletop 🗺️</span>
            </button>

            {/* Leave Room Button */}
            <button
              type="button"
              className="btn-results-action btn-results-leave"
              onClick={onLeaveRoom}
              id="btn-leave-match"
            >
              <span>Leave Table 🚪</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
