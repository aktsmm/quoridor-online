import type { GameState, Move } from '@quoridor/engine';

export type AiLevel = 'easy' | 'normal' | 'hard';

export const AI_LEVELS: readonly AiLevel[] = ['easy', 'normal', 'hard'];

export function isAiLevel(value: unknown): value is AiLevel {
  return typeof value === 'string' && (AI_LEVELS as readonly string[]).includes(value);
}

export interface ChooseMoveOptions {
  state: GameState;
  level: AiLevel;
  /** Defaults to whoever is to move. */
  playerIndex?: number;
  /**
   * Wall-clock budget for the search. The contract is time, not depth: the
   * strong AI deepens iteratively and returns the best move from the last
   * depth it finished.
   */
  timeBudgetMs?: number;
  /** Seeded so games are reproducible in tests and replays. */
  seed?: number;
  /** Injectable monotonic clock, so tests can drive the deadline. */
  now?: () => number;
}

export interface AiDecision {
  move: Move;
  /** Deepest ply fully searched. 0 for the non-searching levels. */
  depth: number;
  /** Evaluation of the chosen move, from the AI's point of view. */
  score: number;
  nodes: number;
  elapsedMs: number;
}

export const DEFAULT_TIME_BUDGET_MS = 500;
