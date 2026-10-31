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
 * Visual Property Group specification for the 10-group color system.
 */
export interface PropertyGroupDefinition {
  id: number;
  name: string;
  colorName: string;
  color: string;
  propertyIds: number[];
}

/**
 * 10 clearly distinguishable property groups with dark-theme friendly palette.
 */
export const PROPERTY_GROUPS: Record<number, PropertyGroupDefinition> = {
  1: { id: 1, name: 'Group 1', colorName: 'Rose', color: '#F472B6', propertyIds: [1, 3] },
  2: { id: 2, name: 'Group 2', colorName: 'Orange', color: '#FB923C', propertyIds: [5, 7, 8] },
  3: { id: 3, name: 'Group 3', colorName: 'Sky Blue', color: '#38BDF8', propertyIds: [10, 11] },
  4: { id: 4, name: 'Group 4', colorName: 'Emerald', color: '#34D399', propertyIds: [13, 14, 16, 17] },
  5: { id: 5, name: 'Group 5', colorName: 'Amber', color: '#FBBF24', propertyIds: [19, 21, 23] },
  6: { id: 6, name: 'Group 6', colorName: 'Violet', color: '#A78BFA', propertyIds: [25, 27, 29] },
  7: { id: 7, name: 'Group 7', colorName: 'Red', color: '#F87171', propertyIds: [31, 32] },
  8: { id: 8, name: 'Group 8', colorName: 'Cyan', color: '#22D3EE', propertyIds: [34, 35] },
  9: { id: 9, name: 'Group 9', colorName: 'Brown', color: '#C08457', propertyIds: [37, 38, 40, 41] },
  10: { id: 10, name: 'Group 10', colorName: 'Silver', color: '#CBD5E1', propertyIds: [43, 45, 47] },
};

/**
 * Direct lookup map from Space ID to its PropertyGroupDefinition.
 */
export const SPACE_PROPERTY_GROUPS: Record<number, PropertyGroupDefinition> = {
  // Group 1: Rahattarpool, Chandgaon
  1: PROPERTY_GROUPS[1],
  3: PROPERTY_GROUPS[1],
  // Group 2: Gualpara, Mithagoli, Akborshah
  5: PROPERTY_GROUPS[2],
  7: PROPERTY_GROUPS[2],
  8: PROPERTY_GROUPS[2],
  // Group 3: Bualkhali, Kaptai
  10: PROPERTY_GROUPS[3],
  11: PROPERTY_GROUPS[3],
  // Group 4: Mern Sun, Orkid, CGHS, Sunny Dawn
  13: PROPERTY_GROUPS[4],
  14: PROPERTY_GROUPS[4],
  16: PROPERTY_GROUPS[4],
  17: PROPERTY_GROUPS[4],
  // Group 5: Muradpur, Oxygen, Nanupur
  19: PROPERTY_GROUPS[5],
  21: PROPERTY_GROUPS[5],
  23: PROPERTY_GROUPS[5],
  // Group 6: Aftabnagar, Bashundhara, Uttara
  25: PROPERTY_GROUPS[6],
  27: PROPERTY_GROUPS[6],
  29: PROPERTY_GROUPS[6],
  // Group 7: Prem Bazar, Mini Kashmir
  31: PROPERTY_GROUPS[7],
  32: PROPERTY_GROUPS[7],
  // Group 8: Bashkhali, Ghuna
  34: PROPERTY_GROUPS[8],
  35: PROPERTY_GROUPS[8],
  // Group 9: Bogalake, Thanchi, Tindu, Kukichin Camp
  37: PROPERTY_GROUPS[9],
  38: PROPERTY_GROUPS[9],
  40: PROPERTY_GROUPS[9],
  41: PROPERTY_GROUPS[9],
  // Group 10: Gorbagudi, Lake Bilash, Saint Martin
  43: PROPERTY_GROUPS[10],
  45: PROPERTY_GROUPS[10],
  47: PROPERTY_GROUPS[10],
};

/**
 * Returns the property group definition for any board space.
 */
export function getSpacePropertyGroup(spaceId: number): PropertyGroupDefinition | undefined {
  return SPACE_PROPERTY_GROUPS[spaceId];
}

/**
 * Returns the property group color hex for any board space.
 */
export function getSpaceGroupColor(spaceId: number): string | undefined {
  return SPACE_PROPERTY_GROUPS[spaceId]?.color;
}

/**
 * Returns all property IDs belonging to a specific group number (1 to 10).
 */
export function getPropertiesInGroup(groupId: number): number[] {
  return PROPERTY_GROUPS[groupId]?.propertyIds ?? [];
}

/**
 * Canonical color palette for property color groups.
 * Updated to support the 10-group color system while preserving backward compatibility.
 */
export const PROPERTY_GROUP_COLORS: Record<PropertyGroup | number | string, string> = {
  1: '#F472B6',
  2: '#FB923C',
  3: '#38BDF8',
  4: '#34D399',
  5: '#FBBF24',
  6: '#A78BFA',
  7: '#F87171',
  8: '#22D3EE',
  9: '#C08457',
  10: '#CBD5E1',
  // Canonical string aliases for backward compatibility:
  brown: '#F472B6',  // Group 1: Rose
  sky: '#FB923C',    // Group 2: Orange (and Group 3: Sky Blue)
  pink: '#34D399',   // Group 4: Emerald
  orange: '#FBBF24', // Group 5: Amber
  red: '#A78BFA',    // Group 6: Violet
  yellow: '#F87171', // Group 7: Red (and Group 8: Cyan)
  green: '#C08457',  // Group 9: Brown
  blue: '#CBD5E1',   // Group 10: Silver
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
