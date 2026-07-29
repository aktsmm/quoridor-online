import { describe, expect, it } from 'vitest';
import {
  notationToPos,
  notationToWall,
  posToNotation,
  wallToNotation,
  cellCol,
  cellIndex,
  cellRow,
  isPos,
  isWallAnchor,
  inverseQuarterTurns,
  normalizeQuarterTurns,
  rotatePos,
  rotateWall,
  seatQuarterTurns,
  NORTH,
  EAST,
  SOUTH,
  WEST,
} from '../src/coords.js';
import { moveToNotation, notationToMove } from '../src/notation.js';
import { Board, allWalls } from '../src/board.js';
import { CLOCKWISE_SEATS, seatSetup } from '../src/game.js';
import { BOARD_SIZE } from '../src/types.js';

describe('coordinates and notation', () => {
  it('anchors a1 at the bottom left and i9 at the top right', () => {
    expect(notationToPos('a1')).toEqual({ c: 0, r: 0 });
    expect(notationToPos('i9')).toEqual({ c: 8, r: 8 });
    expect(notationToPos('e1')).toEqual({ c: 4, r: 0 });
    expect(notationToPos('e9')).toEqual({ c: 4, r: 8 });
    expect(notationToPos('a5')).toEqual({ c: 0, r: 4 });
    expect(notationToPos('i5')).toEqual({ c: 8, r: 4 });
  });

  it('round-trips every square', () => {
    for (let c = 0; c < 9; c += 1) {
      for (let r = 0; r < 9; r += 1) {
        const text = posToNotation({ c, r });
        expect(notationToPos(text)).toEqual({ c, r });
        expect(cellCol(cellIndex(c, r))).toBe(c);
        expect(cellRow(cellIndex(c, r))).toBe(r);
      }
    }
  });

  it('round-trips every wall', () => {
    for (const wall of allWalls()) {
      expect(notationToWall(wallToNotation(wall))).toEqual(wall);
    }
    expect(wallToNotation({ c: 2, r: 4, o: 'v' })).toBe('c5v');
    expect(wallToNotation({ c: 4, r: 2, o: 'h' })).toBe('e3h');
  });

  it('rejects malformed notation', () => {
    for (const bad of ['', 'j1', 'a0', 'a10', 'e5x', 'i1v', 'a9h', '5e', 'hello']) {
      expect(notationToPos(bad) ?? notationToWall(bad)).toBeNull();
    }
  });

  it('round-trips moves', () => {
    expect(moveToNotation({ type: 'pawn', to: { c: 4, r: 1 } })).toBe('e2');
    expect(moveToNotation({ type: 'wall', wall: { c: 4, r: 2, o: 'h' } })).toBe('e3h');
    expect(notationToMove('e2')).toEqual({ type: 'pawn', to: { c: 4, r: 1 } });
    expect(notationToMove('c5v')).toEqual({ type: 'wall', wall: { c: 2, r: 4, o: 'v' } });
    expect(notationToMove('zz')).toBeNull();
  });

  it('validates positions and wall anchors', () => {
    expect(isPos({ c: 0, r: 0 })).toBe(true);
    expect(isPos({ c: 8, r: 8 })).toBe(true);
    expect(isPos({ c: 9, r: 0 })).toBe(false);
    expect(isPos({ c: 0.5, r: 0 })).toBe(false);
    expect(isWallAnchor({ c: 7, r: 7, o: 'h' })).toBe(true);
    expect(isWallAnchor({ c: 8, r: 0, o: 'h' })).toBe(false);
    expect(isWallAnchor({ c: 0, r: 0, o: 'x' as 'h' })).toBe(false);
  });
});

/** Direction index for a step of one square, or -1 when the pair is not adjacent. */
function dirBetween(from: { c: number; r: number }, to: { c: number; r: number }): number {
  const dc = to.c - from.c;
  const dr = to.r - from.r;
  if (dc === 0 && dr === 1) return NORTH;
  if (dc === 1 && dr === 0) return EAST;
  if (dc === 0 && dr === -1) return SOUTH;
  if (dc === -1 && dr === 0) return WEST;
  return -1;
}

describe('board rotation', () => {
  const turns = [0, 1, 2, 3] as const;

  it('normalizes and inverts quarter turns', () => {
    expect(normalizeQuarterTurns(-1)).toBe(3);
    expect(normalizeQuarterTurns(5)).toBe(1);
    expect(normalizeQuarterTurns(Number.NaN)).toBe(0);
    for (const k of turns) {
      expect(normalizeQuarterTurns(k + inverseQuarterTurns(k))).toBe(0);
    }
  });

  it('returns to the identity after four turns', () => {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      for (let r = 0; r < BOARD_SIZE; r += 1) {
        let pos = { c, r };
        for (let i = 0; i < 4; i += 1) pos = rotatePos(pos, 1);
        expect(pos).toEqual({ c, r });
      }
    }
    for (const wall of allWalls()) {
      let rotated = wall;
      for (let i = 0; i < 4; i += 1) rotated = rotateWall(rotated, 1);
      expect(rotated).toEqual(wall);
    }
  });

  it('undoes a rotation with its inverse', () => {
    for (const k of turns) {
      for (const wall of allWalls()) {
        expect(rotateWall(rotateWall(wall, k), inverseQuarterTurns(k))).toEqual(wall);
        expect(isWallAnchor(rotateWall(wall, k))).toBe(true);
      }
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        for (let r = 0; r < BOARD_SIZE; r += 1) {
          expect(rotatePos(rotatePos({ c, r }, k), inverseQuarterTurns(k))).toEqual({ c, r });
        }
      }
    }
  });

  it('puts every seat on the bottom edge', () => {
    for (const seat of CLOCKWISE_SEATS) {
      const k = seatQuarterTurns(seat);
      expect(rotatePos(seatSetup(seat).start, k)).toEqual({ c: 4, r: 0 });
    }
  });

  it('keeps wall blocking identical under rotation', () => {
    for (const wall of allWalls()) {
      const plain = Board.from([wall]);
      for (const k of turns) {
        const rotated = Board.from([rotateWall(wall, k)]);
        for (let c = 0; c < BOARD_SIZE; c += 1) {
          for (let r = 0; r < BOARD_SIZE; r += 1) {
            for (const [dc, dr] of [
              [0, 1],
              [1, 0],
            ] as const) {
              const to = { c: c + dc, r: r + dr };
              if (to.c >= BOARD_SIZE || to.r >= BOARD_SIZE) continue;
              const dir = dirBetween({ c, r }, to);
              const blocked = !plain.canStep(cellIndex(c, r), dir);

              const viewFrom = rotatePos({ c, r }, k);
              const viewTo = rotatePos(to, k);
              const viewDir = dirBetween(viewFrom, viewTo);
              expect(viewDir).not.toBe(-1);
              const viewBlocked = !rotated.canStep(cellIndex(viewFrom.c, viewFrom.r), viewDir);

              expect(viewBlocked).toBe(blocked);
            }
          }
        }
      }
    }
  });
});
