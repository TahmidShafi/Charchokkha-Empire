import { type GameState, type Player, type RoomSettings } from '@charchokkha/shared';
import { soundManager } from '../audio/soundManager';

export interface GameSettingsProps {
  playerName: string;
  playerAvatar: string;
  isHost: boolean;
  isSpectator?: boolean;
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
  settings?: RoomSettings;
  onUpdateSettings?: (partial: Partial<RoomSettings>) => void;
  gameState?: GameState;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onClose?: () => void;
}

export function GameSettings({
  playerName,
  playerAvatar,
  isHost,
  isSpectator = false,
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
  settings,
  onUpdateSettings,
  gameState,
  isMuted = false,
  onToggleMute,
  onClose,
}: GameSettingsProps) {
  const doubleRent = settings?.doubleRent ?? true;
  const vacationCash = settings?.vacationCash ?? false;
  const auction = settings?.auction ?? true;
  const noRentInPrison = settings?.noRentInPrison ?? false;
  const mortgage = settings?.mortgage ?? true;
  const evenBuild = settings?.evenBuild ?? true;

  return (
    <div className="settings-panel-container" role="region" aria-label="Game Settings">
      {/* Top Header if in modal or drawer */}
      <div className="settings-header-bar">
        <div className="settings-header-title">
          <span className="settings-header-icon" aria-hidden="true">⚙️</span>
          <span>Table Settings</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        )}
      </div>

      <div className="settings-scroll-content">
        {/* Card 1: Player Identity Card */}
        <div className="settings-section-card">
          <div className="player-profile-row">
            <div className="player-avatar-badge" title={isSpectator ? 'Spectating Table' : 'Your avatar'}>
              <span>{isSpectator ? '👁️' : playerAvatar}</span>
            </div>
            <div className="player-text-meta">
              <div className="player-name-line">
                <span className="name-bold">{playerName}</span>
                {isSpectator ? (
                  <span className="spectator-pill-badge">👁️ Spectator</span>
                ) : isHost ? (
                  <span className="host-pill-badge">👑 Host</span>
                ) : (
                  <span className="player-pill-badge">Player</span>
                )}
              </div>
              <div className="player-sub-text">
                {isSpectator
                  ? 'Watching table in read-only mode'
                  : isHost
                  ? 'You can configure game rules'
                  : 'Host controls table rules'}
              </div>
            </div>
          </div>

          {!isSpectator && (
            <button
              type="button"
              className="btn-secondary-action btn-change-token"
              onClick={onAvatarChange}
            >
              <span>🎨</span> Change Token
            </button>
          )}
        </div>

        {/* Audio & Sound Effects */}
        <div className="settings-section-card">
          <div className="section-card-header">
            <span className="section-title-label">🔊 Audio & Sound Effects</span>
            <span className="sync-status-badge">{isMuted ? 'Muted' : 'Active'}</span>
          </div>
          <div className="audio-controls-row">
            <button
              type="button"
              id="btn-settings-toggle-sound"
              className={`btn-secondary-action btn-audio-toggle ${isMuted ? 'btn-audio-muted' : ''}`}
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute all game sound effects' : 'Mute all game sound effects'}
            >
              <span>{isMuted ? '🔇 Unmute Sound' : '🔊 Mute Sound'}</span>
            </button>
            <button
              type="button"
              id="btn-test-sound"
              className="btn-secondary-action btn-test-audio"
              onClick={() => {
                soundManager.initContext();
                soundManager.playBuyProperty();
              }}
              title="Test audio output level"
              aria-label="Test audio output"
            >
              <span>🔔 Test Audio</span>
            </button>
          </div>
          <span className="setting-description-note">
            Tactile native Web Audio synthesis for dice rolls, token hops, purchases, and rent.
          </span>
        </div>

        {/* Card 2: Connected Players Roster */}
        <div className="settings-section-card">
          <div className="section-card-header">
            <span className="section-title-label">
              Players ({players.length}/{maxPlayers})
            </span>
            <span className="sync-status-badge">● Authoritative Sync</span>
          </div>

          <div className="player-roster-list">
            {players.map((p) => {
              const pState = gameState?.players[p.id];
              const isTurn = gameState?.activePlayerId === p.id;

              return (
                <div
                  key={p.id}
                  className={`roster-item-row ${isTurn ? 'row-active-turn' : ''}`}
                >
                  <div className="roster-left">
                    <span className="roster-avatar">{p.avatar || '🟢'}</span>
                    <span className="roster-nickname">
                      {p.nickname} {p.nickname === playerName && '(You)'}
                    </span>
                    {!p.connected && (
                      <span className="reconnecting-tag">(reconnecting...)</span>
                    )}
                  </div>

                  <div className="roster-right">
                    {pState && (
                      <span className="roster-cash-amount">${pState.cash}</span>
                    )}
                    {isTurn && (
                      <span className="turn-mini-badge">🎲 Turn</span>
                    )}
                    {p.isHost && (
                      <span className="host-mini-crown" title="Room Host">👑</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Room Configuration (Host Controlled) */}
        <div className="settings-section-card">
          <div className="section-card-header">
            <span className="section-title-label">Room Configuration</span>
            {!isHost && <span className="host-only-note">🔒 Host Only</span>}
          </div>

          {/* Maximum players */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Maximum Players</div>
              <div className="setting-label-desc">Seat capacity for this match</div>
            </div>
            <select
              className="styled-select-input"
              value={maxPlayers}
              disabled={!isHost}
              onChange={(e) => onMaxPlayersChange(Number(e.target.value))}
              aria-label="Maximum players"
            >
              <option value={2}>2 Players</option>
              <option value={3}>3 Players</option>
              <option value={4}>4 Players</option>
              <option value={6}>6 Players</option>
              <option value={8}>8 Players</option>
            </select>
          </div>

          {/* Starting cash */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Starting Balance</div>
              <div className="setting-label-desc">Initial cash per player</div>
            </div>
            <select
              className="styled-select-input"
              value={startingCash}
              disabled={!isHost}
              onChange={(e) => onStartingCashChange(Number(e.target.value))}
              aria-label="Starting Cash"
            >
              <option value={1000}>$1,000</option>
              <option value={1500}>$1,500 (Standard)</option>
              <option value={2000}>$2,000 (Rich)</option>
              <option value={2500}>$2,500</option>
            </select>
          </div>

          {/* Private room */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Private Table</div>
              <div className="setting-label-desc">Accessible via invite link only</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={isPrivate}
                disabled={!isHost}
                onChange={(e) => onIsPrivateChange(e.target.checked)}
                aria-label="Private Table"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* Allow bots */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">
                Allow AI Bots <span className="beta-chip">Beta</span>
              </div>
              <div className="setting-label-desc">Fill vacant seats with AI</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={allowBots}
                disabled={!isHost}
                onChange={(e) => onAllowBotsChange(e.target.checked)}
                aria-label="Allow AI Bots"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>
        </div>

        {/* Card 4: Gameplay Rules (Configurable & Enforced by Engine) */}
        <div className="settings-section-card">
          <div className="section-card-header">
            <span className="section-title-label">Gameplay Rules</span>
            {!isHost && <span className="host-only-note">🔒 Host Only</span>}
          </div>

          {/* x2 rent on full-set */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">x2 Rent on Full-Set Properties</div>
              <div className="setting-label-desc">Unimproved complete color sets yield double base rent</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={doubleRent}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ doubleRent: e.target.checked })}
                aria-label="x2 rent on full set"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* Vacation cash */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Vacation Cash Pot</div>
              <div className="setting-label-desc">Taxes and prison fines accumulate and are won on Vacation</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={vacationCash}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ vacationCash: e.target.checked })}
                aria-label="Vacation Cash"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* Auction */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Auctions on Decline</div>
              <div className="setting-label-desc">Declining purchase opens an auction to all active players</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={auction}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ auction: e.target.checked })}
                aria-label="Auction on decline"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* No rent in prison */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">No Rent While In Prison</div>
              <div className="setting-label-desc">Properties cannot collect rent while owner is in prison</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={noRentInPrison}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ noRentInPrison: e.target.checked })}
                aria-label="No rent in prison"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* Mortgage */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Allow Mortgaging</div>
              <div className="setting-label-desc">Players can mortgage unimproved properties for 50% cash</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={mortgage}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ mortgage: e.target.checked })}
                aria-label="Allow mortgaging"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>

          {/* Even build */}
          <div className="setting-control-row">
            <div className="setting-text-block">
              <div className="setting-label-title">Even Building Rule</div>
              <div className="setting-label-desc">Houses must be built and sold evenly across the color set</div>
            </div>
            <label className="toggle-switch-wrapper">
              <input
                type="checkbox"
                checked={evenBuild}
                disabled={!isHost}
                onChange={(e) => onUpdateSettings?.({ evenBuild: e.target.checked })}
                aria-label="Even building rule"
              />
              <span className="toggle-slider-track" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
