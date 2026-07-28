import type { SearchPosition } from './position.js';

export const WIN_SCORE = 1_000_000;

/**
 * Position value from `me`'s point of view, in a paranoid framing: every
 * opponent is treated as a single adversary trying to beat me, so only the
 * opponent closest to their goal matters.
 *
 * Distance dominates; the wall reserve is a small tiebreak that keeps the AI
 * from throwing walls away for no gain.
 */
export function evaluate(position: SearchPosition, me: number): number {
  if (position.winner !== null) {
    return position.winner === me ? WIN_SCORE : -WIN_SCORE;
  }

  const myDistance = position.distance(me);
  // Sealed off should be impossible in legal play, but never crash the search.
  if (myDistance < 0) return -WIN_SCORE;

  let bestOpponent = Number.POSITIVE_INFINITY;
  let opponentWalls = 0;
  let opponentCount = 0;
  for (let i = 0; i < position.playerCount; i += 1) {
    if (i === me) continue;
    const d = position.distance(i);
    if (d >= 0 && d < bestOpponent) bestOpponent = d;
    opponentWalls += position.wallsLeft[i]!;
    opponentCount += 1;
  }
  if (!Number.isFinite(bestOpponent)) return WIN_SCORE;

  const averageOpponentWalls = opponentCount > 0 ? opponentWalls / opponentCount : 0;
  const wallEdge = position.wallsLeft[me]! - averageOpponentWalls;

  return (bestOpponent - myDistance) * 10 + wallEdge;
}

/** Distance-only view, used by the simpler levels. */
export function distanceAdvantage(position: SearchPosition, me: number): number {
  const myDistance = position.distance(me);
  let bestOpponent = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.playerCount; i += 1) {
    if (i === me) continue;
    const d = position.distance(i);
    if (d >= 0 && d < bestOpponent) bestOpponent = d;
  }
  return (Number.isFinite(bestOpponent) ? bestOpponent : 100) - myDistance;
}
