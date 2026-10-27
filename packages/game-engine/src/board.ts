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
  flag?: string;
  subtext?: string;
}

export const CANONICAL_BOARD_SPACES: BoardSpace[] = [
  // Top Row (0 to 10: Left-to-Right)
  { id: 0, name: 'START', type: 'corner', subtext: 'COLLECT $200' },
  { id: 1, name: 'Salvador', type: 'property', group: 'brown', price: 60, rent: 4, flag: '🇧🇷' },
  { id: 2, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 3, name: 'Rio', type: 'property', group: 'brown', price: 60, rent: 4, flag: '🇧🇷' },
  { id: 4, name: 'Earnings Tax', type: 'tax', price: 100, subtext: '$100' },
  { id: 5, name: 'TLV Airport', type: 'airport', price: 200, rent: 25, flag: '✈️' },
  { id: 6, name: 'Tel Aviv', type: 'property', group: 'sky', price: 100, rent: 6, flag: '🇮🇱' },
  { id: 7, name: 'Haifa', type: 'property', group: 'sky', price: 110, rent: 6, flag: '🇮🇱' },
  { id: 8, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 9, name: 'Jerusalem', type: 'property', group: 'sky', price: 120, rent: 8, flag: '🇮🇱' },
  { id: 10, name: 'In Prison', type: 'corner', subtext: 'PASSING BY' },

  // Right Column (11 to 19: Top-to-Bottom)
  { id: 11, name: 'Venice', type: 'property', group: 'pink', price: 130, rent: 10, flag: '🇮🇹' },
  { id: 12, name: 'Power Co.', type: 'utility', price: 150, rent: 15, subtext: '⚡' },
  { id: 13, name: 'Milan', type: 'property', group: 'pink', price: 140, rent: 10, flag: '🇮🇹' },
  { id: 14, name: 'Rome', type: 'property', group: 'pink', price: 160, rent: 12, flag: '🇮🇹' },
  { id: 15, name: 'MUC Airport', type: 'airport', price: 200, rent: 25, flag: '✈️' },
  { id: 16, name: 'Frankfurt', type: 'property', group: 'orange', price: 180, rent: 14, flag: '🇩🇪' },
  { id: 17, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 18, name: 'Munich', type: 'property', group: 'orange', price: 190, rent: 14, flag: '🇩🇪' },
  { id: 19, name: 'Berlin', type: 'property', group: 'orange', price: 200, rent: 16, flag: '🇩🇪' },
  { id: 20, name: 'Vacation', type: 'corner', subtext: 'REST' },

  // Bottom Row (21 to 29: Right-to-Left in board perimeter order)
  { id: 21, name: 'Shenzhen', type: 'property', group: 'red', price: 210, rent: 18, flag: '🇨🇳' },
  { id: 22, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 23, name: 'Beijing', type: 'property', group: 'red', price: 220, rent: 18, flag: '🇨🇳' },
  { id: 24, name: 'Shanghai', type: 'property', group: 'red', price: 240, rent: 20, flag: '🇨🇳' },
  { id: 25, name: 'CDG Airport', type: 'airport', price: 200, rent: 25, flag: '✈️' },
  { id: 26, name: 'Lyon', type: 'property', group: 'yellow', price: 260, rent: 22, flag: '🇫🇷' },
  { id: 27, name: 'Water Co.', type: 'utility', price: 150, rent: 15, subtext: '💧' },
  { id: 28, name: 'Toulouse', type: 'property', group: 'yellow', price: 270, rent: 22, flag: '🇫🇷' },
  { id: 29, name: 'Paris', type: 'property', group: 'yellow', price: 280, rent: 24, flag: '🇫🇷' },
  { id: 30, name: 'Go to Prison', type: 'corner', subtext: 'ARREST' },

  // Left Column (31 to 39: Bottom-to-Top in board perimeter order)
  { id: 31, name: 'Liverpool', type: 'property', group: 'green', price: 290, rent: 26, flag: '🇬🇧' },
  { id: 32, name: 'Manchester', type: 'property', group: 'green', price: 300, rent: 26, flag: '🇬🇧' },
  { id: 33, name: 'Treasure', type: 'treasure', subtext: 'CHEST' },
  { id: 34, name: 'London', type: 'property', group: 'green', price: 320, rent: 28, flag: '🇬🇧' },
  { id: 35, name: 'JFK Airport', type: 'airport', price: 200, rent: 25, flag: '✈️' },
  { id: 36, name: 'Surprise', type: 'surprise', subtext: '?' },
  { id: 37, name: 'San Francisco', type: 'property', group: 'blue', price: 360, rent: 35, flag: '🇺🇸' },
  { id: 38, name: 'Premium Tax', type: 'tax', price: 75, subtext: '$75' },
  { id: 39, name: 'New York', type: 'property', group: 'blue', price: 400, rent: 50, flag: '🇺🇸' },
];

export const TOTAL_SPACES = 40;

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
