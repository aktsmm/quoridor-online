import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  defaultSeats,
  defaultWallsPerPlayer,
  distanceToGoal,
  isLegalWall,
  legalMoves,
  legalPawnMoves,
  legalWalls,
  moverAtPly,
  seatsExcluding,
  tryApplyMove,
  wallRejection,
} from '../src/game.js';
import { posToNotation, notationToPos } from '../src/coords.js';
import { IllegalMoveError, type GameState, type Pos, type Wall } from '../src/types.js';
import { referenceReaches } from './helpers/reference.js';

function at(notation: string): Pos {
  const p = notationToPos(notation);
  if (!p) throw new Error(`bad notation ${notation}`);
  return p;
}

function place(state: GameState, walls: readonly Wall[]): GameState {
  // Drops walls in without spending turns, for building up test positions.
  return { ...state, walls: [...state.walls, ...walls] };
}

describe('game setup', () => {
  it('seats two players facing each other with ten walls each', () => {
    const game = createGame({ playerCount: 2 });
    expect(game.players.map((p) => posToNotation(p.pos))).toEqual(['e1', 'e9']);
    expect(game.players.map((p) => p.goal)).toEqual([
      { kind: 'row', value: 8 },
      { kind: 'row', value: 0 },
    ]);
    expect(game.players.every((p) => p.wallsLeft === 10)).toBe(true);
    expect(game.turn).toBe(0);
    expect(game.winner).toBeNull();
  });

  it('seats three players on e1, a5 and i5 with seven walls each', () => {
    const game = createGame({ playerCount: 3 });
    expect(game.players.map((p) => posToNotation(p.pos))).toEqual(['e1', 'a5', 'i5']);
    expect(game.players.map((p) => p.goal)).toEqual([
      { kind: 'row', value: 8 },
      { kind: 'col', value: 8 },
      { kind: 'col', value: 0 },
    ]);
    expect(game.players.every((p) => p.wallsLeft === 7)).toBe(true);
  });

  it('seats four players clockwise with five walls each', () => {
    const game = createGame({ playerCount: 4 });
    expect(game.players.map((p) => p.seat)).toEqual(['south', 'west', 'north', 'east']);
    expect(game.players.map((p) => posToNotation(p.pos))).toEqual(['e1', 'a5', 'e9', 'i5']);
    expect(game.players.every((p) => p.wallsLeft === 5)).toBe(true);
  });

  it('keeps clockwise order whichever side is left empty in a 3-player game', () => {
    expect(seatsExcluding('north')).toEqual(['south', 'west', 'east']);
    expect(seatsExcluding('south')).toEqual(['west', 'north', 'east']);
    expect(seatsExcluding('west')).toEqual(['south', 'north', 'east']);
    expect(seatsExcluding('east')).toEqual(['south', 'west', 'north']);
  });

  it('accepts a rotated empty side for 3-player games', () => {
    const game = createGame({ playerCount: 3, seats: seatsExcluding('south') });
    expect(game.players.map((p) => posToNotation(p.pos))).toEqual(['a5', 'e9', 'i5']);
  });

  it('can start on a player other than the first', () => {
    expect(createGame({ playerCount: 4, firstTurn: 2 }).turn).toBe(2);
  });

  it('rejects malformed setups', () => {
    expect(() => createGame({ playerCount: 5 as unknown as 4 })).toThrow(IllegalMoveError);
    expect(() => createGame({ playerCount: 2, seats: ['south'] })).toThrow(IllegalMoveError);
    expect(() => createGame({ playerCount: 2, seats: ['south', 'south'] })).toThrow(
      IllegalMoveError,
    );
    expect(() => createGame({ playerCount: 2, firstTurn: 2 })).toThrow(IllegalMoveError);
    expect(() => createGame({ playerCount: 2, wallsPerPlayer: -1 })).toThrow(IllegalMoveError);
  });

  it('exposes the default wall allowance per player count', () => {
    expect(defaultWallsPerPlayer(2)).toBe(10);
    expect(defaultWallsPerPlayer(3)).toBe(7);
    expect(defaultWallsPerPlayer(4)).toBe(5);
    expect(defaultSeats(2)).toEqual(['south', 'north']);
  });
});

describe('turn handling', () => {
  it('passes the turn on after a pawn move', () => {
    const game = createGame({ playerCount: 2 });
    const next = applyMove(game, { type: 'pawn', to: at('e2') });
    expect(next.turn).toBe(1);
    expect(next.ply).toBe(1);
    expect(posToNotation(next.players[0]!.pos)).toBe('e2');
  });

  it('passes the turn on after a wall and spends one wall', () => {
    const game = createGame({ playerCount: 2 });
    const next = applyMove(game, { type: 'wall', wall: { c: 4, r: 4, o: 'h' } });
    expect(next.turn).toBe(1);
    expect(next.players[0]!.wallsLeft).toBe(9);
    expect(next.walls).toHaveLength(1);
  });

  it('cycles through four seats', () => {
    let game = createGame({ playerCount: 4 });
    const order: number[] = [];
    for (const to of ['e2', 'b5', 'e8', 'h5', 'e3']) {
      order.push(game.turn);
      game = applyMove(game, { type: 'pawn', to: at(to) });
    }
    expect(order).toEqual([0, 1, 2, 3, 0]);
  });

  it('never mutates the state it was given', () => {
    const game = createGame({ playerCount: 2 });
    const snapshot = JSON.stringify(game);
    applyMove(game, { type: 'pawn', to: at('e2') });
    applyMove(game, { type: 'wall', wall: { c: 0, r: 0, o: 'h' } });
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it('rejects illegal pawn moves without changing state', () => {
    const game = createGame({ playerCount: 2 });
    expect(tryApplyMove(game, { type: 'pawn', to: at('e5') })).toEqual({
      ok: false,
      reason: 'illegal-pawn-move',
    });
    expect(tryApplyMove(game, { type: 'pawn', to: { c: 9, r: 0 } })).toEqual({
      ok: false,
      reason: 'out-of-range',
    });
  });

  it('forces a pawn move once a player is out of walls', () => {
    const game = createGame({ playerCount: 2, wallsPerPlayer: 0 });
    expect(legalWalls(game)).toEqual([]);
    expect(wallRejection(game, { c: 0, r: 0, o: 'h' })).toBe('no-walls-left');
    expect(legalMoves(game).every((m) => m.type === 'pawn')).toBe(true);
  });
});

describe('winning', () => {
  it('ends the game the moment a pawn reaches its goal row', () => {
    let game = createGame({ playerCount: 2 });
    game = {
      ...game,
      players: [
        { ...game.players[0]!, pos: at('e8') },
        { ...game.players[1]!, pos: at('a9') },
      ],
    };
    const finished = applyMove(game, { type: 'pawn', to: at('e9') });
    expect(finished.winner).toBe(0);
    expect(legalMoves(finished)).toEqual([]);
    expect(tryApplyMove(finished, { type: 'pawn', to: at('e8') })).toEqual({
      ok: false,
      reason: 'game-over',
    });
  });

  it('ends the game when a side player reaches its goal column', () => {
    let game = createGame({ playerCount: 4, firstTurn: 1 });
    game = {
      ...game,
      players: game.players.map((p, i) => {
        if (i === 1) return { ...p, pos: at('h5') };
        if (i === 3) return { ...p, pos: at('i9') };
        return p;
      }),
    };
    const finished = applyMove(game, { type: 'pawn', to: at('i5') });
    expect(finished.winner).toBe(1);
  });

  it('reports distance to goal from the opening position', () => {
    const game = createGame({ playerCount: 2 });
    expect(distanceToGoal(game, 0)).toBe(8);
    expect(distanceToGoal(game, 1)).toBe(8);
  });
});

describe('wall legality', () => {
  it('rejects anchors outside the interior grid', () => {
    const game = createGame({ playerCount: 2 });
    expect(wallRejection(game, { c: 8, r: 0, o: 'h' })).toBe('out-of-range');
    expect(wallRejection(game, { c: 0, r: 8, o: 'v' })).toBe('out-of-range');
    expect(wallRejection(game, { c: -1, r: 0, o: 'h' })).toBe('out-of-range');
  });

  it('rejects overlapping and crossing walls', () => {
    const game = applyMove(createGame({ playerCount: 2 }), {
      type: 'wall',
      wall: { c: 4, r: 4, o: 'h' },
    });
    expect(wallRejection(game, { c: 4, r: 4, o: 'h' }, 1)).toBe('overlaps-existing-wall');
    expect(wallRejection(game, { c: 5, r: 4, o: 'h' }, 1)).toBe('overlaps-existing-wall');
    expect(wallRejection(game, { c: 4, r: 4, o: 'v' }, 1)).toBe('overlaps-existing-wall');
    expect(wallRejection(game, { c: 6, r: 4, o: 'h' }, 1)).toBeNull();
  });

  it('refuses a wall that would seal a player off completely', () => {
    // Box the south pawn into the bottom-left corner, leaving one gap.
    const game = place(createGame({ playerCount: 2 }), [
      { c: 0, r: 0, o: 'v' },
      { c: 0, r: 2, o: 'h' },
    ]);
    let boxed = { ...game, players: [{ ...game.players[0]!, pos: at('a1') }, game.players[1]!] };
    boxed = place(boxed, [{ c: 1, r: 0, o: 'v' }]);
    // a1/a2/b1/b2 region: the only remaining exit is sealed by h at (0,1)... verify
    // against the reference BFS rather than trusting the construction.
    const candidate: Wall = { c: 0, r: 1, o: 'h' };
    const wouldReach = referenceReaches([...boxed.walls, candidate], at('a1'), {
      kind: 'row',
      value: 8,
    });
    expect(wouldReach).toBe(false);
    expect(wallRejection(boxed, candidate)).toBe('blocks-a-player');
  });

  it('allows a wall that only lengthens the path', () => {
    const game = createGame({ playerCount: 2 });
    expect(isLegalWall(game, { c: 4, r: 0, o: 'h' })).toBe(true);
    const after = applyMove(game, { type: 'wall', wall: { c: 4, r: 0, o: 'h' } });
    expect(distanceToGoal(after, 0)).toBeGreaterThan(8);
  });

  it('checks every player, not just the mover', () => {
    // The north pawn is tucked into the a9 corner behind a vertical wall; a
    // horizontal wall below it would seal the pocket, so player 0 must not be
    // allowed to place it even though it costs player 0 nothing.
    let game = createGame({ playerCount: 2 });
    game = place(game, [{ c: 0, r: 7, o: 'v' }]);
    game = { ...game, players: [game.players[0]!, { ...game.players[1]!, pos: at('a9') }] };

    const seal: Wall = { c: 0, r: 6, o: 'h' };
    expect(referenceReaches(game.walls, at('a9'), { kind: 'row', value: 0 })).toBe(true);
    expect(referenceReaches([...game.walls, seal], at('a9'), { kind: 'row', value: 0 })).toBe(
      false,
    );
    expect(wallRejection(game, seal, 0)).toBe('blocks-a-player');
  });

  it('offers 128 wall placements on an empty board', () => {
    expect(legalWalls(createGame({ playerCount: 2 }))).toHaveLength(128);
  });

  it('agrees with a reference BFS on every candidate wall in a busy position', () => {
    let game = createGame({ playerCount: 2 });
    for (const wall of [
      { c: 3, r: 3, o: 'h' },
      { c: 5, r: 3, o: 'h' },
      { c: 2, r: 5, o: 'v' },
      { c: 6, r: 1, o: 'v' },
      { c: 1, r: 6, o: 'h' },
    ] as Wall[]) {
      game = place(game, [wall]);
    }

    for (const wall of legalWalls(game)) {
      for (const player of game.players) {
        expect(referenceReaches([...game.walls, wall], player.pos, player.goal)).toBe(true);
      }
    }
  });
});

describe('legal move generation', () => {
  it('lists pawn moves and walls together', () => {
    const game = createGame({ playerCount: 2 });
    const moves = legalMoves(game);
    expect(moves.filter((m) => m.type === 'pawn')).toHaveLength(3); // e1: d1, f1, e2
    expect(moves.filter((m) => m.type === 'wall')).toHaveLength(128);
  });

  it('returns nothing once the game is over', () => {
    const game = createGame({ playerCount: 2 });
    const over: GameState = { ...game, winner: 0 };
    expect(legalPawnMoves(over)).toEqual([]);
    expect(legalWalls(over)).toEqual([]);
    expect(legalMoves(over)).toEqual([]);
  });
});

describe('moverAtPly', () => {
  /** Plays `count` plies of whatever move is first in the list. */
  function advance(state: GameState, count: number): GameState {
    let next = state;
    for (let i = 0; i < count; i += 1) {
      next = applyMove(next, { type: 'pawn', to: legalPawnMoves(next)[0]! });
    }
    return next;
  }

  it('attributes every ply when the first player moves first', () => {
    const game = advance(createGame({ playerCount: 2 }), 5);
    expect([0, 1, 2, 3, 4].map((i) => moverAtPly(game, i))).toEqual([0, 1, 0, 1, 0]);
  });

  it('follows a randomised first mover', () => {
    for (const playerCount of [2, 3, 4] as const) {
      for (let firstTurn = 0; firstTurn < playerCount; firstTurn += 1) {
        const game = advance(createGame({ playerCount, firstTurn }), playerCount + 1);
        const expected = Array.from(
          { length: playerCount + 1 },
          (_, i) => (firstTurn + i) % playerCount,
        );
        expect(Array.from({ length: playerCount + 1 }, (_, i) => moverAtPly(game, i))).toEqual(
          expected,
        );
      }
    }
  });

  it('still attributes correctly once someone has won', () => {
    // The winner keeps the turn instead of passing it on, so the finished
    // state has to be read from the winner rather than from `turn`.
    let game = createGame({ playerCount: 2, firstTurn: 1 });
    while (game.winner === null) {
      const me = game.players[game.turn]!;
      const forward = legalPawnMoves(game).reduce((best, pos) => {
        const d = (p: Pos): number =>
          me.goal.kind === 'row' ? Math.abs(me.goal.value - p.r) : Math.abs(me.goal.value - p.c);
        return d(pos) < d(best) ? pos : best;
      });
      game = applyMove(game, { type: 'pawn', to: forward });
    }
    expect(game.winner).not.toBeNull();
    expect(moverAtPly(game, game.ply - 1)).toBe(game.winner);
    expect(moverAtPly(game, 0)).toBe(1);
  });
});
