import { randomInt, randomUUID, createHash } from 'node:crypto';
import type { RoomStore } from './store.js';

export const ROOM_CODE_LENGTH = 6;
const CODE_SPACE = 10 ** ROOM_CODE_LENGTH;

/**
 * Six digits, read out loud over a call. `crypto.randomInt` keeps them
 * unguessable; the store's atomic insert keeps them unique.
 */
export function generateRoomCode(): string {
  return String(randomInt(0, CODE_SPACE)).padStart(ROOM_CODE_LENGTH, '0');
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

export class CodeExhaustedError extends Error {
  constructor() {
    super('could not allocate a room code');
    this.name = 'CodeExhaustedError';
  }
}

/** Draws codes until one is free. Ten tries is plenty at any sane room count. */
export async function reserveRoomCode(
  store: RoomStore,
  roomId: string,
  expiresAt: number,
  attempts = 10,
): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const code = generateRoomCode();
    if (await store.reserveCode(code, roomId, expiresAt)) return code;
  }
  throw new CodeExhaustedError();
}

export function newRoomId(): string {
  return randomUUID();
}

/** Opaque bearer token proving "I am the player in this seat". */
export function newPlayerToken(): string {
  return randomUUID();
}

/**
 * Only the hash is ever persisted, so a leaked snapshot cannot be replayed as
 * a seat takeover.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
