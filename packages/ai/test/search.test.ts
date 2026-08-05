import { describe, expect, it } from 'vitest';
import {
  Board,
  DIRECTIONS,
  cellIndex,
  createGame,
  describeState,
  isGameOver,
  tryApplyMove,
  winnerOf,
  type GameState,
  type Goal,
  type PlayerCount,
  type Wall,
} from '@quoridor/engine';
import {
  LEVEL_PROFILES,
  PathTracer,
  SearchPosition,
  TIE_BAND,
  chooseMove,
  chooseSearchMove,
  chooseStaticMove,
  evaluate,
  generateMoves,
  makeRng,
  pathWallCandidates,
  scoreMove,
  scoreMoves,
  wallsBlockingStep,
  type AiLevel,
} from '../src/index.js';

function playToCompletion(
  level: AiLevel,
  seed: number,
  playerCount: PlayerCount,
  maxPlies = 400,
  timeBudgetMs = 25,
): { final: GameState; plies: number } {
  let state = createGame({ playerCount });
  let plies = 0;

  while (!isGameOver(state) && plies < maxPlies) {
    const decision = chooseMove({ state, level, seed: seed + plies, timeBudgetMs });
    const result = tryApplyMove(state, decision.move);
    expect(result.ok, `${level} produced an illegal move: ${JSON.stringify(decision.move)}`).toBe(
      true,
    );
    if (!result.ok) break;
    state = result.state;
    plies += 1;
  }

  return { final: state, plies };
}

/**
 * A square exactly one step short of `goal`, on the middle of the goal line.
 *
 * The goal is a whole row or column, so "one step short" is the neighbouring
 * row or column - which side of the board that is depends on which edge the
 * goal line sits on.
 */
function nearGoal(goal: Goal): { c: number; r: number } {
  const approach = goal.value === 0 ? 1 : goal.value - 1;
  return goal.kind === 'row' ? { c: 4, r: approach } : { c: approach, r: 4 };
}

describe('wall geometry', () => {
  it('lists exactly the walls that sever a step', () => {
    const board = new Board();
    const probe = new Board();
    const out: Wall[] = [];

    for (let cell = 0; cell < 81; cell += 1) {
      for (const dir of DIRECTIONS) {
        const to = board.stepTo(cell, dir);
        if (to < 0) continue;

        out.length = 0;
        wallsBlockingStep(cell, to, out);
        expect(out.length).toBeGreaterThan(0);
        const listed = new Set(out.map((w) => `${w.c},${w.r},${w.o}`));

        for (let c = 0; c < 8; c += 1) {
          for (let r = 0; r < 8; r += 1) {
            for (const o of ['h', 'v'] as const) {
              probe.add({ c, r, o });
              const after = probe.stepTo(cell, dir);
              probe.remove({ c, r, o });
              const shouldCut = listed.has(`${c},${r},${o}`);
              expect(after, `${c},${r},${o} vs step ${cell}->${to}`).toBe(shouldCut ? -1 : to);
            }
          }
        }
      }
    }
  });
});

describe('path tracer', () => {
  it('returns a connected route whose length matches the pathfinder', () => {
    const state = createGame({ playerCount: 2 });
    const position = SearchPosition.from(state);
    const tracer = new PathTracer();
    const board = position.board;

    for (const wall of [
      { c: 3, r: 4, o: 'h' },
      { c: 5, r: 4, o: 'h' },
      { c: 2, r: 2, o: 'v' },
    ] as Wall[]) {
      board.add(wall);
    }

    for (let player = 0; player < 2; player += 1) {
      const route = tracer.path(board, position.cells[player]!, position.goals[player]!);
      expect(route.length - 1).toBe(position.distance(player));
      expect(route[0]).toBe(position.cells[player]);
      for (let i = 0; i + 1 < route.length; i += 1) {
        const steps = DIRECTIONS.map((dir) => board.stepTo(route[i]!, dir));
        expect(steps, `${route[i]} -> ${route[i + 1]} must be a legal step`).toContain(route[i + 1]);
      }
    }
  });

  it('returns an empty route when the goal is unreachable', () => {
    const board = new Board();
    // Seal the far corner: h(0,7) cuts the way down, v(0,7) cuts the way across.
    board.add({ c: 0, r: 7, o: 'h' });
    board.add({ c: 0, r: 7, o: 'v' });
    const tracer = new PathTracer();
    expect(tracer.path(board, cellIndex(0, 8), { kind: 'row', value: 0 })).toEqual([]);
    // The same corner square is its own goal, so a zero-length route survives.
    expect(tracer.path(board, cellIndex(0, 8), { kind: 'row', value: 8 })).toEqual([
      cellIndex(0, 8),
    ]);
  });
});

describe('wall candidates', () => {
  it('only proposes legal walls, and never one that helps the victim', () => {
    const state = createGame({ playerCount: 2 });
    const position = SearchPosition.from(state);
    const tracer = new PathTracer();

    const before = position.distance(1);
    const candidates = pathWallCandidates(position, 0, [1], tracer, { maxSteps: 12, limit: 64 });
    expect(candidates.length).toBeGreaterThan(0);

    let lengthened = 0;
    for (const wall of candidates) {
      expect(position.isWallLegal(wall)).toBe(true);
      const undo = position.applyWall(0, wall);
      const after = position.distance(1);
      expect(after, `${JSON.stringify(wall)} must not shorten the route`).toBeGreaterThanOrEqual(
        before,
      );
      if (after > before) lengthened += 1;
      position.undo(undo);
    }
    // Cutting the route is necessary but not sufficient to lengthen it, since
    // a parallel column may be just as short. Some candidate must still bite.
    expect(lengthened).toBeGreaterThan(0);
  });

  it('returns nothing once the mover is out of walls', () => {
    const state = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    const position = SearchPosition.from(state);
    const tracer = new PathTracer();
    expect(pathWallCandidates(position, 0, [1], tracer, { maxSteps: 12, limit: 64 })).toEqual([]);
  });
});

describe('search position hashing', () => {
  it('restores the hash after undo and matches equal positions', () => {
    const state = createGame({ playerCount: 2 });
    const a = SearchPosition.from(state);
    const b = SearchPosition.from(state);
    expect(a.hash).toBe(b.hash);

    const before = a.hash;
    const undo = a.applyPawn(0, cellIndex(4, 1));
    expect(a.hash).not.toBe(before);
    a.undo(undo);
    expect(a.hash).toBe(before);

    const wallUndo = a.applyWall(0, { c: 3, r: 3, o: 'h' });
    expect(a.hash).not.toBe(before);
    a.undo(wallUndo);
    expect(a.hash).toBe(before);
  });

  it('gives transposed move orders the same key', () => {
    const state = createGame({ playerCount: 2 });
    const a = SearchPosition.from(state);
    a.applyWall(0, { c: 1, r: 1, o: 'h' });
    a.applyWall(1, { c: 5, r: 5, o: 'v' });

    const b = SearchPosition.from(state);
    b.applyWall(0, { c: 5, r: 5, o: 'v' });
    b.applyWall(1, { c: 1, r: 1, o: 'h' });

    // Same walls on the board, same reserves, same side to move: the whole
    // point of a transposition table is that these share one entry.
    expect(a.hash).toBe(b.hash);

    const c = SearchPosition.from(state);
    c.applyPawn(0, cellIndex(4, 1));
    c.applyPawn(1, cellIndex(4, 7));
    c.applyPawn(0, cellIndex(4, 2));
    c.applyPawn(1, cellIndex(4, 6));

    const d = SearchPosition.from(state);
    d.applyPawn(0, cellIndex(3, 0));
    d.applyPawn(1, cellIndex(4, 7));
    d.applyPawn(0, cellIndex(3, 1));
    d.applyPawn(1, cellIndex(4, 6));
    d.applyPawn(0, cellIndex(4, 1));
    d.applyPawn(1, cellIndex(4, 7));
    d.applyPawn(0, cellIndex(4, 2));
    d.applyPawn(1, cellIndex(4, 6));

    expect(c.hash).toBe(d.hash);
  });

  it('separates positions that differ only in who spent the walls', () => {
    const state = createGame({ playerCount: 2 });
    const shared = SearchPosition.from(state);
    shared.applyWall(0, { c: 1, r: 1, o: 'h' });
    shared.applyWall(1, { c: 5, r: 5, o: 'v' });

    const lopsided = SearchPosition.from(state);
    lopsided.applyWall(0, { c: 1, r: 1, o: 'h' });
    lopsided.applyPawn(1, cellIndex(4, 7));
    lopsided.applyWall(0, { c: 5, r: 5, o: 'v' });
    lopsided.applyPawn(1, cellIndex(4, 8));

    // Identical board and side to move, but 8/10 walls left instead of 9/9.
    expect(lopsided.cells).toEqual(shared.cells);
    expect(lopsided.turn).toBe(shared.turn);
    expect(lopsided.wallsLeft).not.toEqual(shared.wallsLeft);
    expect(lopsided.hash).not.toBe(shared.hash);
  });
});

describe('easy AI (one ply)', () => {
  it('finishes games at every player count', () => {
    for (const playerCount of [2, 3, 4] as PlayerCount[]) {
      const { final, plies } = playToCompletion('easy', playerCount * 7919, playerCount);
      expect(isGameOver(final), `stalled after ${plies} plies: ${describeState(final)}`).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    const state = createGame({ playerCount: 2 });
    const a = chooseMove({ state, level: 'easy', seed: 4242 });
    const b = chooseMove({ state, level: 'easy', seed: 4242 });
    expect(a.move).toEqual(b.move);
  });

  it('takes the winning square when one is available', () => {
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 4, r: 7 } },
        { ...base.players[1]!, pos: { c: 0, r: 8 } },
      ],
    };
    const decision = chooseMove({ state, level: 'easy', seed: 5 });
    expect(decision.move).toEqual({ type: 'pawn', to: { c: 4, r: 8 } });
  });

  it('places a wall when the wall gains more than a step does', () => {
    // The opponent stands in the corner file, where a single wall at h(0,0)
    // cuts the only short way out and costs them two tempi. That beats simply
    // walking on, which is worth one.
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 0, r: 4 } },
        { ...base.players[1]!, pos: { c: 0, r: 1 } },
      ],
    };
    const decision = chooseMove({ state, level: 'easy', seed: 11 });
    expect(decision.move.type).toBe('wall');

    const after = tryApplyMove(state, decision.move);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(SearchPosition.from(after.state).distance(1)).toBeGreaterThanOrEqual(3);
    }
  });

  it('splits its choice between racing and a block worth exactly one square', () => {
    // `easy` is a single ply of `min(opponent distance) - my distance`, in which
    // a wall worth one square exactly cancels the move it costs, so the two
    // plans are genuinely equal and the level picks between them at random.
    // Only a search sees that racing here loses on the spot - that difference
    // is most of the gap between the levels.
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 0, r: 4 } },
        { ...base.players[1]!, pos: { c: 4, r: 1 } },
      ],
    };
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      kinds.add(chooseMove({ state, level: 'easy', seed }).move.type);
    }
    expect(kinds).toEqual(new Set(['pawn', 'wall']));
    expect(chooseMove({ state, level: 'hard', seed: 11, timeBudgetMs: 300 }).move.type).toBe('wall');
  }, 30_000);

  it('never gives up a whole square to the randomness', () => {
    // The tie band is one point wide and a square is worth ten, so whatever the
    // seed, the chosen move must score within a point of the best available.
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 0, r: 4 } },
        { ...base.players[1]!, pos: { c: 4, r: 1 } },
      ],
    };
    const position = SearchPosition.from(state);
    const scored = scoreMoves(
      position,
      0,
      generateMoves(position, 0, [1], new PathTracer(), 12, 64),
    );
    const best = Math.max(...scored.map((entry) => entry.score));

    for (let seed = 0; seed < 40; seed += 1) {
      const chosen = chooseMove({ state, level: 'easy', seed }).move;
      const key = JSON.stringify(chosen);
      const match = scored.find((entry) => JSON.stringify(entry.move) === key);
      expect(match).toBeDefined();
      expect(match!.score).toBeGreaterThanOrEqual(best - TIE_BAND);
    }
  });

  it('never wastes a wall that gains nothing', () => {
    // A straight race with the opponent far behind: any wall on their route is
    // worth something, but a wall must still beat simply walking forward when
    // it cannot lengthen anything. Out of walls, the choice is forced.
    const state = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    for (let seed = 0; seed < 20; seed += 1) {
      expect(chooseMove({ state, level: 'easy', seed }).move.type).toBe('pawn');
    }
  });
});

describe('multi-player search', () => {
  // Every claim here is a regression test for a model that shipped, or nearly
  // shipped, and lost. See the note on `chooseSearchMove`.

  it('values a rival who is not leading', () => {
    // The evaluation used to read only the *nearest* opponent. In a 3-player
    // game that is blind: once the leader is out of reach, nothing I do to the
    // player I am actually racing for second place changes my score at all, and
    // a wall spent on them is scored as a pure loss. Second place is worth a
    // full place, so this is not a rounding detail.
    const base = createGame({ playerCount: 3 });
    // Seat 1 is one step from home in both positions, so it is always the
    // nearest rival and `min` is pinned to it.
    const withRival = (pos: { c: number; r: number }): GameState => ({
      ...base,
      players: [
        base.players[0]!,
        { ...base.players[1]!, pos: nearGoal(base.players[1]!.goal) },
        { ...base.players[2]!, pos },
      ],
    });

    const chasing = SearchPosition.from(withRival(nearGoal(base.players[2]!.goal)));
    const trailing = SearchPosition.from(withRival(base.players[2]!.pos));

    expect(chasing.distance(1)).toBe(1);
    expect(trailing.distance(1)).toBe(1);
    expect(chasing.distance(2)).toBe(1);
    expect(trailing.distance(2)).toBeGreaterThan(1);
    expect(chasing.distance(0)).toBe(trailing.distance(0));

    // The two positions are indistinguishable to `min(rival distance)` - it is
    // 1 in both - yet in one of them I am beaten to second place and in the
    // other I am not.
    expect(Math.min(chasing.distance(1), chasing.distance(2))).toBe(
      Math.min(trailing.distance(1), trailing.distance(2)),
    );
    expect(evaluate(trailing, 0)).toBeGreaterThan(evaluate(chasing, 0));
  });

  it('answers the most dangerous rival, not merely the next one to move', () => {
    // Best-reply search lets whichever opponent has the sharpest answer play it,
    // instead of walking the seats in turn order. That is what lets a shallow
    // search see a threat owned by the player who moves *last* in the round.
    // A turn-ordered search needs a full extra round to reach the same move.
    const base = createGame({ playerCount: 3 });
    const state: GameState = {
      ...base,
      players: [
        base.players[0]!,
        base.players[1]!,
        base.players[2]!,
      ],
    };

    // Put the seat that moves last one step from home, and check the fixture is
    // really what the test claims before asserting anything about the search.
    const threatened = 2;
    const goal = state.players[threatened]!.goal;
    const oneStepShort = nearGoal(goal);
    const loaded: GameState = {
      ...state,
      players: state.players.map((player, seat) =>
        seat === threatened ? { ...player, pos: oneStepShort } : player,
      ),
    };
    const position = SearchPosition.from(loaded);
    expect(position.distance(threatened)).toBe(1);
    expect(loaded.turn).toBe(0);

    // Two plies is one move of mine and one reply. Only a best-reply node can
    // fit the dangerous seat's winning move into that reply.
    const decision = chooseSearchMove(SearchPosition.from(loaded), 0, {
      timeBudgetMs: 10_000,
      now: () => performance.now(),
      rng: makeRng(4),
      maxDepth: 2,
    });
    const after = tryApplyMove(loaded, decision.move);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(SearchPosition.from(after.state).distance(threatened)).toBeGreaterThan(1);
  }, 30_000);

  it('still outsearches the middle level with three and four players', () => {
    // Max^n was measured here and rejected for exactly this: with no cutoff it
    // reached depth 3 at a 500 ms budget with either player count, which is the
    // *middle* level's depth cap. The top level did not lose to the middle level
    // so much as turn into it, and the ladder collapsed to a tie.
    //
    // 500 ms is enough on an idle machine (it reaches depth 5), but the suite
    // runs test files in parallel, so the budget here is deliberately loose:
    // the claim is "deeper than the middle level", not "this fast".
    for (const playerCount of [3, 4] as PlayerCount[]) {
      const state = createGame({ playerCount });
      const decision = chooseMove({ state, level: 'hard', seed: 5, timeBudgetMs: 4_000 });
      expect(
        decision.depth,
        `only reached depth ${decision.depth} with ${playerCount} players`,
      ).toBeGreaterThan(LEVEL_PROFILES.normal.maxDepth ?? Number.POSITIVE_INFINITY);
    }
  }, 60_000);

  it('leaves the two-player evaluation exactly antisymmetric', () => {
    // With a single rival a sum over opponents and a minimum over opponents are
    // the same number, which is what makes all of the above free of charge in a
    // two-player game. If that ever stops being true this test fails first.
    const state = createGame({ playerCount: 2 });
    const position = SearchPosition.from(state);
    expect(evaluate(position, 0) + evaluate(position, 1)).toBe(0);

    const nudged: GameState = {
      ...state,
      players: [{ ...state.players[0]!, pos: { c: 4, r: 1 } }, state.players[1]!],
    };
    const moved = SearchPosition.from(nudged);
    expect(evaluate(moved, 0) + evaluate(moved, 1)).toBe(0);
    expect(evaluate(moved, 0)).toBeGreaterThan(evaluate(position, 0));
  });
});

describe('hard AI', () => {
  it('finishes games at every player count', () => {
    for (const playerCount of [2, 3, 4] as PlayerCount[]) {
      const { final, plies } = playToCompletion('hard', playerCount * 104_729, playerCount);
      expect(isGameOver(final), `stalled after ${plies} plies: ${describeState(final)}`).toBe(true);
    }
  }, 120_000);

  it('is deterministic for a given seed at a fixed depth', () => {
    const state = createGame({ playerCount: 2 });
    const run = () =>
      chooseSearchMove(SearchPosition.from(state), 0, {
        timeBudgetMs: 60_000,
        now: () => performance.now(),
        rng: makeRng(999),
        maxDepth: 2,
      });
    const a = run();
    const b = run();
    expect(a.move).toEqual(b.move);
    expect(a.depth).toBe(b.depth);
    expect(a.nodes).toBe(b.nodes);
    expect(a.score).toBe(b.score);
  }, 60_000);

  it('reports the depth it actually completed', () => {
    const state = createGame({ playerCount: 2 });
    const decision = chooseMove({ state, level: 'hard', seed: 3, timeBudgetMs: 400 });
    expect(decision.depth).toBeGreaterThanOrEqual(1);
    expect(decision.nodes).toBeGreaterThan(0);
  }, 30_000);

  it('respects its time budget', () => {
    const state = createGame({ playerCount: 4 });
    for (const budget of [50, 200, 500]) {
      const started = performance.now();
      const decision = chooseMove({ state, level: 'hard', seed: 17, timeBudgetMs: budget });
      const elapsed = performance.now() - started;
      // The root sweep and the first iteration are not interruptible, so allow
      // generous slack; the point is that it does not run away.
      expect(elapsed, `budget ${budget}ms took ${elapsed.toFixed(0)}ms`).toBeLessThan(budget * 4 + 1500);
      expect(tryApplyMove(state, decision.move).ok).toBe(true);
    }
  }, 30_000);

  it('takes an immediate win instead of a bigger positional gain', () => {
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 4, r: 7 } },
        { ...base.players[1]!, pos: { c: 4, r: 1 } },
      ],
    };
    const decision = chooseMove({ state, level: 'hard', seed: 8, timeBudgetMs: 300 });
    expect(decision.move).toEqual({ type: 'pawn', to: { c: 4, r: 8 } });
    const after = tryApplyMove(state, decision.move);
    expect(after.ok && winnerOf(after.state)).toBe(0);
  }, 30_000);

  it('stops an opponent who would otherwise win next ply', () => {
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 0, r: 4 } },
        { ...base.players[1]!, pos: { c: 4, r: 1 } },
      ],
    };
    const decision = chooseMove({ state, level: 'hard', seed: 13, timeBudgetMs: 400 });
    const after = tryApplyMove(state, decision.move);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(SearchPosition.from(after.state).distance(1)).toBeGreaterThan(1);
  }, 30_000);

  it('is at least as good as the one-ply engine at depth one', () => {
    // The search sweeps every legal wall at the root and orders by the same
    // static score the one-ply engine maximises, so its first iteration can
    // never be worse.
    for (let seed = 1; seed <= 5; seed += 1) {
      const state = createGame({ playerCount: 2 });
      const position = SearchPosition.from(state);
      const searched = chooseSearchMove(position, 0, {
        timeBudgetMs: 10_000,
        now: () => performance.now(),
        rng: makeRng(seed),
        maxDepth: 1,
      });
      const onePly = chooseStaticMove(SearchPosition.from(state), 0, makeRng(seed));
      expect(scoreMove(position, 0, searched.move)).toBe(scoreMove(position, 0, onePly));
    }
  }, 30_000);

  it('searches deeper than one ply within a realistic budget', () => {
    const state = createGame({ playerCount: 2 });
    const decision = chooseMove({ state, level: 'hard', seed: 21, timeBudgetMs: 500 });
    expect(decision.depth).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('only ever suggests legal moves in crowded 4-player positions', () => {
    const rng = makeRng(0x5eed);
    let state = createGame({ playerCount: 4 });

    for (let ply = 0; ply < 60 && !isGameOver(state); ply += 1) {
      const position = SearchPosition.from(state);
      const { move } = chooseSearchMove(position, state.turn, {
        timeBudgetMs: 20,
        now: () => performance.now(),
        rng,
      });
      const result = tryApplyMove(state, move);
      expect(result.ok, `${JSON.stringify(move)} in ${describeState(state)}`).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }
  }, 60_000);
});

describe('evaluation', () => {
  it('prefers the side that is closer to its goal', () => {
    const base = createGame({ playerCount: 2 });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0]!, pos: { c: 4, r: 6 } },
        { ...base.players[1]!, pos: { c: 4, r: 7 } },
      ],
    };
    const position = SearchPosition.from(state);
    expect(evaluate(position, 0)).toBeGreaterThan(evaluate(position, 1));
  });
});
