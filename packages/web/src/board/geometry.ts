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
 * How far from a groove a pointer still counts as aiming at it.
 *
 * Deliberately smaller than half a square, so the middle of a square that has
 * nothing else to offer selects nothing at all rather than some distant wall.
 * A groove is always approachable from at least one side (see below), so
 * tightening this costs no reach - it only removes overreach.
 */
export const WALL_SNAP_PCT = CELL_PCT * 0.35;

/** How much closer a rival candidate must be before the preview switches. */
const HYSTERESIS = 1.25;

/**
 * A wall needs either this much movement or a deliberate hold before release.
 *
 * Measured as a percentage of the board width, so on a 350px board this is
 * about 14px. It has to clear the platform tap slop (8dp on Android, a 15px
 * radius in Chrome) or a shaky tap could still spend a wall.
 */
export const WALL_DRAG_THRESHOLD_PCT = 4;
export const WALL_DWELL_MS = 250;

/**
 * Distance between two viewport points as a percentage of the board width.
 *
 * Viewport coordinates are used on purpose: measuring inside the board would
 * count layout shifts (the readout growing, the preview appearing) as finger
 * movement.
 */
export function pointerTravelPct(
  start: { x: number; y: number },
  current: { x: number; y: number },
  boardWidth: number,
): number {
  if (!(boardWidth > 0)) return 0;
  return (Math.hypot(current.x - start.x, current.y - start.y) / boardWidth) * 100;
}

function distanceToRect(rect: Rect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
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
 *
 * A square you may step to belongs entirely to the pawn move: aiming at it can
 * never spend a wall, which is the one mistake that cannot be taken back. That
 * costs no wall reach, because a groove touches four squares and the mover's
 * own square is never a destination, so at least one side is always free to
 * grab it from.
 */
export function resolveBoardTarget(
  point: { x: number; y: number },
  options: ResolveOptions,
): BoardTarget | null {
  const { targets, walls, previous = null } = options;
  const { x, y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  for (const pos of targets) {
    if (distanceToRect(squareRect(pos), x, y) === 0) return { kind: 'pawn', pos };
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

  return null;
}

export interface ReleaseOptions extends ResolveOptions {
  /** Board point captured on pointerdown, immune to layout movement mid-gesture. */
  tapPoint?: { x: number; y: number };
  /** Furthest distance travelled since pointerdown, as board percentage points. */
  movementPct: number;
  /** Time held before release. */
  elapsedMs: number;
  /**
   * Whether a still gesture may commit a wall. A mouse points before it presses,
   * so a click is already a considered choice; a finger lands blind, so touch
   * makes walls cost a drag or a hold.
   */
  allowWallOnTap?: boolean;
}

/**
 * Applies the safety policy for a release.
 *
 * A gesture that never really moved is read at the point it *started* from, so
 * the few pixels a hand drifts between press and release can never change what
 * is committed - in either direction.
 */
export function resolveRelease(
  point: { x: number; y: number },
  options: ReleaseOptions,
): BoardTarget | null {
  const { tapPoint, movementPct, elapsedMs, allowWallOnTap = false, ...resolveOptions } = options;
  if (movementPct < WALL_DRAG_THRESHOLD_PCT && elapsedMs < WALL_DWELL_MS) {
    const still = tapPoint ?? point;
    return resolveBoardTarget(still, allowWallOnTap ? resolveOptions : { ...resolveOptions, walls: [] });
  }
  return resolveBoardTarget(point, resolveOptions);
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
