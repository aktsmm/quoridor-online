import { describe, expect, it } from 'vitest';
import { Board, allWalls } from '../src/board.js';
import { occupancyOf, pawnDestinations } from '../src/moves.js';
import { cellCol, cellIndex, cellRow, posToNotation, notationToPos } from '../src/coords.js';
import type { Pos, Wall } from '../src/types.js';
import { referenceDestinations, wallsCompatible } from './helpers/reference.js';
import { makeRng, randomInt } from './helpers/rng.js';

function at(notation: string): Pos {
  const p = notationToPos(notation);
  if (!p) throw new Error(`bad notation ${notation}`);
  return p;
}

function destinations(walls: readonly Wall[], from: Pos, pawns: readonly Pos[]): string[] {
  const board = Board.from(walls);
  const occupied = occupancyOf(pawns.map((p) => cellIndex(p.c, p.r)));
  return pawnDestinations(board, cellIndex(from.c, from.r), occupied)
    .map((cell) => posToNotation({ c: cellCol(cell), r: cellRow(cell) }))
    .sort();
}

function sortedNotation(list: readonly Pos[]): string[] {
  return list.map(posToNotation).sort();
}

describe('ordinary pawn movement', () => {
  it('offers four steps from the middle of an empty board', () => {
    expect(destinations([], at('e5'), [at('e5')])).toEqual(['d5', 'e4', 'e6', 'f5']);
  });

  it('offers two steps from a corner', () => {
    expect(destinations([], at('a1'), [at('a1')])).toEqual(['a2', 'b1']);
    expect(destinations([], at('i9'), [at('i9')])).toEqual(['h9', 'i8']);
  });

  it('cannot step through a horizontal wall', () => {
    // h at (4,4) sits above e5 and f5, blocking e5 -> e6.
    expect(destinations([{ c: 4, r: 4, o: 'h' }], at('e5'), [at('e5')])).toEqual([
      'd5',
      'e4',
      'f5',
    ]);
  });

  it('cannot step through a vertical wall', () => {
    // v at (4,4) sits right of e5 and e6, blocking e5 -> f5.
    expect(destinations([{ c: 4, r: 4, o: 'v' }], at('e5'), [at('e5')])).toEqual([
      'd5',
      'e4',
      'e6',
    ]);
  });

  it('blocks the second square a wall spans, not just the first', () => {
    // h at (4,4) also spans f5, so f5 -> f6 is blocked too.
    expect(destinations([{ c: 4, r: 4, o: 'h' }], at('f5'), [at('f5')])).toEqual([
      'e5',
      'f4',
      'g5',
    ]);
  });
});

describe('jumping', () => {
  it('jumps straight over an adjacent pawn', () => {
    const moves = destinations([], at('e5'), [at('e5'), at('e6')]);
    expect(moves).toContain('e7');
    expect(moves).not.toContain('e6');
    expect(moves).not.toContain('d6');
    expect(moves).not.toContain('f6');
  });

  it('falls back to diagonals when the square behind is off the board', () => {
    // Pawn on e9 (top row) cannot be jumped upwards.
    const moves = destinations([], at('e8'), [at('e8'), at('e9')]);
    expect(moves).toContain('d9');
    expect(moves).toContain('f9');
    expect(moves).not.toContain('e9');
  });

  it('falls back to diagonals when a wall sits behind the blocker', () => {
    // h at (4,6) blocks e7 -> e8, so the straight jump from e6 is impossible.
    const moves = destinations([{ c: 4, r: 6, o: 'h' }], at('e6'), [at('e6'), at('e7')]);
    expect(moves).toContain('d7');
    expect(moves).toContain('f7');
    expect(moves).not.toContain('e8');
  });

  it('falls back to diagonals when a third pawn stands behind the blocker', () => {
    // This is the case the rulebook leaves ambiguous; the project's settled
    // reading is that the straight jump is unavailable, so diagonals open up.
    const moves = destinations([], at('e5'), [at('e5'), at('e6'), at('e7')]);
    expect(moves).not.toContain('e7');
    expect(moves).toContain('d6');
    expect(moves).toContain('f6');
  });

  it('will not land on an occupied diagonal square', () => {
    // Blocker on e6, h wall at (4,5) severs e6 -> e7 so the straight jump is
    // out, and d6 is occupied, leaving f6 as the only diagonal.
    const moves = destinations(
      [{ c: 4, r: 5, o: 'h' }],
      at('e5'),
      [at('e5'), at('e6'), at('d6')],
    );
    expect(moves).not.toContain('d6');
    expect(moves).not.toContain('e7');
    expect(moves).toContain('f6');
  });

  it('will not cross a wall on the diagonal leg', () => {
    // h at (4,6) severs e7 -> e8 (no straight jump); v at (4,5) severs
    // e7 -> f7, so only the d7 diagonal survives.
    const moves = destinations(
      [
        { c: 4, r: 6, o: 'h' },
        { c: 4, r: 5, o: 'v' },
      ],
      at('e6'),
      [at('e6'), at('e7')],
    );
    expect(moves).toContain('d7');
    expect(moves).not.toContain('f7');
    expect(moves).not.toContain('e8');
  });

  it('never chains over two pawns in a row', () => {
    const moves = destinations([], at('e3'), [at('e3'), at('e4'), at('e5')]);
    expect(moves).not.toContain('e6');
  });

  it('does not jump through a wall between the pawns', () => {
    // h at (4,5) blocks e6 -> e7 entirely, so no jump in that direction at all.
    const moves = destinations([{ c: 4, r: 5, o: 'h' }], at('e6'), [at('e6'), at('e7')]);
    expect(moves).not.toContain('e7');
    expect(moves).not.toContain('e8');
    expect(moves).not.toContain('d7');
    expect(moves).not.toContain('f7');
    expect(moves).toEqual(['d6', 'e5', 'f6']);
  });

  it('de-duplicates a diagonal reachable from two directions', () => {
    // Blockers north and east, both with the square behind occupied by the
    // other blocker's neighbour, so f6 is a candidate from both directions.
    const moves = destinations([], at('e5'), [at('e5'), at('e6'), at('f5'), at('e7'), at('g5')]);
    expect(new Set(moves).size).toBe(moves.length);
  });
});

describe('engine matches the reference implementation', () => {
  it('agrees on every single-blocker jump across the whole board', () => {
    const mismatches: string[] = [];
    const steps: Pos[] = [
      { c: 0, r: 1 },
      { c: 1, r: 0 },
      { c: 0, r: -1 },
      { c: -1, r: 0 },
    ];

    for (let c = 0; c < 9; c += 1) {
      for (let r = 0; r < 9; r += 1) {
        const from = { c, r };
        for (const d of steps) {
          const blocker = { c: c + d.c, r: r + d.r };
          if (blocker.c < 0 || blocker.c > 8 || blocker.r < 0 || blocker.r > 8) continue;
          const pawns = [from, blocker];
          const engine = destinations([], from, pawns);
          const reference = sortedNotation(referenceDestinations([], from, pawns));
          if (JSON.stringify(engine) !== JSON.stringify(reference)) {
            mismatches.push(
              `from=${posToNotation(from)} blocker=${posToNotation(blocker)} engine=${engine.join()} ref=${reference.join()}`,
            );
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('agrees on randomised positions with walls and up to four pawns', () => {
    const rng = makeRng(0xc0ffee);
    const catalogue = allWalls();
    const mismatches: string[] = [];

    for (let iteration = 0; iteration < 4000; iteration += 1) {
      // Build a mutually compatible wall set; connectivity does not matter
      // here because we are only comparing movement generation.
      const walls: Wall[] = [];
      const wallTarget = randomInt(rng, 12);
      for (let attempt = 0; attempt < wallTarget * 4 && walls.length < wallTarget; attempt += 1) {
        const candidate = catalogue[randomInt(rng, catalogue.length)]!;
        if (walls.every((w) => wallsCompatible(w, candidate))) walls.push(candidate);
      }

      const pawnCount = 2 + randomInt(rng, 3);
      const pawns: Pos[] = [];
      while (pawns.length < pawnCount) {
        const candidate = { c: randomInt(rng, 9), r: randomInt(rng, 9) };
        if (!pawns.some((p) => p.c === candidate.c && p.r === candidate.r)) pawns.push(candidate);
      }

      const from = pawns[0]!;
      const engine = destinations(walls, from, pawns);
      const reference = sortedNotation(referenceDestinations(walls, from, pawns));
      if (JSON.stringify(engine) !== JSON.stringify(reference)) {
        mismatches.push(
          `iteration=${iteration} from=${posToNotation(from)} pawns=${pawns.map(posToNotation).join()} walls=${walls
            .map((w) => `${w.c}${w.r}${w.o}`)
            .join()} engine=${engine.join()} ref=${reference.join()}`,
        );
        if (mismatches.length > 3) break;
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('agrees on dense positions where pawns surround the mover', () => {
    const mismatches: string[] = [];
    const from = at('e5');
    const ring = [at('e6'), at('f5'), at('e4'), at('d5')];
    const outer = [at('e7'), at('g5'), at('e3'), at('c5')];

    // Every subset of the four neighbours and the four squares behind them.
    for (let mask = 0; mask < 256; mask += 1) {
      const pawns: Pos[] = [from];
      for (let bit = 0; bit < 4; bit += 1) if (mask & (1 << bit)) pawns.push(ring[bit]!);
      for (let bit = 0; bit < 4; bit += 1) if (mask & (1 << (bit + 4))) pawns.push(outer[bit]!);

      const engine = destinations([], from, pawns);
      const reference = sortedNotation(referenceDestinations([], from, pawns));
      if (JSON.stringify(engine) !== JSON.stringify(reference)) {
        mismatches.push(`mask=${mask} engine=${engine.join()} ref=${reference.join()}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('agrees when every wall around the mover is present', () => {
    const mismatches: string[] = [];
    const from = at('e5');
    // The four wall anchors that can touch e5.
    const anchors: Wall[] = [
      { c: 3, r: 4, o: 'h' },
      { c: 4, r: 4, o: 'h' },
      { c: 3, r: 4, o: 'v' },
      { c: 4, r: 4, o: 'v' },
      { c: 3, r: 3, o: 'h' },
      { c: 4, r: 3, o: 'h' },
      { c: 3, r: 3, o: 'v' },
      { c: 4, r: 3, o: 'v' },
    ];

    for (let mask = 0; mask < 1 << anchors.length; mask += 1) {
      const walls = anchors.filter((_, i) => mask & (1 << i));
      // Only consider physically valid combinations.
      let valid = true;
      for (let i = 0; i < walls.length && valid; i += 1) {
        for (let j = i + 1; j < walls.length && valid; j += 1) {
          if (!wallsCompatible(walls[i]!, walls[j]!)) valid = false;
        }
      }
      if (!valid) continue;

      const pawns = [from, at('e6'), at('f5')];
      const engine = destinations(walls, from, pawns);
      const reference = sortedNotation(referenceDestinations(walls, from, pawns));
      if (JSON.stringify(engine) !== JSON.stringify(reference)) {
        mismatches.push(`mask=${mask} engine=${engine.join()} ref=${reference.join()}`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
