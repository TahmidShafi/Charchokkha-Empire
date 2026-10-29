import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SOCKET_EVENTS, type RoomSnapshot, type SessionAuthenticatedPayload, type SocketAck } from '@charchokkha/shared';
import { parseInviteRoomCode } from '../src/utils/inviteLink.js';
import { LandingPage } from '../src/components/LandingPage.js';

describe('Private-Room Invitation Link Parser (parseInviteRoomCode)', () => {
  it('extracts canonical uppercase room code from full production URL', () => {
    const result = parseInviteRoomCode('https://charchokkha-empire.pages.dev/?room=LLPAG');
    expect(result.error).toBeNull();
    expect(result.code).toBe('LLPAG');
  });

  it('extracts room code from local development URL', () => {
    const result = parseInviteRoomCode('http://localhost:5173/?room=ABCDE');
    expect(result.error).toBeNull();
    expect(result.code).toBe('ABCDE');
  });

  it('extracts room code from standalone search query string', () => {
    const result = parseInviteRoomCode('?room=TEST1');
    expect(result.error).toBeNull();
    expect(result.code).toBe('TEST1');
  });

  it('handles lowercase room codes case-insensitively by normalizing to uppercase', () => {
    const result = parseInviteRoomCode('https://charchokkha-empire.pages.dev/?room=llpag');
    expect(result.error).toBeNull();
    expect(result.code).toBe('LLPAG');
  });

  it('strips leading and trailing whitespace from the room code', () => {
    const result = parseInviteRoomCode('?room=%20%20LLPAG%20%20');
    expect(result.error).toBeNull();
    expect(result.code).toBe('LLPAG');
  });

  it('strips URL fragment hashes attached to the URL', () => {
    const result = parseInviteRoomCode('https://charchokkha-empire.pages.dev/?room=LLPAG#player-lobby');
    expect(result.error).toBeNull();
    expect(result.code).toBe('LLPAG');
  });

  it('correctly handles multi-param query strings where room is in any position', () => {
    const result1 = parseInviteRoomCode('?foo=bar&room=ROOM9&baz=123');
    expect(result1.code).toBe('ROOM9');

    const result2 = parseInviteRoomCode('?room=FIRST&other=true');
    expect(result2.code).toBe('FIRST');
  });

  it('returns null code and null error when no room parameter is present (normal homepage)', () => {
    expect(parseInviteRoomCode('')).toEqual({ code: null, error: null });
    expect(parseInviteRoomCode(null)).toEqual({ code: null, error: null });
    expect(parseInviteRoomCode(undefined)).toEqual({ code: null, error: null });
    expect(parseInviteRoomCode('?mock=1')).toEqual({ code: null, error: null });
    expect(parseInviteRoomCode('https://charchokkha-empire.pages.dev/')).toEqual({ code: null, error: null });
  });

  it('returns a descriptive error when room parameter is empty', () => {
    const result = parseInviteRoomCode('?room=');
    expect(result.code).toBeNull();
    expect(result.error).toContain('cannot be empty');
  });

  it('returns a descriptive error when room code is too short (< 3 characters)', () => {
    const result = parseInviteRoomCode('?room=AB');
    expect(result.code).toBeNull();
    expect(result.error).toContain('must be 3–10 characters');
    expect(result.error).toContain('received 2');
  });

  it('returns a descriptive error when room code is too long (> 10 characters)', () => {
    const result = parseInviteRoomCode('?room=ABCDEFGHIJKL');
    expect(result.code).toBeNull();
    expect(result.error).toContain('must be 3–10 characters');
    expect(result.error).toContain('received 12');
  });

  it('returns a descriptive error when room code contains special or illegal characters', () => {
    const result = parseInviteRoomCode('?room=LL-PAG!');
    expect(result.code).toBeNull();
    expect(result.error).toContain('only contain letters and numbers');
  });
});

describe('LandingPage UI Invitation & Connecting States', () => {
  it('renders "Connecting to Table..." and disables buttons during pending invite connection', () => {
    const html = renderToStaticMarkup(
      React.createElement(LandingPage, {
        nickname: 'Speedy Racer',
        onNicknameChange: () => {},
        onPlay: () => {},
        onCreatePrivate: () => {},
        onJoinByCode: () => {},
        isConnecting: true,
      })
    );

    // Primary button should show connecting label and spinner
    expect(html).toContain('Connecting to Table...');
    expect(html).toContain('button-spinner');

    // Primary and secondary buttons should have disabled attribute
    expect(html).toContain('id="btn-play"');
    expect(html).toMatch(/id="btn-play"[^>]*disabled/);
    expect(html).toMatch(/id="btn-all-rooms"[^>]*disabled/);
    expect(html).toMatch(/id="btn-create-private"[^>]*disabled/);
  });

  it('renders prominent error banner when invite join fails with serverError', () => {
    const errorMessage = 'Room LLPAG does not exist or has expired';
    const html = renderToStaticMarkup(
      React.createElement(LandingPage, {
        nickname: 'Speedy Racer',
        onNicknameChange: () => {},
        onPlay: () => {},
        onCreatePrivate: () => {},
        onJoinByCode: () => {},
        serverError: errorMessage,
        isConnecting: false,
      })
    );

    expect(html).toContain('landing-alert-banner');
    expect(html).toContain(errorMessage);
    expect(html).not.toContain('button-spinner');
  });
});

describe('Frontend Invite Link Auto-Join Coordinator Logic', () => {
  type MockEmitCallback = (ack: SocketAck<RoomSnapshot>) => void;

  interface AutoJoinContext {
    targetRoom: string | null;
    hasAttemptedJoin: boolean;
    nickname: string;
    screen: string;
    serverError: string;
    roomSnapshot: RoomSnapshot | null;
    cleanedUrl: string | null;
  }

  function createCoordinator(initialRoom: string | null, nickname: string = 'Guest') {
    const state: AutoJoinContext = {
      targetRoom: initialRoom,
      hasAttemptedJoin: false,
      nickname,
      screen: 'landing',
      serverError: '',
      roomSnapshot: null,
      cleanedUrl: null,
    };

    const emitCalls: Array<{ event: string; payload: unknown; callback?: MockEmitCallback }> = [];

    const mockSocket = {
      emit: (event: string, payload: unknown, callback?: MockEmitCallback) => {
        emitCalls.push({ event, payload, callback });
      },
    };

    const mockHistory = {
      replaceState: (_data: unknown, _title: string, url: string) => {
        state.cleanedUrl = url;
      },
    };

    // Implements exact logic from App.tsx on SESSION_AUTHENTICATED
    const onSessionAuthenticated = (auth: SessionAuthenticatedPayload) => {
      const targetRoom = state.targetRoom;
      if (!targetRoom || state.hasAttemptedJoin) {
        return;
      }

      if (auth.currentRoomCode && auth.currentRoomCode.toUpperCase() === targetRoom.toUpperCase()) {
        state.hasAttemptedJoin = true;
        state.targetRoom = null;
        return;
      }

      state.hasAttemptedJoin = true;

      mockSocket.emit(
        SOCKET_EVENTS.ROOM_JOIN,
        {
          roomCode: targetRoom,
          nickname: state.nickname.trim() || 'Player',
        },
        (ack: SocketAck<RoomSnapshot>) => {
          state.targetRoom = null;

          if (!ack.ok) {
            state.serverError = ack.error.message || `Failed to join room ${targetRoom}.`;
            mockHistory.replaceState({}, '', '/');
            return;
          }

          state.roomSnapshot = ack.data;
          state.screen = 'room';
          mockHistory.replaceState({}, '', '/');
        }
      );
    };

    return { state, mockSocket, emitCalls, mockHistory, onSessionAuthenticated };
  }

  const sampleSnapshot: RoomSnapshot = {
    code: 'LLPAG',
    hostId: 'host_1',
    state: 'waiting',
    sequenceNumber: 2,
    createdAt: Date.now(),
    settings: {
      maxPlayers: 4,
      isPrivate: true,
      allowBots: false,
      startingCash: 1500,
      doubleRent: true,
      vacationCash: false,
      auction: true,
      noRentInPrison: false,
      mortgage: true,
      evenBuild: true,
    },
    players: [
      { id: 'host_1', nickname: 'Host', avatar: '🟢', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
      { id: 'guest_2', nickname: 'Guest', avatar: '🎩', color: '#FFC83D', isHost: false, connected: true, seatIndex: 1 },
    ],
  };

  it('fresh browser session: auto-joins target room when socket authenticates and omits taken host color', () => {
    const { state, emitCalls, onSessionAuthenticated } = createCoordinator('LLPAG', 'InvitedGuest');

    // Simulate session authentication event from server
    onSessionAuthenticated({
      sessionId: 'sess_guest_99',
      playerId: 'sess_guest_99',
      token: 'tok_123',
      nickname: 'InvitedGuest',
    });

    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].event).toBe(SOCKET_EVENTS.ROOM_JOIN);
    expect(emitCalls[0].payload).toEqual({
      roomCode: 'LLPAG',
      nickname: 'InvitedGuest',
    });
    // Color should NOT be passed in payload so server assigns untaken color
    expect((emitCalls[0].payload as Record<string, unknown>).color).toBeUndefined();

    // Simulate server acknowledging join with room snapshot
    emitCalls[0].callback?.({ ok: true, data: sampleSnapshot });

    expect(state.screen).toBe('room');
    expect(state.roomSnapshot).toEqual(sampleSnapshot);
    expect(state.targetRoom).toBeNull();
    expect(state.cleanedUrl).toBe('/');
  });

  it('delayed socket connection: preserves room code until authentication arrives before emitting join', async () => {
    const { state, emitCalls, onSessionAuthenticated } = createCoordinator('LLPAG');

    // Target code is preserved while socket is still connecting
    expect(state.targetRoom).toBe('LLPAG');
    expect(emitCalls).toHaveLength(0);

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(emitCalls).toHaveLength(0);

    // Connection completes and auth event arrives
    onSessionAuthenticated({
      sessionId: 'sess_delayed',
      playerId: 'sess_delayed',
      token: 'tok_delayed',
      nickname: 'Guest',
    });

    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].event).toBe(SOCKET_EVENTS.ROOM_JOIN);
    expect(emitCalls[0].payload).toEqual({ roomCode: 'LLPAG', nickname: 'Guest' });
  });

  it('failed join (room not found or full): sets serverError, remains on landing page, and clears URL', () => {
    const { state, emitCalls, onSessionAuthenticated } = createCoordinator('LLPAG');

    onSessionAuthenticated({
      sessionId: 'sess_fail',
      playerId: 'sess_fail',
      token: 'tok_fail',
      nickname: 'Guest',
    });

    expect(emitCalls).toHaveLength(1);

    // Simulate server error response (e.g. room closed or does not exist)
    emitCalls[0].callback?.({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND', message: 'Room LLPAG does not exist' },
    });

    expect(state.screen).toBe('landing');
    expect(state.roomSnapshot).toBeNull();
    expect(state.targetRoom).toBeNull();
    expect(state.serverError).toBe('Room LLPAG does not exist');
    expect(state.cleanedUrl).toBe('/');
  });

  it('duplicate prevention: multiple socket events or reconnects only emit ROOM_JOIN once', () => {
    const { emitCalls, onSessionAuthenticated } = createCoordinator('LLPAG');

    const authPayload = {
      sessionId: 'sess_dup',
      playerId: 'sess_dup',
      token: 'tok_dup',
      nickname: 'Guest',
    };

    // Emit 5 auth events (simulating rapid re-renders or multiple reconnect handshakes)
    onSessionAuthenticated(authPayload);
    onSessionAuthenticated(authPayload);
    onSessionAuthenticated(authPayload);
    onSessionAuthenticated(authPayload);
    onSessionAuthenticated(authPayload);

    expect(emitCalls).toHaveLength(1);
  });

  it('reconnection preservation: does not emit duplicate ROOM_JOIN if session already in room', () => {
    const { state, emitCalls, onSessionAuthenticated } = createCoordinator('LLPAG');

    // Server says session is already in room LLPAG
    onSessionAuthenticated({
      sessionId: 'sess_existing',
      playerId: 'sess_existing',
      token: 'tok_existing',
      nickname: 'ReconnectingPlayer',
      currentRoomCode: 'LLPAG',
    });

    // Should NOT emit ROOM_JOIN because server re-attaches socket and sends snapshot automatically
    expect(emitCalls).toHaveLength(0);
    expect(state.hasAttemptedJoin).toBe(true);
    expect(state.targetRoom).toBeNull();
  });

  it('normal homepage visit without ?room: never emits ROOM_JOIN', () => {
    const { emitCalls, onSessionAuthenticated } = createCoordinator(null);

    onSessionAuthenticated({
      sessionId: 'sess_normal',
      playerId: 'sess_normal',
      token: 'tok_normal',
      nickname: 'NormalGuest',
    });

    expect(emitCalls).toHaveLength(0);
  });
});
