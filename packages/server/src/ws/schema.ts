import { Ajv, type ValidateFunction } from 'ajv';
import { BOARD_SIZE, WALL_GRID } from '@quoridor/engine';
import { DEFAULT_LIMITS } from '../config.js';
import type { ClientMessage } from './protocol.js';

const ajv = new Ajv({ allErrors: false, removeAdditional: false, strict: true });

const pos = {
  type: 'object',
  additionalProperties: false,
  required: ['c', 'r'],
  properties: {
    c: { type: 'integer', minimum: 0, maximum: BOARD_SIZE - 1 },
    r: { type: 'integer', minimum: 0, maximum: BOARD_SIZE - 1 },
  },
} as const;

const wall = {
  type: 'object',
  additionalProperties: false,
  required: ['c', 'r', 'o'],
  properties: {
    c: { type: 'integer', minimum: 0, maximum: WALL_GRID - 1 },
    r: { type: 'integer', minimum: 0, maximum: WALL_GRID - 1 },
    o: { enum: ['h', 'v'] },
  },
} as const;

/**
 * Each branch is self-contained with its own `additionalProperties: false`, so
 * a frame cannot smuggle both a pawn destination and a wall in one move.
 */
const move = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'to'],
      properties: { type: { const: 'pawn' }, to: pos },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'wall'],
      properties: { type: { const: 'wall' }, wall },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: { const: 'resign' } },
    },
  ],
} as const;

const rid = { type: 'integer', minimum: 0, maximum: 2 ** 31 } as const;
const name = { type: 'string', minLength: 0, maxLength: DEFAULT_LIMITS.maxNameLength } as const;
const code = { type: 'string', pattern: '^[0-9]{6}$' } as const;

/**
 * The host's own place in the move order, 1-based. `null` (or omitted) asks
 * for a random draw.
 *
 * The real ceiling is `playerCount`, which a single bound cannot express, so
 * this carries the widest possible range and `positionFitsTable` narrows it
 * per table size below. `RoomManager` checks the same rule again - the client
 * is never the authority on it.
 */
const hostPosition = { type: ['integer', 'null'], minimum: 1, maximum: 4 } as const;

function positionFitsTable(playerCount: number): object {
  return {
    if: {
      type: 'object',
      required: ['playerCount'],
      properties: { playerCount: { const: playerCount } },
    },
    then: {
      type: 'object',
      properties: { hostPosition: { type: ['integer', 'null'], maximum: playerCount } },
    },
  };
}

/**
 * One schema per message type. Everything inbound is validated before it is
 * allowed anywhere near the room state: shapes, ranges, string lengths and
 * unexpected properties are all rejected at the edge.
 */
const schemas: Record<ClientMessage['type'], object> = {
  'room.create': {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'playerCount', 'aiLevel', 'fillWithCpu', 'name'],
    properties: {
      type: { const: 'room.create' },
      rid,
      playerCount: { enum: [2, 3, 4] },
      aiLevel: { enum: ['easy', 'normal', 'hard'] },
      fillWithCpu: { type: 'boolean' },
      name,
      hostPosition,
    },
    allOf: [positionFitsTable(2), positionFitsTable(3)],
  },
  'room.join': {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'code', 'name'],
    properties: { type: { const: 'room.join' }, rid, code, name },
  },
  'room.watch': {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'code'],
    properties: { type: { const: 'room.watch' }, rid, code },
  },
  'room.reconnect': {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'code', 'playerToken'],
    properties: {
      type: { const: 'room.reconnect' },
      rid,
      code,
      playerToken: { type: 'string', minLength: 8, maxLength: 64 },
      lastGameVersion: { type: 'integer', minimum: 0 },
    },
  },
  'room.start': {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: { type: { const: 'room.start' }, rid },
  },
  'room.rematch': {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: { type: { const: 'room.rematch' }, rid },
  },
  'room.leave': {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: { type: { const: 'room.leave' }, rid },
  },
  'game.move': {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'expectedGameVersion', 'move'],
    properties: {
      type: { const: 'game.move' },
      rid,
      expectedGameVersion: { type: 'integer', minimum: 0 },
      move,
    },
  },
  ping: {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: { type: { const: 'ping' }, rid },
  },
};

const validators = new Map<string, ValidateFunction>(
  Object.entries(schemas).map(([type, schema]) => [type, ajv.compile(schema)]),
);

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string; rid?: number };

/** Parses and validates one inbound frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'message must be an object' };
  }

  const record = value as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') return { ok: false, reason: 'missing type' };

  const validate = validators.get(type);
  const candidateRid = typeof record['rid'] === 'number' ? (record['rid'] as number) : undefined;
  if (!validate) {
    return candidateRid === undefined
      ? { ok: false, reason: `unknown type: ${type}` }
      : { ok: false, reason: `unknown type: ${type}`, rid: candidateRid };
  }
  if (!validate(record)) {
    const reason = validate.errors?.[0]?.message ?? 'invalid message';
    return candidateRid === undefined ? { ok: false, reason } : { ok: false, reason, rid: candidateRid };
  }
  return { ok: true, message: record as unknown as ClientMessage };
}

/** Collapses whitespace and trims to the display limit. */
export function sanitiseName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DEFAULT_LIMITS.maxNameLength);
  return cleaned.length > 0 ? cleaned : fallback;
}
