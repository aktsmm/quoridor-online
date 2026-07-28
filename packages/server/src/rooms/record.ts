import type { AiLevel } from '@quoridor/ai';
import type { GameState, PlayerCount, SeatDirection } from '@quoridor/engine';

/** Bumped whenever the persisted shape changes; older records are discarded. */
export const ROOM_SCHEMA_VERSION = 1;

export type RoomStatus = 'lobby' | 'playing' | 'finished';

/**
 * Where a seat's controller currently is.
 *
 * `disconnected` is the grace period: the seat is still reserved for the human
 * who holds the token. Once it expires the seat flips to `cpu-controlled` and
 * the AI plays on their behalf - but the token still works, so they can come
 * back and take over again.
 */
export type SeatConnection = 'empty' | 'connected' | 'disconnected' | 'cpu-controlled';

export interface SeatRecord {
  /** Index into `GameState.players`, fixed once the room is created. */
  index: number;
  seat: SeatDirection;
  name: string;
  /** `cpu` seats were never human; `human` seats may still be CPU-controlled. */
  kind: 'human' | 'cpu';
  connection: SeatConnection;
  /**
   * SHA-256 of the player token. The raw token only ever travels to the one
   * client that owns it, and is never stored, broadcast or logged.
   */
  tokenHash: string | null;
  /** Epoch ms of the disconnect that started the current grace period. */
  disconnectedAt: number | null;
}

export interface RoomRecord {
  schemaVersion: number;
  roomId: string;
  code: string;
  createdAt: number;
  updatedAt: number;
  /** Last moment a human was actually connected; the abandon clock runs from here. */
  lastHumanAt: number;
  expiresAt: number;
  /** Monotonic counter; every accepted mutation bumps it exactly once. */
  gameVersion: number;
  status: RoomStatus;
  playerCount: PlayerCount;
  aiLevel: AiLevel;
  fillWithCpu: boolean;
  /** Seat index of the host, or null once every human has left for good. */
  hostSeat: number | null;
  seats: SeatRecord[];
  game: GameState | null;
  /** Moves in standard notation, for the sidebar. */
  moveLog: string[];
}

/** A record plus the concurrency token it was read with. */
export interface StoredRoom {
  record: RoomRecord;
  etag: string;
}

export function humanSeats(record: RoomRecord): SeatRecord[] {
  return record.seats.filter((s) => s.kind === 'human');
}

export function hasLiveHuman(record: RoomRecord): boolean {
  return record.seats.some((s) => s.kind === 'human' && s.connection === 'connected');
}

export function seatByToken(record: RoomRecord, tokenHash: string): SeatRecord | undefined {
  return record.seats.find((s) => s.tokenHash !== null && s.tokenHash === tokenHash);
}

/** True when the seat to move is played by the machine. */
export function isCpuSeat(seat: SeatRecord | undefined): boolean {
  if (!seat) return false;
  return seat.kind === 'cpu' || seat.connection === 'cpu-controlled';
}
