import type { AiLevel } from '@quoridor/ai';
import type { GameState, PlayerCount, SeatDirection } from '@quoridor/engine';

/**
 * Bumped whenever the persisted shape changes; older records are discarded.
 *
 * "Discarded" is literal - `RoomManager` deletes a record it cannot read - so
 * a bump wipes every live lobby and game the moment they are next touched.
 * Additive fields must therefore be optional and defaulted on read instead.
 */
export const ROOM_SCHEMA_VERSION = 2;

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
  /**
   * Seat that moves first in this room's *first* game, 0-based.
   *
   * Resolved once, when the room is created, from the position the host asked
   * for (or drawn at random). It is never recomputed: the host may be handed
   * over to another seat later, and re-applying a "host goes Nth" rule to the
   * new host would silently reorder the table. Fixing it at creation also
   * means nobody can change the order after people have joined.
   *
   * Optional because schema v2 records written before turn selection existed
   * do not carry it; `nextFirstTurn` defaults them to seat 0.
   */
  initialFirstTurn?: number;
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

/**
 * Seat that will move first in the next game this room deals, 0-based.
 *
 * Rematches step the opening seat on by one so the first-mover advantage is
 * passed around instead of staying with whoever hosts. The step is taken from
 * the game just played rather than from a counter, so the answer is entirely
 * recomputable from the persisted record - a replica restart, a revision swap
 * or a lost in-memory tally cannot desynchronise it.
 *
 * This also applies to rooms that asked for a random opening: the draw settles
 * the first game only, and every game after it rotates. Re-drawing each time
 * would let the same seat open twice in a row, which is exactly what the
 * rotation exists to prevent.
 *
 * The rotation follows *seats*, not people. If somebody leaves between games
 * and a newcomer takes the empty seat, the newcomer inherits whatever turn
 * position that seat was next in line for. It keeps the seats fair rather than
 * the individuals, which is the only thing a room can promise when its roster
 * changes underneath it.
 */
export function nextFirstTurn(record: RoomRecord): number {
  if (record.game) return (record.game.firstTurn + 1) % record.playerCount;
  return normaliseSeatIndex(record.initialFirstTurn, record.playerCount);
}

/** Anything a v2 record (or a corrupt one) leaves out falls back to seat 0. */
function normaliseSeatIndex(value: number | undefined, playerCount: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
  if (value < 0 || value >= playerCount) return 0;
  return value;
}

/**
 * Where a seat sits in the move order, 1-based, given the seat that opens.
 *
 * Seats are dealt clockwise from the opener, which is exactly the order
 * `GameState.turn` advances in.
 */
export function turnPosition(seatIndex: number, firstTurn: number, playerCount: number): number {
  return (((seatIndex - firstTurn) % playerCount) + playerCount) % playerCount + 1;
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
