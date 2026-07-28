import type { Move } from '@quoridor/engine';
import { SearchPosition } from './position.js';
import { chooseEasyMove } from './easy.js';
import { chooseNormalMove } from './normal.js';
import { chooseHardMove } from './hard.js';
import { makeRng } from './rng.js';
import { DEFAULT_TIME_BUDGET_MS, type AiDecision, type ChooseMoveOptions } from './types.js';

export * from './types.js';
export { SearchPosition, cellToPos, pawnMove, ALL_WALLS } from './position.js';
export { evaluate, distanceAdvantage, WIN_SCORE } from './evaluate.js';
export { chooseEasyMove, bestStepTowardsGoal } from './easy.js';
export { chooseNormalMove, generateMoves, opponentsOf, scoreMove, scoreMoves } from './normal.js';
export { chooseHardMove, type HardOptions, type HardResult } from './hard.js';
export { PathTracer } from './paths.js';
export { pathWallCandidates, wallsBlockingStep, wallOrdinal } from './candidates.js';
export { makeRng, randomInt, pickRandom } from './rng.js';

/**
 * Picks a move for the given level.
 *
 * All three levels share the same rules and evaluation and differ only in how
 * far ahead they look: not at all, one move, or as deep as the time budget
 * allows.
 */
export function chooseMove(options: ChooseMoveOptions): AiDecision {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();

  const state = options.state;
  const me = options.playerIndex ?? state.turn;
  if (state.winner !== null) throw new Error('cannot choose a move in a finished game');

  const position = SearchPosition.from(state);
  const rng = makeRng(options.seed ?? Math.floor(Math.random() * 0xffffffff));

  let move: Move;
  let depth = 0;
  let score = 0;
  let nodes = 0;

  switch (options.level) {
    case 'easy':
      move = chooseEasyMove(position, me, rng);
      break;
    case 'normal':
      move = chooseNormalMove(position, me, rng);
      break;
    case 'hard': {
      const result = chooseHardMove(position, me, {
        timeBudgetMs: options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
        now,
        rng,
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
