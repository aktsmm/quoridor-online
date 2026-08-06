import { isActive, isGameOver, type Move } from '@quoridor/engine';
import { SearchPosition } from './position.js';
import { chooseGreedyMove } from './greedy.js';
import { chooseStaticMove } from './static.js';
import { chooseSearchMove } from './search.js';
import { makeRng } from './rng.js';
import {
  DEFAULT_TIME_BUDGET_MS,
  type AiDecision,
  type AiLevel,
  type ChooseMoveOptions,
} from './types.js';

export * from './types.js';
export { SearchPosition, cellToPos, pawnMove, ALL_WALLS } from './position.js';
export { evaluate, distanceAdvantage, placeValue, WIN_SCORE } from './evaluate.js';
export { chooseGreedyMove, bestStepTowardsGoal } from './greedy.js';
export { chooseStaticMove, generateMoves, opponentsOf, scoreMove, scoreMoves, nearTies, pickNearTie, TIE_BAND, tieBand } from './static.js';
export { chooseSearchMove, type SearchOptions, type SearchResult } from './search.js';
export { PathTracer } from './paths.js';
export { pathWallCandidates, wallsBlockingStep, wallOrdinal } from './candidates.js';
export { makeRng, randomInt, pickRandom } from './rng.js';

/** Which engine a level runs, and how hard it is allowed to work. */
export interface LevelProfile {
  readonly engine: 'greedy' | 'static' | 'search';
  /** Fraction of the caller's time budget the search may spend. */
  readonly budgetScale?: number;
  /** Hard depth cap, so the level plays the same on any machine. */
  readonly maxDepth?: number;
  readonly rootWallCandidates?: number;
}

/**
 * Levels are decoupled from engines on purpose.
 *
 * The old bottom level just walked its own shortest path and never looked at
 * the opponent, which made it a punchbag rather than a beginner opponent. Every
 * level moved up one notch: the weakest now looks one move ahead, and the
 * strongest gets a bigger budget than before.
 */
export const LEVEL_PROFILES: Record<AiLevel, LevelProfile> = {
  easy: { engine: 'static' },
  // Depth is capped as well as timed: a fast machine must not quietly turn the
  // middle level into the top one.
  normal: { engine: 'search', budgetScale: 0.2, maxDepth: 3, rootWallCandidates: 10 },
  hard: { engine: 'search', budgetScale: 1 },
};

/** Shortest search the middle level is still allowed, in milliseconds. */
const MIN_SEARCH_BUDGET_MS = 60;

/**
 * Picks a move for the given level.
 *
 * All three levels share the same rules and evaluation and differ only in how
 * far ahead they look: one move, a shallow search, or as deep as the time
 * budget allows.
 */
export function chooseMove(options: ChooseMoveOptions): AiDecision {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();

  const state = options.state;
  const me = options.playerIndex ?? state.turn;
  if (isGameOver(state)) throw new Error('cannot choose a move in a finished game');
  if (!isActive(state, me)) throw new Error('cannot choose a move for a player who has finished');

  const position = SearchPosition.from(state);
  const rng = makeRng(options.seed ?? Math.floor(Math.random() * 0xffffffff));
  const profile = LEVEL_PROFILES[options.level];

  let move: Move;
  let depth = 0;
  let score = 0;
  let nodes = 0;

  switch (profile.engine) {
    case 'greedy':
      move = chooseGreedyMove(position, me, rng);
      break;
    case 'static':
      move = chooseStaticMove(position, me, rng);
      break;
    case 'search': {
      const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
      const result = chooseSearchMove(position, me, {
        timeBudgetMs: Math.max(MIN_SEARCH_BUDGET_MS, budget * (profile.budgetScale ?? 1)),
        now,
        rng,
        ...(profile.maxDepth === undefined ? {} : { maxDepth: profile.maxDepth }),
        ...(profile.rootWallCandidates === undefined
          ? {}
          : { rootWallCandidates: profile.rootWallCandidates }),
      });
      move = result.move;
      depth = result.depth;
      score = result.score;
      nodes = result.nodes;
      break;
    }
  }

  return { move, depth, score, nodes, elapsedMs: now() - startedAt };
}

export { DEFAULT_TIME_BUDGET_MS };
