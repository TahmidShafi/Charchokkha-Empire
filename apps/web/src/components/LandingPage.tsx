import { useState, useEffect, useRef } from 'react';
import { PLAYER_COLORS } from '@charchokkha/shared';
import { PlayerCharacter } from './PlayerCharacter';
import { AlertTriangleIcon, LockIcon, EyeIcon } from './Icons';

export interface LandingPageProps {
  nickname: string;
  onNicknameChange: (name: string) => void;
  onPlay: (color?: string) => void;
  onCreatePrivate: (color?: string) => void;
  onJoinByCode: (code: string, color?: string) => void;
  onSpectateByCode?: (code: string) => void;
  serverError?: string;
  isConnecting?: boolean;
  takenColors?: string[];
}

export const AVATAR_LIST = ['🟢', '🎩', '⛵', '🐎', '🏎️', '🏰', '🐱', '🦊'];
export { PLAYER_COLORS };

export function LandingPage({
  nickname,
  onNicknameChange,
  onPlay,
  onCreatePrivate,
  onJoinByCode,
  onSpectateByCode,
  serverError,
  isConnecting = false,
  takenColors = [],
}: LandingPageProps) {
  const [error, setError] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const joinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showJoinModal && joinInputRef.current) {
      joinInputRef.current.focus();
    }
  }, [showJoinModal]);

  // Handle ESC to close join modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showJoinModal) {
        setShowJoinModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showJoinModal]);

  const currentColor = PLAYER_COLORS[selectedColorIndex] ?? PLAYER_COLORS[0];

  const validateNickname = (): boolean => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('Please choose a nickname to enter');
      return false;
    }
    if (trimmed.length > 25) {
      setError('Nickname cannot exceed 25 characters');
      return false;
    }
    setError('');
    return true;
  };

  const handlePlaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNickname() || submitting || isConnecting) return;
    setSubmitting(true);
    onPlay(currentColor.hex);
    setTimeout(() => setSubmitting(false), 2000);
  };

  const handlePrivateSubmit = () => {
    if (!validateNickname() || submitting || isConnecting) return;
    setSubmitting(true);
    onCreatePrivate(currentColor.hex);
    setTimeout(() => setSubmitting(false), 2000);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNickname()) {
      setShowJoinModal(false);
      return;
    }
    const cleanCode = joinCodeInput.trim().toUpperCase();
    if (!cleanCode) return;
    onJoinByCode(cleanCode, currentColor.hex);
  };

  const cycleColor = (direction: 1 | -1) => {
    setSelectedColorIndex((prev) => {
      let next = prev + direction;
      if (next < 0) next = PLAYER_COLORS.length - 1;
      else if (next >= PLAYER_COLORS.length) next = 0;
      return next;
    });
  };

  return (
    <div className="landing-viewport">
      {/* Decorative ambient board motifs in background */}
      <div className="landing-ambient-canvas" aria-hidden="true">
        <div className="ambient-blob ambient-blob-1" />
        <div className="ambient-blob ambient-blob-2" />
        <div className="ambient-grid-overlay" />
      </div>

      <div className="landing-center-container">
        {/* Tactile 3D Board Game Visual Stage */}
        <div className="landing-stage-hero" aria-hidden="true">
          <div className="tactile-dice-pair">
            {/* Left Die (showing 3) */}
            <div className="tactile-die die-primary">
              <span className="die-dot dot-tl" />
              <span className="die-dot dot-mid" />
              <span className="die-dot dot-br" />
            </div>
            {/* Right Die (showing 5) */}
            <div className="tactile-die die-secondary">
              <span className="die-dot dot-tl" />
              <span className="die-dot dot-tr" />
              <span className="die-dot dot-mid" />
              <span className="die-dot dot-bl" />
              <span className="die-dot dot-br" />
            </div>
          </div>
          {/* Floating Gold Coin Accent */}
          <div className="floating-coin-motif" />
        </div>

        {/* Brand Header */}
        <header className="landing-brand-header">
          <h1 className="landing-brand-title">
            CHARCHOKKHA<span className="brand-dot-io">.IO</span>
          </h1>
          <p className="landing-brand-tagline">Oyyy May be bhuul kheltaseee</p>
        </header>

        {/* Server Connection Error Alert */}
        {serverError && (
          <div className="landing-alert-banner" role="alert">
            <AlertTriangleIcon size={16} className="alert-icon" />
            <span className="alert-text">{serverError}</span>
          </div>
        )}

        {/* Main Entry Card */}
        <div className="landing-card-surface">
          {/* Animated Human-Like Character & Color Picker */}
          <div className="landing-character-picker" aria-label="Select player character and color">
            <div className="character-preview-stage">
              <button
                type="button"
                className="avatar-arrow-btn"
                onClick={() => cycleColor(-1)}
                title="Previous character color"
                aria-label="Previous character color"
              >
                ‹
              </button>
              <div
                className="character-preview-ring"
                style={{
                  borderColor: currentColor.hex,
                  boxShadow: `0 0 20px ${currentColor.hex}66`,
                }}
                title={`Selected: ${currentColor.name}`}
              >
                <PlayerCharacter
                  color={currentColor.hex}
                  size={46}
                  isSelected
                  showGlow
                />
              </div>
              <button
                type="button"
                className="avatar-arrow-btn"
                onClick={() => cycleColor(1)}
                title="Next character color"
                aria-label="Next character color"
              >
                ›
              </button>
            </div>
            <div className="character-name-badge" style={{ color: currentColor.hex }}>
              {currentColor.name}
            </div>

            {/* 8-Color Palette Row / Grid */}
            <div className="character-palette-row" role="radiogroup" aria-label="Player Colors">
              {PLAYER_COLORS.map((col, idx) => {
                const isSelected = idx === selectedColorIndex;
                const isTaken = takenColors.some(
                  (tc) => tc.toLowerCase() === col.hex.toLowerCase()
                );
                return (
                  <button
                    key={col.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isTaken}
                    className={`character-swatch-chip ${isSelected ? 'chip-active' : ''} ${
                      isTaken ? 'chip-taken' : ''
                    }`}
                    onClick={() => !isTaken && setSelectedColorIndex(idx)}
                    title={isTaken ? `${col.name} (Occupied)` : col.name}
                    aria-label={`${col.name}${isTaken ? ' (taken)' : ''}`}
                    style={
                      {
                        '--swatch-color': col.hex,
                        borderColor: isSelected ? col.hex : 'transparent',
                        boxShadow: isSelected ? `0 0 10px ${col.hex}88` : undefined,
                      } as React.CSSProperties
                    }
                  >
                    <PlayerCharacter
                      color={col.hex}
                      size={22}
                      isTaken={isTaken}
                      isSelected={isSelected}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="avatar-hint-text">Choose your game character & color</div>

          {/* Nickname Form */}
          <form className="landing-form" onSubmit={handlePlaySubmit}>
            <div className="input-group-wrapper">
              <label htmlFor="nickname-input" className="input-field-label">
                Player Nickname
              </label>
              <div className="input-inner-container">
                <input
                  id="nickname-input"
                  type="text"
                  className={`styled-text-input ${error ? 'input-error' : ''}`}
                  placeholder="Enter your name..."
                  value={nickname}
                  onChange={(e) => {
                    onNicknameChange(e.target.value);
                    if (error) setError('');
                  }}
                  maxLength={25}
                  autoComplete="nickname"
                  autoFocus
                />
                <span className="input-char-counter">{nickname.length}/25</span>
              </div>
              {error && <span className="inline-error-message">{error}</span>}
            </div>

            {/* Dominant Primary Play Button */}
            <button
              id="btn-play"
              type="submit"
              className="btn-primary-action btn-play-large"
              disabled={submitting || isConnecting}
            >
              {submitting || isConnecting ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  <span>Connecting to Table...</span>
                </>
              ) : (
                <>
                  <span>Play Online</span>
                  <span className="btn-arrow-icon" aria-hidden="true">
                    ▶
                  </span>
                </>
              )}
            </button>
          </form>

          {/* Secondary Actions Divider */}
          <div className="landing-actions-separator">
            <span>or join with friends</span>
          </div>

          {/* Secondary Button Row */}
          <div className="landing-sub-buttons-row">
            <button
              id="btn-all-rooms"
              type="button"
              className="btn-secondary-action"
              onClick={() => setShowJoinModal(true)}
              disabled={isConnecting || submitting}
            >
              <span>Join Room</span>
            </button>

            <button
              id="btn-create-private"
              type="button"
              className="btn-secondary-action"
              onClick={handlePrivateSubmit}
              disabled={isConnecting || submitting}
            >
              <LockIcon size={14} style={{ marginRight: 6 }} />
              <span>Private Room</span>
            </button>
          </div>
        </div>

        {/* Footer info */}
        <footer className="landing-footer-info">
          <span>Real-time Multiplayer Property Trading</span>
          <span>•</span>
          <span>v2.0 Official</span>
        </footer>
      </div>

      {/* Join Room Modal Dialog */}
      {showJoinModal && (
        <div
          className="modal-backdrop-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-modal-title"
          onClick={() => setShowJoinModal(false)}
        >
          <div
            className="dialog-card-surface"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '380px' }}
          >
            <div className="dialog-header-row">
              <h2 id="join-modal-title" className="dialog-title-text">
                Join Game Table
              </h2>
              <button
                type="button"
                className="dialog-close-btn"
                onClick={() => setShowJoinModal(false)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <p className="dialog-subtitle-text">
              Enter the unique 5 or 6-character room code shared by your host.
            </p>

            {serverError && (serverError.toLowerCase().includes('capacity') || serverError.toLowerCase().includes('full')) && (
              <div className="room-full-spectate-prompt" role="alert">
                <div className="prompt-header">
                  <EyeIcon size={16} className="prompt-icon" />
                  <strong>Table Full — Spectate Match</strong>
                </div>
                <p className="prompt-desc">
                  This table is at maximum player capacity. You can still watch the game live in read-only spectator mode!
                </p>
                {onSpectateByCode && (
                  <button
                    type="button"
                    id="btn-spectate-full-cta"
                    className="btn-primary-action btn-spectate-full-cta"
                    onClick={() => {
                      const cleanCode = joinCodeInput.trim().toUpperCase();
                      if (cleanCode) onSpectateByCode(cleanCode);
                    }}
                  >
                    <span>Watch Table Live</span>
                    <EyeIcon size={14} style={{ marginLeft: 6 }} />
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleJoinSubmit} className="dialog-form-body">
              <div className="input-group-wrapper">
                <input
                  ref={joinInputRef}
                  id="input-join-code"
                  type="text"
                  className="styled-text-input join-code-input"
                  placeholder="e.g. 6RK2V"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  maxLength={10}
                />
              </div>

              <div className="dialog-action-buttons-row">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setShowJoinModal(false)}
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-join"
                  type="submit"
                  className="btn-primary-action"
                  disabled={!joinCodeInput.trim()}
                >
                  Join Table
                </button>
              </div>

              {onSpectateByCode && (
                <div className="dialog-spectate-option">
                  <span className="spectate-divider-text">or</span>
                  <button
                    type="button"
                    id="btn-spectate-code"
                    className="btn-ghost-action btn-spectate-direct"
                    disabled={!joinCodeInput.trim()}
                    onClick={() => {
                      const clean = joinCodeInput.trim().toUpperCase();
                      if (clean) {
                        setShowJoinModal(false);
                        onSpectateByCode(clean);
                      }
                    }}
                  >
                    <EyeIcon size={14} style={{ marginRight: 6 }} />
                    <span>Spectate Table Instead</span>
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
