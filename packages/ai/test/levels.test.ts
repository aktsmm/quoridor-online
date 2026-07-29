import { describe, expect, it } from 'vitest';
import { createGame, tryApplyMove, type GameState } from '@quoridor/engine';
import { LEVEL_PROFILES, chooseMove, type AiLevel } from '../src/index.js';

/**
 * A clock that advances one millisecond per reading.
 *
 * A wall-clock budget makes the depth reached depend on how fast the machine
 * is, which is exactly the sort of flakiness a shared CI runner produces.
 * Counting reads instead makes "how deep did it get" reproducible, and the
 * search only reads the clock once every 128 nodes, so the budget still bounds
 * the work it does.
 */
function virtualClock(): () => number {
  let ticks = 0;
  return () => {
    ticks += 1;
    return ticks;
  };
}

function decide(level: AiLevel, state: GameState, seed: number, timeBudgetMs: number) {
  return chooseMove({ state, level, seed, timeBudgetMs, now: virtualClock() });
}

describe('difficulty levels', () => {
  it('never puts the pure path-follower on a level', () => {
    expect(Object.keys(LEVEL_PROFILES).sort()).toEqual(['easy', 'hard', 'normal']);
    // Walking your own shortest path while ignoring the opponent was the old
    // bottom level, and it was a punchbag. The engine stays available for the
    // server's fallback, but no level uses it any more - that is the change.
    for (const profile of Object.values(LEVEL_PROFILES)) {
      expect(profile.engine).not.toBe('greedy');
    }
    expect(LEVEL_PROFILES.easy.engine).toBe('static');
    expect(LEVEL_PROFILES.normal.engine).toBe('search');
    expect(LEVEL_PROFILES.hard.engine).toBe('search');
  });

  it('answers instantly at the bottom level and searches above it', () => {
    const state = createGame({ playerCount: 2 });

    const easy = decide('easy', state, 1, 300);
    expect(easy.depth).toBe(0);
    expect(easy.nodes).toBe(0);
    expect(tryApplyMove(state, easy.move).ok).toBe(true);

    const normal = decide('normal', state, 1, 300);
    expect(normal.depth).toBeGreaterThanOrEqual(1);
    expect(normal.nodes).toBeGreaterThan(0);
    expect(tryApplyMove(state, normal.move).ok).toBe(true);
  }, 30_000);

  it('caps the middle level so a fast machine cannot promote it', () => {
    const state = createGame({ playerCount: 2 });
    const cap = LEVEL_PROFILES.normal.maxDepth;
    expect(cap).toBeGreaterThan(0);
    for (let seed = 1; seed <= 3; seed += 1) {
      // A budget far larger than anything the server hands out: the depth cap
      // has to be what stops it, not the clock.
      expect(decide('normal', state, seed, 60_000).depth).toBeLessThanOrEqual(cap!);
    }
  }, 60_000);

  it('never searches shallower at the top level than in the middle', () => {
    const state = createGame({ playerCount: 2 });
    for (let seed = 1; seed <= 2; seed += 1) {
      const normal = decide('normal', state, seed, 200);
      const hard = decide('hard', state, seed, 200);
      expect(hard.depth).toBeGreaterThanOrEqual(normal.depth);
      expect(tryApplyMove(state, hard.move).ok).toBe(true);
    }
  }, 60_000);

  it('spends a smaller share of the budget in the middle than at the top', () => {
    expect(LEVEL_PROFILES.normal.budgetScale ?? 1).toBeLessThan(
      LEVEL_PROFILES.hard.budgetScale ?? 1,
    );
  });
});
