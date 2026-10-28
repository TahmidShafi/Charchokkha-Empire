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

type AppScreen = 'landing' | 'room';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('landing');
  const [nickname, setNickname] = useState('Hateful Escape');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [serverError, setServerError] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const lastSequenceRef = useRef<number>(0);

  useEffect(() => {
    const backendUrl =
      import.meta.env.VITE_SERVER_URL ||
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : window.location.origin);

    const storedToken = localStorage.getItem('charchokkha_guest_token') || undefined;

    const s = io(backendUrl, {
      auth: { token: storedToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });

    s.on('connect', () => {
      setServerError('');
    });

    // 1. Authenticated guest identity from server
    s.on(SOCKET_EVENTS.SESSION_AUTHENTICATED, (auth: SessionAuthenticatedPayload) => {
      localStorage.setItem('charchokkha_guest_token', auth.token);
      setCurrentSessionId(auth.sessionId);
    });

    // 2. Authoritative room snapshot
    s.on(SOCKET_EVENTS.ROOM_SNAPSHOT, (snapshot: RoomSnapshot) => {
      lastSequenceRef.current = snapshot.sequenceNumber;
      setRoomSnapshot(snapshot);
      setScreen('room');
    });

    // 3. Room updated with sequence tracking
    s.on(SOCKET_EVENTS.ROOM_UPDATED, (snapshot: RoomSnapshot) => {
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
            if (res.ok) {
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
          text: `👁️ ${data.nickname} is now spectating this table.`,
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
          text: `👁️ ${data.nickname} left spectator mode.`,
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

  const handleCreateRoom = (avatar: string = '🟢', isPrivate: boolean = false) => {
    if (!socket) {
      setServerError('Connecting to game server...');
      return;
    }
    setServerError('');

    socket.emit(
      SOCKET_EVENTS.ROOM_CREATE,
      {
        nickname: nickname.trim() || 'Player',
        avatar,
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

  const handleJoinByCode = (code: string, avatar: string = '🟢') => {
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
        avatar,
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
            text: `👁️ Spectating table ${ack.data.code} in real-time. Actions are read-only.`,
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
    setScreen('landing');
  };

  const handleSendMessage = (text: string) => {
    if (!socket || !roomSnapshot) return;
    socket.emit(SOCKET_EVENTS.CHAT_SEND, { roomCode: roomSnapshot.code, text });
  };

  return (
    <>
      {screen === 'landing' || !roomSnapshot ? (
        <LandingPage
          nickname={nickname}
          onNicknameChange={setNickname}
          onPlay={(avatar) => handleCreateRoom(avatar, false)}
          onCreatePrivate={(avatar) => handleCreateRoom(avatar, true)}
          onJoinByCode={handleJoinByCode}
          onSpectateByCode={handleSpectateByCode}
          serverError={serverError}
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
