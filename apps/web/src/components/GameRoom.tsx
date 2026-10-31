import { useState, useRef, useEffect } from 'react';
import { Board } from './Board';
import { PlayerCharacter } from './PlayerCharacter';
import { ChatPanel, type ChatMessage } from './ChatPanel';
import { GameSettings } from './GameSettings';
import { PostMatchResults } from './PostMatchResults';
import { soundManager } from '../audio/soundManager';
import { DiceIcon, ChatIcon, SettingsIcon, CrownIcon, EyeIcon, TrophyIcon } from './Icons';
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

  // Durable pending action tracking: reuses the exact same requestId on retry
  const pendingRequestsRef = useRef<Map<string, string>>(new Map());

  const getOrCreateRequestId = (actionKey: string): string => {
    const existing = pendingRequestsRef.current.get(actionKey);
    if (existing) {
      return existing;
    }
    const newId = `req_${actionKey}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    pendingRequestsRef.current.set(actionKey, newId);
    return newId;
  };

  const clearRequestId = (actionKey: string) => {
    pendingRequestsRef.current.delete(actionKey);
  };

  // Reset in-flight flags on socket disconnect or sequence update so buttons do not stay stuck
  useEffect(() => {
    if (!socket) return;
    const handleDisconnect = () => {
      setIsSubmittingAction(false);
      setIsRolling(false);
    };
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    setIsSubmittingAction(false);
  }, [roomSnapshot.sequenceNumber]);

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

  const handleSelectColor = (color: string) => {
    if (!socket || isSpectator || roomSnapshot.state !== 'waiting') return;
    const reqId = getOrCreateRequestId('select_color');
    socket.emit(
      SOCKET_EVENTS.ROOM_SELECT_COLOR,
      { roomCode, color, requestId: reqId },
      () => {
        clearRequestId('select_color');
      }
    );
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
    const actionKey = `settings_${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_UPDATE_SETTINGS,
      { roomCode, settings: partial, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack?.ok) {
          clearRequestId(actionKey);
        }
      }
    );
  };

  const handleAddBot = (count = 1) => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_BOT_ADD,
      { roomCode, count },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack?.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to add bot:', ack?.error?.message);
        }
      }
    );
  };

  const handleRemoveBot = (botPlayerId: string) => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_BOT_REMOVE,
      { roomCode, botPlayerId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack?.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to remove bot:', ack?.error?.message);
        }
      }
    );
  };

  const handleSetBotSpeed = (speed: 'normal' | 'slow') => {
    if (!socket || !isHost || isSubmittingAction) return;
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_BOT_SET_SPEED,
      { roomCode, speed },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (!ack?.ok) {
          // eslint-disable-next-line no-console
          console.error('Failed to set bot speed:', ack?.error?.message);
        }
      }
    );
  };

  // Authoritative Game Actions
  const handleStartGame = () => {
    if (!socket || !isHost || isSubmittingAction) return;
    const actionKey = `start_${roomCode}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_START,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to start game:', ack.error.message);
        }
      }
    );
  };

  const handleRematch = () => {
    if (!socket || !isHost || isSubmittingAction) return;
    const actionKey = `rematch_${roomCode}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.ROOM_REMATCH,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to initiate rematch:', ack.error.message);
        }
      }
    );
  };

  const handleRollDice = () => {
    if (!socket || isRolling || isSubmittingAction) return;
    const actionKey = `roll_${roomSnapshot.gameState?.currentTurnIndex ?? 0}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsRolling(true);
    setIsSubmittingAction(true);

    const safetyTimer = setTimeout(() => {
      setIsSubmittingAction(false);
      setIsRolling(false);
    }, 3000);

    socket.emit(
      SOCKET_EVENTS.GAME_ROLL_DICE,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        clearTimeout(safetyTimer);
        setIsSubmittingAction(false);
        setTimeout(() => {
          setIsRolling(false);
        }, 350);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to roll dice:', ack.error.message);
        }
      }
    );
  };

  const handleBuyProperty = () => {
    if (!socket || isSubmittingAction) return;
    const currentPos = roomSnapshot.gameState?.players[currentSessionId]?.position ?? 0;
    const actionKey = `buy_${currentPos}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_BUY_PROPERTY,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to buy property:', ack.error.message);
        }
      }
    );
  };

  const handleDeclineProperty = () => {
    if (!socket || isSubmittingAction) return;
    const currentPos = roomSnapshot.gameState?.players[currentSessionId]?.position ?? 0;
    const actionKey = `decline_${currentPos}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_DECLINE_PROPERTY,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to decline property:', ack.error.message);
        }
      }
    );
  };

  const handleAuctionBid = (bidAmount: number) => {
    if (!socket || isSubmittingAction) return;
    const spaceId = roomSnapshot.gameState?.auction?.spaceId ?? 0;
    const actionKey = `bid_${spaceId}_${bidAmount}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_AUCTION_BID,
      { roomCode, bidAmount, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Auction bid failed:', ack.error.message);
        }
      }
    );
  };

  const handleAuctionPass = () => {
    if (!socket || isSubmittingAction) return;
    const spaceId = roomSnapshot.gameState?.auction?.spaceId ?? 0;
    const actionKey = `pass_${spaceId}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_AUCTION_PASS,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Auction pass failed:', ack.error.message);
        }
      }
    );
  };

  const handlePayPrisonFine = () => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `pay_prison_${roomSnapshot.gameState?.currentTurnIndex ?? 0}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_PAY_PRISON_FINE,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to pay prison fine:', ack.error.message);
        }
      }
    );
  };

  const handleMortgageProperty = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `mortgage_${spaceId}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_MORTGAGE_PROPERTY,
      { roomCode, spaceId, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to mortgage property:', ack.error.message);
        }
      }
    );
  };

  const handleUnmortgageProperty = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `unmortgage_${spaceId}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_UNMORTGAGE_PROPERTY,
      { roomCode, spaceId, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to unmortgage property:', ack.error.message);
        }
      }
    );
  };

  const handleBuildHouse = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `build_${spaceId}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_BUILD_HOUSE,
      { roomCode, spaceId, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to build house:', ack.error.message);
        }
      }
    );
  };

  const handleSellHouse = (spaceId: number) => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `sell_${spaceId}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_SELL_HOUSE,
      { roomCode, spaceId, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
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
    const actionKey = `trade_create_${trade.receiverId}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_CREATE,
      { roomCode, ...trade, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to propose trade:', ack.error.message);
        }
      }
    );
  };

  const handleAcceptTrade = () => {
    if (!socket || isSubmittingAction) return;
    const tradeId = roomSnapshot.gameState?.pendingTrade?.id ?? 'trade';
    const actionKey = `trade_accept_${tradeId}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_ACCEPT,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to accept trade:', ack.error.message);
        }
      }
    );
  };

  const handleRejectTrade = () => {
    if (!socket || isSubmittingAction) return;
    const tradeId = roomSnapshot.gameState?.pendingTrade?.id ?? 'trade';
    const actionKey = `trade_reject_${tradeId}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_TRADE_REJECT,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to reject trade:', ack.error.message);
        }
      }
    );
  };

  const handleDeclareBankruptcy = () => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `bankruptcy_${currentSessionId}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_DECLARE_BANKRUPTCY,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to declare bankruptcy:', ack.error.message);
        }
      }
    );
  };

  const handleEndTurn = () => {
    if (!socket || isSubmittingAction) return;
    const actionKey = `end_turn_${roomSnapshot.gameState?.currentTurnIndex ?? 0}_seq${roomSnapshot.sequenceNumber}`;
    const requestId = getOrCreateRequestId(actionKey);
    setIsSubmittingAction(true);
    socket.emit(
      SOCKET_EVENTS.GAME_END_TURN,
      { roomCode, requestId },
      (ack: SocketAck<RoomSnapshot>) => {
        setIsSubmittingAction(false);
        if (ack.ok) {
          clearRequestId(actionKey);
        } else {
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
              <EyeIcon size={14} className="spectator-eye-icon" />
              <span className="spectator-badge-text">SPECTATING</span>
            </div>
          )}

          {/* Spectator Count Pill */}
          {(roomSnapshot.spectatorCount ?? 0) > 0 && (
            <div
              className="header-spectator-count-pill"
              title={`${roomSnapshot.spectatorCount} spectator(s) watching this table`}
            >
              <EyeIcon size={14} className="spectator-eye-icon" />
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
            className={`header-tool-btn btn-sound-toggle ${isMuted ? 'tool-btn-muted' : ''}`}
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            aria-label={isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
          >
            {isMuted ? (
              <svg
                className="header-svg-icon icon-muted"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
              </svg>
            ) : (
              <svg
                className="header-svg-icon icon-sound"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
            <span className="btn-label-desktop">{isMuted ? 'Muted' : 'Sound'}</span>
          </button>

          {/* Chat Toggle (Desktop Only) */}
          <button
            type="button"
            className={`header-tool-btn header-btn-desktop-only ${isDesktopChatOpen ? 'tool-btn-active' : ''}`}
            onClick={() => setIsDesktopChatOpen(!isDesktopChatOpen)}
            title="Toggle Chat Panel"
            aria-label="Toggle chat panel"
          >
            <svg
              className="header-svg-icon"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="btn-label-desktop">Chat</span>
            {chatMessages.length > 0 && (
              <span className="chat-counter-bubble">{chatMessages.length}</span>
            )}
          </button>

          {/* Settings Toggle (Desktop Only) */}
          <button
            type="button"
            className={`header-tool-btn header-btn-desktop-only ${isDesktopSettingsOpen ? 'tool-btn-active' : ''}`}
            onClick={() => setIsDesktopSettingsOpen(!isDesktopSettingsOpen)}
            title="Table Settings"
            aria-label="Table settings"
          >
            <svg
              className="header-svg-icon"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="btn-label-desktop">Settings</span>
            {isHost && <CrownIcon size={12} className="host-crown-mini" />}
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
            <svg
              className="header-svg-icon icon-exit"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
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
                  <PlayerCharacter color={p.color || '#C4E64A'} size={24} showGlow={false} />
                  {p.isHost && (
                    <CrownIcon size={12} className="player-host-crown" title="Room Host" />
                  )}
                </div>

                <div className="player-roster-info-stack">
                  <div className="player-name-row">
                    <span className="roster-name-truncate">{p.nickname}</span>
                    {p.isBot && <span className="bot-self-chip">BOT</span>}
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
          <EyeIcon size={15} className="spectator-eye-icon" />
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

        {/* Center Stage: The 40-Space Board or Mobile Tab View */}
        <main className={`room-board-center-stage ${activeMobileTab !== 'board' ? 'tab-stage-active' : ''}`}>
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
                playerColor={currentPlayer?.color || '#C4E64A'}
                onColorChange={handleSelectColor}
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
                onAddBot={handleAddBot}
                onRemoveBot={handleRemoveBot}
                onSetBotSpeed={handleSetBotSpeed}
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
              playerColor={currentPlayer?.color || '#C4E64A'}
              onColorChange={handleSelectColor}
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
              onAddBot={handleAddBot}
              onRemoveBot={handleRemoveBot}
              onSetBotSpeed={handleSetBotSpeed}
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
          <DiceIcon size={18} className="tab-icon" />
          <span className="tab-label">Board</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-tab-btn ${activeMobileTab === 'chat' ? 'tab-active' : ''}`}
          onClick={() => setActiveMobileTab('chat')}
          aria-label="Chat View"
        >
          <ChatIcon size={18} className="tab-icon" />
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
          <SettingsIcon size={18} className="tab-icon" />
          <span className="tab-label">Settings</span>
          {isHost && <CrownIcon size={12} className="tab-host-crown" />}
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
            <span>View Match Results</span>
            <TrophyIcon size={14} style={{ marginLeft: 6 }} />
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
