import type { Move } from '@quoridor/engine';
import { SearchPosition } from './position.js';
import { chooseEasyMove } from './easy.js';
import { makeRng } from './rng.js';
import { DEFAULT_TIME_BUDGET_MS, type AiDecision, type ChooseMoveOptions } from './types.js';

export * from './types.js';
export { SearchPosition, cellToPos, pawnMove, ALL_WALLS } from './position.js';
export { evaluate, distanceAdvantage, WIN_SCORE } from './evaluate.js';
export { chooseEasyMove, bestStepTowardsGoal } from './easy.js';
export { makeRng, randomInt, pickRandom } from './rng.js';

/**
 * Picks a move for the given level.
 *
 * `normal` and `hard` are not implemented yet and currently fall back to
 * `easy`; they arrive with the search work in a later phase.
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
  switch (options.level) {
    case 'easy':
    case 'normal':
    case 'hard':
      move = chooseEasyMove(position, me, rng);
      break;
  }

  return {
    move,
    depth: 0,
    score: 0,
    nodes: 0,
    elapsedMs: now() - startedAt,
  };
}

export { DEFAULT_TIME_BUDGET_MS };
