import { useState } from 'react';
import { Board } from './Board';
import { ChatPanel, type ChatMessage } from './ChatPanel';
import { GameSettings } from './GameSettings';
import {
  SOCKET_EVENTS,
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
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

  const roomCode = roomSnapshot.code;
  const roomUrl = `https://charchokkha.io/room/${roomCode}`;

  const currentPlayer = roomSnapshot.players.find((p) => p.id === currentSessionId);
  const isHost = currentSessionId === roomSnapshot.hostId;
  const currentAvatar = currentPlayer?.avatar || AVATAR_OPTIONS[avatarIndex];
  const playerName = currentPlayer?.nickname || 'Guest';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCycleAvatar = () => {
    const nextIdx = (avatarIndex + 1) % AVATAR_OPTIONS.length;
    setAvatarIndex(nextIdx);
  };

  const handleUpdateMaxPlayers = (maxPlayers: number) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { maxPlayers } },
      (_ack: SocketAck<RoomSnapshot>) => {
        // Handled via room:updated
      }
    );
  };

  const handleUpdateIsPrivate = (isPrivate: boolean) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { isPrivate } },
      (_ack: SocketAck<RoomSnapshot>) => {
        // Handled via room:updated
      }
    );
  };

  const handleUpdateAllowBots = (allowBots: boolean) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { allowBots } },
      (_ack: SocketAck<RoomSnapshot>) => {
        // Handled via room:updated
      }
    );
  };

  const handleUpdateStartingCash = (startingCash: number) => {
    if (!socket || !isHost) return;
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: { startingCash } },
      (_ack: SocketAck<RoomSnapshot>) => {
        // Handled via room:updated
      }
    );
  };

  // Authoritative Game Actions
  const handleStartGame = () => {
    if (!socket || !isHost) return;
    socket.emit(SOCKET_EVENTS.GAME_START, { roomCode }, (ack: SocketAck<RoomSnapshot>) => {
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to start game:', ack.error.message);
      }
    });
  };

  const handleRollDice = () => {
    if (!socket || isRolling) return;
    setIsRolling(true);
    socket.emit(SOCKET_EVENTS.GAME_ROLL_DICE, { roomCode }, (ack: SocketAck<RoomSnapshot>) => {
      setTimeout(() => {
        setIsRolling(false);
      }, 350);
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to roll dice:', ack.error.message);
      }
    });
  };

  const handleBuyProperty = () => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.GAME_BUY_PROPERTY, { roomCode }, (ack: SocketAck<RoomSnapshot>) => {
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to buy property:', ack.error.message);
      }
    });
  };

  const handleEndTurn = () => {
    if (!socket) return;
    socket.emit(SOCKET_EVENTS.GAME_END_TURN, { roomCode }, (ack: SocketAck<RoomSnapshot>) => {
      if (!ack.ok) {
        // eslint-disable-next-line no-console
        console.error('Failed to end turn:', ack.error.message);
      }
    });
  };

  return (
    <div className="room-viewport">
      <div className="room-desktop-grid">
        {/* ==================== LEFT COLUMN ==================== */}
        <aside className="room-left-col">
          {/* Brand & Icons */}
          <header className="room-brand-header">
            <h1 className="room-logo" onClick={onExitToMenu} title="Return to Main Menu">
              CHARCHOKKHA<span className="io-badge">.IO</span>
            </h1>
            <div className="room-header-icons" aria-label="Utility controls">
              <span title="Discord">💬</span>
              <span title="Help">❓</span>
              <span title="Sound toggle">🔊</span>
              <span title="Full screen">⛶</span>
            </div>
          </header>

          {/* Share this game card */}
          <div className="share-box-card">
            <div className="share-box-title">
              <span>Share this game</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>ⓘ</span>
            </div>
            <div className="share-box-input-group">
              <span className="share-link-text">{roomUrl}</span>
              <button
                type="button"
                id="btn-copy-room-link"
                className="btn-copy-link"
                onClick={handleCopyLink}
              >
                <span>📋</span> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Neutral Edition Banner */}
          <div className="room-sponsor-card">
            <div className="sponsor-badge">Charchokkha Empire</div>
            <div className="sponsor-title">Live Multiplayer Table</div>
            <div className="sponsor-sub">Real-time room synchronization verified</div>
          </div>

          {/* Desktop Chat Panel */}
          <div className="room-desktop-chat">
            <ChatPanel messages={chatMessages} onSendMessage={onSendMessage} />
          </div>
        </aside>

        {/* ==================== CENTER COLUMN: BOARD ==================== */}
        <main className="room-center-col">
          <Board
            roomCode={roomCode}
            roomSnapshot={roomSnapshot}
            currentSessionId={currentSessionId}
            isHost={isHost}
            onStartGame={handleStartGame}
            onRollDice={handleRollDice}
            onBuyProperty={handleBuyProperty}
            onEndTurn={handleEndTurn}
            isRolling={isRolling}
          />
        </main>

        {/* ==================== RIGHT COLUMN: SETTINGS ==================== */}
        <aside className="room-right-col">
          <GameSettings
            playerName={playerName}
            playerAvatar={currentAvatar}
            isHost={isHost}
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
            gameState={roomSnapshot.gameState}
          />
        </aside>
      </div>

      {/* Floating Chat Button for Mobile */}
      <button
        type="button"
        id="btn-mobile-chat"
        className="mobile-chat-fab"
        onClick={() => setIsMobileChatOpen(true)}
        aria-label="Open Chat"
      >
        💬
      </button>

      {/* Mobile Chat Slide-Up Modal */}
      {isMobileChatOpen && (
        <ChatPanel
          messages={chatMessages}
          onSendMessage={onSendMessage}
          onCloseMobile={() => setIsMobileChatOpen(false)}
          isMobileModal
        />
      )}
    </div>
  );
}
