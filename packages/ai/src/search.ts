import type { Move } from '@quoridor/engine';
import { WIN_SCORE, evaluate } from './evaluate.js';
import { generateMoves, opponentsOf, scoreMove } from './static.js';
import { PathTracer } from './paths.js';
import type { SearchPosition} from './position.js';
import { pawnMove } from './position.js';
import { randomInt } from './rng.js';

/** Thrown to unwind the search when the deadline passes. */
const TIME_UP = Symbol('time-up');

const CHECK_INTERVAL = 128;
const MAX_DEPTH = 24;
const TT_LIMIT = 250_000;

/** Interior nodes only attack the first few steps of a route. */
const INNER_WALL_STEPS = 4;
const INNER_WALL_LIMIT = 10;

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

interface Entry {
  depth: number;
  flag: number;
  score: number;
  move: Move | null;
}

export interface SearchOptions {
  readonly timeBudgetMs: number;
  readonly now: () => number;
  readonly rng: () => number;
  /** Root walls kept for deep search, after shallow ordering. */
  readonly rootWallCandidates?: number;
  readonly maxDepth?: number;
}

export interface SearchResult {
  readonly move: Move;
  readonly depth: number;
  readonly score: number;
  readonly nodes: number;
}

/**
 * Iterative deepening alpha-beta under a wall-clock budget.
 *
 * The contract is time, not depth. Each iteration either finishes - in which
 * case its move replaces the previous answer - or is abandoned mid-way, in
 * which case the last completed depth still holds a fully searched move. That
 * is what makes it safe to hand the search a one second budget on a small
 * container and still get a sane answer.
 *
 * `maxDepth` is what separates the two levels that use this engine: capping the
 * depth keeps the middle level honest on a fast machine, where a time-only
 * limit would quietly make it as strong as the top level.
 *
 * Multi-player games are searched paranoid: every opponent is assumed to be
 * cooperating against `me`, which keeps the value one-dimensional and avoids
 * the discontinuities a max-n search would produce.
 */
export function chooseSearchMove(
  position: SearchPosition,
  me: number,
  options: SearchOptions,
): SearchResult {
  const deadline = options.now() + options.timeBudgetMs;
  const tracer = new PathTracer();
  const victims = opponentsOf(position, me);
  const table = new Map<number, Entry>();
  let nodes = 0;
  let sinceCheck = 0;

  const outOfTime = (): boolean => {
    sinceCheck += 1;
    if (sinceCheck < CHECK_INTERVAL) return false;
    sinceCheck = 0;
    return options.now() >= deadline;
  };

  // The root sweeps every legal wall, so a strong tactical wall far from the
  // current routes is never invisible; only the deep search is narrowed.
  const rootMoves: Move[] = [];
  for (const cell of position.pawnMoves(me, [])) rootMoves.push(pawnMove(cell));
  for (const wall of position.legalWalls(me)) rootMoves.push({ type: 'wall', wall });
  if (rootMoves.length === 0) throw new Error('no legal move available');

  const scored = rootMoves
    .map((move) => ({ move, score: scoreMove(position, me, move) }))
    .sort((a, b) => b.score - a.score);

  const wallBudget = options.rootWallCandidates ?? 14;
  let wallsKept = 0;
  const shortlist: Move[] = [];
  for (const entry of scored) {
    if (entry.move.type === 'wall') {
      if (wallsKept >= wallBudget) continue;
      wallsKept += 1;
    }
    shortlist.push(entry.move);
  }

  // Depth 0 answer: the best static move, i.e. exactly what the one-ply engine
  // would do. Even a search that runs out of time immediately returns that.
  const topScore = scored[0]!.score;
  const topTies = scored.filter((entry) => entry.score === topScore);
  let best = topTies[randomInt(options.rng, topTies.length)]!.move;
  let bestScore = topScore;
  let completed = 0;

  const search = (depth: number, ply: number, alphaIn: number, betaIn: number): number => {
    if (outOfTime()) throw TIME_UP;
    if (position.winner !== null) {
      return position.winner === me ? WIN_SCORE - ply : -WIN_SCORE + ply;
    }
    if (depth <= 0) return evaluate(position, me);

    let alpha = alphaIn;
    let beta = betaIn;
    const key = position.hash;
    const cached = table.get(key);
    if (cached && cached.depth >= depth) {
      if (cached.flag === EXACT) return cached.score;
      if (cached.flag === LOWER && cached.score > alpha) alpha = cached.score;
      else if (cached.flag === UPPER && cached.score < beta) beta = cached.score;
      if (alpha >= beta) return cached.score;
    }

    const mover = position.turn;
    const maximizing = mover === me;
    // Paranoid: opponents only ever try to slow me down, never each other.
    const targets = maximizing ? victims : [me];
    const moves = generateMoves(
      position,
      mover,
      targets,
      tracer,
      INNER_WALL_STEPS,
      INNER_WALL_LIMIT,
    );
    if (moves.length === 0) return evaluate(position, me);

    orderMoves(moves, cached?.move ?? null);

    nodes += 1;
    let bestLocal = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    let bestMove: Move | null = null;

    for (const move of moves) {
      const undo = position.apply(move);
      let value: number;
      try {
        value = search(depth - 1, ply + 1, alpha, beta);
      } finally {
        position.undo(undo);
      }

      if (maximizing) {
        if (value > bestLocal) {
          bestLocal = value;
          bestMove = move;
        }
        if (bestLocal > alpha) alpha = bestLocal;
      } else {
        if (value < bestLocal) {
          bestLocal = value;
          bestMove = move;
        }
        if (bestLocal < beta) beta = bestLocal;
      }
      if (alpha >= beta) break;
    }

    if (table.size < TT_LIMIT && Math.abs(bestLocal) < WIN_SCORE - MAX_DEPTH) {
      // Win scores are ply-relative, so they must not be cached against a
      // position that a different line could reach at a different depth.
      const flag = bestLocal <= alphaIn ? UPPER : bestLocal >= betaIn ? LOWER : EXACT;
      table.set(key, { depth, flag, score: bestLocal, move: bestMove });
    }
    return bestLocal;
  };

  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = Number.NEGATIVE_INFINITY;
    const beta = Number.POSITIVE_INFINITY;
    let iterationBest: Move | null = null;
    let iterationScore = Number.NEGATIVE_INFINITY;

    try {
      // The previous iteration's answer goes first: it is usually still best,
      // which makes the window tight straight away.
      const ordered = [best, ...shortlist.filter((move) => move !== best)];
      for (const move of ordered) {
        const undo = position.apply(move);
        let value: number;
        try {
          value = search(depth - 1, 1, alpha, beta);
        } finally {
          position.undo(undo);
        }
        if (value > iterationScore) {
          iterationScore = value;
          iterationBest = move;
        }
        if (iterationScore > alpha) alpha = iterationScore;
      }
    } catch (error) {
      if (error === TIME_UP) break;
      throw error;
    }

    if (iterationBest === null) break;
    best = iterationBest;
    bestScore = iterationScore;
    completed = depth;

    if (Math.abs(bestScore) >= WIN_SCORE - MAX_DEPTH) break;
    if (options.now() >= deadline) break;
  }

  return { move: best, depth: completed, score: bestScore, nodes };
}

/** Cheap ordering: hash move, then pawn steps, then walls. */
function orderMoves(moves: Move[], hashMove: Move | null): void {
  moves.sort((a, b) => rank(a, hashMove) - rank(b, hashMove));
}

function rank(move: Move, hashMove: Move | null): number {
  if (hashMove !== null && sameMove(move, hashMove)) return 0;
  return move.type === 'pawn' ? 1 : 2;
}

function sameMove(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pawn' && b.type === 'pawn') return a.to.c === b.to.c && a.to.r === b.to.r;
  if (a.type === 'wall' && b.type === 'wall') {
    return a.wall.c === b.wall.c && a.wall.r === b.wall.r && a.wall.o === b.wall.o;
  }
  return false;
}
