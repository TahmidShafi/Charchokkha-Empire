import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type ChatMessageBroadcast,
  type RoomSnapshot,
  type SessionAuthenticatedPayload,
  type SocketAck,
} from '@charchokkha/shared';
import { LandingPage } from './components/LandingPage';
import { GameRoom } from './components/GameRoom';
import { type ChatMessage } from './components/ChatPanel';
import { parseInviteRoomCode } from './utils/inviteLink';
import { AlertCircleIcon, AlertTriangleIcon, RefreshIcon } from './components/Icons';

type AppScreen = 'landing' | 'room';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('landing');
  const [nickname, setNickname] = useState('Hateful Escape');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [pendingInviteRoom, setPendingInviteRoom] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const isMock = new URLSearchParams(window.location.search).get('mock') === '1';
      if (!isMock) {
        const parsed = parseInviteRoomCode(window.location.search);
        if (parsed.code) return parsed.code;
      }
    }
    return null;
  });
  const [serverError, setServerError] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const isMock = new URLSearchParams(window.location.search).get('mock') === '1';
      if (!isMock) {
        const parsed = parseInviteRoomCode(window.location.search);
        if (parsed.error) return parsed.error;
      }
    }
    return '';
  });
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'connecting' | 'reconnecting' | 'disconnected'
  >('connecting');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const lastSequenceRef = useRef<number>(0);
  const pendingInviteRoomRef = useRef<string | null>(pendingInviteRoom);
  const hasAttemptedInviteJoinRef = useRef<boolean>(false);
  const nicknameRef = useRef<string>(nickname);

  useEffect(() => {
    pendingInviteRoomRef.current = pendingInviteRoom;
  }, [pendingInviteRoom]);

  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1') {
      const urlParams = new URLSearchParams(window.location.search);
      const isPrivateMock = urlParams.get('private') === '1';
      const isWaitingMock = urlParams.get('waiting') === '1';
      const mockPhase = (urlParams.get('phase') as any) || 'need_roll';
      const mockSnap: RoomSnapshot = {
        code: 'TABLE1',
        hostId: 'p1',
        state: isWaitingMock ? 'waiting' : 'in_progress',
        sequenceNumber: 10,
        createdAt: Date.now(),
        settings: {
          maxPlayers: 4,
          isPrivate: isPrivateMock,
          allowBots: isPrivateMock,
          startingCash: 1500,
          doubleRent: true,
          vacationCash: true,
          auction: true,
          noRentInPrison: false,
          mortgage: true,
          evenBuild: true,
        },
        players: [
          { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
          { id: 'p2', nickname: 'Bob', avatar: '🎩', color: '#FFC83D', isHost: false, connected: true, seatIndex: 1 },
          { id: 'p3', nickname: 'Charlie', avatar: '🐱', color: '#559BD6', isHost: false, connected: true, seatIndex: 2 },
          { id: 'p4', nickname: 'Diana', avatar: '🚀', color: '#FF8738', isHost: false, connected: true, seatIndex: 3 },
        ],
        gameState: isWaitingMock ? undefined : {
          phase: 'in_progress',
          turnOrder: ['p1', 'p2', 'p3', 'p4'],
          currentTurnIndex: 0,
          activePlayerId: 'p1',
          turnPhase: mockPhase,
          lastDiceRoll: { die1: 4, die2: 3, total: 7, isDouble: false },
          startingSalary: 200,
          vacationPot: 150,
          players: {
            p1: { id: 'p1', position: 7, cash: 1350, inPrison: false, prisonTurns: 0, isBankrupt: false },
            p2: { id: 'p2', position: 15, cash: 1280, inPrison: false, prisonTurns: 0, isBankrupt: false },
            p3: { id: 'p3', position: 27, cash: 1420, inPrison: false, prisonTurns: 0, isBankrupt: false },
            p4: { id: 'p4', position: 40, cash: 1100, inPrison: false, prisonTurns: 0, isBankrupt: false },
          },
          properties: {
            '1': { ownerId: 'p1', houses: 0, isMortgaged: false },
            '3': { ownerId: 'p1', houses: 2, isMortgaged: false },
            '13': { ownerId: 'p2', houses: 0, isMortgaged: false },
            '14': { ownerId: 'p2', houses: 0, isMortgaged: false },
            '25': { ownerId: 'p3', houses: 0, isMortgaged: false },
            '41': { ownerId: 'p4', houses: 0, isMortgaged: false },
            '47': { ownerId: 'p4', houses: 5, isMortgaged: false },
          },
          rules: {
            doubleRent: true,
            vacationCash: true,
            auction: true,
            noRentInPrison: false,
            mortgage: true,
            evenBuild: true,
          },
        },
      };
      setCurrentSessionId('p1');
      setConnectionStatus('connected');
      setRoomSnapshot(mockSnap);
      setScreen('room');
      return;
    }

    const backendUrl =
      import.meta.env.VITE_SERVER_URL ||
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : window.location.origin);

    const storedToken = localStorage.getItem('charchokkha_guest_token') || undefined;

    const s = io(backendUrl, {
      auth: { token: storedToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    });

    s.on('connect', () => {
      setConnectionStatus('connected');
      setServerError('');
    });

    s.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    s.io.on('reconnect_attempt', () => {
      setConnectionStatus('reconnecting');
    });

    s.io.on('reconnect', () => {
      setConnectionStatus('connected');
    });

    s.io.on('reconnect_failed', () => {
      setConnectionStatus('disconnected');
      setServerError('Unable to reconnect to server. Please refresh or verify your connection.');
    });

    // 1. Authenticated guest identity from server
    s.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
      localStorage.setItem('charchokkha_guest_token', auth.token);
      setCurrentSessionId(auth.sessionId);

      const targetRoom = pendingInviteRoomRef.current;
      if (!targetRoom || hasAttemptedInviteJoinRef.current) {
        return;
      }

      // If session was already in this room, server automatically sent/sends ROOM_SNAPSHOT
      if (auth.currentRoomCode && auth.currentRoomCode.toUpperCase() === targetRoom.toUpperCase()) {
        hasAttemptedInviteJoinRef.current = true;
        setPendingInviteRoom(null);
        pendingInviteRoomRef.current = null;
        return;
      }

      // Prevent duplicate join requests across re-renders or socket events
      hasAttemptedInviteJoinRef.current = true;

      s.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode: targetRoom,
          nickname: nicknameRef.current.trim() || 'Player',
        },
        (ack: SocketAck<RoomSnapshot>) => {
          setPendingInviteRoom(null);
          pendingInviteRoomRef.current = null;

          if (!ack.ok) {
            setServerError(ack.error.message || `Failed to join room ${targetRoom}.`);
            if (typeof window !== 'undefined' && window.history?.replaceState) {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
            return;
          }

          lastSequenceRef.current = ack.data.sequenceNumber;
          setRoomSnapshot(ack.data);
          setChatMessages([
            {
              id: `init_${Date.now()}`,
              sender: 'System',
              text: `Joined table ${ack.data.code} via invite link.`,
              isSystem: true,
            },
          ]);
          setScreen('room');

          if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }
      );
    });

    // 2. Authoritative room snapshot
    s.on(SOCKET_EVENTS.ROOM_SNAPSHOT, (snapshot: RoomSnapshot) => {
      if (snapshot.sequenceNumber < lastSequenceRef.current) {
        return; // Stale snapshot ignored
      }
      lastSequenceRef.current = snapshot.sequenceNumber;
      setPendingInviteRoom(null);
      pendingInviteRoomRef.current = null;
      setRoomSnapshot(snapshot);
      setScreen('room');
    });

    // 3. Room updated with sequence tracking
    s.on(SOCKET_EVENTS.ROOM_UPDATED, (snapshot: RoomSnapshot) => {
      if (snapshot.sequenceNumber < lastSequenceRef.current) {
        return; // Ignore stale delayed update
      }

      // Check for sequence number gap
      if (
        lastSequenceRef.current > 0 &&
        snapshot.sequenceNumber > lastSequenceRef.current + 1
      ) {
        // Gap detected: request fresh snapshot from server
        s.emit(
          SOCKET_EVENTS.ROOM_GET_SNAPSHOT,
          { roomCode: snapshot.code },
          (res: SocketAck<RoomSnapshot>) => {
            if (res.ok && res.data.sequenceNumber >= lastSequenceRef.current) {
              lastSequenceRef.current = res.data.sequenceNumber;
              setRoomSnapshot(res.data);
            }
          }
        );
        return;
      }

      lastSequenceRef.current = snapshot.sequenceNumber;
      setRoomSnapshot(snapshot);
    });

    // 4. Room player notifications
    s.on(SOCKET_EVENTS.ROOM_PLAYER_JOINED, (data: { nickname: string }) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `join_${Date.now()}_${Math.random()}`,
          sender: 'System',
          text: `${data.nickname} joined the table.`,
          isSystem: true,
        },
      ]);
    });

    s.on(SOCKET_EVENTS.ROOM_PLAYER_LEFT, (data: { nickname: string }) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `leave_${Date.now()}_${Math.random()}`,
          sender: 'System',
          text: `${data.nickname} left the table.`,
          isSystem: true,
        },
      ]);
    });

    s.on(SOCKET_EVENTS.ROOM_PLAYER_RECONNECTED, (data: { nickname: string }) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `reconnect_${Date.now()}_${Math.random()}`,
          sender: 'System',
          text: `${data.nickname} reconnected to their seat.`,
          isSystem: true,
        },
      ]);
    });

    s.on(SOCKET_EVENTS.ROOM_SPECTATOR_JOINED, (data: { nickname: string }) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `spec_join_${Date.now()}_${Math.random()}`,
          sender: 'System',
          text: `${data.nickname} is now spectating this table.`,
          isSystem: true,
        },
      ]);
    });

    s.on(SOCKET_EVENTS.ROOM_SPECTATOR_LEFT, (data: { nickname: string }) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `spec_leave_${Date.now()}_${Math.random()}`,
          sender: 'System',
          text: `${data.nickname} left spectator mode.`,
          isSystem: true,
        },
      ]);
    });

    // 5. Chat messages
    s.on(SOCKET_EVENTS.CHAT_MESSAGE, (msg: ChatMessageBroadcast) => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          sender: msg.senderNickname,
          text: msg.text,
          isSystem: msg.isSystem,
        },
      ]);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  const handleCreateRoom = (color: string = '#C4E64A', isPrivate: boolean = false) => {
    if (!socket) {
      setServerError('Connecting to game server...');
      return;
    }
    setServerError('');

    socket.emit(
      SOCKET_EVENTS.ROOM_CREATE,
      {
        nickname: nickname.trim() || 'Player',
        color,
        settings: isPrivate ? { isPrivate: true } : undefined,
      },
      (ack: SocketAck<RoomSnapshot>) => {
        if (!ack.ok) {
          setServerError(ack.error.message);
          return;
        }
        lastSequenceRef.current = ack.data.sequenceNumber;
        setRoomSnapshot(ack.data);
        setChatMessages([
          {
            id: `init_${Date.now()}`,
            sender: 'System',
            text: `Table ${ack.data.code} created. Share the link with friends to play.`,
            isSystem: true,
          },
        ]);
        setScreen('room');
      }
    );
  };

  const handleJoinByCode = (code: string, color: string = '#C4E64A') => {
    if (!socket) {
      setServerError('Connecting to game server...');
      return;
    }
    setServerError('');

    socket.emit(
      SOCKET_EVENTS.ROOM_JOIN,
      {
        roomCode: code,
        nickname: nickname.trim() || 'Player',
        color,
      },
      (ack: SocketAck<RoomSnapshot>) => {
        if (!ack.ok) {
          setServerError(ack.error.message);
          return;
        }
        lastSequenceRef.current = ack.data.sequenceNumber;
        setRoomSnapshot(ack.data);
        setChatMessages([
          {
            id: `init_${Date.now()}`,
            sender: 'System',
            text: `Joined table ${ack.data.code}.`,
            isSystem: true,
          },
        ]);
        setScreen('room');
      }
    );
  };

  const handleSpectateByCode = (code: string) => {
    if (!socket) {
      setServerError('Connecting to game server...');
      return;
    }
    setServerError('');

    socket.emit(
      SOCKET_EVENTS.ROOM_SPECTATE,
      {
        roomCode: code,
        nickname: nickname.trim() || 'Spectator',
      },
      (ack: SocketAck<RoomSnapshot>) => {
        if (!ack.ok) {
          setServerError(ack.error.message);
          return;
        }
        lastSequenceRef.current = ack.data.sequenceNumber;
        setRoomSnapshot(ack.data);
        setChatMessages([
          {
            id: `init_${Date.now()}`,
            sender: 'System',
            text: `Spectating table ${ack.data.code} in real-time. Actions are read-only.`,
            isSystem: true,
          },
        ]);
        setScreen('room');
      }
    );
  };

  const handleExitToMenu = () => {
    if (socket && roomSnapshot) {
      socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode: roomSnapshot.code });
    }
    setRoomSnapshot(null);
    setChatMessages([]);
    setPendingInviteRoom(null);
    pendingInviteRoomRef.current = null;
    setScreen('landing');
  };

  const handleSendMessage = (text: string) => {
    if (!socket || !roomSnapshot) return;
    socket.emit(SOCKET_EVENTS.CHAT_SEND, { roomCode: roomSnapshot.code, text });
  };

  return (
    <>
      {connectionStatus !== 'connected' && (
        <div className="network-status-banner" role="status" aria-live="polite">
          {connectionStatus === 'reconnecting' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangleIcon size={15} />
              <span>Network interrupted — reconnecting to match...</span>
            </span>
          )}
          {connectionStatus === 'disconnected' && (
            <div className="network-status-disconnected-row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AlertCircleIcon size={15} />
                <span>Disconnected from server.</span>
              </span>
              <button
                type="button"
                className="btn-network-reconnect"
                onClick={() => {
                  if (socket) {
                    socket.connect();
                  } else {
                    window.location.reload();
                  }
                }}
              >
                <span>Reconnect</span>
                <RefreshIcon size={13} style={{ marginLeft: 6 }} />
              </button>
            </div>
          )}
          {connectionStatus === 'connecting' && screen === 'room' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RefreshIcon size={14} className="spinning-sync-icon" />
              <span>Synchronizing with table...</span>
            </span>
          )}
        </div>
      )}
      {screen === 'landing' || !roomSnapshot ? (
        <LandingPage
          nickname={nickname}
          onNicknameChange={setNickname}
          onPlay={(color) => handleCreateRoom(color, false)}
          onCreatePrivate={(color) => handleCreateRoom(color, true)}
          onJoinByCode={handleJoinByCode}
          onSpectateByCode={handleSpectateByCode}
          serverError={serverError}
          isConnecting={Boolean(pendingInviteRoom)}
        />
      ) : (
        <GameRoom
          roomSnapshot={roomSnapshot}
          currentSessionId={currentSessionId}
          socket={socket}
          onExitToMenu={handleExitToMenu}
          chatMessages={chatMessages}
          onSendMessage={handleSendMessage}
        />
      )}
    </>
  );
}
