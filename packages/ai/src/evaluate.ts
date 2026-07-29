import type { SearchPosition } from './position.js';

export const WIN_SCORE = 1_000_000;

/**
 * Maps a finishing place (0 = first) onto a score that runs from `+WIN_SCORE`
 * for first down to `-WIN_SCORE` for last, so a two-player loss is as bad as a
 * win is good and every extra place in between is worth the same.
 *
 * Fractional places are allowed: an unfinished game is scored at the place the
 * player would land on average, which puts the heuristic terms on the same
 * axis as the terminal ones instead of a wholly different scale.
 */
export function placeValue(place: number, playerCount: number): number {
  if (playerCount < 2) return WIN_SCORE;
  return (WIN_SCORE * (playerCount - 1 - 2 * place)) / (playerCount - 1);
}

/**
 * Position value from `me`'s point of view, in a paranoid framing: every
 * opponent still in the game is treated as a single adversary trying to beat
 * me, so only the opponent closest to their goal matters.
 *
 * With three or four players the board keeps going after somebody finishes, so
 * every rival who homes ahead of me costs a place. Distance dominates within a
 * place; the wall reserve is a small tiebreak that keeps the AI from throwing
 * walls away for no gain.
 */
export function evaluate(position: SearchPosition, me: number): number {
  const players = position.playerCount;

  if (position.isRetired(me)) {
    const rank = position.goalRank[me] ?? -1;
    // Gave up rather than finished: nothing below that.
    return rank < 0 ? -WIN_SCORE : placeValue(rank, players);
  }

  // Last one standing: my place is behind everyone who already ran home.
  if (position.isGameOver()) return placeValue(position.finishedCount, players);

  // Anyone home is above me for good; anyone still running is a coin toss.
  const expected = placeValue(
    position.finishedCount + (position.activeCount - 1) / 2,
    players,
  );

  const myDistance = position.distance(me);
  // Sealed off should be impossible in legal play, but never crash the search.
  if (myDistance < 0) return -WIN_SCORE;

  let bestOpponent = Number.POSITIVE_INFINITY;
  let opponentWalls = 0;
  let opponentCount = 0;
  for (let i = 0; i < players; i += 1) {
    if (i === me || position.isRetired(i)) continue;
    const d = position.distance(i);
    if (d >= 0 && d < bestOpponent) bestOpponent = d;
    opponentWalls += position.wallsLeft[i]!;
    opponentCount += 1;
  }
  if (!Number.isFinite(bestOpponent)) return placeValue(position.finishedCount, players);

  const averageOpponentWalls = opponentCount > 0 ? opponentWalls / opponentCount : 0;
  const wallEdge = position.wallsLeft[me]! - averageOpponentWalls;

  return expected + (bestOpponent - myDistance) * 10 + wallEdge;
}

/** Distance-only view, used by the simpler levels. */
export function distanceAdvantage(position: SearchPosition, me: number): number {
  const myDistance = position.distance(me);
  let bestOpponent = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.playerCount; i += 1) {
    if (i === me || position.isRetired(i)) continue;
    const d = position.distance(i);
    if (d >= 0 && d < bestOpponent) bestOpponent = d;
  }
  return (Number.isFinite(bestOpponent) ? bestOpponent : 100) - myDistance;
}
