import type { SeatDirection } from '@quoridor/engine';
import type { Lang, MessageKey } from '../i18n/index.js';
import type { ErrorCode, RoomView } from '../net/protocol.js';

/** Board and roster read seat colours from the same place so they never drift. */
export function seatColors(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `var(--seat-${index})`);
}

const SEAT_LABELS: Record<SeatDirection, MessageKey> = {
  south: 'seatSouth',
  west: 'seatWest',
  north: 'seatNorth',
  east: 'seatEast',
};

export function seatLabelKey(seat: SeatDirection): MessageKey {
  return SEAT_LABELS[seat];
}

const ERROR_KEYS: Record<ErrorCode, MessageKey> = {
  'room-unavailable': 'errRoomUnavailable',
  'not-host': 'errNotHost',
  'already-started': 'errAlreadyStarted',
  'not-your-turn': 'errNotYourTurn',
  'illegal-move': 'errIllegalMove',
  'version-conflict': 'errVersionConflict',
  capacity: 'errCapacity',
  'invalid-request': 'errGeneric',
  'rate-limited': 'errRateLimited',
  'bad-message': 'errGeneric',
  'protocol-mismatch': 'errProtocolMismatch',
  internal: 'errGeneric',
};

export function errorKey(code: ErrorCode): MessageKey {
  return ERROR_KEYS[code] ?? 'errGeneric';
}

/** Seats still waiting for a human before the host can sensibly start. */
export function openSeatCount(room: RoomView): number {
  return room.seats.filter((seat) => seat.connection === 'empty').length;
}

export function displayName(
  room: RoomView,
  index: number,
  you: number | null,
  t: (key: MessageKey) => string,
): string {
  const seat = room.seats[index];
  if (!seat) return '';
  if (index === you) return seat.name || t('lobbyYou');
  if (seat.kind === 'cpu' || seat.connection === 'cpu-controlled') {
    return seat.name || `${t('seatCpu')} ${index + 1}`;
  }
  return seat.name || t(seatLabelKey(seat.seat));
}

/** "2nd" / "2 位". Placings only ever run 1..4, but the general rule is cheap. */
export function ordinal(place: number, lang: Lang): string {
  if (lang === 'ja') return `${place} 位`;
  const teens = place % 100;
  if (teens >= 11 && teens <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/**
 * "1st" / "1 番手" - where a seat sits in the move order.
 *
 * Kept apart from `ordinal` because in Japanese finishing 1st ("1 位") and
 * moving first ("1 番手") are different words for different things.
 */
export function turnOrderLabel(position: number, lang: Lang): string {
  return lang === 'ja' ? `${position} 番手` : ordinal(position, 'en');
}
