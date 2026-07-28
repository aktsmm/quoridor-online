import { BOARD_SIZE, WALL_GRID, type Wall } from '@quoridor/engine';

/**
 * Zobrist keys for the transposition table.
 *
 * Two independent 32-bit words are kept and folded into one 53-bit safe
 * integer, because a single 32-bit key collides often enough at a few hundred
 * thousand entries to hand the search a wrong bound.
 */
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const WALL_COUNT = WALL_GRID * WALL_GRID * 2;
const MAX_PLAYERS = 4;
const MAX_RESERVE = 11;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function table(size: number, rng: () => number): Int32Array {
  const out = new Int32Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (rng() * 4294967296) | 0;
  return out;
}

const rngHi = mulberry32(0x9e3779b9);
const rngLo = mulberry32(0x85ebca6b);

export const PAWN_HI = table(MAX_PLAYERS * CELL_COUNT, rngHi);
export const PAWN_LO = table(MAX_PLAYERS * CELL_COUNT, rngLo);
export const WALL_HI = table(WALL_COUNT, rngHi);
export const WALL_LO = table(WALL_COUNT, rngLo);
export const TURN_HI = table(MAX_PLAYERS, rngHi);
export const TURN_LO = table(MAX_PLAYERS, rngLo);
export const RESERVE_HI = table(MAX_PLAYERS * MAX_RESERVE, rngHi);
export const RESERVE_LO = table(MAX_PLAYERS * MAX_RESERVE, rngLo);

export function pawnKey(player: number, cell: number): number {
  return player * CELL_COUNT + cell;
}

export function wallKeyIndex(wall: Wall): number {
  return (wall.c * WALL_GRID + wall.r) * 2 + (wall.o === 'v' ? 1 : 0);
}

export function reserveKey(player: number, left: number): number {
  return player * MAX_RESERVE + Math.min(left, MAX_RESERVE - 1);
}

/** Folds the two words into one integer that is safe as a `Map` key. */
export function foldHash(hi: number, lo: number): number {
  return (hi >>> 0) * 2097152 + (lo >>> 11);
}
