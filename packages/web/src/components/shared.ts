import type { SeatDirection } from '@quoridor/engine';
import type { MessageKey } from '../i18n/index.js';
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
