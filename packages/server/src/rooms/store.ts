import type { RoomRecord, StoredRoom } from './record.js';

/**
 * Persistence contract for room snapshots.
 *
 * Two rules make the whole design work:
 *  - `reserveCode` is an atomic insert, so two replicas can never hand out the
 *    same 6-digit code.
 *  - `save` is a compare-and-swap on the ETag, so a move is only broadcast
 *    after it has definitely won the race.
 */
export interface RoomStore {
  /** True when the code was free and is now ours. */
  reserveCode(code: string, roomId: string, expiresAt: number): Promise<boolean>;
  /** Pushes an existing reservation's deadline out. No-op if it is not ours. */
  touchCode(code: string, roomId: string, expiresAt: number): Promise<void>;
  releaseCode(code: string): Promise<void>;
  lookupCode(code: string): Promise<string | null>;

  create(record: RoomRecord): Promise<StoredRoom>;
  load(roomId: string): Promise<StoredRoom | null>;
  /** Resolves to null when someone else wrote first; the caller must retry. */
  save(record: RoomRecord, etag: string): Promise<StoredRoom | null>;
  delete(roomId: string, etag: string): Promise<void>;

  close?(): Promise<void>;
}

export class CodeTakenError extends Error {
  constructor() {
    super('room code already reserved');
    this.name = 'CodeTakenError';
  }
}

interface MemoryEntry {
  json: string;
  etag: string;
}

/** In-process store used by tests and `npm run dev`. */
export class MemoryRoomStore implements RoomStore {
  readonly #rooms = new Map<string, MemoryEntry>();
  readonly #codes = new Map<string, { roomId: string; expiresAt: number }>();
  readonly #now: () => number;
  #etagSeq = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  #nextEtag(): string {
    this.#etagSeq += 1;
    return `W/"${this.#etagSeq}"`;
  }

  reserveCode(code: string, roomId: string, expiresAt: number): Promise<boolean> {
    const existing = this.#codes.get(code);
    if (existing && existing.expiresAt > this.#now()) return Promise.resolve(false);
    this.#codes.set(code, { roomId, expiresAt });
    return Promise.resolve(true);
  }

  touchCode(code: string, roomId: string, expiresAt: number): Promise<void> {
    const existing = this.#codes.get(code);
    if (existing && existing.roomId === roomId && expiresAt > existing.expiresAt) {
      this.#codes.set(code, { roomId, expiresAt });
    }
    return Promise.resolve();
  }

  releaseCode(code: string): Promise<void> {
    this.#codes.delete(code);
    return Promise.resolve();
  }

  lookupCode(code: string): Promise<string | null> {
    const entry = this.#codes.get(code);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.#now()) {
      this.#codes.delete(code);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.roomId);
  }

  create(record: RoomRecord): Promise<StoredRoom> {
    if (this.#rooms.has(record.roomId)) throw new Error('room already exists');
    const etag = this.#nextEtag();
    this.#rooms.set(record.roomId, { json: JSON.stringify(record), etag });
    return Promise.resolve({ record: clone(record), etag });
  }

  load(roomId: string): Promise<StoredRoom | null> {
    const entry = this.#rooms.get(roomId);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve({ record: JSON.parse(entry.json) as RoomRecord, etag: entry.etag });
  }

  save(record: RoomRecord, etag: string): Promise<StoredRoom | null> {
    const entry = this.#rooms.get(record.roomId);
    if (!entry || entry.etag !== etag) return Promise.resolve(null);
    const next = this.#nextEtag();
    this.#rooms.set(record.roomId, { json: JSON.stringify(record), etag: next });
    return Promise.resolve({ record: clone(record), etag: next });
  }

  delete(roomId: string, etag: string): Promise<void> {
    const entry = this.#rooms.get(roomId);
    if (entry && entry.etag === etag) this.#rooms.delete(roomId);
    return Promise.resolve();
  }

  /** Test helper: how many rooms are currently held. */
  get size(): number {
    return this.#rooms.size;
  }
}

function clone(record: RoomRecord): RoomRecord {
  return JSON.parse(JSON.stringify(record)) as RoomRecord;
}
