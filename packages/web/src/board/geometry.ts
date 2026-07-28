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

export const ORIENTATIONS: readonly Orientation[] = ['h', 'v'];

export function rectStyle(rect: Rect): React.CSSProperties {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}
