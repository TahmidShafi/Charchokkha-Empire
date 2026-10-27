import {
  type BoardSpace,
  type PropertyGroup,
  type SpaceType,
  CANONICAL_BOARD_SPACES,
} from '@charchokkha/game-engine';

export type { BoardSpace, PropertyGroup, SpaceType };

export const PROPERTY_GROUP_COLORS: Record<PropertyGroup, string> = {
  brown: '#a855f7', // vibrant purple-brown as seen in reference
  sky: '#0284c7',   // cyan/sky blue
  pink: '#ec4899',  // hot pink
  orange: '#f97316',// bright orange
  red: '#ef4444',   // vibrant red
  yellow: '#eab308',// gold yellow
  green: '#10b981', // emerald green
  blue: '#3b82f6',  // royal blue
};

export const BOARD_SPACES: BoardSpace[] = CANONICAL_BOARD_SPACES;
