import { BOARD_SIZE, WALL_GRID, type Orientation, type Pos, type Wall } from '@quoridor/engine';

/**
 * The board is laid out in percentages so it scales to any width without
 * JavaScript. One "step" is a square plus the groove that follows it; walls
 * live in the grooves, which is why they get a real size rather than a hairline.
 */
const CELL_UNITS = 10;
const GAP_UNITS = 1.85;
const STEP_UNITS = CELL_UNITS + GAP_UNITS;
const TOTAL_UNITS = BOARD_SIZE * CELL_UNITS + WALL_GRID * GAP_UNITS;

export const CELL_PCT = (CELL_UNITS / TOTAL_UNITS) * 100;
export const GAP_PCT = (GAP_UNITS / TOTAL_UNITS) * 100;
export const STEP_PCT = (STEP_UNITS / TOTAL_UNITS) * 100;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `r` counts up from the bottom, CSS counts down from the top. */
export function squareRect(pos: Pos): Rect {
  return {
    left: pos.c * STEP_PCT,
    top: (BOARD_SIZE - 1 - pos.r) * STEP_PCT,
    width: CELL_PCT,
    height: CELL_PCT,
  };
}

/**
 * A horizontal wall sits in the groove above squares (c,r) and (c+1,r);
 * a vertical wall sits in the groove right of squares (c,r) and (c,r+1).
 */
export function wallRect(wall: Wall): Rect {
  const span = 2 * CELL_PCT + GAP_PCT;
  if (wall.o === 'h') {
    return {
      left: wall.c * STEP_PCT,
      top: (BOARD_SIZE - 1 - wall.r) * STEP_PCT - GAP_PCT,
      width: span,
      height: GAP_PCT,
    };
  }
  return {
    left: wall.c * STEP_PCT + CELL_PCT,
    top: (BOARD_SIZE - 2 - wall.r) * STEP_PCT,
    width: GAP_PCT,
    height: span,
  };
}

/**
 * Grooves are only ~1.7% of the board wide - far below a comfortable touch
 * target - so wall hit areas are inflated over the neighbouring squares. They
 * sit under the pawn layer so they never steal a pawn tap.
 */
export function wallHitRect(wall: Wall): Rect {
  const rect = wallRect(wall);
  const padCross = CELL_PCT * 0.42;
  if (wall.o === 'h') {
    return {
      left: rect.left,
      top: rect.top - padCross,
      width: rect.width,
      height: rect.height + padCross * 2,
    };
  }
  return {
    left: rect.left - padCross,
    top: rect.top,
    width: rect.width + padCross * 2,
    height: rect.height,
  };
}

export function wallId(wall: Wall): string {
  return `${wall.c}-${wall.r}-${wall.o}`;
}

export function posId(pos: Pos): string {
  return `${pos.c}-${pos.r}`;
}

/**
 * What a pointer at a given board position means. Coordinates are always in
 * *view* space: the caller rotates its candidates before asking and rotates the
 * answer back, so this stays a plain geometry function.
 */
export type BoardTarget =
  | { readonly kind: 'pawn'; readonly pos: Pos }
  | { readonly kind: 'wall'; readonly wall: Wall };

/**
 * How far into a square the "definitely a pawn move" core starts, as a fraction
 * of the square. The outer ring belongs to the grooves around it.
 */
export const PAWN_CORE_INSET = 0.28;

/**
 * How far from a groove a pointer still counts as aiming at it. Deliberately
 * larger than half a square so there is no dead zone in the middle of a square
 * that has nothing else to offer - the preview shows what would happen, and
 * releasing outside the board cancels.
 */
export const WALL_SNAP_PCT = CELL_PCT * 0.7;

/** How much closer a rival candidate must be before the preview switches. */
const HYSTERESIS = 1.25;

function distanceToRect(rect: Rect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

function insideCore(rect: Rect, x: number, y: number): boolean {
  const inset = CELL_PCT * PAWN_CORE_INSET;
  return (
    x >= rect.left + inset &&
    x <= rect.left + rect.width - inset &&
    y >= rect.top + inset &&
    y <= rect.top + rect.height - inset
  );
}

export function sameTarget(a: BoardTarget | null, b: BoardTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'pawn' && b.kind === 'pawn') return a.pos.c === b.pos.c && a.pos.r === b.pos.r;
  if (a.kind === 'wall' && b.kind === 'wall') {
    return a.wall.c === b.wall.c && a.wall.r === b.wall.r && a.wall.o === b.wall.o;
  }
  return false;
}

export interface ResolveOptions {
  /** Legal pawn destinations, already in view space. */
  targets: readonly Pos[];
  /** Legal walls of both orientations, already in view space. */
  walls: readonly Wall[];
  /** The previous answer, used to stop the preview flickering mid-drag. */
  previous?: BoardTarget | null;
}

/**
 * Turns a pointer position (percentages inside the board box) into the move it
 * would make, or null when nothing sensible is under it.
 */
export function resolveBoardTarget(
  point: { x: number; y: number },
  options: ResolveOptions,
): BoardTarget | null {
  const { targets, walls, previous = null } = options;
  const { x, y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // The middle of a square you may step to is never ambiguous.
  for (const pos of targets) {
    if (insideCore(squareRect(pos), x, y)) return { kind: 'pawn', pos };
  }

  let bestWall: Wall | null = null;
  let bestWallDist = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    const distance = distanceToRect(wallRect(wall), x, y);
    if (distance < bestWallDist) {
      bestWallDist = distance;
      bestWall = wall;
    }
  }

  if (bestWall && bestWallDist <= WALL_SNAP_PCT) {
    if (previous?.kind === 'wall' && walls.some((w) => sameTarget({ kind: 'wall', wall: w }, previous))) {
      const previousDist = distanceToRect(wallRect(previous.wall), x, y);
      if (previousDist <= bestWallDist * HYSTERESIS) return previous;
    }
    return { kind: 'wall', wall: bestWall };
  }

  // Outer ring of a reachable square, used when walls are exhausted or far.
  for (const pos of targets) {
    if (distanceToRect(squareRect(pos), x, y) === 0) return { kind: 'pawn', pos };
  }

  return null;
}

export const ORIENTATIONS: readonly Orientation[] = ['h', 'v'];

export function rectStyle(rect: Rect): React.CSSProperties {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}
