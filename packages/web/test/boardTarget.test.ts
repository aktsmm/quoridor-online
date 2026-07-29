import { describe, expect, it } from 'vitest';
import {
  createGame,
  legalPawnMoves,
  legalWalls,
  applyMove,
  type GameState,
  type Pos,
  type Wall,
} from '@quoridor/engine';
import {
  CELL_PCT,
  pointerTravelPct,
  resolveBoardTarget,
  resolveRelease,
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

  it('gives the whole of a reachable square to the pawn move', () => {
    // Every point inside a destination square, corners included, has to be the
    // move: aiming at a square must never be able to spend a wall.
    const rect = squareRect(square);
    const walls: Wall[] = [
      horizontal,
      vertical,
      { c: 3, r: 0, o: 'v' },
      { c: 3, r: 1, o: 'h' },
      { c: 4, r: 1, o: 'h' },
      { c: 4, r: 1, o: 'v' },
    ];
    for (let i = 0; i <= 12; i += 1) {
      for (let j = 0; j <= 12; j += 1) {
        const point = {
          x: rect.left + (rect.width * i) / 12,
          y: rect.top + (rect.height * j) / 12,
        };
        expect(resolveBoardTarget(point, { targets: [square], walls })).toEqual<BoardTarget>({
          kind: 'pawn',
          pos: square,
        });
      }
    }
  });

  it('selects nothing in the middle of a square that is not a destination', () => {
    const point = centre(squareRect({ c: 4, r: 4 }));
    expect(resolveBoardTarget(point, { targets: [], walls: legalWalls(createGame({ playerCount: 2 })) })).toBeNull();
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
    const target = resolveRelease(
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
    const target = resolveRelease(centre(wallRect(horizontal)), {
      tapPoint: centre(squareRect(square)),
      targets: [square],
      walls: [horizontal],
      movementPct: 0,
      elapsedMs: 80,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('never spends a wall on a quick stationary touch', () => {
    const target = resolveRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 0,
      elapsedMs: 80,
    });
    expect(target).toBeNull();
  });

  it('ignores a shaky tap that stays inside the platform tap slop', () => {
    const target = resolveRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 3,
      elapsedMs: 80,
    });
    expect(target).toBeNull();
  });

  it('allows a wall after a deliberate drag', () => {
    const target = resolveRelease(centre(wallRect(horizontal)), {
      targets: [],
      walls: [horizontal],
      movementPct: 6,
      elapsedMs: 80,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: horizontal });
  });

  it('allows a wall after a deliberate hold', () => {
    const target = resolveRelease(centre(wallRect(vertical)), {
      targets: [],
      walls: [vertical],
      movementPct: 0,
      elapsedMs: 300,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: vertical });
  });
});

describe('mouse releases', () => {
  const mouseClick = { movementPct: 0, elapsedMs: 0, allowWallOnTap: true } as const;

  it('places a wall on a plain click, with no drag or hold', () => {
    const point = centre(wallRect(horizontal));
    const target = resolveRelease(point, {
      tapPoint: point,
      targets: [square],
      walls: [horizontal],
      ...mouseClick,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: horizontal });
  });

  it('ignores the pixels a hand drifts between press and release', () => {
    // Pressed on the square, released a hair into the groove below it. The
    // press said "move", so a wall must not come out of it.
    const target = resolveRelease(centre(wallRect(horizontal)), {
      tapPoint: centre(squareRect(square)),
      targets: [square],
      walls: [horizontal],
      ...mouseClick,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'pawn', pos: square });
  });

  it('ignores drift in the other direction too', () => {
    const target = resolveRelease(centre(squareRect(square)), {
      tapPoint: centre(wallRect(horizontal)),
      targets: [square],
      walls: [horizontal],
      ...mouseClick,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: horizontal });
  });

  it('follows the pointer once it has really been dragged', () => {
    const target = resolveRelease(centre(wallRect(vertical)), {
      tapPoint: centre(squareRect(square)),
      targets: [square],
      walls: [vertical],
      movementPct: WALL_DRAG_THRESHOLD_PCT + 1,
      elapsedMs: 0,
      allowWallOnTap: true,
    });
    expect(target).toEqual<BoardTarget>({ kind: 'wall', wall: vertical });
  });
});

describe('wall reachability', () => {
  /**
   * Tightening the snap radius is only safe if every legal wall still has a
   * point that selects it. It does, because a groove touches four squares and
   * the mover's own square is never a destination.
   */
  function unreachable(state: GameState): Wall[] {
    const targets = legalPawnMoves(state);
    const walls = legalWalls(state);
    return walls.filter((wall) => {
      const rect = wallRect(wall);
      const along = wall.o === 'h' ? rect.width : rect.height;
      const off = CELL_PCT * 0.3;
      for (let i = 1; i < 12; i += 1) {
        const t = (along * i) / 12;
        for (const shift of [0, -off, off]) {
          const point =
            wall.o === 'h'
              ? { x: rect.left + t, y: rect.top + rect.height / 2 + shift }
              : { x: rect.left + rect.width / 2 + shift, y: rect.top + t };
          const hit = resolveBoardTarget(point, { targets, walls });
          if (hit?.kind === 'wall' && hit.wall === wall) return false;
        }
      }
      return true;
    });
  }

  it('leaves every legal wall selectable on a fresh two-player board', () => {
    expect(unreachable(createGame({ playerCount: 2 }))).toEqual([]);
  });

  it('leaves every legal wall selectable once the pawns have advanced', () => {
    let state = createGame({ playerCount: 4 });
    for (const to of legalPawnMoves(state).slice(0, 1)) state = applyMove(state, { type: 'pawn', to });
    for (const to of legalPawnMoves(state).slice(0, 1)) state = applyMove(state, { type: 'pawn', to });
    state = applyMove(state, { type: 'wall', wall: legalWalls(state)[40] as Wall });
    expect(unreachable(state)).toEqual([]);
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
