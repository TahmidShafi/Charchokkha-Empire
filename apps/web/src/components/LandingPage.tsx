import { useState, useEffect, useRef } from 'react';

export interface LandingPageProps {
  nickname: string;
  onNicknameChange: (name: string) => void;
  onPlay: (avatar?: string) => void;
  onCreatePrivate: (avatar?: string) => void;
  onJoinByCode: (code: string, avatar?: string) => void;
  serverError?: string;
  isConnecting?: boolean;
}

export const AVATAR_LIST = ['🟢', '🎩', '⛵', '🐎', '🏎️', '🏰', '🐱', '🦊'];

export function LandingPage({
  nickname,
  onNicknameChange,
  onPlay,
  onCreatePrivate,
  onJoinByCode,
  serverError,
  isConnecting = false,
}: LandingPageProps) {
  const [error, setError] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0);
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
    onPlay(AVATAR_LIST[selectedAvatarIndex]);
    setTimeout(() => setSubmitting(false), 2000);
  };

  const handlePrivateSubmit = () => {
    if (!validateNickname() || submitting || isConnecting) return;
    setSubmitting(true);
    onCreatePrivate(AVATAR_LIST[selectedAvatarIndex]);
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
    onJoinByCode(cleanCode, AVATAR_LIST[selectedAvatarIndex]);
  };

  const cycleAvatar = (direction: 1 | -1) => {
    setSelectedAvatarIndex((prev) => {
      const next = prev + direction;
      if (next < 0) return AVATAR_LIST.length - 1;
      return next % AVATAR_LIST.length;
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
          <p className="landing-brand-tagline">Rule the economy</p>
        </header>

        {/* Server Connection Error Alert */}
        {serverError && (
          <div className="landing-alert-banner" role="alert">
            <span className="alert-icon">⚠️</span>
            <span className="alert-text">{serverError}</span>
          </div>
        )}

        {/* Main Entry Card */}
        <div className="landing-card-surface">
          {/* Avatar / Token Selector */}
          <div className="landing-avatar-picker" aria-label="Select player token">
            <button
              type="button"
              className="avatar-arrow-btn"
              onClick={() => cycleAvatar(-1)}
              title="Previous token"
              aria-label="Previous token"
            >
              ‹
            </button>
            <div className="avatar-preview-ring" title="Your game piece">
              <span className="avatar-emoji">{AVATAR_LIST[selectedAvatarIndex]}</span>
            </div>
            <button
              type="button"
              className="avatar-arrow-btn"
              onClick={() => cycleAvatar(1)}
              title="Next token"
              aria-label="Next token"
            >
              ›
            </button>
          </div>
          <div className="avatar-hint-text">Choose your game piece</div>

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
            >
              <span className="btn-icon">🚪</span>
              <span>Join Room</span>
            </button>

            <button
              id="btn-create-private"
              type="button"
              className="btn-secondary-action"
              onClick={handlePrivateSubmit}
            >
              <span className="btn-icon">🔒</span>
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

              <div className="dialog-btn-row">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setShowJoinModal(false)}
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-join-code"
                  type="submit"
                  className="btn-primary-action"
                  disabled={!joinCodeInput.trim()}
                >
                  Enter Table →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
