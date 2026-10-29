export interface ParsedInviteResult {
  code: string | null;
  error: string | null;
}

/**
 * Extracts and validates a room invite code from a URL search string, full URL, or query parameter.
 *
 * Requirements:
 * - Minimum 3 characters, maximum 10 characters (matches JoinRoomPayloadSchema)
 * - Alphanumeric characters only
 * - Case-insensitive: normalized to uppercase
 * - Strips trailing hashes or extraneous queries
 * - Returns null code and error if no 'room' query parameter is present
 * - Returns clear user-facing error message if 'room' query parameter is present but invalid
 */
export function parseInviteRoomCode(input?: string | null): ParsedInviteResult {
  if (!input) {
    return { code: null, error: null };
  }

  let searchString = input.trim();
  if (!searchString) {
    return { code: null, error: null };
  }

  // Remove fragment/hash if present
  if (searchString.includes('#')) {
    searchString = searchString.split('#')[0];
  }

  // If a full URL is passed, extract query portion
  if (searchString.includes('?')) {
    searchString = searchString.slice(searchString.indexOf('?'));
  } else if (!searchString.startsWith('?') && searchString.includes('=')) {
    searchString = `?${searchString}`;
  } else if (!searchString.includes('=')) {
    return { code: null, error: null };
  }

  let rawRoom: string | null = null;
  try {
    const params = new URLSearchParams(searchString);
    if (!params.has('room')) {
      return { code: null, error: null };
    }
    rawRoom = params.get('room');
  } catch {
    return {
      code: null,
      error: 'Invalid room invite link format.',
    };
  }

  if (rawRoom === null) {
    return { code: null, error: null };
  }

  const trimmed = rawRoom.trim();
  if (trimmed.length === 0) {
    return {
      code: null,
      error: 'Invalid room invite link: Room code cannot be empty.',
    };
  }

  if (trimmed.length < 3 || trimmed.length > 10) {
    return {
      code: null,
      error: `Invalid room invite link: Room code must be 3–10 characters (received ${trimmed.length}).`,
    };
  }

  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return {
      code: null,
      error: 'Invalid room invite link: Room code must only contain letters and numbers.',
    };
  }

  return {
    code: trimmed.toUpperCase(),
    error: null,
  };
}

