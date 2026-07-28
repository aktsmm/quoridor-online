import { BOARD_SIZE, WALL_GRID, type Orientation, type Wall } from './types.js';
import { DIR_DC, DIR_DR, NORTH, EAST, SOUTH, WEST, cellIndex, inBoard } from './coords.js';

/**
 * Walls are normalised to the set of graph edges they sever, never to a
 * geometric "corner". Every legality rule below is then a set operation on
 * those edges, which makes it impossible for a row-inversion bug to creep in.
 *
 * Edge ids occupy one flat space:
 *   - vertical-movement edges  (c,r)-(c,r+1):  r*9 + c            ->   0..71
 *   - horizontal-movement edges (c,r)-(c+1,r): 72 + r*8 + c       ->  72..143
 */
export const EDGE_COUNT = 144;
export const CENTER_COUNT = WALL_GRID * WALL_GRID;

/** Edge severed when moving north from (c,r), i.e. between (c,r) and (c,r+1). */
export function verticalEdgeId(c: number, r: number): number {
  return r * BOARD_SIZE + c;
}

/** Edge severed when moving east from (c,r), i.e. between (c,r) and (c+1,r). */
export function horizontalEdgeId(c: number, r: number): number {
  return 72 + r * WALL_GRID + c;
}

/**
 * The two edges a wall severs.
 *
 *   h at (c,r): (c,r)-(c,r+1)   and (c+1,r)-(c+1,r+1)
 *   v at (c,r): (c,r)-(c+1,r)   and (c,r+1)-(c+1,r+1)
 */
export function wallBlockedEdges(w: Wall): [number, number] {
  return w.o === 'h'
    ? [verticalEdgeId(w.c, w.r), verticalEdgeId(w.c + 1, w.r)]
    : [horizontalEdgeId(w.c, w.r), horizontalEdgeId(w.c, w.r + 1)];
}

/** The intersection a wall pivots on. Two walls may never share one. */
export function wallCenterId(w: Wall): number {
  return w.c * WALL_GRID + w.r;
}

export function wallKey(w: Wall): string {
  return `${w.c},${w.r},${w.o}`;
}

/** All 128 wall placements that exist on a 9x9 board, ignoring legality. */
export function allWalls(): Wall[] {
  const out: Wall[] = [];
  for (let c = 0; c < WALL_GRID; c += 1) {
    for (let r = 0; r < WALL_GRID; r += 1) {
      for (const o of ['h', 'v'] as const) {
        out.push({ c, r, o });
      }
    }
  }
  return out;
}

/** Maps a (cell, direction) pair onto its edge id, or -1 if it leaves the board. */
function edgeFor(c: number, r: number, dir: number): number {
  switch (dir) {
    case NORTH:
      return r + 1 < BOARD_SIZE ? verticalEdgeId(c, r) : -1;
    case SOUTH:
      return r - 1 >= 0 ? verticalEdgeId(c, r - 1) : -1;
    case EAST:
      return c + 1 < BOARD_SIZE ? horizontalEdgeId(c, r) : -1;
    case WEST:
      return c - 1 >= 0 ? horizontalEdgeId(c - 1, r) : -1;
    default:
      return -1;
  }
}

/** Precomputed cell/direction -> edge id table (81 x 4). */
const EDGE_TABLE = (() => {
  const table = new Int16Array(BOARD_SIZE * BOARD_SIZE * 4);
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      for (let dir = 0; dir < 4; dir += 1) {
        table[cellIndex(c, r) * 4 + dir] = edgeFor(c, r, dir);
      }
    }
  }
  return table;
})();

/**
 * Mutable wall index. Supports add/remove so search code can make and unmake
 * placements without rebuilding, while `Board.from` keeps the immutable
 * `GameState` the single source of truth.
 */
export class Board {
  /** 1 when the edge is severed. */
  private readonly edges = new Uint8Array(EDGE_COUNT);
  /** 1 when an intersection is occupied by a wall. */
  private readonly centers = new Uint8Array(CENTER_COUNT);
  private wallCount = 0;

  static from(walls: Iterable<Wall>): Board {
    const board = new Board();
    for (const w of walls) board.add(w);
    return board;
  }

  get size(): number {
    return this.wallCount;
  }

  add(w: Wall): void {
    const [e1, e2] = wallBlockedEdges(w);
    this.edges[e1] = 1;
    this.edges[e2] = 1;
    this.centers[wallCenterId(w)] = 1;
    this.wallCount += 1;
  }

  remove(w: Wall): void {
    const [e1, e2] = wallBlockedEdges(w);
    this.edges[e1] = 0;
    this.edges[e2] = 0;
    this.centers[wallCenterId(w)] = 0;
    this.wallCount -= 1;
  }

  isEdgeBlocked(edgeId: number): boolean {
    return this.edges[edgeId] === 1;
  }

  isCenterUsed(w: Wall): boolean {
    return this.centers[wallCenterId(w)] === 1;
  }

  /**
   * Shape-only legality: the wall is inside the grid, shares no severed edge
   * with an existing wall, and does not cross one. Path connectivity is
   * checked separately because it needs to know where the pawns are.
   */
  fitsWithoutOverlap(w: Wall): boolean {
    if (this.centers[wallCenterId(w)] === 1) return false;
    const [e1, e2] = wallBlockedEdges(w);
    return this.edges[e1] === 0 && this.edges[e2] === 0;
  }

  /** Can a pawn step from `cell` in `dir` without crossing a wall or the rim? */
  canStep(cell: number, dir: number): boolean {
    const edge = EDGE_TABLE[cell * 4 + dir]!;
    if (edge < 0) return false;
    return this.edges[edge] === 0;
  }

  /** Neighbour cell index in `dir`, or -1 when blocked or off-board. */
  stepTo(cell: number, dir: number): number {
    const edge = EDGE_TABLE[cell * 4 + dir]!;
    if (edge < 0 || this.edges[edge] === 1) return -1;
    return cell + DIR_DR[dir]! * BOARD_SIZE + DIR_DC[dir]!;
  }
}

export function orientationOf(w: Wall): Orientation {
  return w.o;
}

export { inBoard };
