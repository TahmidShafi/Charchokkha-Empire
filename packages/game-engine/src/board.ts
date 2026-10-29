export type SpaceType =
  | 'corner'
  | 'property'
  | 'airport'
  | 'utility'
  | 'treasure'
  | 'surprise'
  | 'tax';

export type PropertyGroup =
  | 'brown'
  | 'sky'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'blue';

export interface BoardSpace {
  id: number;
  name: string;
  type: SpaceType;
  group?: PropertyGroup;
  price?: number;
  rent?: number;
  subtext?: string;
  houseCost?: number;
  rentTiers?: [number, number, number, number, number, number]; // [base, 1H, 2H, 3H, 4H, Hotel]
}

export const CANONICAL_BOARD_SPACES: BoardSpace[] = [
  // Top Row (0 to 12: Left-to-Right)
  { id: 0, name: 'START', type: 'corner', subtext: 'COLLECT $200' },
  { id: 1, name: 'Rahattarpool', type: 'property', group: 'brown', price: 60, rent: 4, houseCost: 50, rentTiers: [4, 20, 60, 180, 320, 450] },
  { id: 2, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 3, name: 'Chandgaon', type: 'property', group: 'brown', price: 60, rent: 4, houseCost: 50, rentTiers: [4, 20, 60, 180, 320, 450] },
  { id: 4, name: 'Earnings Tax', type: 'tax', price: 100, subtext: '$100' },
  { id: 5, name: 'Gualpara', type: 'property', group: 'sky', price: 100, rent: 6, houseCost: 50, rentTiers: [6, 30, 90, 270, 400, 550] },
  { id: 6, name: 'Shongit Airport', type: 'airport', price: 200, rent: 25, subtext: '✈️' },
  { id: 7, name: 'Mithagoli', type: 'property', group: 'sky', price: 100, rent: 6, houseCost: 50, rentTiers: [6, 30, 90, 270, 400, 550] },
  { id: 8, name: 'Akborshah', type: 'property', group: 'sky', price: 110, rent: 7, houseCost: 50, rentTiers: [7, 35, 95, 280, 420, 580] },
  { id: 9, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 10, name: 'Bualkhali', type: 'property', group: 'sky', price: 120, rent: 8, houseCost: 50, rentTiers: [8, 40, 100, 300, 450, 600] },
  { id: 11, name: 'Kaptai', type: 'property', group: 'sky', price: 130, rent: 10, houseCost: 50, rentTiers: [10, 50, 150, 450, 625, 750] },
  { id: 12, name: 'Utshob Rehab Center', type: 'corner' },

  // Right Column (13 to 23: Top-to-Bottom)
  { id: 13, name: 'Mern Sun', type: 'property', group: 'pink', price: 140, rent: 10, houseCost: 100, rentTiers: [10, 50, 150, 450, 625, 750] },
  { id: 14, name: 'Orkid', type: 'property', group: 'pink', price: 140, rent: 10, houseCost: 100, rentTiers: [10, 50, 150, 450, 625, 750] },
  { id: 15, name: 'Desi Fresh Factory', type: 'utility', price: 150, rent: 15, subtext: '🐮' },
  { id: 16, name: 'CGHS', type: 'property', group: 'pink', price: 160, rent: 12, houseCost: 100, rentTiers: [12, 60, 180, 500, 700, 900] },
  { id: 17, name: 'Sunny Dawn', type: 'property', group: 'pink', price: 160, rent: 12, houseCost: 100, rentTiers: [12, 60, 180, 500, 700, 900] },
  { id: 18, name: 'Sholoshor Airport', type: 'airport', price: 200, rent: 25, subtext: '✈️' },
  { id: 19, name: 'Muradpur', type: 'property', group: 'orange', price: 180, rent: 14, houseCost: 100, rentTiers: [14, 70, 200, 550, 750, 950] },
  { id: 20, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 21, name: 'Oxygen', type: 'property', group: 'orange', price: 180, rent: 14, houseCost: 100, rentTiers: [14, 70, 200, 550, 750, 950] },
  { id: 22, name: 'Bhai Bhai Tiles', type: 'utility', price: 150, rent: 15, subtext: '🧱' },
  { id: 23, name: 'Nanupur', type: 'property', group: 'orange', price: 200, rent: 16, houseCost: 100, rentTiers: [16, 80, 220, 600, 800, 1000] },
  { id: 24, name: 'Abesh Boobesh', type: 'corner', subtext: 'REST' },

  // Bottom Row (25 to 35: Right-to-Left in board perimeter order)
  { id: 25, name: 'Uttara', type: 'property', group: 'red', price: 210, rent: 18, houseCost: 150, rentTiers: [18, 90, 250, 700, 875, 1050] },
  { id: 26, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 27, name: 'Bashundhara', type: 'property', group: 'red', price: 220, rent: 18, houseCost: 150, rentTiers: [18, 90, 250, 700, 875, 1050] },
  { id: 28, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 29, name: 'Aftabnagar', type: 'property', group: 'red', price: 240, rent: 20, houseCost: 150, rentTiers: [20, 100, 300, 750, 925, 1100] },
  { id: 30, name: 'Ansar Camp Airport', type: 'airport', price: 200, rent: 25, subtext: '✈️' },
  { id: 31, name: 'Prem Bazar', type: 'property', group: 'yellow', price: 260, rent: 22, houseCost: 150, rentTiers: [22, 110, 330, 800, 975, 1150] },
  { id: 32, name: 'Mini Kashmir', type: 'property', group: 'yellow', price: 260, rent: 22, houseCost: 150, rentTiers: [22, 110, 330, 800, 975, 1150] },
  { id: 33, name: '7 dayz Chap Station', type: 'utility', price: 150, rent: 15, subtext: '🍗' },
  { id: 34, name: 'Ghuna', type: 'property', group: 'yellow', price: 280, rent: 24, houseCost: 150, rentTiers: [24, 120, 360, 850, 1025, 1200] },
  { id: 35, name: 'Bashkhali', type: 'property', group: 'yellow', price: 280, rent: 24, houseCost: 150, rentTiers: [24, 120, 360, 850, 1025, 1200] },
  { id: 36, name: 'Go to Rehab', type: 'corner' },

  // Left Column (37 to 47: Bottom-to-Top in board perimeter order)
  { id: 37, name: 'Bogalake', type: 'property', group: 'green', price: 290, rent: 26, houseCost: 200, rentTiers: [26, 130, 390, 900, 1100, 1275] },
  { id: 38, name: 'Thanchi', type: 'property', group: 'green', price: 300, rent: 26, houseCost: 200, rentTiers: [26, 130, 390, 900, 1100, 1275] },
  { id: 39, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 40, name: 'Tindu', type: 'property', group: 'green', price: 320, rent: 28, houseCost: 200, rentTiers: [28, 150, 450, 1000, 1200, 1400] },
  { id: 41, name: 'Kukichin Camp', type: 'property', group: 'green', price: 320, rent: 28, houseCost: 200, rentTiers: [28, 150, 450, 1000, 1200, 1400] },
  { id: 42, name: 'Gudaraghat Airport', type: 'airport', price: 200, rent: 25, subtext: '✈️' },
  { id: 43, name: 'Gorbagudi', type: 'property', group: 'blue', price: 350, rent: 32, houseCost: 200, rentTiers: [32, 160, 480, 1050, 1250, 1450] },
  { id: 44, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 45, name: 'Lake Bilash', type: 'property', group: 'blue', price: 360, rent: 35, houseCost: 200, rentTiers: [35, 175, 500, 1100, 1300, 1500] },
  { id: 46, name: 'Premium Tax', type: 'tax', price: 75, subtext: '$75' },
  { id: 47, name: 'Saint Martin', type: 'property', group: 'blue', price: 400, rent: 50, houseCost: 200, rentTiers: [50, 200, 600, 1400, 1700, 2000] },
];

export const TOTAL_SPACES = 48;

export function getBoardSpace(spaceId: number): BoardSpace {
  const normalizedId = ((spaceId % TOTAL_SPACES) + TOTAL_SPACES) % TOTAL_SPACES;
  const space = CANONICAL_BOARD_SPACES[normalizedId];
  if (!space) {
    throw new Error(`Invalid board space ID: ${spaceId}`);
  }
  return space;
}

export function isPurchasableSpace(space: BoardSpace): boolean {
  return (
    (space.type === 'property' || space.type === 'airport' || space.type === 'utility') &&
    typeof space.price === 'number' &&
    space.price > 0
  );
}

/**
 * Returns all board spaces belonging to a specific property group.
 */
export function getGroupSpaces(group: PropertyGroup): BoardSpace[] {
  return CANONICAL_BOARD_SPACES.filter((s) => s.group === group);
}

/**
 * Checks whether a player owns all properties in a color group (Monopoly).
 */
export function hasColorMonopoly(
  group: PropertyGroup,
  playerId: string,
  getPropertyOwner: (spaceId: number) => string | undefined
): boolean {
  const groupSpaces = getGroupSpaces(group);
  return groupSpaces.every((s) => getPropertyOwner(s.id) === playerId);
}

/**
 * Calculates authoritative rent for a space based on ownership, monopoly, improvements,
 * and room rules.
 */
export function calculateRentAmount(params: {
  space: BoardSpace;
  ownerId: string;
  getPropertyOwner: (spaceId: number) => string | undefined;
  getHouses?: (spaceId: number) => number;
  isMortgaged?: (spaceId: number) => boolean;
  diceTotal?: number;
  doubleRentRule?: boolean;
  noRentInPrisonRule?: boolean;
  ownerInPrison?: boolean;
}): number {
  const {
    space,
    ownerId,
    getPropertyOwner,
    getHouses = () => 0,
    isMortgaged = () => false,
    diceTotal = 7,
    doubleRentRule = true,
    noRentInPrisonRule = false,
    ownerInPrison = false,
  } = params;

  // Rule: If property is mortgaged, rent is 0
  if (isMortgaged(space.id)) {
    return 0;
  }

  // Rule: If owner is in prison and rule is active, rent is 0
  if (noRentInPrisonRule && ownerInPrison) {
    return 0;
  }

  let rent = space.rent ?? 0;

  if (space.type === 'airport') {
    // Airports: $25 for 1, $50 for 2, $100 for 3, $200 for 4
    const airportSpaces = CANONICAL_BOARD_SPACES.filter((s) => s.type === 'airport');
    const ownedCount = airportSpaces.filter((s) => getPropertyOwner(s.id) === ownerId).length;
    if (ownedCount === 1) rent = 25;
    else if (ownedCount === 2) rent = 50;
    else if (ownedCount === 3) rent = 100;
    else if (ownedCount >= 4) rent = 200;
  } else if (space.type === 'utility') {
    // Utilities: 4x dice if 1 owned, 10x dice if both owned
    const utilitySpaces = CANONICAL_BOARD_SPACES.filter((s) => s.type === 'utility');
    const ownedCount = utilitySpaces.filter((s) => getPropertyOwner(s.id) === ownerId).length;
    const multiplier = ownedCount >= 2 ? 10 : 4;
    rent = multiplier * diceTotal;
  } else if (space.type === 'property' && space.group) {
    const houses = getHouses(space.id);
    if (houses > 0 && space.rentTiers) {
      // Improved property: rent based on tier
      rent = space.rentTiers[Math.min(houses, 5)];
    } else {
      // Unimproved property: check for complete color group monopoly
      const isMonopoly = hasColorMonopoly(space.group, ownerId, getPropertyOwner);
      if (isMonopoly && doubleRentRule) {
        rent = (space.rent ?? 0) * 2;
      }
    }
  }

  return rent;
}
