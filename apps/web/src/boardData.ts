import {
  type BoardSpace,
  type PropertyGroup,
  type SpaceType,
  CANONICAL_BOARD_SPACES,
  getBoardSpace,
  TOTAL_SPACES,
} from '@charchokkha/game-engine';

export type { BoardSpace, PropertyGroup, SpaceType };
export { getBoardSpace, TOTAL_SPACES };

/**
 * Canonical color palette for property color groups.
 * Tuned for maximum contrast and distinctiveness on dark board surfaces.
 */
export const PROPERTY_GROUP_COLORS: Record<PropertyGroup, string> = {
  brown: '#a855f7',  // vibrant purple-brown (Salvador, Rio)
  sky: '#0284c7',    // cyan/sky blue (Tel Aviv, Haifa, Jerusalem)
  pink: '#ec4899',   // hot pink (Venice, Milan, Rome)
  orange: '#f97316', // bright orange (Frankfurt, Munich, Berlin)
  red: '#ef4444',    // vibrant red (Shenzhen, Beijing, Shanghai)
  yellow: '#eab308', // gold yellow (Lyon, Toulouse, Paris)
  green: '#10b981',  // emerald green (Liverpool, Manchester, London)
  blue: '#3b82f6',   // royal blue (San Francisco, New York)
};

/**
 * Reusable, country-flag-free identity badges for all 40 canonical spaces.
 * Clean, subtle, neutral emblems distinguishing property categories without clutter.
 */
export interface SpaceIdentityBadge {
  symbol: string;
  category: 'corner' | 'property' | 'transit' | 'utility' | 'card' | 'tax';
  label: string;
}

export const SPACE_IDENTITY_BADGES: Record<number, SpaceIdentityBadge> = {
  0: { symbol: '🏁', category: 'corner', label: 'Start Point' },
  1: { symbol: '🏛️', category: 'property', label: 'Historic District' },
  2: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  3: { symbol: '🏖️', category: 'property', label: 'Coastal District' },
  4: { symbol: '⚖️', category: 'tax', label: 'Earnings Tax' },
  5: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  6: { symbol: '🏙️', category: 'property', label: 'Commercial Hub' },
  7: { symbol: '⚓', category: 'property', label: 'Harbor City' },
  8: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  9: { symbol: '🏰', category: 'property', label: 'Heritage Quarter' },
  10: { symbol: '⛓️', category: 'corner', label: 'Visiting Prison' },
  11: { symbol: '🎭', category: 'property', label: 'Canal City' },
  12: { symbol: '⚡', category: 'utility', label: 'Power Utility' },
  13: { symbol: '🏛️', category: 'property', label: 'Design Capital' },
  14: { symbol: '🏛️', category: 'property', label: 'Eternal District' },
  15: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  16: { symbol: '🏢', category: 'property', label: 'Financial Center' },
  17: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  18: { symbol: '🍺', category: 'property', label: 'Bavarian Quarter' },
  19: { symbol: '🏙️', category: 'property', label: 'Metropolis' },
  20: { symbol: '🌴', category: 'corner', label: 'Vacation Retreat' },
  21: { symbol: '💡', category: 'property', label: 'Tech Frontier' },
  22: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  23: { symbol: '🏯', category: 'property', label: 'Imperial District' },
  24: { symbol: '🌆', category: 'property', label: 'Skyline Hub' },
  25: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  26: { symbol: '🍇', category: 'property', label: 'Culinary District' },
  27: { symbol: '💧', category: 'utility', label: 'Water Utility' },
  28: { symbol: '🚀', category: 'property', label: 'Aero Center' },
  29: { symbol: '🎨', category: 'property', label: 'Boulevard Quarter' },
  30: { symbol: '🚨', category: 'corner', label: 'Go to Prison' },
  31: { symbol: '🎵', category: 'property', label: 'Waterfront Haven' },
  32: { symbol: '🏭', category: 'property', label: 'Industrial Hub' },
  33: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  34: { symbol: '👑', category: 'property', label: 'Royal District' },
  35: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  36: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  37: { symbol: '🌉', category: 'property', label: 'Bay Area' },
  38: { symbol: '💎', category: 'tax', label: 'Premium Tax' },
  39: { symbol: '🗽', category: 'property', label: 'Empire City' },
};

/**
 * Returns canonical identity badge for any board space.
 */
export function getSpaceBadge(spaceId: number): SpaceIdentityBadge {
  const normalizedId = ((spaceId % TOTAL_SPACES) + TOTAL_SPACES) % TOTAL_SPACES;
  return SPACE_IDENTITY_BADGES[normalizedId] || { symbol: '📍', category: 'property', label: 'Space' };
}

/**
 * Returns formatted display name supporting future custom map names while
 * defaulting to the authoritative canonical name.
 */
export function getSpaceDisplayName(spaceId: number, customNames?: Record<number, string>): string {
  if (customNames && customNames[spaceId]) {
    return customNames[spaceId];
  }
  const space = getBoardSpace(spaceId);
  return space.name;
}

export const BOARD_SPACES: BoardSpace[] = CANONICAL_BOARD_SPACES;
