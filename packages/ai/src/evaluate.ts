import type { SearchPosition } from './position.js';

export const WIN_SCORE = 1_000_000;

/**
 * Maps a finishing place (0 = first) onto a score that runs from `+WIN_SCORE`
 * for first down to `-WIN_SCORE` for last.
 *
 * Fractional places are allowed: an unfinished game is scored at the place the
 * player would land on average, which puts the heuristic terms on the same
 * axis as the terminal ones instead of a wholly different scale.
 *
 * With three or more players the curve is deliberately **not** linear. A linear
 * scale makes second place at 3 players worth exactly the average of first and
 * last, so the search is indifferent between banking a certain second and
 * flipping a coin for the win - and it banks the second. Measured against two
 * `normal`s it finished second in 68.6% of games and first in 20.6%, below the
 * 33.3% its seat is worth, while still beating the field on mean place. Someone
 * who picks the strongest CPU wants it to play for the win, so `q^0.5` pulls
 * every place except first down towards last and makes winning worth more than
 * the places it risks.
 *
 * Two players keep the linear form exactly, which is what leaves the 2-player
 * engine - where the curve has no interior points anyway - bit for bit unchanged.
 */
export function placeValue(place: number, playerCount: number): number {
  if (playerCount < 2) return WIN_SCORE;
  if (playerCount === 2) return WIN_SCORE * (1 - 2 * place);
  const q = Math.min(1, Math.max(0, place / (playerCount - 1)));
  return WIN_SCORE * (1 - 2 * Math.sqrt(q));
}

/**
 * Position value from `me`'s point of view.
 *
 * The game scores a *place*, and a place is the number of rivals who get home
 * before me - a sum over opponents, not a minimum. So the race term sums over
 * everyone still running rather than looking only at whoever currently leads.
 *
 * Reading only the leader, as this used to, is blind in a 3- or 4-player game:
 * once the leader is out of reach the evaluation stops responding to the rival I
 * am actually racing for second place, and a wall on anyone but the leader
 * scores strictly negative - it moves no minimum and still costs the reserve -
 * so the search will not block the player it is competing with. Second place is
 * worth a full `placeValue` step, so that is not a detail.
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

  let race = 0;
  let opponentWalls = 0;
  let opponentCount = 0;
  for (let i = 0; i < players; i += 1) {
    if (i === me || position.isRetired(i)) continue;
    const d = position.distance(i);
    if (d >= 0) race += rivalEdge(d - myDistance);
    opponentWalls += position.wallsLeft[i]!;
    opponentCount += 1;
  }
  if (opponentCount === 0) return placeValue(position.finishedCount, players);

  const averageOpponentWalls = opponentWalls / opponentCount;
  const wallEdge = position.wallsLeft[me]! - averageOpponentWalls;

  return expected + race * STEP_VALUE + wallEdge;
}

/** What one square of the race is worth, against one opponent. */
export const STEP_VALUE = 10;

/**
 * How much being `gap` squares ahead of one particular rival is worth.
 *
 * A plain difference, after trying not to be. A place is a count of the rivals
 * who get home first, so in principle a square taken off the rival I am level
 * with is worth far more than a square taken off one fifteen behind, and the
 * value of a gap should flatten once that race is decided. A saturating curve
 * (a tanh over six squares, with a linear quarter kept so the gradient never
 * reaches zero) was implemented and measured on both counts, and it is not
 * worth taking:
 *
 * - it collapses the gap this work exists to open. In a 3-player table the top
 *   level scored 46.7% against the middle level's 45.6%, where the plain
 *   difference gives 47.8% against 34.4%.
 * - it quietly weakens the bottom level, which resolves near-ties inside a band
 *   of one point. Saturation shrinks a square from 10 points to 2.5 once a race
 *   is decided, so the band stops meaning "moves worth the same" and starts
 *   swallowing real differences: that level fell from 17.8% to 7.8%.
 *
 * Staying linear also makes the two-player game bit-identical to the leader-only
 * evaluation this replaced, since with one rival a sum and a minimum are the
 * same number.
 */
export function rivalEdge(gap: number): number {
  return gap;
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
