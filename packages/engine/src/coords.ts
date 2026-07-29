import {
  BOARD_SIZE,
  WALL_GRID,
  type Orientation,
  type Pos,
  type SeatDirection,
  type Wall,
} from './types.js';

export function inBoard(c: number, r: number): boolean {
  return c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE;
}

export function isPos(p: Pos): boolean {
  return Number.isInteger(p.c) && Number.isInteger(p.r) && inBoard(p.c, p.r);
}

export function isWallAnchor(w: Wall): boolean {
  return (
    (w.o === 'h' || w.o === 'v') &&
    Number.isInteger(w.c) &&
    Number.isInteger(w.r) &&
    w.c >= 0 &&
    w.c < WALL_GRID &&
    w.r >= 0 &&
    w.r < WALL_GRID
  );
}

/** Flat index of a square, 0..80. */
export function cellIndex(c: number, r: number): number {
  return r * BOARD_SIZE + c;
}

export function cellCol(index: number): number {
  return index % BOARD_SIZE;
}

export function cellRow(index: number): number {
  return Math.floor(index / BOARD_SIZE);
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.c === b.c && a.r === b.r;
}

/** Directions in clockwise order starting from north. */
export const NORTH = 0;
export const EAST = 1;
export const SOUTH = 2;
export const WEST = 3;

export const DIR_DC = [0, 1, 0, -1] as const;
export const DIR_DR = [1, 0, -1, 0] as const;
export const DIRECTIONS = [NORTH, EAST, SOUTH, WEST] as const;

/** The two directions at right angles to `dir`, used for diagonal jumps. */
export const PERPENDICULAR: readonly (readonly [number, number])[] = [
  [EAST, WEST], // north
  [NORTH, SOUTH], // east
  [EAST, WEST], // south
  [NORTH, SOUTH], // west
];

/**
 * Board rotation, used purely for presentation so every player can look at
 * their own home row from the bottom of the screen. Game state, notation and
 * the wire protocol always stay in absolute coordinates; only the renderer and
 * the pointer hit-testing move into "view space".
 *
 * One quarter turn maps `(c, r)` to `(n - r, c)`, which is a rotation (the
 * determinant is 1), so applying it four times is the identity and applying it
 * `4 - k` times undoes `k`.
 */
export type QuarterTurns = 0 | 1 | 2 | 3;

export function normalizeQuarterTurns(k: number): QuarterTurns {
  if (!Number.isFinite(k)) return 0;
  return ((((Math.trunc(k) % 4) + 4) % 4) as QuarterTurns);
}

/** The rotation that undoes `k`. */
export function inverseQuarterTurns(k: number): QuarterTurns {
  return normalizeQuarterTurns(4 - normalizeQuarterTurns(k));
}

/** How far the board must turn so this seat's home row sits at the bottom. */
export function seatQuarterTurns(seat: SeatDirection): QuarterTurns {
  switch (seat) {
    case 'west':
      return 1;
    case 'north':
      return 2;
    case 'east':
      return 3;
    default:
      return 0;
  }
}

export function rotatePos(pos: Pos, k: number): Pos {
  const n = BOARD_SIZE - 1;
  switch (normalizeQuarterTurns(k)) {
    case 1:
      return { c: n - pos.r, r: pos.c };
    case 2:
      return { c: n - pos.c, r: n - pos.r };
    case 3:
      return { c: pos.r, r: n - pos.c };
    default:
      return { c: pos.c, r: pos.r };
  }
}

/**
 * Wall anchors live on the 8x8 grid of interior intersections, so they use the
 * same formula with `WALL_GRID - 1`. An odd number of quarter turns swaps the
 * orientation: `h(c,r)` becomes `v(7-r, c)` and `v(c,r)` becomes `h(7-r, c)`.
 */
export function rotateWall(wall: Wall, k: number): Wall {
  const m = WALL_GRID - 1;
  const flipped: Orientation = wall.o === 'h' ? 'v' : 'h';
  switch (normalizeQuarterTurns(k)) {
    case 1:
      return { c: m - wall.r, r: wall.c, o: flipped };
    case 2:
      return { c: m - wall.c, r: m - wall.r, o: wall.o };
    case 3:
      return { c: wall.r, r: m - wall.c, o: flipped };
    default:
      return { c: wall.c, r: wall.r, o: wall.o };
  }
}

const FILES = 'abcdefghi';

/** `{ c: 4, r: 0 }` -> `"e1"`. */
export function posToNotation(p: Pos): string {
  return `${FILES[p.c] ?? '?'}${p.r + 1}`;
}

/** `"e1"` -> `{ c: 4, r: 0 }`. Returns null for anything unparseable. */
export function notationToPos(text: string): Pos | null {
  const match = /^([a-i])([1-9])$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const c = FILES.indexOf(match[1]!);
  const r = Number(match[2]) - 1;
  return { c, r };
}

/** `{ c: 2, r: 4, o: 'v' }` -> `"c5v"`. */
export function wallToNotation(w: Wall): string {
  return `${FILES[w.c] ?? '?'}${w.r + 1}${w.o}`;
}

/** `"c5v"` -> `{ c: 2, r: 4, o: 'v' }`. Returns null for anything unparseable. */
export function notationToWall(text: string): Wall | null {
  const match = /^([a-h])([1-8])([hv])$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  return {
    c: FILES.indexOf(match[1]!),
    r: Number(match[2]) - 1,
    o: match[3] as 'h' | 'v',
  };
}
