import { describe, expect, it } from 'vitest';
import { PingPayloadSchema, HealthCheckResponseSchema } from '@charchokkha/shared';
import { rollDicePair, getEngineInfo } from '@charchokkha/game-engine';

describe('Web Application Contract Consumption', () => {
  it('imports and successfully validates payloads using @charchokkha/shared', () => {
    const validPing = {
      message: 'Web client smoke test',
      timestamp: Date.now(),
    };
    const result = PingPayloadSchema.safeParse(validPing);
    expect(result.success).toBe(true);
  });

  it('rejects invalid ping payloads client-side', () => {
    const invalidPing = {
      message: '',
      timestamp: -10,
    };
    const result = PingPayloadSchema.safeParse(invalidPing);
    expect(result.success).toBe(false);
  });

  it('validates health check schema in web client', () => {
    const health = {
      status: 'ok',
      service: 'charchokkha-server',
      uptime: 42,
      timestamp: new Date().toISOString(),
    };
    expect(HealthCheckResponseSchema.safeParse(health).success).toBe(true);
  });

  it('imports and invokes game-engine pure functions from web app', () => {
    const info = getEngineInfo();
    expect(info.milestone).toBe(1);

    const dice = rollDicePair(() => 3);
    expect(dice.die1).toBe(3);
    expect(dice.die2).toBe(3);
    expect(dice.isDouble).toBe(true);
    expect(dice.total).toBe(6);
  });
});

import { BOARD_SPACES, PROPERTY_GROUP_COLORS } from '../src/boardData.js';

describe('Tabletop Board Architecture Data', () => {
  it('defines exactly 40 spaces on the perimeter', () => {
    expect(BOARD_SPACES.length).toBe(40);
  });

  it('defines the 4 key corner stations', () => {
    expect(BOARD_SPACES[0].name).toBe('START');
    expect(BOARD_SPACES[0].type).toBe('corner');

    expect(BOARD_SPACES[10].name).toBe('In Prison');
    expect(BOARD_SPACES[10].type).toBe('corner');

    expect(BOARD_SPACES[20].name).toBe('Vacation');
    expect(BOARD_SPACES[20].type).toBe('corner');

    expect(BOARD_SPACES[30].name).toBe('Go to Prison');
    expect(BOARD_SPACES[30].type).toBe('corner');
  });

  it('verifies properties have prices and positive values', () => {
    const properties = BOARD_SPACES.filter((s) => s.type === 'property');
    expect(properties.length).toBe(22);
    for (const prop of properties) {
      expect(prop.price).toBeGreaterThan(0);
      expect(prop.rent).toBeGreaterThan(0);
      expect(prop.group).toBeDefined();
    }
  });

  it('validates canonical color groups have defined rich UI hex color tokens', () => {
    const groups = ['brown', 'sky', 'pink', 'orange', 'red', 'yellow', 'green', 'blue'] as const;
    for (const g of groups) {
      expect(PROPERTY_GROUP_COLORS[g]).toBeDefined();
      expect(PROPERTY_GROUP_COLORS[g]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

import { RoomSettingsSchema } from '@charchokkha/shared';

describe('Room Settings UI & Engine Defaults', () => {
  it('supplies authoritative default rule configuration', () => {
    const defaults = RoomSettingsSchema.parse({});
    expect(defaults.doubleRent).toBe(true);
    expect(defaults.vacationCash).toBe(false);
    expect(defaults.auction).toBe(true);
    expect(defaults.noRentInPrison).toBe(false);
    expect(defaults.mortgage).toBe(true);
    expect(defaults.evenBuild).toBe(true);
  });
});

