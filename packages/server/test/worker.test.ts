import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createGame, isGameOver, tryApplyMove, type GameState } from '@quoridor/engine';
import { WorkerAiPool, fallbackMove } from '../src/ai/pool.js';

const require = createRequire(import.meta.url);
const workerPath = (() => {
  try {
    return require.resolve('@quoridor/ai/worker');
  } catch {
    return null;
  }
})();

// The worker runs the compiled output, so this only makes sense after a build.
const describeBuilt = workerPath && existsSync(workerPath) ? describe : describe.skip;

describeBuilt('worker thread AI pool', () => {
  it('plays a whole game without ever blocking the main thread for long', async () => {
    const pool = WorkerAiPool.create();
    try {
      let state: GameState = createGame({ playerCount: 2 });
      let plies = 0;
      let worstLagMs = 0;

      while (!isGameOver(state) && plies < 400) {
        // Measure how late a 10 ms timer fires while the search runs; if the
        // search were on this thread it would be starved.
        const scheduled = Date.now();
        const lag = new Promise<number>((resolve) => {
          setTimeout(() => resolve(Date.now() - scheduled - 10), 10);
        });

        const decision = await pool.think({
          state,
          level: 'easy',
          playerIndex: state.turn,
          timeBudgetMs: 100,
        });
        worstLagMs = Math.max(worstLagMs, await lag);

        const result = tryApplyMove(state, decision.move);
        expect(result.ok, `worker produced ${JSON.stringify(decision.move)}`).toBe(true);
        if (!result.ok) break;
        state = result.state;
        plies += 1;
      }

      expect(isGameOver(state)).toBe(true);
      expect(worstLagMs).toBeLessThan(500);
    } finally {
      await pool.close();
    }
  });

  it('rejects work once closed', async () => {
    const pool = WorkerAiPool.create();
    await pool.close();
    await expect(
      pool.think({ state: createGame({ playerCount: 2 }), level: 'easy', playerIndex: 0, timeBudgetMs: 10 }),
    ).rejects.toThrow(/closed/);
  });
});

describe('fallback move', () => {
  it('always returns something legal while the game is running', () => {
    const state = createGame({ playerCount: 2 });
    const move = fallbackMove(state, 0);
    expect(move).not.toBeNull();
    expect(tryApplyMove(state, move!).ok).toBe(true);
  });
});
