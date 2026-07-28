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
} from '../src/coords.js';
import { moveToNotation, notationToMove } from '../src/notation.js';
import { allWalls } from '../src/board.js';

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
