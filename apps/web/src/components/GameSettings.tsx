import { useState } from 'react';
import { type GameState, type Player } from '@charchokkha/shared';

export interface GameSettingsProps {
  playerName: string;
  playerAvatar: string;
  isHost: boolean;
  players: Player[];
  onAvatarChange: () => void;
  maxPlayers: number;
  onMaxPlayersChange: (val: number) => void;
  isPrivate: boolean;
  onIsPrivateChange: (val: boolean) => void;
  allowBots: boolean;
  onAllowBotsChange: (val: boolean) => void;
  startingCash: number;
  onStartingCashChange: (val: number) => void;
  gameState?: GameState;
}

export function GameSettings({
  playerName,
  playerAvatar,
  isHost,
  players,
  onAvatarChange,
  maxPlayers,
  onMaxPlayersChange,
  isPrivate,
  onIsPrivateChange,
  allowBots,
  onAllowBotsChange,
  startingCash,
  onStartingCashChange,
  gameState,
}: GameSettingsProps) {
  // Gameplay rule toggles (client visual state for un-modeled rule variations)
  const [doubleRent, setDoubleRent] = useState(false);
  const [vacationCash, setVacationCash] = useState(false);
  const [auction, setAuction] = useState(false);
  const [noRentInPrison, setNoRentInPrison] = useState(false);
  const [mortgage, setMortgage] = useState(false);
  const [evenBuild, setEvenBuild] = useState(true);

  return (
    <div className="room-right-col">
      {/* Player Profile Bar */}
      <div className="player-host-card">
        <div className="player-info-left">
          <div className="player-avatar-circle" title="Your avatar">
            {playerAvatar}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="player-name-text">{playerName}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>➔</span>
              {isHost ? (
                <span className="host-crown-tag">👑 Host</span>
              ) : (
                <span className="host-crown-tag" style={{ background: '#221a38', color: '#c4b5fd', borderColor: '#483a73' }}>
                  Player
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn-change-appearance"
          onClick={onAvatarChange}
        >
          <span>🎨</span> Change appearance
        </button>
      </div>

      {/* Roster of Connected Players */}
      <div className="settings-panel-card" style={{ padding: '0.9rem 1.15rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#d6ceff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Players ({players.length}/{maxPlayers})
          </span>
          <span style={{ fontSize: '0.75rem', color: '#86efac' }}>● Server Sync</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {players.map((p) => {
            const pState = gameState?.players[p.id];
            const isTurn = gameState?.activePlayerId === p.id;

              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem',
                    background: isTurn ? '#1c1438' : '#130f24',
                    border: isTurn ? '1px solid #7c3aed' : '1px solid transparent',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{p.avatar || '🟢'}</span>
                    <span style={{ fontWeight: 600, color: p.connected ? '#fff' : '#78716c' }}>
                      {p.nickname} {p.nickname === playerName && '(You)'}
                    </span>
                    {!p.connected && (
                      <span style={{ fontSize: '0.65rem', color: '#f87171' }}>(reconnecting...)</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {pState && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80' }}>
                        ${pState.cash}
                      </span>
                    )}
                    {isTurn && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          background: '#3b0764',
                          color: '#d8b4fe',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          border: '1px solid #7e22ce',
                        }}
                      >
                        🎲 Turn
                      </span>
                    )}
                    {p.isHost && (
                      <span style={{ fontSize: '0.7rem', color: '#fbbf24', fontWeight: 700 }}>
                        👑 Host
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Game Settings Card */}
      <div className="settings-panel-card">
        <h3 className="settings-card-title">Game settings</h3>

        {/* Maximum players */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">👥</span>
            <div>
              <div className="setting-title-text">Maximum players</div>
              <div className="setting-desc-text">How many players can join the game</div>
            </div>
          </div>
          <select
            className="setting-select"
            value={maxPlayers}
            disabled={!isHost}
            onChange={(e) => onMaxPlayersChange(Number(e.target.value))}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={6}>6</option>
            <option value={8}>8</option>
          </select>
        </div>

        {/* Private room */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🔑</span>
            <div>
              <div className="setting-title-text">Private room</div>
              <div className="setting-desc-text">Private rooms can be accessed using the room URL only</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={isPrivate}
              disabled={!isHost}
              onChange={(e) => onIsPrivateChange(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Allow bots */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🤖</span>
            <div>
              <div className="setting-title-text">
                Allow bots to join <span className="beta-pill">Beta</span>
              </div>
              <div className="setting-desc-text">Bots will join the game based on availability</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={allowBots}
              disabled={!isHost}
              onChange={(e) => onAllowBotsChange(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Board map */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🗺️</span>
            <div>
              <div className="setting-title-text">Board map</div>
              <div className="setting-desc-text">Change map tiles, properties and stacks</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#c4b5fd', fontSize: '0.8rem', fontWeight: 600 }}>
            <span>Classic</span>
            <span style={{ fontSize: '0.7rem' }}>&gt;</span>
          </div>
        </div>
      </div>

      {/* Gameplay Rules Card */}
      <div className="settings-panel-card">
        <h3 className="settings-card-title">Gameplay rules</h3>

        {/* x2 rent on full-set */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">⚡</span>
            <div>
              <div className="setting-title-text">x2 rent on full-set properties</div>
              <div className="setting-desc-text">If a player owns a full property set, base rent is doubled</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={doubleRent}
              disabled={!isHost}
              onChange={(e) => setDoubleRent(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Vacation cash */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🌴</span>
            <div>
              <div className="setting-title-text">Vacation cash</div>
              <div className="setting-desc-text">If a player lands on Vacation, tax and penalty money is earned</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={vacationCash}
              disabled={!isHost}
              onChange={(e) => setVacationCash(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Auction */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🔨</span>
            <div>
              <div className="setting-title-text">Auction</div>
              <div className="setting-desc-text">If someone skips purchasing a landed property, it is auctioned</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={auction}
              disabled={!isHost}
              onChange={(e) => setAuction(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Don't collect rent in prison */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">⛓️</span>
            <div>
              <div className="setting-title-text">Don&apos;t collect rent while in prison</div>
              <div className="setting-desc-text">Rent will not be collected on properties while owner is in prison</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={noRentInPrison}
              disabled={!isHost}
              onChange={(e) => setNoRentInPrison(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Mortgage */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🏦</span>
            <div>
              <div className="setting-title-text">Mortgage</div>
              <div className="setting-desc-text">Mortgage properties to earn 50% of cost without earning rent</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={mortgage}
              disabled={!isHost}
              onChange={(e) => setMortgage(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Even build */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">🏗️</span>
            <div>
              <div className="setting-title-text">Even build</div>
              <div className="setting-desc-text">Houses and hotels must be built up and sold evenly in a set</div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={evenBuild}
              disabled={!isHost}
              onChange={(e) => setEvenBuild(e.target.checked)}
            />
            <span className="slider-round" />
          </label>
        </div>

        {/* Starting cash */}
        <div className="setting-item-row">
          <div className="setting-left-info">
            <span className="setting-icon">💵</span>
            <div>
              <div className="setting-title-text">Starting cash</div>
              <div className="setting-desc-text">Adjust how much money players start the game with</div>
            </div>
          </div>
          <select
            className="setting-select"
            value={startingCash}
            disabled={!isHost}
            onChange={(e) => onStartingCashChange(Number(e.target.value))}
          >
            <option value={1000}>$1000</option>
            <option value={1500}>$1500</option>
            <option value={2000}>$2000</option>
            <option value={2500}>$2500</option>
          </select>
        </div>
      </div>
    </div>
  );
}
