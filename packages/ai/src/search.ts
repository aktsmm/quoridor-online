import type { Move } from '@quoridor/engine';
import { cellIndex } from '@quoridor/engine';
import { WIN_SCORE, evaluate } from './evaluate.js';
import { generateMoves, TIE_BAND, opponentsOf, scoreMove } from './static.js';
import { PathTracer } from './paths.js';
import type { SearchPosition, Undo } from './position.js';
import { pawnMove } from './position.js';
import { randomInt } from './rng.js';

/** Thrown to unwind the search when the deadline passes. */
const TIME_UP = Symbol('time-up');

const CHECK_INTERVAL = 128;
const MAX_DEPTH = 24;
const TT_LIMIT = 250_000;

/**
 * Mixed into the transposition key at opponent nodes.
 *
 * A best-reply tree alternates strictly between my nodes and opponent nodes, so
 * the same board can appear as both. `position.hash` cannot tell them apart on
 * its own, because the seat it records as "to move" is not the seat the search
 * is about to move.
 */
const REPLY_SALT = 0x5f3a71b;

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
  /** Which seat `move` belongs to; an opponent node's best move is not mine. */
  owner: number;
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
 * Every player count is searched the same way, as a *best reply* tree: my nodes
 * offer my moves, and a reply node offers every still-running rival's moves and
 * plays the single best of them. See the comment on `search` below for why, and
 * for what the two alternatives - paranoid and max^n - were measured to cost.
 * With one rival the reply node has exactly one candidate seat, so the whole
 * thing degenerates to ordinary minimax and the two-player game is untouched.
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

  /**
   * Plays `move` on behalf of a named seat rather than whoever the board says is
   * to move.
   *
   * A best-reply tree deliberately breaks turn order - it lets whichever rival
   * has the sharpest answer play it, and skips the rest - so the search cannot
   * use `position.apply`, which reads the seat from the board. Undoing restores
   * the previous turn either way, so the board is left exactly as it was found.
   */
  const applyAs = (player: number, move: Move): Undo => {
    if (move.type === 'pawn') return position.applyPawn(player, cellIndex(move.to.c, move.to.r));
    if (move.type === 'wall') return position.applyWall(player, move.wall);
    throw new Error('cannot search a resignation');
  };

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
  let headCount = 0;
  const cutoff = scored[0]!.score - TIE_BAND;
  for (const entry of scored) {
    if (entry.move.type === 'wall') {
      if (wallsKept >= wallBudget) continue;
      wallsKept += 1;
    }
    if (entry.score >= cutoff) headCount += 1;
    shortlist.push(entry.move);
  }

  // Alpha-beta keeps the first move it finds when several score the same, so a
  // fixed root order makes every mirror game identical. Shuffling only the
  // moves the static evaluation cannot separate leaves the ordering just as
  // strong - the best-scoring block still goes first - while letting ties fall
  // differently from game to game. Reordering the root cannot change the value
  // the search returns, only which of the equal-valued moves is reported.
  shuffleHead(shortlist, headCount, options.rng);

  // Depth 0 answer: the best static move, i.e. exactly what the one-ply engine
  // would do. Even a search that runs out of time immediately returns that.
  let best = shortlist[0]!;
  let bestScore = scored[0]!.score;
  let completed = 0;

  /**
   * Best-reply search.
   *
   * `mine` says whose node this is: my own, where I pick the move that scores
   * best for me, or the reply node, where exactly one rival - whichever of them
   * has the sharpest answer - plays against me and the others stand still.
   *
   * That "exactly one" is the whole design. Three opponent models were measured
   * here and the other two each fail for their own reason:
   *
   * - *Paranoid* lets every rival move every round, so the search expects
   *   `playerCount - 1` hostile moves between two of its own, decides running is
   *   futile and hoards walls. The error compounds with depth, which is fatal in
   *   the one level whose selling point is depth: in a mixed 3-player table it
   *   looks level at a 200 ms budget (43.7% against the middle level's 43.7%)
   *   and then *falls* to 30.0% against 44.4% at the 500 ms budget the game
   *   ships with. With four players it scored 16.7% against a 25% chance.
   * - *Max^n* gives each rival their own score to maximise, which is the
   *   truthful model and does fix the inversion - but a bound on my score says
   *   nothing about anybody else's, so there is no cutoff. Measured: at a 500 ms
   *   budget it reached depth 3 with three players and depth 3 with four, which
   *   is exactly the *middle* level's depth cap. It did not lose to the middle
   *   level so much as turn into it, and the table agreed - 40.0% to 42.2%.
   *
   * Best-reply keeps one number and strict alternation, so full alpha-beta comes
   * back and with it the depth that separates the levels, while dropping the
   * coalition fantasy. It is optimistic in the other direction - real rivals do
   * all move - but the bias is uniform across sibling leaves, whereas paranoid's
   * grows with depth, and a free-for-all really does under-supply blocking: a
   * wall spent on the leader helps everyone behind them as much as it helps me.
   *
   * With a single opponent the reply node has exactly one candidate seat, so
   * this is ordinary minimax and the two-player game is untouched by
   * construction - same tree, same order, same move.
   */
  const search = (mine: boolean, depth: number, ply: number, alphaIn: number, betaIn: number): number => {
    if (outOfTime()) throw TIME_UP;
    // Once I am off the board nothing later can change my place, and once one
    // player is left the placings are settled.
    if (position.isRetired(me)) {
      // Always prefer to get there sooner. Places are handed out in arrival
      // order, so waiting can only cost a place, never win one - and the usual
      // "lose later" rule is actively harmful here, because with three or four
      // players a perfectly good finish still scores below zero. Third of four
      // is worth -WIN_SCORE/3, so "later is better for a negative score" told a
      // player standing two squares from home with the race already won to walk
      // away from the goal and keep walking away, for as long as the horizon
      // let it. That is exactly the shuffle that left 4-player games unfinished.
      return evaluate(position, me) - ply;
    }
    if (position.isGameOver()) return evaluate(position, me) - ply;
    if (depth <= 0) return evaluate(position, me);

    let alpha = alphaIn;
    let beta = betaIn;
    const key = mine ? position.hash : position.hash ^ REPLY_SALT;
    const cached = table.get(key);
    if (cached && cached.depth >= depth) {
      if (cached.flag === EXACT) return cached.score;
      if (cached.flag === LOWER && cached.score > alpha) alpha = cached.score;
      else if (cached.flag === UPPER && cached.score < beta) beta = cached.score;
      if (alpha >= beta) return cached.score;
    }

    nodes += 1;
    let bestLocal = mine ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    let bestMove: Move | null = null;
    let bestOwner = -1;
    let any = false;

    // My node offers my moves; the reply node offers every still-running
    // rival's, and the best of them all is the one that gets played.
    const seats = mine ? [me] : victims;

    outer: for (const seat of seats) {
      if (!mine && position.isRetired(seat)) continue;
      const moves = generateMoves(
        position,
        seat,
        // Opponents only ever try to slow me down. That is what makes this a
        // *best reply* rather than a free-for-all: their own race is not being
        // modelled here, only the harm they can do to mine.
        mine ? victims : [me],
        tracer,
        INNER_WALL_STEPS,
        INNER_WALL_LIMIT,
      );
      if (moves.length === 0) continue;
      orderMoves(moves, cached?.owner === seat ? (cached.move ?? null) : null);
      any = true;

      for (const move of moves) {
        const undo = applyAs(seat, move);
        let value: number;
        try {
          value = search(!mine, depth - 1, ply + 1, alpha, beta);
        } finally {
          position.undo(undo);
        }

        if (mine) {
          if (value > bestLocal) {
            bestLocal = value;
            bestMove = move;
            bestOwner = seat;
          }
          if (bestLocal > alpha) alpha = bestLocal;
        } else {
          if (value < bestLocal) {
            bestLocal = value;
            bestMove = move;
            bestOwner = seat;
          }
          if (bestLocal < beta) beta = bestLocal;
        }
        if (alpha >= beta) break outer;
      }
    }

    // Nobody on this side of the board can move at all, so there is no reply to
    // search: score the position as it stands.
    if (!any) return evaluate(position, me);

    if (table.size < TT_LIMIT && Math.abs(bestLocal) < WIN_SCORE - MAX_DEPTH) {
      // Win scores are ply-relative, so they must not be cached against a
      // position that a different line could reach at a different depth.
      const flag = bestLocal <= alphaIn ? UPPER : bestLocal >= betaIn ? LOWER : EXACT;
      table.set(key, { depth, flag, score: bestLocal, move: bestMove, owner: bestOwner });
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
        const undo = applyAs(me, move);
        let value: number;
        try {
          value = search(false, depth - 1, 1, alpha, beta);
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

/**
 * Fisher-Yates over the first `count` entries only. Used to scramble the block
 * of root moves the static evaluation rates as equivalent, so alpha-beta's
 * first-wins tie rule stops resolving the same way in every game.
 */
function shuffleHead(moves: Move[], count: number, rng: () => number): void {
  for (let i = Math.min(count, moves.length) - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    const tmp = moves[i]!;
    moves[i] = moves[j]!;
    moves[j] = tmp;
  }
}

function sameMove(a: Move, b: Move): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'pawn' && b.type === 'pawn') return a.to.c === b.to.c && a.to.r === b.to.r;
  if (a.type === 'wall' && b.type === 'wall') {
    return a.wall.c === b.wall.c && a.wall.r === b.wall.r && a.wall.o === b.wall.o;
  }
  return false;
}
