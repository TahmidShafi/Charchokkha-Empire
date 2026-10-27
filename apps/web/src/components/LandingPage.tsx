import { useState } from 'react';

export interface LandingPageProps {
  nickname: string;
  onNicknameChange: (name: string) => void;
  onPlay: () => void;
  onCreatePrivate: () => void;
  onJoinByCode: (code: string) => void;
  serverError?: string;
}

export function LandingPage({
  nickname,
  onNicknameChange,
  onPlay,
  onCreatePrivate,
  onJoinByCode,
  serverError,
}: LandingPageProps) {
  const [error, setError] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const handlePlaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setError('Please enter a nickname to play');
      return;
    }
    setError('');
    onPlay();
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setError('Please enter a nickname before joining');
      return;
    }
    if (!joinCodeInput.trim()) return;
    onJoinByCode(joinCodeInput.trim().toUpperCase());
  };

  return (
    <div className="landing-viewport">
      <div className="landing-center">
        {/* 3D Dice Hero */}
        <div className="landing-dice-hero" aria-hidden="true">
          <div className="dice-cube-3d">
            <span className="dice-pip" style={{ gridArea: '1 / 1' }} />
            <span className="dice-pip" style={{ gridArea: '1 / 3' }} />
            <span className="dice-pip" style={{ gridArea: '2 / 2' }} />
            <span className="dice-pip" style={{ gridArea: '3 / 1' }} />
            <span className="dice-pip" style={{ gridArea: '3 / 3' }} />
          </div>
        </div>

        {/* Brand Title */}
        <h1 className="landing-logo">
          CHARCHOKKHA<span className="io-badge">.IO</span>
        </h1>
        <p className="landing-tagline">Rule the economy</p>

        {serverError && (
          <div
            style={{
              background: '#451a1a',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              marginBottom: '1rem',
              width: '100%',
              maxWidth: '320px',
            }}
          >
            {serverError}
          </div>
        )}

        {/* Nickname Form */}
        <form className="landing-form" onSubmit={handlePlaySubmit}>
          <input
            id="nickname-input"
            type="text"
            className="nickname-input"
            placeholder="Your nickname..."
            value={nickname}
            onChange={(e) => {
              onNicknameChange(e.target.value);
              if (error) setError('');
            }}
            maxLength={18}
          />

          {error && (
            <span style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '-4px' }}>
              {error}
            </span>
          )}

          <button id="btn-play" type="submit" className="btn-play">
            <span>&raquo;</span> Play
          </button>
        </form>

        {/* Secondary Navigation */}
        <div className="landing-sub-actions">
          <button
            id="btn-all-rooms"
            type="button"
            className="btn-sub-action"
            onClick={() => setShowJoinModal(!showJoinModal)}
          >
            <span>👥</span> Join Room Code
          </button>
          <button
            id="btn-create-private"
            type="button"
            className="btn-sub-action"
            onClick={onCreatePrivate}
          >
            <span>🔑</span> Create a private game
          </button>
        </div>

        {/* Inline Join Code Drawer */}
        {showJoinModal && (
          <form
            onSubmit={handleJoinSubmit}
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginTop: '1rem',
              width: '100%',
              maxWidth: '320px',
            }}
          >
            <input
              type="text"
              id="input-join-code"
              className="nickname-input"
              style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              placeholder="Room code (e.g. 6RK2V)"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              maxLength={10}
            />
            <button
              id="btn-submit-join-code"
              type="submit"
              className="btn-play"
              style={{ width: 'auto', padding: '0 1.25rem', height: '46px', fontSize: '0.9rem' }}
              disabled={!joinCodeInput.trim()}
            >
              Join
            </button>
          </form>
        )}
      </div>

      {/* Decorative Floating Game Icons */}
      <div className="landing-backdrop-icons" aria-hidden="true">
        <span>✈️</span>
        <span>⚡</span>
        <span>🎁</span>
        <span>❓</span>
        <span>🏠</span>
        <span>🪙</span>
        <span>💰</span>
      </div>
    </div>
  );
}
