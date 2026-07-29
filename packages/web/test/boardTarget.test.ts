import { describe, expect, it } from 'vitest';
import type { Pos, Wall } from '@quoridor/engine';
import {
  pointerTravelPct,
  resolveBoardTarget,
  resolveTouchRelease,
  squareRect,
  wallRect,
  WALL_DRAG_THRESHOLD_PCT,
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

  it('uses the whole legal square for a quick touch tap', () => {
    const rect = squareRect(square);
    const target = resolveTouchRelease(
      { x: rect.left + 1, y: rect.top + 1 },
      {
        targets: [square],
        walls: [horizontal, vertical],
        movementPct: 0,
        elapsedMs: 80,
      },
    );
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('uses the pointerdown point when layout moves under a quick touch', () => {
    const target = resolveTouchRelease(centre(wallRect(horizontal)), {
      tapPoint: centre(squareRect(square)),
      targets: [square],
      walls: [horizontal],
      movementPct: 0,
      elapsedMs: 80,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('never spends a wall on a quick stationary touch', () => {
    const target = resolveTouchRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 0,
      elapsedMs: 80,
    });
    expect(target).toBeNull();
  });

  it('ignores a shaky tap that stays inside the platform tap slop', () => {
    const target = resolveTouchRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 3,
      elapsedMs: 80,
    });
    expect(target).toBeNull();
  });

  it('allows a wall after a deliberate drag', () => {
    const target = resolveTouchRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 6,
      elapsedMs: 80,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: horizontal });
  });

  it('allows a wall after a deliberate hold', () => {
    const target = resolveTouchRelease(centre(wallRect(vertical)), {
      targets: [],
      walls: [vertical],
      movementPct: 0,
      elapsedMs: 300,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: vertical });
  });
});

describe('pointerTravelPct', () => {
  it('measures viewport travel against the board width', () => {
    expect(pointerTravelPct({ x: 100, y: 100 }, { x: 130, y: 140 }, 350)).toBeCloseTo(
      (50 / 350) * 100,
      6,
    );
  });

  it('reports nothing when the pointer has not moved', () => {
    expect(pointerTravelPct({ x: 10, y: 20 }, { x: 10, y: 20 }, 350)).toBe(0);
  });

  it('stays safe before the board has been measured', () => {
    expect(pointerTravelPct({ x: 0, y: 0 }, { x: 90, y: 90 }, 0)).toBe(0);
  });

  it('clears the wall threshold only past the platform tap slop', () => {
    // Android's 8dp slop and Chrome's 15px suppression radius on a 350px board.
    expect(pointerTravelPct({ x: 0, y: 0 }, { x: 8, y: 0 }, 350)).toBeLessThan(
      WALL_DRAG_THRESHOLD_PCT,
    );
    expect(pointerTravelPct({ x: 0, y: 0 }, { x: 15, y: 0 }, 350)).toBeGreaterThan(
      WALL_DRAG_THRESHOLD_PCT,
    );
  });
});
