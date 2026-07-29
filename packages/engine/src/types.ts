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
  | { readonly type: 'wall'; readonly wall: Wall }
  | { readonly type: 'resign' };

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

/**
 * How a player left the game.
 *
 * Reaching your goal line and giving up both retire you: the pawn comes off the
 * board and the turn order skips you from then on. The order these are recorded
 * in is what the final placings are built from.
 */
export interface CompletionRecord {
  /** Index into `players`. */
  readonly player: number;
  readonly kind: 'goal' | 'resign';
  /** The ply count immediately after the move that retired them. */
  readonly ply: number;
}

export interface GameState {
  readonly playerCount: PlayerCount;
  readonly players: readonly PlayerState[];
  readonly walls: readonly Wall[];
  /** Index into `players` of whoever must move next. */
  readonly turn: number;
  /** Who moved on ply 0, kept so the move log can be replayed exactly. */
  readonly firstTurn: number;
  /** Players who have retired, in the order it happened. */
  readonly completions: readonly CompletionRecord[];
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
