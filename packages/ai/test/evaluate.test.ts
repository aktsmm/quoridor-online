import { describe, expect, it } from 'vitest';
import {
  cellIndex,
  createGame,
  type CompletionRecord,
  type GameState,
  type PlayerCount,
} from '@quoridor/engine';
import { SearchPosition, WIN_SCORE, evaluate, placeValue } from '../src/index.js';

function withCompletions(playerCount: PlayerCount, records: CompletionRecord[]): GameState {
  return { ...createGame({ playerCount }), completions: records };
}

function goal(player: number, ply: number): CompletionRecord {
  return { player, kind: 'goal', ply };
}

describe('placings on the score scale', () => {
  it('runs from a win down to last place, with winning worth the most', () => {
    // Two players have no interior place, so the scale stays linear there and
    // the two-player engine is untouched.
    expect(placeValue(0, 2)).toBe(WIN_SCORE);
    expect(placeValue(1, 2)).toBe(-WIN_SCORE);
    expect(placeValue(0.5, 2)).toBe(0);

    const four = [0, 1, 2, 3].map((p) => placeValue(p, 4));
    expect(four[0]).toBe(WIN_SCORE);
    expect(four[3]).toBe(-WIN_SCORE);
    // Strictly worse each step...
    expect(four[0]!).toBeGreaterThan(four[1]!);
    expect(four[1]!).toBeGreaterThan(four[2]!);
    expect(four[2]!).toBeGreaterThan(four[3]!);
    // ...and the first step is the biggest, so giving up the win costs more
    // than any place below it. An evenly spaced scale makes the top level bank
    // a safe second instead of playing for first.
    expect(four[0]! - four[1]!).toBeGreaterThan(four[1]! - four[2]!);
    expect(four[1]! - four[2]!).toBeGreaterThan(four[2]! - four[3]!);

    // Three players: a certain second must be worse than a coin flip between
    // first and last, which is exactly the preference the linear scale lacked.
    expect(placeValue(1, 3)).toBeLessThan((placeValue(0, 3) + placeValue(2, 3)) / 2);
  });

  it('scores a two-player loss as badly as a win scores well', () => {
    const position = SearchPosition.from(withCompletions(2, [goal(1, 5)]));
    expect(position.isGameOver()).toBe(true);
    expect(evaluate(position, 1)).toBe(WIN_SCORE);
    // The bug this guards: last place used to come out hugely positive, so the
    // search happily walked into a loss.
    expect(evaluate(position, 0)).toBe(-WIN_SCORE);
  });

  it('treats giving up as the worst outcome there is', () => {
    const position = SearchPosition.from(
      withCompletions(4, [goal(1, 5), { player: 2, kind: 'resign', ply: 6 }]),
    );
    expect(evaluate(position, 2)).toBe(-WIN_SCORE);
    expect(evaluate(position, 1)).toBe(placeValue(0, 4));
  });

  it('prefers finishing now over playing on, and playing on over placing last', () => {
    // One rival is already home, so second place is the best still available.
    const running = SearchPosition.from(withCompletions(4, [goal(1, 5)]));
    const finishedSecond = SearchPosition.from(withCompletions(4, [goal(1, 5), goal(0, 7)]));

    const playOn = evaluate(running, 0);
    const takeSecond = evaluate(finishedSecond, 0);
    const takeLast = placeValue(3, 4);

    expect(takeSecond).toBeGreaterThan(playOn);
    expect(playOn).toBeGreaterThan(takeLast);
    // The heuristic terms are a nudge, never enough to jump a place.
    expect(Math.abs(playOn - placeValue(2, 4))).toBeLessThan(1_000);
  });
});

describe('search position bookkeeping', () => {
  it('puts everything back after a move that takes a pawn off the board', () => {
    const state = createGame({ playerCount: 2 });
    const position = SearchPosition.from(state);
    const home = cellIndex(state.players[0]!.pos.c, 8);

    const before = {
      hash: position.hash,
      turn: position.turn,
      active: position.activeCount,
      finished: position.finishedCount,
      cells: [...position.cells],
      retired: [...position.retired],
      ranks: [...position.goalRank],
    };

    const undoHome = position.applyPawn(0, home);
    expect(position.isGameOver()).toBe(true);
    expect(evaluate(position, 0)).toBe(WIN_SCORE);

    position.undo(undoHome);
    expect(position.hash).toBe(before.hash);
    expect(position.turn).toBe(before.turn);
    expect(position.activeCount).toBe(before.active);
    expect(position.finishedCount).toBe(before.finished);
    expect([...position.cells]).toEqual(before.cells);
    expect([...position.retired]).toEqual(before.retired);
    expect([...position.goalRank]).toEqual(before.ranks);
  });
});
