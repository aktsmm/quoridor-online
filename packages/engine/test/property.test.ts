import { describe, expect, it } from 'vitest';
import {
  activePlayers,
  createGame,
  distanceToGoal,
  finalPlacings,
  isActive,
  isGameOver,
  legalPawnMoves,
  legalWalls,
  seatsExcluding,
  tryApplyMove,
} from '../src/game.js';
import { allWalls, wallKey } from '../src/board.js';
import { cellIndex, posToNotation } from '../src/coords.js';
import { describeState } from '../src/notation.js';
import type { GameState, Move, PlayerCount } from '../src/types.js';
import { referenceReaches, wallsCompatible } from './helpers/reference.js';
import { makeRng, randomInt } from './helpers/rng.js';

/** Fails loudly if any rule invariant is violated in the given position. */
function assertInvariants(state: GameState): void {
  const context = describeState(state);

  // Retired pawns keep their last coordinates for the log but are off the
  // board, so only the runners still in play must occupy distinct squares.
  const live = activePlayers(state);
  const cells = live.map((i) => {
    const p = state.players[i]!;
    return cellIndex(p.pos.c, p.pos.r);
  });
  expect(new Set(cells).size, `two pawns share a square: ${context}`).toBe(cells.length);

  const keys = state.walls.map(wallKey);
  expect(new Set(keys).size, `duplicate wall: ${context}`).toBe(keys.length);

  for (let i = 0; i < state.walls.length; i += 1) {
    for (let j = i + 1; j < state.walls.length; j += 1) {
      expect(
        wallsCompatible(state.walls[i]!, state.walls[j]!),
        `overlapping walls: ${context}`,
      ).toBe(true);
    }
  }

  for (const player of state.players) {
    expect(player.wallsLeft, `negative wall count: ${context}`).toBeGreaterThanOrEqual(0);
  }
  for (const index of live) {
    const player = state.players[index]!;
    expect(
      referenceReaches(state.walls, player.pos, player.goal),
      `player ${player.seat} is sealed off: ${context}`,
    ).toBe(true);
  }

  expect(state.turn, context).toBeGreaterThanOrEqual(0);
  expect(state.turn, context).toBeLessThan(state.playerCount);
  if (!isGameOver(state)) {
    expect(isActive(state, state.turn), `retired player is on move: ${context}`).toBe(true);
  }
}

/**
 * Plays a full game with a policy that mostly walks the shortest path and
 * occasionally drops a wall, which is enough to keep games finite while still
 * producing crowded, wall-heavy positions.
 */
function playRandomGame(seed: number, playerCount: PlayerCount, maxPlies = 400): GameState {
  const rng = makeRng(seed);
  const seats =
    playerCount === 3
      ? seatsExcluding((['south', 'west', 'north', 'east'] as const)[randomInt(rng, 4)]!)
      : undefined;

  let state = createGame(
    seats
      ? { playerCount, seats, firstTurn: randomInt(rng, playerCount) }
      : { playerCount, firstTurn: randomInt(rng, playerCount) },
  );
  assertInvariants(state);

  const totalWalls = state.players.reduce((sum, p) => sum + p.wallsLeft, 0);

  while (!isGameOver(state) && state.ply < maxPlies) {
    const move = chooseMove(state, rng);
    const result = tryApplyMove(state, move);
    expect(result.ok, `engine rejected its own legal move ${JSON.stringify(move)}`).toBe(true);
    if (!result.ok) break;

    const previous = state;
    state = result.state;
    assertInvariants(state);

    const spent = totalWalls - state.players.reduce((sum, p) => sum + p.wallsLeft, 0);
    expect(state.walls.length, describeState(state)).toBe(spent);
    expect(state.ply).toBe(previous.ply + 1);
  }

  return state;
}

function chooseMove(state: GameState, rng: () => number): Move {
  const pawnMoves = legalPawnMoves(state);
  const player = state.players[state.turn]!;

  // 20% of the time, place a wall if one is available.
  if (player.wallsLeft > 0 && rng() < 0.2) {
    const walls = legalWalls(state);
    if (walls.length > 0) return { type: 'wall', wall: walls[randomInt(rng, walls.length)]! };
  }

  // Otherwise walk towards the goal, with a little noise so games differ.
  if (rng() < 0.15) return { type: 'pawn', to: pawnMoves[randomInt(rng, pawnMoves.length)]! };

  let best = pawnMoves[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const to of pawnMoves) {
    const probe: GameState = {
      ...state,
      players: state.players.map((p, i) => (i === state.turn ? { ...p, pos: to } : p)),
    };
    const d = distanceToGoal(probe, state.turn);
    if (d >= 0 && d < bestDistance) {
      bestDistance = d;
      best = to;
    }
  }
  return { type: 'pawn', to: best };
}

describe('random self-play keeps every invariant', () => {
  for (const playerCount of [2, 3, 4] as const) {
    it(`holds across 40 ${playerCount}-player games`, () => {
      let finished = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const final = playRandomGame(seed * 7919 + playerCount, playerCount);
        if (!isGameOver(final)) continue;
        finished += 1;
        // Everyone but the last runner must have walked onto their own line;
        // this policy never resigns, so every completion is a goal.
        expect(final.completions.length, describeState(final)).toBe(playerCount - 1);
        for (const record of final.completions) {
          expect(record.kind).toBe('goal');
          const player = final.players[record.player]!;
          const reached =
            player.goal.kind === 'row'
              ? player.pos.r === player.goal.value
              : player.pos.c === player.goal.value;
          expect(reached, `finisher is not on its goal line: ${describeState(final)}`).toBe(true);
        }
        expect(new Set(finalPlacings(final)).size).toBe(playerCount);
      }
      // A shortest-path policy should finish essentially every game.
      expect(finished).toBeGreaterThanOrEqual(38);
    });
  }
});

describe('legal wall enumeration', () => {
  it('matches a brute-force check over all 128 walls in random positions', () => {
    const rng = makeRng(0x5eed);

    for (let iteration = 0; iteration < 15; iteration += 1) {
      const playerCount = ([2, 3, 4] as const)[randomInt(rng, 3)]!;
      let state = createGame({ playerCount });

      // Play a handful of plies to reach a non-trivial position.
      for (let ply = 0; ply < 12 && !isGameOver(state); ply += 1) {
        const result = tryApplyMove(state, chooseMove(state, rng));
        if (!result.ok) break;
        state = result.state;
      }
      if (isGameOver(state)) continue;

      const engine = new Set(legalWalls(state).map(wallKey));
      const player = state.players[state.turn]!;

      for (const wall of allWalls()) {
        const overlaps = state.walls.some((w) => !wallsCompatible(w, wall));
        const duplicate = state.walls.some((w) => wallKey(w) === wallKey(wall));
        const sealsSomeone = activePlayers(state).some((i) => {
          const p = state.players[i]!;
          return !referenceReaches([...state.walls, wall], p.pos, p.goal);
        });
        const expected = player.wallsLeft > 0 && !overlaps && !duplicate && !sealsSomeone;
        expect(
          engine.has(wallKey(wall)),
          `${wallToKeyLabel(wall)} in ${describeState(state)}`,
        ).toBe(expected);
      }
    }
  });
});

function wallToKeyLabel(wall: { c: number; r: number; o: 'h' | 'v' }): string {
  return `${posToNotation({ c: wall.c, r: wall.r })}${wall.o}`;
}
