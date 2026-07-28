import { WALL_GRID, cellCol, cellRow, type Wall } from '@quoridor/engine';
import type { PathTracer } from './paths.js';
import type { SearchPosition } from './position.js';

/** Stable small integer per wall anchor, used for de-duplication. */
export function wallOrdinal(wall: Wall): number {
  return (wall.c * WALL_GRID + wall.r) * 2 + (wall.o === 'v' ? 1 : 0);
}

/**
 * The (at most two) walls that would sever the step between two adjacent
 * squares.
 *
 * A horizontal wall at `(c,r)` cuts the vertical steps above `(c,r)` and
 * `(c+1,r)`, so the step `(c,r)->(c,r+1)` is cut by `h(c,r)` and `h(c-1,r)`.
 * Vertical walls mirror that.
 */
export function wallsBlockingStep(from: number, to: number, out: Wall[]): Wall[] {
  const fc = cellCol(from);
  const fr = cellRow(from);
  const tc = cellCol(to);
  const tr = cellRow(to);

  if (fc === tc) {
    const r = Math.min(fr, tr);
    if (fc < WALL_GRID) out.push({ c: fc, r, o: 'h' });
    if (fc - 1 >= 0) out.push({ c: fc - 1, r, o: 'h' });
  } else {
    const c = Math.min(fc, tc);
    if (fr < WALL_GRID) out.push({ c, r: fr, o: 'v' });
    if (fr - 1 >= 0) out.push({ c, r: fr - 1, o: 'v' });
  }
  return out;
}

export interface CandidateOptions {
  /** How many steps of each victim's route to attack. */
  readonly maxSteps: number;
  /** Hard cap on the returned list, so a node never explodes. */
  readonly limit: number;
}

/**
 * Legal walls worth trying for `mover`, restricted to the routes of the players
 * named in `victims`.
 *
 * A full 128-anchor sweep costs a reachability check per anchor, which is fine
 * once at the root but ruinous inside the tree. Near the front of an opponent's
 * route is also where the useful walls actually are: a wall behind them is a
 * wasted turn.
 */
export function pathWallCandidates(
  position: SearchPosition,
  mover: number,
  victims: readonly number[],
  tracer: PathTracer,
  options: CandidateOptions,
  out: Wall[] = [],
): Wall[] {
  out.length = 0;
  if (position.wallsLeft[mover]! <= 0) return out;

  const seen = new Set<number>();
  const route: number[] = [];
  const walls: Wall[] = [];

  for (const victim of victims) {
    tracer.path(position.board, position.cells[victim]!, position.goals[victim]!, route);
    const steps = Math.min(route.length - 1, options.maxSteps);
    for (let i = 0; i < steps; i += 1) {
      walls.length = 0;
      wallsBlockingStep(route[i]!, route[i + 1]!, walls);
      for (const wall of walls) {
        const key = wallOrdinal(wall);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!position.isWallLegal(wall)) continue;
        out.push(wall);
        if (out.length >= options.limit) return out;
      }
    }
  }
  return out;
}
