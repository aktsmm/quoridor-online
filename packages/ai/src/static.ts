import { type Move } from '@quoridor/engine';
import { evaluate } from './evaluate.js';
import { pathWallCandidates } from './candidates.js';
import { PathTracer } from './paths.js';
import type { SearchPosition} from './position.js';
import { pawnMove } from './position.js';
import { randomInt } from './rng.js';

/** Root wall candidates come from the whole board, not just the hot squares. */
const STATIC_WALL_STEPS = 12;
const STATIC_WALL_LIMIT = 64;

export interface ScoredMove {
  readonly move: Move;
  readonly score: number;
}

/**
 * Every move `mover` can legally make, with walls restricted to the ones that
 * actually cut a route somebody wants to walk.
 */
export function generateMoves(
  position: SearchPosition,
  mover: number,
  victims: readonly number[],
  tracer: PathTracer,
  maxSteps: number,
  limit: number,
): Move[] {
  const moves: Move[] = [];
  for (const cell of position.pawnMoves(mover, [])) moves.push(pawnMove(cell));
  for (const wall of pathWallCandidates(position, mover, victims, tracer, {
    maxSteps,
    limit,
  })) {
    moves.push({ type: 'wall', wall });
  }
  return moves;
}

/** Everyone except `me` who is still in the game, in seat order. */
export function opponentsOf(position: SearchPosition, me: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < position.playerCount; i += 1) {
    if (i !== me && !position.isRetired(i)) out.push(i);
  }
  return out;
}

/**
 * Static value of the position `move` leads to, from `me`'s point of view.
 * This is the whole of the one-ply engine and the root ordering for the search.
 */
export function scoreMove(position: SearchPosition, me: number, move: Move): number {
  const undo = position.apply(move);
  try {
    return evaluate(position, me);
  } finally {
    position.undo(undo);
  }
}

export function scoreMoves(
  position: SearchPosition,
  me: number,
  moves: readonly Move[],
): ScoredMove[] {
  return moves.map((move) => ({ move, score: scoreMove(position, me, move) }));
}

/**
 * One-ply engine: takes the move that leaves the best
 * `min(opponent distance) - my distance`, walls included.
 *
 * It plays a sensible race and will block an opponent who is clearly ahead, but
 * it never asks what the reply would be, so its walls are easy to walk around.
 * That makes it a fair beginner opponent rather than a pushover.
 */
export function chooseStaticMove(
  position: SearchPosition,
  me: number,
  rng: () => number,
  tracer: PathTracer = new PathTracer(),
): Move {
  const victims = opponentsOf(position, me);
  const moves = generateMoves(
    position,
    me,
    victims,
    tracer,
    STATIC_WALL_STEPS,
    STATIC_WALL_LIMIT,
  );
  if (moves.length === 0) throw new Error('no legal move available');

  let best = Number.NEGATIVE_INFINITY;
  const tied: Move[] = [];
  for (const move of moves) {
    const score = scoreMove(position, me, move);
    if (score > best) {
      best = score;
      tied.length = 0;
      tied.push(move);
    } else if (score === best) {
      tied.push(move);
    }
  }

  return tied[randomInt(rng, tied.length)]!;
}
