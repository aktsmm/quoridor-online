import {
  CLOCKWISE_SEATS,
  createGame,
  defaultSeats,
  isGameOver,
  moveToNotation,
  seatsExcluding,
  tryApplyMove,
  type Move,
  type PlayerCount,
  type SeatDirection,
} from '@quoridor/engine';
import { isAiLevel, type AiLevel } from '@quoridor/ai';
import type { ServerConfig } from '../config.js';
import {
  ROOM_SCHEMA_VERSION,
  hasLiveHuman,
  isCpuSeat,
  nextFirstTurn,
  seatByToken,
  type RoomRecord,
  type SeatRecord,
  type StoredRoom,
} from './record.js';
import type { RoomStore } from './store.js';
import { hashToken, newPlayerToken, newRoomId, reserveRoomCode } from './code.js';

export type RoomErrorCode =
  | 'room-unavailable'
  | 'invalid-request'
  | 'not-your-turn'
  | 'illegal-move'
  | 'version-conflict'
  | 'not-host'
  | 'not-ready'
  | 'already-started'
  | 'capacity'
  | 'conflict';

export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RoomError';
    this.code = code;
  }
}

export interface CreateRoomInput {
  playerCount: PlayerCount;
  aiLevel: AiLevel;
  fillWithCpu: boolean;
  name: string;
  /**
   * Where the host wants to sit in the move order, 1-based, or null to be
   * dealt one at random.
   *
   * Deliberately *not* called `firstTurn`: this is a position in the order
   * ("I want to go second"), while the engine's `firstTurn` is a 0-based seat
   * index ("seat 1 opens"). They coincide only when the host holds seat 0 and
   * asks to go first, and conflating them silently rotates the table.
   */
  hostPosition?: number | null;
}

/** The seat the room creator always takes. */
const HOST_SEAT = 0;

/**
 * Converts "the host is the Nth to move" into the 0-based seat that opens.
 *
 * Written for an arbitrary host seat rather than assuming 0, so the intent
 * stays readable even though rooms only ever resolve this at creation, when
 * the host is seat 0 by construction.
 */
export function firstTurnForHostPosition(
  hostSeat: number,
  hostPosition: number,
  playerCount: number,
): number {
  return (((hostSeat - (hostPosition - 1)) % playerCount) + playerCount) % playerCount;
}

export interface SeatGrant {
  stored: StoredRoom;
  seatIndex: number;
  /** Raw token, returned to exactly one client and never persisted. */
  playerToken: string;
}

interface MutationContext {
  now: number;
  /** Marks the record as changed so the version is bumped and it is saved. */
  touch(): void;
}

const MAX_CAS_ATTEMPTS = 6;
/** Drift below this is not worth a storage round trip on a read. */
const EXPIRY_WRITE_THRESHOLD_MS = 60_000;
/** Code reservations outlive the room they point at, so codes are never recycled early. */
const CODE_RESERVATION_SLACK_MS = 10 * 60_000;

/**
 * Owns every room mutation.
 *
 * Each change is a load -> reconcile -> mutate -> compare-and-swap cycle, so
 * concurrent actors (a human move, a CPU move landing late, a reconnect, the
 * grace-period sweeper) are serialised by the store rather than by luck. The
 * caller only broadcasts after the swap succeeds.
 */
export class RoomManager {
  readonly #store: RoomStore;
  readonly #config: ServerConfig;
  readonly #now: () => number;
  readonly #random: () => number;
  #roomCount = 0;

  constructor(options: {
    store: RoomStore;
    config: ServerConfig;
    now?: () => number;
    random?: () => number;
  }) {
    this.#store = options.store;
    this.#config = options.config;
    this.#now = options.now ?? (() => Date.now());
    this.#random = options.random ?? Math.random;
  }

  get store(): RoomStore {
    return this.#store;
  }

  async createRoom(input: CreateRoomInput): Promise<SeatGrant> {
    if (this.#roomCount >= this.#config.limits.maxRooms) throw new RoomError('capacity');
    if (!isAiLevel(input.aiLevel)) throw new RoomError('invalid-request');
    // Checked here, before a code is reserved, and again in the JSON schema at
    // the edge. The schema cannot express "at most `playerCount`" as a plain
    // bound, and in any case the client is never the authority on this.
    const hostPosition = input.hostPosition ?? null;
    if (hostPosition !== null) {
      if (!Number.isInteger(hostPosition) || hostPosition < 1 || hostPosition > input.playerCount) {
        throw new RoomError('invalid-request', 'hostPosition out of range');
      }
    }

    const now = this.#now();
    const roomId = newRoomId();
    const expiresAt = now + this.#config.abandonedRoomTtlMs;
    const code = await reserveRoomCode(
      this.#store,
      roomId,
      expiresAt + CODE_RESERVATION_SLACK_MS,
    );

    const token = newPlayerToken();
    const seats = this.#layoutSeats(input.playerCount).map<SeatRecord>((seat, index) => ({
      index,
      seat,
      name: '',
      kind: 'human',
      connection: 'empty',
      tokenHash: null,
      disconnectedAt: null,
    }));
    const host = seats[HOST_SEAT]!;
    host.name = input.name;
    host.connection = 'connected';
    host.tokenHash = hashToken(token);

    const record: RoomRecord = {
      schemaVersion: ROOM_SCHEMA_VERSION,
      roomId,
      code,
      createdAt: now,
      updatedAt: now,
      lastHumanAt: now,
      expiresAt,
      gameVersion: 1,
      status: 'lobby',
      playerCount: input.playerCount,
      aiLevel: input.aiLevel,
      fillWithCpu: input.fillWithCpu,
      hostSeat: HOST_SEAT,
      initialFirstTurn:
        hostPosition === null
          ? Math.floor(this.#random() * input.playerCount)
          : firstTurnForHostPosition(HOST_SEAT, hostPosition, input.playerCount),
      seats,
      game: null,
      moveLog: [],
    };

    const stored = await this.#store.create(record);
    this.#roomCount += 1;
    return { stored, seatIndex: 0, playerToken: token };
  }

  /**
   * Three-player games leave one side empty; rotating which side (and, at
   * start, who moves first) keeps the unofficial variant roughly fair.
   */
  #layoutSeats(playerCount: PlayerCount): SeatDirection[] {
    if (playerCount !== 3) return defaultSeats(playerCount);
    const empty = CLOCKWISE_SEATS[Math.floor(this.#random() * CLOCKWISE_SEATS.length)]!;
    const seats = seatsExcluding(empty);
    // `seatsExcluding` keeps the fixed clockwise order, so on its own the host
    // would draw south in three of the four layouts and the last player to join
    // would draw east just as often. Rotating the survivors leaves the turn
    // order clockwise but hands every seat index each direction equally often,
    // so no measurable or future difference between directions can attach
    // itself to join order.
    const offset = Math.floor(this.#random() * seats.length);
    return [...seats.slice(offset), ...seats.slice(0, offset)];
  }

  async joinRoom(code: string, name: string): Promise<SeatGrant> {
    const roomId = await this.#store.lookupCode(code);
    // Missing, full and already-started all look identical from outside so the
    // code space cannot be enumerated for live games.
    if (!roomId) throw new RoomError('room-unavailable');

    const token = newPlayerToken();
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      // A finished room is between games, so it takes newcomers just like a
      // fresh lobby does - that is what keeps a table together for a rematch.
      if (record.status === 'playing') throw new RoomError('room-unavailable');
      const seat = record.seats.find((s) => s.connection === 'empty' && s.tokenHash === null);
      if (!seat) throw new RoomError('room-unavailable');
      seat.name = name;
      seat.kind = 'human';
      seat.connection = 'connected';
      seat.tokenHash = hashToken(token);
      seat.disconnectedAt = null;
      record.hostSeat ??= seat.index;
      ctx.touch();
      return seat.index;
    });
    if (!outcome) throw new RoomError('room-unavailable');
    return { stored: outcome.stored, seatIndex: outcome.result, playerToken: token };
  }

  /** Returns the seat the token owns, taking it back from the CPU if needed. */
  async reconnect(code: string, playerToken: string): Promise<{ stored: StoredRoom; seatIndex: number }> {
    const roomId = await this.#store.lookupCode(code);
    if (!roomId) throw new RoomError('room-unavailable');
    const hash = hashToken(playerToken);

    const outcome = await this.#mutate(roomId, (record, ctx) => {
      const seat = seatByToken(record, hash);
      if (!seat) throw new RoomError('room-unavailable');
      seat.connection = 'connected';
      seat.disconnectedAt = null;
      record.hostSeat ??= seat.index;
      ctx.touch();
      return seat.index;
    });
    if (!outcome) throw new RoomError('room-unavailable');
    return { stored: outcome.stored, seatIndex: outcome.result };
  }

  /** Starts the grace period. The seat is still theirs until it expires. */
  async markDisconnected(roomId: string, seatIndex: number): Promise<StoredRoom | null> {
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      const seat = record.seats[seatIndex];
      if (!seat || seat.connection !== 'connected') return false;
      seat.connection = 'disconnected';
      seat.disconnectedAt = ctx.now;
      ctx.touch();
      return true;
    });
    return outcome?.stored ?? null;
  }

  /** Explicit "I'm out". Unlike a dropped socket this releases the seat now. */
  async leave(roomId: string, seatIndex: number): Promise<StoredRoom | null> {
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      const seat = record.seats[seatIndex];
      if (!seat) return false;
      // Between games the seat is free again; mid-game it has to keep playing,
      // so the CPU takes over instead of the position losing a player.
      if (record.status === 'playing') {
        seat.connection = 'cpu-controlled';
      } else {
        seat.name = '';
        seat.kind = 'human';
        seat.connection = 'empty';
        seat.tokenHash = null;
      }
      seat.disconnectedAt = null;
      ctx.touch();
      return true;
    });
    return outcome?.stored ?? null;
  }

  async start(roomId: string, seatIndex: number): Promise<StoredRoom> {
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      if (record.hostSeat !== seatIndex) throw new RoomError('not-host');
      if (record.status !== 'lobby') throw new RoomError('already-started');
      this.#beginGame(record);
      ctx.touch();
      return true;
    });
    if (!outcome) throw new RoomError('room-unavailable');
    return outcome.stored;
  }

  /**
   * Starts the next game without breaking up the table. Seats, names and
   * tokens all survive; only the position is new, and the opening seat steps
   * on by one so the first-mover advantage rotates rather than sticking with
   * whoever happens to host.
   */
  async rematch(roomId: string, seatIndex: number): Promise<StoredRoom> {
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      if (record.hostSeat !== seatIndex) throw new RoomError('not-host');
      if (record.status !== 'finished') throw new RoomError('invalid-request');
      this.#beginGame(record);
      ctx.touch();
      return true;
    });
    if (!outcome) throw new RoomError('room-unavailable');
    return outcome.stored;
  }

  #beginGame(record: RoomRecord): void {
    for (const seat of record.seats) {
      if (seat.connection !== 'disconnected') continue;
      // The token still reclaims this seat. Until then the CPU keeps the game
      // moving instead of waiting for a grace-period timer that may sleep.
      seat.connection = 'cpu-controlled';
      seat.disconnectedAt = null;
    }
    if (record.fillWithCpu) {
      for (const seat of record.seats) {
        if (seat.connection !== 'empty') continue;
        seat.kind = 'cpu';
        seat.connection = 'cpu-controlled';
        seat.name = `CPU ${seat.index + 1}`;
      }
    }
    if (record.seats.some((s) => s.connection === 'empty')) throw new RoomError('not-ready');

    // `nextFirstTurn` reads the game that just finished, so a rematch rotates
    // the opening seat on by one without anyone having to keep a counter.
    record.game = createGame({
      playerCount: record.playerCount,
      seats: record.seats.map((s) => s.seat),
      firstTurn: nextFirstTurn(record),
    });
    record.status = 'playing';
    record.moveLog = [];
  }

  /**
   * Applies a move on behalf of a seat.
   *
   * `expectedGameVersion` is mandatory: it makes a stale client (or an AI
   * result that arrived after the position moved on) fail loudly instead of
   * silently overwriting a newer position.
   */
  async applyMove(
    roomId: string,
    seatIndex: number,
    expectedGameVersion: number,
    move: Move,
  ): Promise<StoredRoom> {
    const outcome = await this.#mutate(roomId, (record, ctx) => {
      if (record.status !== 'playing' || !record.game) throw new RoomError('room-unavailable');
      if (record.gameVersion !== expectedGameVersion) throw new RoomError('version-conflict');
      if (record.game.turn !== seatIndex) throw new RoomError('not-your-turn');

      const result = tryApplyMove(record.game, move);
      if (!result.ok) throw new RoomError('illegal-move', result.reason);

      record.game = result.state;
      record.moveLog.push(moveToNotation(move));
      if (isGameOver(result.state)) record.status = 'finished';
      ctx.touch();
      return true;
    });
    if (!outcome) throw new RoomError('room-unavailable');
    return outcome.stored;
  }

  /** Reads the room, applying any pending grace-period or TTL transitions. */
  async get(roomId: string): Promise<StoredRoom | null> {
    const outcome = await this.#mutate(roomId, () => true);
    return outcome?.stored ?? null;
  }

  async getByCode(code: string): Promise<StoredRoom | null> {
    const roomId = await this.#store.lookupCode(code);
    if (!roomId) return null;
    return this.get(roomId);
  }

  async destroy(roomId: string): Promise<void> {
    const stored = await this.#store.load(roomId);
    if (!stored) return;
    await this.#store.delete(roomId, stored.etag);
    await this.#store.releaseCode(stored.record.code);
    this.#roomCount = Math.max(0, this.#roomCount - 1);
  }

  /**
   * Load, bring the record up to date with the wall clock, run the mutator,
   * then compare-and-swap. Retries from a fresh read when someone else wins.
   */
  async #mutate<T>(
    roomId: string,
    fn: (record: RoomRecord, ctx: MutationContext) => T,
  ): Promise<{ stored: StoredRoom; result: T } | null> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const loaded = await this.#store.load(roomId);
      if (!loaded) return null;
      if (loaded.record.schemaVersion !== ROOM_SCHEMA_VERSION) {
        await this.#store.delete(roomId, loaded.etag);
        return null;
      }

      const now = this.#now();
      if (loaded.record.expiresAt <= now) {
        await this.#store.delete(roomId, loaded.etag);
        await this.#store.releaseCode(loaded.record.code);
        this.#roomCount = Math.max(0, this.#roomCount - 1);
        return null;
      }

      // `touch` means "clients need to see this"; bookkeeping writes (expiry
      // refresh) are saved without bumping the version, so an idle read never
      // invalidates a move that is already in flight.
      let touched = false;
      const ctx: MutationContext = {
        now,
        touch: () => {
          touched = true;
        },
      };

      if (this.#reconcile(loaded.record, now)) touched = true;
      const result = fn(loaded.record, ctx);
      const bookkeeping = this.#refreshExpiry(loaded.record, now, touched);

      if (!touched && !bookkeeping) return { stored: loaded, result };

      if (touched) loaded.record.gameVersion += 1;
      loaded.record.updatedAt = now;
      const saved = await this.#store.save(loaded.record, loaded.etag);
      if (saved) {
        if (bookkeeping) {
          await this.#store.touchCode(
            saved.record.code,
            roomId,
            saved.record.expiresAt + CODE_RESERVATION_SLACK_MS,
          );
        }
        return { stored: saved, result };
      }
    }
    throw new RoomError('conflict', 'room is being updated too quickly');
  }

  /**
   * Time-based transitions. These have to be computed on read rather than by a
   * timer, because with `minReplicas: 0` there may be no process running when
   * the deadline passes.
   */
  #reconcile(record: RoomRecord, now: number): boolean {
    let changed = false;

    for (const seat of record.seats) {
      if (seat.connection !== 'disconnected' || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt < this.#config.reconnectGraceMs) continue;

      if (record.status === 'lobby') {
        seat.name = '';
        seat.kind = 'human';
        seat.connection = 'empty';
        seat.tokenHash = null;
      } else {
        // The token keeps working, so they can still come back and take over.
        seat.connection = 'cpu-controlled';
      }
      seat.disconnectedAt = null;
      changed = true;
    }

    const host = record.hostSeat === null ? undefined : record.seats[record.hostSeat];
    const hostLost = !host || host.connection === 'empty' || host.kind === 'cpu';
    if (hostLost) {
      // Only a permanent loss delegates; a blip leaves the host where it is.
      const next =
        record.seats.find((s) => s.kind === 'human' && s.connection === 'connected') ??
        record.seats.find((s) => s.kind === 'human' && s.connection !== 'empty');
      const nextSeat = next?.index ?? null;
      if (record.hostSeat !== nextSeat) {
        record.hostSeat = nextSeat;
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Rooms live for `roomTtlMs` while a human is connected and only
   * `abandonedRoomTtlMs` after the last one drops.
   *
   * Both deadlines are derived from `lastHumanAt` rather than from a timer,
   * because with `minReplicas: 0` there may be no process alive when the
   * deadline passes - the answer has to be recomputable from the record alone.
   */
  #refreshExpiry(record: RoomRecord, now: number, dirty: boolean): boolean {
    const live = hasLiveHuman(record);
    const lastHumanAt = live ? now : record.lastHumanAt;
    const ttl = live ? this.#config.roomTtlMs : this.#config.abandonedRoomTtlMs;
    const target = lastHumanAt + ttl;

    if (target === record.expiresAt && lastHumanAt === record.lastHumanAt) return false;
    // A plain read should not turn into a write, so small drift is ignored
    // unless we are saving anyway.
    if (!dirty && Math.abs(target - record.expiresAt) < EXPIRY_WRITE_THRESHOLD_MS) return false;

    record.lastHumanAt = lastHumanAt;
    record.expiresAt = target;
    return true;
  }
}

/** The seat whose turn it is, or undefined outside a running game. */
export function seatToMove(record: RoomRecord): SeatRecord | undefined {
  if (record.status !== 'playing' || !record.game) return undefined;
  return record.seats[record.game.turn];
}

export function isCpuToMove(record: RoomRecord): boolean {
  return isCpuSeat(seatToMove(record));
}
