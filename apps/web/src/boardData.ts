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
  brown: '#a855f7',  // vibrant purple-brown (Rahattarpool, Chandgaon)
  sky: '#0284c7',    // cyan/sky blue (Guaalpara, Mithagoli, Akborshah)
  pink: '#ec4899',   // hot pink (Mern Sun, CGHS, Orchid)
  orange: '#f97316', // bright orange (Muradpur, Oxygen, Nanupur)
  red: '#ef4444',    // vibrant red (Uttara, Bashundhara, Aftabnagar)
  yellow: '#eab308', // gold yellow (Mini Kashmir, Bashkhali, Ghuna)
  green: '#10b981',  // emerald green (Bogalake, Thanchi, Tindu)
  blue: '#3b82f6',   // royal blue (Lake Bilash, Saint Martin)
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
  5: { symbol: '🏙️', category: 'property', label: 'Commercial Hub' },
  6: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  7: { symbol: '⚓', category: 'property', label: 'Harbor City' },
  8: { symbol: '🏰', category: 'property', label: 'Heritage Quarter' },
  9: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  10: { symbol: '🏘️', category: 'property', label: 'Bualkhali' },
  11: { symbol: '🌲', category: 'property', label: 'Kaptai' },
  12: { symbol: '🏥', category: 'corner', label: 'Utshob Rehab Center' },
  13: { symbol: '🎭', category: 'property', label: 'Mern Sun' },
  14: { symbol: '🏛️', category: 'property', label: 'Orkid' },
  15: { symbol: '🐮', category: 'utility', label: 'Desi Fresh Factory' },
  16: { symbol: '🏛️', category: 'property', label: 'CGHS' },
  17: { symbol: '🌅', category: 'property', label: 'Sunny Dawn' },
  18: { symbol: '✈️', category: 'transit', label: 'Airport Transit' },
  19: { symbol: '🏢', category: 'property', label: 'Financial Center' },
  20: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  21: { symbol: '🍺', category: 'property', label: 'Oxygen' },
  22: { symbol: '🧱', category: 'utility', label: 'Bhai Bhai Tiles' },
  23: { symbol: '🏙️', category: 'property', label: 'Nanupur' },
  24: { symbol: '🍔', category: 'corner', label: 'Abesh Boobesh' },
  25: { symbol: '💡', category: 'property', label: 'Uttara' },
  26: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  27: { symbol: '🏯', category: 'property', label: 'Bashundhara' },
  28: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  29: { symbol: '🌆', category: 'property', label: 'Aftabnagar' },
  30: { symbol: '✈️', category: 'transit', label: 'Ansar Camp Airport' },
  31: { symbol: '🛍️', category: 'property', label: 'Prem Bazar' },
  32: { symbol: '🍇', category: 'property', label: 'Mini Kashmir' },
  33: { symbol: '🍗', category: 'utility', label: '7 dayz Chap Station' },
  34: { symbol: '🎨', category: 'property', label: 'Ghuna' },
  35: { symbol: '🚀', category: 'property', label: 'Bashkhali' },
  36: { symbol: '🚨', category: 'corner', label: 'Go to Rehab' },
  37: { symbol: '🎵', category: 'property', label: 'Bogalake' },
  38: { symbol: '🏭', category: 'property', label: 'Thanchi' },
  39: { symbol: '💎', category: 'card', label: 'Treasure Chest' },
  40: { symbol: '👑', category: 'property', label: 'Tindu' },
  41: { symbol: '🏕️', category: 'property', label: 'Kukichin Camp' },
  42: { symbol: '✈️', category: 'transit', label: 'Gudaraghat Airport' },
  43: { symbol: '🏡', category: 'property', label: 'Gorbagudi' },
  44: { symbol: '❓', category: 'card', label: 'Surprise Card' },
  45: { symbol: '🌊', category: 'property', label: 'Lake Bilash' },
  46: { symbol: '💎', category: 'tax', label: 'Premium Tax' },
  47: { symbol: '🏝️', category: 'property', label: 'Saint Martin' },
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

/**
 * Concise display label for perimeter board tiles.
 * Provides clean, legible visual formatting on compact mobile tiles while preserving
 * full canonical property names and natural line wrapping.
 */
export function formatTileDisplayName(space: BoardSpace): string {
  if (space.type === 'airport') {
    return space.name.replace(/\s*airport\s*/i, '').trim();
  }

  // Preserve full canonical property names without confusing abbreviations
  return space.name;
}

export const BOARD_SPACES: BoardSpace[] = CANONICAL_BOARD_SPACES;
