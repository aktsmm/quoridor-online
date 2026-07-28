import { BOARD_SIZE, WALL_GRID, type Pos, type Wall } from './types.js';

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
