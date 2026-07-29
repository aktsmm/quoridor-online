import { describe, expect, it } from 'vitest';
import {
  activePlayers,
  createGame,
  tryApplyMove,
  describeState,
  cellIndex,
  isGameOver,
  winnerOf,
  type GameState,
  type Move,
  type PlayerCount,
} from '@quoridor/engine';
import { chooseGreedyMove, makeRng, SearchPosition } from '../src/index.js';

/**
 * The greedy engine is no longer wired to a difficulty level - it is the
 * server's fallback when a worker dies - so it is exercised directly rather
 * than through `chooseMove`.
 */
function greedyMove(state: GameState, rng: () => number): Move {
  return chooseGreedyMove(SearchPosition.from(state), state.turn, rng);
}

function playToCompletion(
  seed: number,
  playerCount: PlayerCount,
  maxPlies = 600,
): { final: GameState; plies: number } {
  const rng = makeRng(seed);
  let state = createGame({ playerCount });
  let plies = 0;

  while (!isGameOver(state) && plies < maxPlies) {
    const move = greedyMove(state, rng);
    const result = tryApplyMove(state, move);
    expect(result.ok, `AI produced an illegal move: ${JSON.stringify(move)}`).toBe(true);
    if (!result.ok) break;
    state = result.state;
    plies += 1;

    // Retired pawns keep their last square in the record but are off the board.
    const cells = activePlayers(state).map((i) => {
      const p = state.players[i]!;
      return cellIndex(p.pos.c, p.pos.r);
    });
    expect(new Set(cells).size, describeState(state)).toBe(cells.length);
  }

  return { final: state, plies };
}

describe('greedy fallback AI', () => {
  it('finishes 2-player games', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { final, plies } = playToCompletion(seed * 1013, 2);
      expect(isGameOver(final), `stalled after ${plies} plies: ${describeState(final)}`).toBe(true);
    }
  });

  it('finishes 3-player games', () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const { final } = playToCompletion(seed * 2027, 3);
      expect(isGameOver(final)).toBe(true);
    }
  });

  it('finishes 4-player games', () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const { final } = playToCompletion(seed * 3041, 4);
      expect(isGameOver(final)).toBe(true);
    }
  });

  it('walks straight down the board when nothing is in the way', () => {
    // With walls disabled the shortest path is a straight line, so the very
    // first move must be one step forward.
    const state = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    expect(greedyMove(state, makeRng(42))).toEqual({ type: 'pawn', to: { c: 4, r: 1 } });
  });

  it('takes the winning square when one is available', () => {
    const base = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 4, r: 7 } },
        { ...base.players[1]!, pos: { c: 0, r: 8 } },
      ],
    };
    const move = greedyMove(state, makeRng(7));
    expect(move).toEqual({ type: 'pawn', to: { c: 4, r: 8 } });
    const after = tryApplyMove(state, move);
    expect(after.ok && winnerOf(after.state)).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const state = createGame({ playerCount: 2 });
    expect(greedyMove(state, makeRng(12345))).toEqual(greedyMove(state, makeRng(12345)));
  });

  it('only ever suggests legal moves in crowded positions', () => {
    const rng = makeRng(0xabcdef);
    let state = createGame({ playerCount: 4 });

    for (let ply = 0; ply < 200 && !isGameOver(state); ply += 1) {
      const move = greedyMove(state, rng);
      const result = tryApplyMove(state, move);
      expect(result.ok, `${JSON.stringify(move)} in ${describeState(state)}`).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }
  });

  it('falls back to a pawn move when out of walls', () => {
    const state = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    for (let seed = 0; seed < 50; seed += 1) {
      expect(greedyMove(state, makeRng(seed)).type).toBe('pawn');
    }
  });
});
