import { BOARD_SIZE, type Goal } from './types.js';
import { DIRECTIONS, cellCol, cellRow } from './coords.js';
import type { Board } from './board.js';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export function isGoalCell(goal: Goal, cell: number): boolean {
  return goal.kind === 'row' ? cellRow(cell) === goal.value : cellCol(cell) === goal.value;
}

/**
 * Breadth-first search over the wall graph.
 *
 * Pawns are deliberately ignored: the "a wall may not seal a player off" rule
 * is about the wall layout only, since pawns can always be jumped or walked
 * around eventually.
 *
 * Buffers are reused between calls, so a single instance must not be used
 * re-entrantly. Each worker thread gets its own module instance.
 */
export class Pathfinder {
  private readonly seen = new Int32Array(CELL_COUNT);
  private readonly dist = new Int32Array(CELL_COUNT);
  private readonly queue = new Int32Array(CELL_COUNT);
  private generation = 0;

  /** Steps from `from` to the nearest goal square, or -1 when unreachable. */
  distanceToGoal(board: Board, from: number, goal: Goal): number {
    if (isGoalCell(goal, from)) return 0;

    this.generation += 1;
    const gen = this.generation;
    const { seen, dist, queue } = this;

    seen[from] = gen;
    dist[from] = 0;
    queue[0] = from;
    let head = 0;
    let tail = 1;

    while (head < tail) {
      const cell = queue[head++]!;
      const next = dist[cell]! + 1;
      for (const dir of DIRECTIONS) {
        const to = board.stepTo(cell, dir);
        if (to < 0 || seen[to] === gen) continue;
        if (isGoalCell(goal, to)) return next;
        seen[to] = gen;
        dist[to] = next;
        queue[tail++] = to;
      }
    }
    return -1;
  }

  canReachGoal(board: Board, from: number, goal: Goal): boolean {
    return this.distanceToGoal(board, from, goal) >= 0;
  }
}

/** Shared instance for callers that do not need their own buffers. */
export const defaultPathfinder = new Pathfinder();
