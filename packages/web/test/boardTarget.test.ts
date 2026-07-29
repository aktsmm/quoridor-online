import { describe, expect, it } from 'vitest';
import type { Pos, Wall } from '@quoridor/engine';
import {
  resolveBoardTarget,
  squareRect,
  wallRect,
  WALL_SNAP_PCT,
  type BoardTarget,
  type Rect,
} from '../src/board/geometry.js';

function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

const square: Pos = { c: 4, r: 1 };
const horizontal: Wall = { c: 4, r: 0, o: 'h' };
const vertical: Wall = { c: 4, r: 0, o: 'v' };

/** Sits inside both grooves, which is exactly where a preview would flicker. */
const crossing = {
  x: centre(wallRect(vertical)).x,
  y: centre(wallRect(horizontal)).y,
};

describe('resolveBoardTarget', () => {
  it('reads the middle of a reachable square as a pawn move', () => {
    const target = resolveBoardTarget(centre(squareRect(square)), {
      targets: [square],
      walls: [horizontal, vertical],
    });
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('reads a groove as the wall that sits in it', () => {
    const target = resolveBoardTarget(centre(wallRect(horizontal)), {
      targets: [square],
      walls: [horizontal, vertical],
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: horizontal });
  });

  it('keeps the previous wall at a crossing where both are equally close', () => {
    expect(resolveBoardTarget(crossing, { targets: [], walls: [horizontal, vertical] })).toEqual({
      kind: 'wall',
      wall: horizontal,
    });
    expect(
      resolveBoardTarget(crossing, {
        targets: [],
        walls: [horizontal, vertical],
        previous: { kind: 'wall', wall: vertical },
      }),
    ).toEqual({ kind: 'wall', wall: vertical });
  });

  it('drops a remembered wall that is no longer legal', () => {
    expect(
      resolveBoardTarget(crossing, {
        targets: [],
        walls: [horizontal],
        previous: { kind: 'wall', wall: vertical },
      }),
    ).toEqual({ kind: 'wall', wall: horizontal });
  });

  it('falls back to the outer ring of a reachable square when no wall is offered', () => {
    const rect = squareRect(square);
    const target = resolveBoardTarget(
      { x: rect.left + 1, y: rect.top + 1 },
      { targets: [square], walls: [] },
    );
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('never invents a wall when none are legal', () => {
    const target = resolveBoardTarget(centre(wallRect(horizontal)), {
      targets: [square],
      walls: [],
    });
    expect(target).toBeNull();
  });

  it('returns nothing well outside the board', () => {
    const target = resolveBoardTarget(
      { x: 400, y: -400 },
      { targets: [square], walls: [horizontal, vertical] },
    );
    expect(target).toBeNull();
  });

  it('ignores a pointer further from every groove than the snap radius', () => {
    const rect = wallRect(horizontal);
    const target = resolveBoardTarget(
      { x: rect.left, y: rect.top - WALL_SNAP_PCT * 2 },
      { targets: [], walls: [horizontal] },
    );
    expect(target).toBeNull();
  });
});
