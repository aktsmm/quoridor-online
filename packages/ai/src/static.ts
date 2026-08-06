import { type Move } from '@quoridor/engine';
import { evaluate, STEP_VALUE } from './evaluate.js';
import { pathWallCandidates } from './candidates.js';
import { PathTracer } from './paths.js';
import type { SearchPosition} from './position.js';
import { pawnMove } from './position.js';
import { randomInt } from './rng.js';

/** Root wall candidates come from the whole board, not just the hot squares. */
const STATIC_WALL_STEPS = 12;
const STATIC_WALL_LIMIT = 64;

/**
 * How far below the best a move may score and still count as an arbitrary tie.
 *
 * One point, which is exactly the price of a spent wall. The evaluation prices
 * a step of distance at 10 and a spent wall at 1, so "walk forward" and "drop a
 * wall that costs the leader a step" both come to +1 step of advantage and
 * differ only by the reserved wall. Taking the strict maximum therefore made
 * the one-ply engine refuse to place a wall in its entire life, replay a single
 * identical 14-ply game forever, and hand seat 1 a 100% score in 2-player
 * mirror games. Randomising only over *exact* ties does not help: measured over
 * 60 mirror games, all 60 were still byte-identical, because the scores
 * genuinely differ by that one point.
 *
 * The band is narrower than one step, so no move that actually concedes
 * distance can enter it.
 *
 * This constant is the **two-player** width. `tieBand` below generalises it;
 * `search.ts` keeps using the constant, because its root shortlist wants a
 * genuinely narrow band and widening that would reorder the root and cost depth.
 */
export const TIE_BAND = 1;

/**
 * The same band, in the units the evaluation actually uses today.
 *
 * The reasoning above is stated for a race term of `min(rival distance) - my
 * distance`. Under a minimum, walking forward moves the minimum by one step and
 * scores +10, exactly one point above a wall that costs the leader a step (+10
 * for the step, -1 for the wall). A band of one catches that pair.
 *
 * `evaluate` now **sums** the race term over every rival, because a finishing
 * place is a count of the players who get home first. That multiplies walking
 * forward by the number of rivals - +10(n-1) - while a wall still slows one
 * rival and is still worth +9. The gap becomes 1, 11 and 21 at two, three and
 * four players, so a fixed band of one stops catching anything above two and the
 * one-ply level silently stops placing walls: measured at 7.8 walls per seat at
 * two players, 3.1 at three and **0.0** at four, where 200 games produced not a
 * single wall and finished in 30 plies.
 *
 * Scaling the band by the same factor restores the property it was written for.
 * At one rival `rivals - 1` is zero, so this is *identical* to `TIE_BAND` and
 * two-player play is unchanged by construction, not by measurement.
 */
export function tieBand(rivals: number): number {
  return STEP_VALUE * Math.max(0, rivals - 1) + TIE_BAND;
}

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
 * How often the tie is resolved in favour of dropping a wall rather than
 * walking on.
 *
 * Not a coin flip. The two plans score within a point of each other, but they
 * are not symmetrical: the step is banked immediately, while the wall spends a
 * resource on a block a one-ply engine cannot tell will still be worth a square
 * in ten moves. An even split has the level spend 19.6 of its 20 walls in a
 * 2-player game and lifts its share of a mixed 3-player table from 48% to 56%,
 * which is not what the bottom level should be doing; at 0.2 it spends 14 and
 * scores 46%, i.e. it plays like it did before while no longer repeating one
 * game forever.
 */
const WALL_PLAN_WEIGHT = 0.2;

/**
 * The moves worth choosing between: the best one, plus anything the evaluation
 * cannot really tell apart from it. `scored` is not required to be sorted.
 *
 * `band` defaults to the two-player width so existing callers are unaffected;
 * callers that know the rival count should pass `tieBand(rivals)`.
 */
export function nearTies(scored: readonly ScoredMove[], band = TIE_BAND): ScoredMove[] {
  let best = Number.NEGATIVE_INFINITY;
  for (const entry of scored) {
    if (entry.score > best) best = entry.score;
  }
  return scored.filter((entry) => entry.score >= best - band);
}

/**
 * Pick one of the equivalent moves, choosing a *plan* first.
 *
 * Drawing uniformly from the raw list would not be neutral: at any moment there
 * is one step that shortens my route and a dozen walls that lengthen theirs by
 * the same amount, so a flat draw picks a wall ~90% of the time and the level
 * dumps its whole supply in the opening. So the plan is drawn first, then a
 * member of it uniformly.
 */
export function pickNearTie(
  scored: readonly ScoredMove[],
  rng: () => number,
  band = TIE_BAND,
): Move {
  const candidates = nearTies(scored, band);
  const pawns = candidates.filter((entry) => entry.move.type === 'pawn');
  const walls = candidates.filter((entry) => entry.move.type === 'wall');
  if (pawns.length === 0) return walls[randomInt(rng, walls.length)]!.move;
  if (walls.length === 0) return pawns[randomInt(rng, pawns.length)]!.move;
  const group = rng() < WALL_PLAN_WEIGHT ? walls : pawns;
  return group[randomInt(rng, group.length)]!.move;
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

  return pickNearTie(scoreMoves(position, me, moves), rng, tieBand(victims.length));
}
