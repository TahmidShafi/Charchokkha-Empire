import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOARD_SPACES,
  formatTileDisplayName,
  getBoardSpace,
} from '../src/boardData.js';
import { Board } from '../src/components/Board.js';
import { GameSettings } from '../src/components/GameSettings.js';
import { type RoomSnapshot } from '@charchokkha/shared';

describe('Property Tile Display Name Formatter (formatTileDisplayName)', () => {
  it('preserves canonical property names in the authoritative data structure', () => {
    expect(BOARD_SPACES.length).toBe(48);
    expect(getBoardSpace(1).name).toBe('Rahattarpool');
    expect(getBoardSpace(12).name).toBe('Utshob Rehab Center');
    expect(getBoardSpace(15).name).toBe('Desi Fresh Factory');
    expect(getBoardSpace(22).name).toBe('Bhai Bhai Tiles');
    expect(getBoardSpace(27).name).toBe('Bashundhara');
    expect(getBoardSpace(33).name).toBe('7 dayz Chap Station');
    expect(getBoardSpace(41).name).toBe('Kukichin Camp');
  });

  it('preserves canonical property names without confusing abbreviations', () => {
    expect(formatTileDisplayName(getBoardSpace(1))).toBe('Rahattarpool');
    expect(formatTileDisplayName(getBoardSpace(12))).toBe('Utshob Rehab Center');
    expect(formatTileDisplayName(getBoardSpace(15))).toBe('Desi Fresh Factory');
    expect(formatTileDisplayName(getBoardSpace(22))).toBe('Bhai Bhai Tiles');
    expect(formatTileDisplayName(getBoardSpace(33))).toBe('7 dayz Chap Station');
    expect(formatTileDisplayName(getBoardSpace(41))).toBe('Kukichin Camp');
  });

  it('strips redundant "Airport" postfix on all 4 airport transit tiles', () => {
    expect(formatTileDisplayName(getBoardSpace(6))).toBe('Shongit');
    expect(formatTileDisplayName(getBoardSpace(18))).toBe('Sholoshor');
    expect(formatTileDisplayName(getBoardSpace(30))).toBe('Ansar Camp');
    expect(formatTileDisplayName(getBoardSpace(42))).toBe('Gudaraghat');
  });

  it('keeps all standard property and special space names clean and natural', () => {
    expect(formatTileDisplayName(getBoardSpace(0))).toBe('START');
    expect(formatTileDisplayName(getBoardSpace(3))).toBe('Chandgaon');
    expect(formatTileDisplayName(getBoardSpace(5))).toBe('Gualpara');
    expect(formatTileDisplayName(getBoardSpace(7))).toBe('Mithagoli');
    expect(formatTileDisplayName(getBoardSpace(8))).toBe('Akborshah');
    expect(formatTileDisplayName(getBoardSpace(13))).toBe('Mern Sun');
    expect(formatTileDisplayName(getBoardSpace(14))).toBe('Orkid');
    expect(formatTileDisplayName(getBoardSpace(16))).toBe('CGHS');
    expect(formatTileDisplayName(getBoardSpace(17))).toBe('Sunny Dawn');
    expect(formatTileDisplayName(getBoardSpace(21))).toBe('Oxygen');
    expect(formatTileDisplayName(getBoardSpace(23))).toBe('Nanupur');
    expect(formatTileDisplayName(getBoardSpace(24))).toBe('Abesh Boobesh');
    expect(formatTileDisplayName(getBoardSpace(25))).toBe('Uttara');
    expect(formatTileDisplayName(getBoardSpace(27))).toBe('Bashundhara');
    expect(formatTileDisplayName(getBoardSpace(29))).toBe('Aftabnagar');
    expect(formatTileDisplayName(getBoardSpace(31))).toBe('Prem Bazar');
    expect(formatTileDisplayName(getBoardSpace(32))).toBe('Mini Kashmir');
    expect(formatTileDisplayName(getBoardSpace(35))).toBe('Bashkhali');
    expect(formatTileDisplayName(getBoardSpace(36))).toBe('Go to Rehab');
    expect(formatTileDisplayName(getBoardSpace(37))).toBe('Bogalake');
    expect(formatTileDisplayName(getBoardSpace(45))).toBe('Lake Bilash');
    expect(formatTileDisplayName(getBoardSpace(47))).toBe('Saint Martin');
  });

  it('ensures all spaces have valid non-empty display names and maintain canonical integrity', () => {
    for (const space of BOARD_SPACES) {
      const display = formatTileDisplayName(space);
      expect(display.length).toBeGreaterThan(0);
    }
  });
});

describe('Mobile Board Component Render Structure', () => {
  const mockSnapshot: RoomSnapshot = {
    code: 'TABLE1',
    hostId: 'p1',
    state: 'in_progress',
    sequenceNumber: 15,
    createdAt: Date.now(),
    settings: {
      maxPlayers: 4,
      isPrivate: true,
      allowBots: false,
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
    ],
    gameState: {
      phase: 'in_progress',
      turnOrder: ['p1', 'p2'],
      currentTurnIndex: 0,
      activePlayerId: 'p1',
      turnPhase: 'need_roll',
      lastDiceRoll: { die1: 4, die2: 3, total: 7, isDouble: false },
      startingSalary: 200,
      vacationPot: 150,
      players: {
        p1: { id: 'p1', position: 0, cash: 1500, inPrison: false, prisonTurns: 0, isBankrupt: false },
        p2: { id: 'p2', position: 12, cash: 1450, inPrison: false, prisonTurns: 0, isBankrupt: false },
      },
      properties: {
        '1': { ownerId: 'p1', houses: 0, isMortgaged: false },
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

  it('renders tabletop grid with all 4 edge tracks and 4 corner spaces', () => {
    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TABLE1',
        roomSnapshot: mockSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        isRolling: false,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
      })
    );

    // Track regions
    expect(html).toContain('board-grid-tabletop');
    expect(html).toContain('board-top-edge-track');
    expect(html).toContain('board-right-edge-track');
    expect(html).toContain('board-bottom-edge-track');
    expect(html).toContain('board-left-edge-track');

    // Corners
    expect(html).toContain('id="space-0"');
    expect(html).toContain('id="space-12"');
    expect(html).toContain('id="space-24"');
    expect(html).toContain('id="space-36"');
    expect(html).toContain('Utshob Rehab Center');

    // Property prices formatted
    expect(html).toContain('$60');
    expect(html).toContain('$400');

    // Courtyard Center Elements in recommended order (turn notification removed from inside board)
    expect(html).toContain('board-courtyard-center');
    expect(html).not.toContain('courtyard-turn-status-bar');
    expect(html).toContain('courtyard-dice-stage');
    expect(html).toContain('tactile-dice-cube');
    expect(html).toContain('courtyard-action-controls');
    expect(html).toContain('id="btn-roll-dice"');

    // In-game Action Bar under the whole board
    expect(html).toContain('board-bottom-actions-bar');
    expect(html).toContain('id="btn-open-trade"');
    expect(html).toContain('id="btn-declare-bankruptcy"');

    // Player Information Menu in the below free space
    expect(html).toContain('board-player-info-menu');
    expect(html).toContain('player-info-card');
    expect(html).toContain('player-info-turn-badge');
  });

  it('renders property ownership color strip without player nicknames inside tiles', () => {
    const html = renderToStaticMarkup(
      React.createElement(Board, {
        roomCode: 'TABLE1',
        roomSnapshot: mockSnapshot,
        currentSessionId: 'p1',
        isHost: true,
        isRolling: false,
        onStartGame: () => {},
        onRollDice: () => {},
        onBuyProperty: () => {},
        onDeclineProperty: () => {},
        onAuctionBid: () => {},
        onAuctionPass: () => {},
        onPayPrisonFine: () => {},
        onMortgageProperty: () => {},
        onUnmortgageProperty: () => {},
        onBuildHouse: () => {},
        onSellHouse: () => {},
        onCreateTrade: () => {},
        onAcceptTrade: () => {},
        onRejectTrade: () => {},
        onDeclareBankruptcy: () => {},
        onEndTurn: () => {},
      })
    );

    // Owned property space 1 has ownership strip with p1's color
    expect(html).toContain('tile-ownership-strip');
    expect(html).toContain('background-color:#C4E64A');

    // Tile text should NEVER contain owner nickname
    const space1Substr = html.substring(html.indexOf('id="space-1"'), html.indexOf('id="space-2"'));
    expect(space1Substr).not.toContain('Alice');
  });
});

describe('Table Settings and Test Bots (QA) Accessibility', () => {
  it('renders Test Bots (QA) section for host in private room with full add/fill/speed controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(GameSettings, {
        playerName: 'Alice',
        playerAvatar: '👑',
        isHost: true,
        players: [
          { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
          { id: 'bot_1', nickname: 'Bot Alpha', avatar: '🤖', color: '#FFC83D', isHost: false, connected: true, seatIndex: 1, isBot: true },
        ],
        onAvatarChange: () => {},
        maxPlayers: 4,
        onMaxPlayersChange: () => {},
        isPrivate: true,
        onIsPrivateChange: () => {},
        allowBots: false,
        onAllowBotsChange: () => {},
        startingCash: 1500,
        onStartingCashChange: () => {},
        onAddBot: () => {},
        onRemoveBot: () => {},
        onSetBotSpeed: () => {},
      })
    );

    expect(html).toContain('test-bots-section-card');
    expect(html).toContain('Test Bots (QA)');
    expect(html).toContain('id="btn-add-one-bot"');
    expect(html).toContain('id="btn-fill-bots"');
    expect(html).toContain('Normal (750ms)');
    expect(html).toContain('Slow (2.5s)');
    expect(html).toContain('Bot Alpha');
  });

  it('renders Test Bots QA section with a helpful switch-to-private button when room is public', () => {
    const html = renderToStaticMarkup(
      React.createElement(GameSettings, {
        playerName: 'Alice',
        playerAvatar: '👑',
        isHost: true,
        players: [
          { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
        ],
        onAvatarChange: () => {},
        maxPlayers: 4,
        onMaxPlayersChange: () => {},
        isPrivate: false,
        onIsPrivateChange: () => {},
        allowBots: false,
        onAllowBotsChange: () => {},
        startingCash: 1500,
        onStartingCashChange: () => {},
        onAddBot: () => {},
      })
    );

    // Card is not hidden; it informs the host how to activate bots
    expect(html).toContain('test-bots-section-card');
    expect(html).toContain('id="btn-enable-private-for-bots"');
    expect(html).toContain('Switch to Private Table');
  });

  it('does NOT render Test Bots QA section for non-host players', () => {
    const html = renderToStaticMarkup(
      React.createElement(GameSettings, {
        playerName: 'Bob',
        playerAvatar: '🎩',
        isHost: false,
        players: [
          { id: 'p1', nickname: 'Alice', avatar: '👑', color: '#C4E64A', isHost: true, connected: true, seatIndex: 0 },
          { id: 'p2', nickname: 'Bob', avatar: '🎩', color: '#FFC83D', isHost: false, connected: true, seatIndex: 1 },
        ],
        onAvatarChange: () => {},
        maxPlayers: 4,
        onMaxPlayersChange: () => {},
        isPrivate: true,
        onIsPrivateChange: () => {},
        allowBots: false,
        onAllowBotsChange: () => {},
        startingCash: 1500,
        onStartingCashChange: () => {},
      })
    );

    expect(html).not.toContain('test-bots-section-card');
    expect(html).not.toContain('id="btn-add-one-bot"');
  });
});

describe('Mobile CSS Stylesheet Integrity Verification', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/index.css'), 'utf8');

  it('enforces 100dvh and prevents page-level scrolling in game-room-viewport', () => {
    expect(css).toMatch(/\.game-room-viewport\s*\{[^}]*height:\s*100dvh/);
    expect(css).toMatch(/\.game-room-viewport\s*\{[^}]*overflow:\s*hidden/);
  });

  it('maximizes tabletop board dimensions on mobile up to calc(100vw - 4px)', () => {
    expect(css).toMatch(/width:\s*min\(calc\(100vw - 4px\)/);
    expect(css).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
  });

  it('increases perimeter track depth on mobile to 1.38fr to give tiles ample breathing room', () => {
    expect(css).toMatch(/grid-template-columns:\s*1\.38fr repeat\(9, 1fr\) 1\.38fr/);
  });

  it('does NOT contain word-break: break-all on property tile titles', () => {
    expect(css).not.toMatch(/\.tile-title-text[^}]*word-break:\s*break-all/);
  });

  it('uses compact height for mobile top header and roster bar', () => {
    expect(css).toMatch(/\.room-top-header\s*\{[^}]*height:\s*38px/);
    expect(css).toMatch(/\.room-players-roster-bar\s*\{[^}]*min-height:\s*34px/);
  });

  it('uses compact bottom nav bar taking safe-area-inset-bottom into account', () => {
    expect(css).toMatch(/height:\s*calc\(44px \+ env\(safe-area-inset-bottom/);
  });

  it('scales tactile dice cubes down to 27px on mobile', () => {
    expect(css).toMatch(/\.tactile-dice-cube\s*\{[^}]*width:\s*27px/);
  });

  it('ensures room-board-center-stage.tab-stage-active stretches without flex center clipping', () => {
    expect(css).toMatch(/\.room-board-center-stage\.tab-stage-active\s*\{[^}]*align-items:\s*stretch/);
    expect(css).toMatch(/\.room-board-center-stage\.tab-stage-active\s*\{[^}]*justify-content:\s*flex-start/);
  });

  it('provides single scroll container in settings with safe-area bottom padding', () => {
    expect(css).toMatch(/\.settings-scroll-content\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.settings-scroll-content\s*\{[^}]*padding:[^}]*env\(safe-area-inset-bottom/);
  });

  it('ensures settings cards and test bots card do not shrink or collapse in flex containers', () => {
    expect(css).toMatch(/\.settings-section-card\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.test-bots-section-card\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.test-bots-section-card\s*\{[^}]*min-height:\s*max-content/);
    expect(css).toMatch(/\.test-bots-section-card\s*\{[^}]*overflow:\s*visible/);
  });

  it('enforces compact mobile Roll Dice button, compact turn indicator badge, action bar, and player info menu under the board', () => {
    expect(css).toMatch(/\.btn-roll-prominent[^}]*min-height:\s*3[02]px/);
    expect(css).toMatch(/\.turn-indicator-badge\s*\{[^}]*font-size:\s*clamp\(1[01]/);
    expect(css).toMatch(/\.board-bottom-actions-bar\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.btn-board-bottom-action\s*\{[^}]*min-height:\s*3[68]px/);
    expect(css).toMatch(/\.board-player-info-menu\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.player-cash-delta-pill\.delta-increase/);
    expect(css).toMatch(/\.player-cash-delta-pill\.delta-deduction/);
  });

  it('preserves desktop board tabletop grid rules (> 1024px)', () => {
    expect(css).toMatch(/@media \(min-width:\s*1440px\)/);
  });

  it('enforces clean dual button layout and sr-only concealment preventing text overlap', () => {
    expect(css).toMatch(/\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(css).toMatch(/\.courtyard-action-buttons-row\s+#btn-decline-property\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.courtyard-action-buttons-row\s+\.btn-end-turn-action[^}]*min-width:\s*0\s*!important/);
    expect(css).toMatch(/\.courtyard-action-buttons-row\s+\.btn-end-turn-action[^}]*max-width:\s*none\s*!important/);
  });

  it('hides top header chat and settings on mobile/tablet viewports and styles professional icons', () => {
    expect(css).toMatch(/\.header-btn-desktop-only\s*\{[^}]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.header-svg-icon\s*\{[^}]*stroke:\s*currentColor/);
    expect(css).toMatch(/\.header-tool-btn\.btn-leave-table/);
    expect(css).toMatch(/\.header-tool-btn\.tool-btn-muted/);
  });
});
