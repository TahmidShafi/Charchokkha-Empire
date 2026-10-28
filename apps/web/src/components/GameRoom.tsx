import { useState } from 'react';
import { Board } from './Board';
import { ChatPanel, type ChatMessage } from './ChatPanel';
import { GameSettings } from './GameSettings';
import { PostMatchResults } from './PostMatchResults';
import { soundManager } from '../audio/soundManager';
import {
  SOCKET_EVENTS,
  type Player,
  type RoomSettings,
  type RoomSnapshot,
  type SocketAck,
} from '@charchokkha/shared';
import { type Socket } from 'socket.io-client';

export interface GameRoomProps {
  roomSnapshot: RoomSnapshot;
  currentSessionId: string;
  socket: Socket | null;
  onExitToMenu: () => void;
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

const AVATAR_OPTIONS = ['🟢', '🎩', '⛵', '🐎', '🏎️', '🏰', '🐱', '🦊'];

type MobileTab = 'board' | 'chat' | 'settings';

export function GameRoom({
  roomSnapshot,
  currentSessionId,
  socket,
  onExitToMenu,
  chatMessages,
  onSendMessage,
}: GameRoomProps) {
  const [copied, setCopied] = useState(false);
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isDesktopChatOpen, setIsDesktopChatOpen] = useState(true);
  const [isDesktopSettingsOpen, setIsDesktopSettingsOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('board');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isMuted, setIsMuted] = useState(() => soundManager.isMuted());
  const [dismissedResultsForSequence, setDismissedResultsForSequence] = useState<number | null>(null);

  const generateRequestId = (action: string) =>
    `req_${action}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const handleToggleMute = () => {
    const next = soundManager.toggleMuted();
    setIsMuted(next);
  };

  const roomCode = roomSnapshot.code;
  const roomUrl = `${window.location.origin}/?room=${roomCode}`;

  const isGameFinished =
    roomSnapshot.state === 'finished' || roomSnapshot.gameState?.phase === 'finished';

  const showResultsOverlay =
    isGameFinished && dismissedResultsForSequence !== roomSnapshot.sequenceNumber;

  const isSpectator = Boolean(
    roomSnapshot &&
    currentSessionId &&
    !roomSnapshot.players.some((p: Player) => p.id === currentSessionId)
  );

  const currentPlayer = roomSnapshot.players.find((p: Player) => p.id === currentSessionId);
  const isHost = !isSpectator && currentSessionId === roomSnapshot.hostId;
  const currentAvatar = currentPlayer?.avatar || (isSpectator ? '👁️' : AVATAR_OPTIONS[avatarIndex]);
  const playerName = currentPlayer?.nickname || (isSpectator ? 'Spectator' : 'Guest');

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCycleAvatar = () => {
    const nextIdx = (avatarIndex + 1) % AVATAR_OPTIONS.length;
    setAvatarIndex(nextIdx);
    if (socket) {
      socket.emit(SOCKET_EVENTS.ROOM_JOIN, {
        roomCode,
        nickname: playerName,
        avatar: AVATAR_OPTIONS[nextIdx],
      });
    }
  };

  const handleUpdateMaxPlayers = (maxPlayers: number) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { maxPlayers } },
      (_ack: SocketAck<RoomSnapshot>) => {}
    );
  };

  const handleUpdateIsPrivate = (isPrivate: boolean) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { isPrivate } },
      (_ack: SocketAck<RoomSnapshot>) => {}
    );
  };

  const handleUpdateAllowBots = (allowBots: boolean) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { allowBots } },
      (_ack: SocketAck<RoomSnapshot>) => {}
    );
  };

  const handleUpdateStartingCash = (startingCash: number) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { startingCash } },
      (_ack: SocketAck<RoomSnapshot>) => {}
    );
  };

  const handleUpdateSettings = (partial: Partial<RoomSettings>) => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: partial, requestId: generateRequestId('settings') },
      (_ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
      }
    );
  };

  // Authoritative Game Actions
  const handleStartGame = () => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_START,
      { roomCode, requestId: generateRequestId('start') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to start game:', ack.error.message);
        }
      }
    );
  };

  const handleRematch = () => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_REMATCH,
      { roomCode, requestId: generateRequestId('rematch') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to initiate rematch:', ack.error.message);
        }
      }
    );
  };

  const handleRollDice = () => {
    if (!socket || isRolling || isSubmittingAction) return;
    setIsRolling(true);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_ROLL_DICE,
      { roomCode, requestId: generateRequestId('roll') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        setTimeout(() => {
          setIsRolling(false);
        }, 350);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to roll dice:', ack.error.message);
        }
      }
    );
  };

  const handleBuyProperty = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_BUY_PROPERTY,
      { roomCode, requestId: generateRequestId('buy') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to buy property:', ack.error.message);
        }
      }
    );
  };

  const handleDeclineProperty = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_DECLINE_PROPERTY,
      { roomCode, requestId: generateRequestId('decline') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to decline property:', ack.error.message);
        }
      }
    );
  };

  const handleAuctionBid = (bidAmount: number) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_AUCTION_BID,
      { roomCode, bidAmount, requestId: generateRequestId('auction_bid') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Auction bid failed:', ack.error.message);
        }
      }
    );
  };

  const handleAuctionPass = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_AUCTION_PASS,
      { roomCode, requestId: generateRequestId('auction_pass') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Auction pass failed:', ack.error.message);
        }
      }
    );
  };

  const handlePayPrisonFine = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_PAY_PRISON_FINE,
      { roomCode, requestId: generateRequestId('pay_prison') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to pay prison fine:', ack.error.message);
        }
      }
    );
  };

  const handleMortgageProperty = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY,
      { roomCode, spaceId, requestId: generateRequestId('mortgage') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to mortgage property:', ack.error.message);
        }
      }
    );
  };

  const handleUnmortgageProperty = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_UNMORTGAGE_PROPERTY,
      { roomCode, spaceId, requestId: generateRequestId('unmortgage') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to unmortgage property:', ack.error.message);
        }
      }
    );
  };

  const handleBuildHouse = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_BUILD_HOUSE,
      { roomCode, spaceId, requestId: generateRequestId('build') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to build house:', ack.error.message);
        }
      }
    );
  };

  const handleSellHouse = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_SELL_HOUSE,
      { roomCode, spaceId, requestId: generateRequestId('sell') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to sell house:', ack.error.message);
        }
      }
    );
  };

  const handleCreateTrade = (trade: {
    receiverId: string;
    offeredCash: number;
    offeredPropertyIds: number[];
    requestedCash: number;
    requestedPropertyIds: number[];
  }) => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_CREATE,
      { roomCode, ...trade, requestId: generateRequestId('trade_create') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to propose trade:', ack.error.message);
        }
      }
    );
  };

  const handleAcceptTrade = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_ACCEPT,
      { roomCode, requestId: generateRequestId('trade_accept') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to accept trade:', ack.error.message);
        }
      }
    );
  };

  const handleRejectTrade = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_REJECT,
      { roomCode, requestId: generateRequestId('trade_reject') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to reject trade:', ack.error.message);
        }
      }
    );
  };

  const handleDeclareBankruptcy = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
      { roomCode, requestId: generateRequestId('bankruptcy') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to declare bankruptcy:', ack.error.message);
        }
      }
    );
  };

  const handleEndTurn = () => {
    if (!socket || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_END_TURN,
      { roomCode, requestId: generateRequestId('end_turn') },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to end turn:', ack.error.message);
        }
      }
    );
  };

  return (
    <div className="game-room-viewport">
      {/* ==================== 1. TOP ROOM HEADER ==================== */}
      <header className="room-top-header" role="banner">
        <div className="header-brand-group">
          <span className="header-brand-logo">CHARCHOKKHA<span className="brand-dot-io">.IO</span></span>
          <span className="header-divider" aria-hidden="true">/</span>
          {/* Room Code Badge with Copy Action */}
          <button
            type="button"
            id="btn-copy-room-link"
            className="room-code-badge-btn"
            onClick={handleCopyLink}
            title="Click to copy invitation link"
            aria-label={`Table code ${roomCode}, click to copy invite link`}
          >
            <span className="room-code-hash">#</span>
            <span className="room-code-text">{roomCode}</span>
            <span className="room-code-action-tag">{copied ? 'Copied! ✓' : 'Copy Link'}</span>
          </button>
        </div>

        {/* Header Right Actions */}
        <div className="header-actions-group">
          {/* Spectator Mode Indicator */}
          {isSpectator && (
            <div className="header-spectator-pill" title="You are spectating this table (Read-Only)">
              <span className="spectator-eye-icon" aria-hidden="true">👁️</span>
              <span className="spectator-badge-text">SPECTATING</span>
            </div>
          )}

          {/* Spectator Count Pill */}
          {(roomSnapshot.spectatorCount ?? 0) > 0 && (
            <div
              className="header-spectator-count-pill"
              title={`${roomSnapshot.spectatorCount} spectator(s) watching this table`}
            >
              <span className="spectator-eye-icon" aria-hidden="true">👁️</span>
              <span className="spectator-count-num">{roomSnapshot.spectatorCount}</span>
            </div>
          )}

          {/* Real-time sync status pill */}
          <div className="header-sync-pill" title="Server State Synchronized">
            <span className="status-live-dot" aria-hidden="true" />
            <span className="status-live-text">Live Sync</span>
          </div>

          {/* Sound Mute / Unmute Toggle */}
          <button
            type="button"
            id="btn-toggle-sound"
            className={`header-tool-btn ${isMuted ? 'tool-btn-muted' : ''}`}
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            aria-label={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
          >
            <span>{isMuted ? '🔇' : '🔊'}</span>
            <span className="btn-label-desktop">{isMuted ? 'Muted' : 'Sound'}</span>
          </button>

          {/* Chat Toggle (Desktop) */}
          <button
            type="button"
            className={`header-tool-btn ${isDesktopChatOpen ? 'tool-btn-active' : ''}`}
            onClick={() => setIsDesktopChatOpen(!isDesktopChatOpen)}
            title="Toggle Chat Panel"
            aria-label="Toggle chat panel"
          >
            <span>💬</span>
            <span className="btn-label-desktop">Chat</span>
            {chatMessages.length > 0 && (
              <span className="chat-counter-bubble">{chatMessages.length}</span>
            )}
          </button>

          {/* Settings Toggle (Desktop) */}
          <button
            type="button"
            className={`header-tool-btn ${isDesktopSettingsOpen ? 'tool-btn-active' : ''}`}
            onClick={() => setIsDesktopSettingsOpen(!isDesktopSettingsOpen)}
            title="Table Settings"
            aria-label="Table settings"
          >
            <span>⚙️</span>
            <span className="btn-label-desktop">Settings</span>
            {isHost && <span className="host-crown-mini">👑</span>}
          </button>

          {/* Leave Room Action */}
          <button
            type="button"
            id="btn-leave-room"
            className="header-tool-btn btn-leave-table"
            onClick={() => setShowLeaveConfirm(true)}
            title="Exit Table"
            aria-label="Exit Table"
          >
            <span>🚪</span>
            <span className="btn-label-desktop">Leave</span>
          </button>
        </div>
      </header>

      {/* ==================== 2. PLAYER ROSTER STRIP ==================== */}
      <section className="room-players-roster-bar" aria-label="Players at Table">
        <div className="roster-bar-inner">
          {roomSnapshot.players.map((p: Player) => {
            const pState = roomSnapshot.gameState?.players[p.id];
            const isTurn = roomSnapshot.gameState?.activePlayerId === p.id;
            const isMe = p.id === currentSessionId;

            return (
              <div
                key={p.id}
                className={`player-roster-card ${isTurn ? 'card-is-active-turn' : ''} ${isMe ? 'card-is-self' : ''}`}
              >
                <div className="player-roster-avatar-wrap">
                  <span className="player-avatar-icon">{p.avatar || '🟢'}</span>
                  {p.isHost && (
                    <span className="player-host-crown" title="Room Host">👑</span>
                  )}
                </div>

                <div className="player-roster-info-stack">
                  <div className="player-name-row">
                    <span className="roster-name-truncate">{p.nickname}</span>
                    {isMe && <span className="you-self-chip">You</span>}
                  </div>
                  <div className="player-balance-row">
                    {pState ? (
                      <span className="player-cash-bold font-mono">${pState.cash}</span>
                    ) : (
                      <span className="player-cash-bold font-mono">
                        ${roomSnapshot.settings.startingCash}
                      </span>
                    )}
                  </div>
                </div>

                {isTurn && (
                  <div className="player-active-turn-indicator" title="Active Turn">
                    <span className="pulsing-turn-dot" />
                    <span>Turn</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ==================== 3. MAIN STAGE / CONTENT LAYOUT ==================== */}
      {isSpectator && (
        <div className="spectator-top-alert-strip" role="status">
          <span className="spectator-eye-icon" aria-hidden="true">👁️</span>
          <span>You are spectating this match in real-time. Player actions and table controls are read-only.</span>
        </div>
      )}

      <div className="room-main-stage-container">
        {/* Left Column: Desktop Chat (Collapsible) */}
        {isDesktopChatOpen && (
          <aside className="room-desktop-chat-sidebar">
            <ChatPanel messages={chatMessages} onSendMessage={onSendMessage} />
          </aside>
        )}

        {/* Center Stage: The 40-Space Board */}
        <main className="room-board-center-stage">
          {/* On Mobile: Switch between Board, Chat, and Settings tabs */}
          {activeMobileTab === 'board' && (
            <Board
              roomCode={roomCode}
              roomSnapshot={roomSnapshot}
              currentSessionId={currentSessionId}
              isHost={isHost}
              isSpectator={isSpectator}
              onStartGame={handleStartGame}
              onRollDice={handleRollDice}
              onBuyProperty={handleBuyProperty}
              onDeclineProperty={handleDeclineProperty}
              onAuctionBid={handleAuctionBid}
              onAuctionPass={handleAuctionPass}
              onPayPrisonFine={handlePayPrisonFine}
              onMortgageProperty={handleMortgageProperty}
              onUnmortgageProperty={handleUnmortgageProperty}
              onBuildHouse={handleBuildHouse}
              onSellHouse={handleSellHouse}
              onCreateTrade={handleCreateTrade}
              onAcceptTrade={handleAcceptTrade}
              onRejectTrade={handleRejectTrade}
              onDeclareBankruptcy={handleDeclareBankruptcy}
              onEndTurn={handleEndTurn}
              isRolling={isRolling}
              isSubmittingAction={isSubmittingAction}
              onShowResults={() => setDismissedResultsForSequence(null)}
            />
          )}

          {activeMobileTab === 'chat' && (
            <div className="mobile-tab-view-container">
              <ChatPanel messages={chatMessages} onSendMessage={onSendMessage} />
            </div>
          )}

          {activeMobileTab === 'settings' && (
            <div className="mobile-tab-view-container">
              <GameSettings
                playerName={playerName}
                playerAvatar={currentAvatar}
                isHost={isHost}
                isSpectator={isSpectator}
                players={roomSnapshot.players}
                onAvatarChange={handleCycleAvatar}
                maxPlayers={roomSnapshot.settings.maxPlayers}
                onMaxPlayersChange={handleUpdateMaxPlayers}
                isPrivate={roomSnapshot.settings.isPrivate}
                onIsPrivateChange={handleUpdateIsPrivate}
                allowBots={roomSnapshot.settings.allowBots}
                onAllowBotsChange={handleUpdateAllowBots}
                startingCash={roomSnapshot.settings.startingCash}
                onStartingCashChange={handleUpdateStartingCash}
                settings={roomSnapshot.settings}
                onUpdateSettings={handleUpdateSettings}
                gameState={roomSnapshot.gameState}
                isMuted={isMuted}
                onToggleMute={handleToggleMute}
              />
            </div>
          )}
        </main>

        {/* Right Column: Desktop Settings (Collapsible) */}
        {isDesktopSettingsOpen && (
          <aside className="room-desktop-settings-sidebar">
            <GameSettings
              playerName={playerName}
              playerAvatar={currentAvatar}
              isHost={isHost}
              isSpectator={isSpectator}
              players={roomSnapshot.players}
              onAvatarChange={handleCycleAvatar}
              maxPlayers={roomSnapshot.settings.maxPlayers}
              onMaxPlayersChange={handleUpdateMaxPlayers}
              isPrivate={roomSnapshot.settings.isPrivate}
              onIsPrivateChange={handleUpdateIsPrivate}
              allowBots={roomSnapshot.settings.allowBots}
              onAllowBotsChange={handleUpdateAllowBots}
              startingCash={roomSnapshot.settings.startingCash}
              onStartingCashChange={handleUpdateStartingCash}
              settings={roomSnapshot.settings}
              onUpdateSettings={handleUpdateSettings}
              gameState={roomSnapshot.gameState}
              isMuted={isMuted}
              onToggleMute={handleToggleMute}
              onClose={() => setIsDesktopSettingsOpen(false)}
            />
          </aside>
        )}
      </div>

      {/* ==================== 4. MOBILE BOTTOM NAVIGATION BAR ==================== */}
      <nav className="mobile-bottom-nav-bar" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-nav-tab-btn ${activeMobileTab === 'board' ? 'tab-active' : ''}`}
          onClick={() => setActiveMobileTab('board')}
          aria-label="Board View"
        >
          <span className="tab-icon">🎲</span>
          <span className="tab-label">Board</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-tab-btn ${activeMobileTab === 'chat' ? 'tab-active' : ''}`}
          onClick={() => setActiveMobileTab('chat')}
          aria-label="Chat View"
        >
          <span className="tab-icon">💬</span>
          <span className="tab-label">Chat</span>
          {chatMessages.length > 0 && (
            <span className="tab-counter-badge">{chatMessages.length}</span>
          )}
        </button>

        <button
          type="button"
          className={`mobile-nav-tab-btn ${activeMobileTab === 'settings' ? 'tab-active' : ''}`}
          onClick={() => setActiveMobileTab('settings')}
          aria-label="Settings View"
        >
          <span className="tab-icon">⚙️</span>
          <span className="tab-label">Settings</span>
          {isHost && <span className="tab-host-crown">👑</span>}
        </button>
      </nav>

      {/* ==================== 5. POST-MATCH RESULTS SCREEN ==================== */}
      {showResultsOverlay && (
        <PostMatchResults
          roomSnapshot={roomSnapshot}
          currentSessionId={currentSessionId}
          isHost={isHost}
          isSpectator={isSpectator}
          onRematch={handleRematch}
          onToggleBoardView={() => setDismissedResultsForSequence(roomSnapshot.sequenceNumber)}
          onLeaveRoom={() => setShowLeaveConfirm(true)}
        />
      )}

      {/* Floating Inspection Banner when results are dismissed to view board */}
      {isGameFinished && !showResultsOverlay && (
        <div className="inspect-board-floating-banner" role="region" aria-label="Inspection Controls">
          <span className="inspect-banner-text">Viewing Final Tabletop</span>
          <button
            type="button"
            className="btn-floating-view-results"
            onClick={() => setDismissedResultsForSequence(null)}
          >
            View Match Results 🏆
          </button>
        </div>
      )}

      {/* ==================== 6. LEAVE CONFIRMATION MODAL ==================== */}
      {showLeaveConfirm && (
        <div
          className="modal-backdrop-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-modal-title"
          onClick={() => setShowLeaveConfirm(false)}
        >
          <div className="dialog-card-surface" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <div className="dialog-header-row">
              <h2 id="leave-modal-title" className="dialog-title-text">
                Exit Table?
              </h2>
              <button
                type="button"
                className="dialog-close-btn"
                onClick={() => setShowLeaveConfirm(false)}
                aria-label="Cancel"
              >
                ✕
              </button>
            </div>

            <p className="dialog-subtitle-text" style={{ margin: '1rem 0' }}>
              Are you sure you want to leave table <strong>{roomCode}</strong>? If a game is in progress, your seat will be vacated.
            </p>

            <div className="dialog-btn-row">
              <button
                type="button"
                className="btn-secondary-action"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay at Table
              </button>
              <button
                type="button"
                className="btn-danger-action"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onExitToMenu();
                }}
              >
                Leave Table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
