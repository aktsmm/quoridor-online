import { describe, expect, it } from 'vitest';
import {
  Board,
  allWalls,
  wallBlockedEdges,
  wallCenterId,
  wallKey,
  verticalEdgeId,
  horizontalEdgeId,
} from '../src/board.js';
import { WALL_GRID } from '../src/types.js';
import { wallsCompatible } from './helpers/reference.js';

describe('wall normalisation', () => {
  it('enumerates exactly 128 placements', () => {
    const walls = allWalls();
    expect(walls).toHaveLength(128);
    expect(new Set(walls.map(wallKey)).size).toBe(128);
  });

  it('severs the two edges named in the spec', () => {
    // h at (c,r) blocks (c,r)-(c,r+1) and (c+1,r)-(c+1,r+1)
    expect(wallBlockedEdges({ c: 3, r: 5, o: 'h' })).toEqual([
      verticalEdgeId(3, 5),
      verticalEdgeId(4, 5),
    ]);
    // v at (c,r) blocks (c,r)-(c+1,r) and (c,r+1)-(c+1,r+1)
    expect(wallBlockedEdges({ c: 3, r: 5, o: 'v' })).toEqual([
      horizontalEdgeId(3, 5),
      horizontalEdgeId(3, 6),
    ]);
  });

  it('gives every wall a distinct edge pair within its orientation', () => {
    const seen = new Map<string, string>();
    for (const w of allWalls()) {
      const key = `${w.o}:${wallBlockedEdges(w).join('-')}`;
      expect(seen.has(key)).toBe(false);
      seen.set(key, wallKey(w));
    }
  });

  it('shares a centre only with its own perpendicular twin', () => {
    for (const w of allWalls()) {
      const twin = { ...w, o: w.o === 'h' ? ('v' as const) : ('h' as const) };
      expect(wallCenterId(twin)).toBe(wallCenterId(w));
    }
  });

  it('never assigns the same edge id to a horizontal and a vertical step', () => {
    const vertical = new Set<number>();
    const horizontal = new Set<number>();
    for (let c = 0; c < 9; c += 1) {
      for (let r = 0; r < 8; r += 1) vertical.add(verticalEdgeId(c, r));
    }
    for (let c = 0; c < 8; c += 1) {
      for (let r = 0; r < 9; r += 1) horizontal.add(horizontalEdgeId(c, r));
    }
    expect(vertical.size).toBe(72);
    expect(horizontal.size).toBe(72);
    for (const id of vertical) expect(horizontal.has(id)).toBe(false);
  });
});

describe('wall compatibility, all 128 x 128 pairs', () => {
  it('matches an independent geometric definition', () => {
    const walls = allWalls();
    const mismatches: string[] = [];

    for (const a of walls) {
      const board = Board.from([a]);
      for (const b of walls) {
        const engineSaysOk = board.fitsWithoutOverlap(b);
        const referenceSaysOk = wallsCompatible(a, b) && wallKey(a) !== wallKey(b);
        if (engineSaysOk !== referenceSaysOk) {
          mismatches.push(`${wallKey(a)} vs ${wallKey(b)}: engine=${engineSaysOk}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('is symmetric', () => {
    const walls = allWalls();
    for (const a of walls) {
      const boardA = Board.from([a]);
      for (const b of walls) {
        if (wallKey(a) === wallKey(b)) continue;
        const boardB = Board.from([b]);
        expect(boardA.fitsWithoutOverlap(b)).toBe(boardB.fitsWithoutOverlap(a));
      }
    }
  });

  it('rejects a wall against itself', () => {
    for (const w of allWalls()) {
      expect(Board.from([w]).fitsWithoutOverlap(w)).toBe(false);
    }
  });

  it('rejects the perpendicular twin at the same intersection', () => {
    for (const w of allWalls()) {
      const twin = { ...w, o: w.o === 'h' ? ('v' as const) : ('h' as const) };
      expect(Board.from([w]).fitsWithoutOverlap(twin)).toBe(false);
    }
  });

  it('accepts T-shaped and end-to-end contacts', () => {
    // A vertical wall whose foot touches the end of a horizontal wall.
    expect(Board.from([{ c: 3, r: 3, o: 'h' }]).fitsWithoutOverlap({ c: 4, r: 3, o: 'v' })).toBe(
      true,
    );
    // Two horizontal walls laid end to end (two columns apart).
    expect(Board.from([{ c: 3, r: 3, o: 'h' }]).fitsWithoutOverlap({ c: 5, r: 3, o: 'h' })).toBe(
      true,
    );
    // Two horizontal walls one column apart do overlap.
    expect(Board.from([{ c: 3, r: 3, o: 'h' }]).fitsWithoutOverlap({ c: 4, r: 3, o: 'h' })).toBe(
      false,
    );
  });

  it('add and remove round-trip exactly', () => {
    const board = new Board();
    for (const w of allWalls()) {
      expect(board.fitsWithoutOverlap(w)).toBe(true);
      board.add(w);
      expect(board.fitsWithoutOverlap(w)).toBe(false);
      board.remove(w);
      expect(board.size).toBe(0);
    }
  });

  it('keeps anchors inside the 8x8 interior grid', () => {
    for (const w of allWalls()) {
      expect(w.c).toBeGreaterThanOrEqual(0);
      expect(w.c).toBeLessThan(WALL_GRID);
      expect(w.r).toBeGreaterThanOrEqual(0);
      expect(w.r).toBeLessThan(WALL_GRID);
    }
  });
});
