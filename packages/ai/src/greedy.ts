import { isGoalCell, type Move } from '@quoridor/engine';
import { SearchPosition, pawnMove } from './position.js';
import { pickRandom, randomInt } from './rng.js';

/** How often the greedy AI wastes a turn on an arbitrary wall. */
const RANDOM_WALL_CHANCE = 0.12;

/**
 * The simplest engine there is: walk the shortest path to the goal, and
 * occasionally drop a wall somewhere legal without thinking about it.
 *
 * No level uses this on its own any more - it was too weak to be a fair
 * opponent - but it never plays an illegal move and always makes progress, so
 * it is exactly what the server wants when a worker dies mid-turn.
 */
export function chooseGreedyMove(position: SearchPosition, me: number, rng: () => number): Move {
  if (position.wallsLeft[me]! > 0 && rng() < RANDOM_WALL_CHANCE) {
    const walls = position.legalWalls(me);
    if (walls.length > 0) return { type: 'wall', wall: pickRandom(rng, walls) };
  }
  return pawnMove(bestStepTowardsGoal(position, me, rng));
}

/**
 * The reachable square that leaves the shortest remaining path, preferring an
 * immediate win. Ties are broken randomly so repeated games do not follow
 * identical lines.
 *
 * Distances are measured with pawns ignored, matching how the engine checks
 * reachability, so the destination square is all that needs evaluating.
 */
export function bestStepTowardsGoal(
  position: SearchPosition,
  me: number,
  rng: () => number,
): number {
  const moves = position.pawnMoves(me, []);
  if (moves.length === 0) throw new Error('no legal pawn move available');

  const goal = position.goals[me]!;
  let best = Number.POSITIVE_INFINITY;
  const tied: number[] = [];

  for (const cell of moves) {
    if (isGoalCell(goal, cell)) return cell;

    const distance = position.distanceFrom(me, cell);
    const value = distance < 0 ? Number.POSITIVE_INFINITY : distance;
    if (value < best) {
      best = value;
      tied.length = 0;
      tied.push(cell);
    } else if (value === best) {
      tied.push(cell);
    }
  }

  if (tied.length === 0) return moves[randomInt(rng, moves.length)]!;
  return tied[randomInt(rng, tied.length)]!;
}

export { SearchPosition };
