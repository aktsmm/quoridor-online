import { BOARD_SIZE } from './types.js';
import { DIRECTIONS, PERPENDICULAR } from './coords.js';
import type { Board } from './board.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * Squares the pawn on `from` may step to, following the official movement and
 * jump rules.
 *
 * For every orthogonal direction:
 *   1. empty neighbour                      -> ordinary step
 *   2. occupied neighbour, square behind it
 *      is on the board, unwalled and empty  -> straight jump
 *   3. otherwise                            -> the two squares left and right
 *      of that neighbour, each still requiring an unwalled, empty landing
 *      square (diagonal jump)
 *
 * A wall between the pawn and its neighbour rules the whole direction out,
 * jumps included, and a jump never chains over a second pawn. The landing
 * square must always be empty, which is what keeps two pawns from ending up
 * on the same square via a diagonal.
 *
 * `occupied` is indexed by cell and must include the moving pawn itself; that
 * is harmless because a pawn is never its own neighbour.
 */
export function pawnDestinations(
  board: Board,
  from: number,
  occupied: Uint8Array,
  out: number[] = [],
): number[] {
  out.length = 0;

  for (const dir of DIRECTIONS) {
    const neighbour = board.stepTo(from, dir);
    if (neighbour < 0) continue;

    if (occupied[neighbour] === 0) {
      pushUnique(out, neighbour);
      continue;
    }

    const behind = board.stepTo(neighbour, dir);
    if (behind >= 0 && occupied[behind] === 0) {
      pushUnique(out, behind);
      continue;
    }

    // The straight jump is unavailable (board edge, wall, or a third pawn),
    // so the pawn may sidestep around the blocker instead.
    for (const side of PERPENDICULAR[dir]!) {
      const diagonal = board.stepTo(neighbour, side);
      if (diagonal >= 0 && occupied[diagonal] === 0) pushUnique(out, diagonal);
    }
  }

  return out;
}

function pushUnique(out: number[], cell: number): void {
  if (!out.includes(cell)) out.push(cell);
}

export function occupancyOf(cells: readonly number[]): Uint8Array {
  const occupied = new Uint8Array(CELL_COUNT);
  for (const cell of cells) occupied[cell] = 1;
  return occupied;
}
