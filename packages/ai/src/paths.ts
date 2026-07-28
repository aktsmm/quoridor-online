import { BOARD_SIZE, DIRECTIONS, isGoalCell, type Board, type Goal } from '@quoridor/engine';

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * BFS that keeps its predecessor tree, so the search can ask not just "how far
 * is the goal" but "which squares does the route run through".
 *
 * That route is what the wall generator works from: the only walls worth
 * considering are the ones that actually sever a step somebody wants to take.
 *
 * Buffers are reused between calls, so one instance must not be used
 * re-entrantly - take a fresh instance per search.
 */
export class PathTracer {
  private readonly seen = new Int32Array(CELL_COUNT);
  private readonly dist = new Int32Array(CELL_COUNT);
  private readonly cameFrom = new Int32Array(CELL_COUNT);
  private readonly queue = new Int32Array(CELL_COUNT);
  private generation = 0;

  /**
   * The squares of one shortest route from `start` to the goal, inclusive of
   * both ends. Empty when the goal is unreachable.
   *
   * Pawns are ignored, exactly as `Pathfinder` does, because the wall rules and
   * the distance evaluation are both defined on the wall graph alone.
   */
  path(board: Board, start: number, goal: Goal, out: number[] = []): number[] {
    out.length = 0;
    if (isGoalCell(goal, start)) {
      out.push(start);
      return out;
    }

    this.generation += 1;
    const gen = this.generation;
    const { seen, dist, cameFrom, queue } = this;

    seen[start] = gen;
    dist[start] = 0;
    cameFrom[start] = -1;
    queue[0] = start;
    let head = 0;
    let tail = 1;

    while (head < tail) {
      const cell = queue[head++]!;
      const next = dist[cell]! + 1;
      for (const dir of DIRECTIONS) {
        const to = board.stepTo(cell, dir);
        if (to < 0 || seen[to] === gen) continue;
        seen[to] = gen;
        dist[to] = next;
        cameFrom[to] = cell;
        if (isGoalCell(goal, to)) {
          for (let node = to; node >= 0; node = cameFrom[node]!) out.push(node);
          out.reverse();
          return out;
        }
        queue[tail++] = to;
      }
    }
    return out;
  }
}
