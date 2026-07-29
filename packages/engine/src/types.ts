/** Squares per side. The board is always 9x9. */
export const BOARD_SIZE = 9;

/** Wall anchors form an 8x8 grid of interior intersections. */
export const WALL_GRID = BOARD_SIZE - 1;

/**
 * Board coordinates.
 *
 * `c` runs left to right (0 = file "a"), `r` runs bottom to top (0 = rank 1),
 * so `a1` is the bottom-left square and matches how the board is drawn.
 */
export interface Pos {
  readonly c: number;
  readonly r: number;
}

export type Orientation = 'h' | 'v';

/**
 * A wall, identified by the intersection it is centred on (`c`, `r` in 0..7).
 *
 * An `h` wall lies along the top edges of squares (c,r) and (c+1,r); a `v`
 * wall lies along the right edges of squares (c,r) and (c,r+1). The
 * authoritative definition is the pair of graph edges it severs - see
 * `wallBlockedEdges` in `walls.ts`.
 */
export interface Wall {
  readonly c: number;
  readonly r: number;
  readonly o: Orientation;
}

export type Move =
  | { readonly type: 'pawn'; readonly to: Pos }
  | { readonly type: 'wall'; readonly wall: Wall };

/** Where a player starts, which colour they get, and which line they run to. */
export type SeatDirection = 'south' | 'west' | 'north' | 'east';

/** A player wins by reaching any square on the given row or column. */
export type Goal =
  | { readonly kind: 'row'; readonly value: number }
  | { readonly kind: 'col'; readonly value: number };

export interface PlayerState {
  readonly seat: SeatDirection;
  readonly pos: Pos;
  readonly wallsLeft: number;
  readonly goal: Goal;
}

export type PlayerCount = 2 | 3 | 4;

export interface GameState {
  readonly playerCount: PlayerCount;
  readonly players: readonly PlayerState[];
  readonly walls: readonly Wall[];
  /** Index into `players` of whoever must move next. */
  readonly turn: number;
  /** Index into `players`, or null while the game is still running. */
  readonly winner: number | null;
  /** Number of plies played so far. */
  readonly ply: number;
}

export class IllegalMoveError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'IllegalMoveError';
    this.reason = reason;
  }
}
