/**
 * A second, deliberately naive implementation of the movement rules written
 * straight from the rulebook wording, using plain coordinates instead of the
 * engine's packed edge ids.
 *
 * The engine is fast; this one is obviously correct. Cross-checking them over
 * a large number of positions is what catches row-inversion and off-by-one
 * bugs that a hand-written expectation would miss.
 */
import type { Pos, Wall } from '../../src/types.js';

const SIZE = 9;

export function onBoard(p: Pos): boolean {
  return p.c >= 0 && p.c < SIZE && p.r >= 0 && p.r < SIZE;
}

export function eq(a: Pos, b: Pos): boolean {
  return a.c === b.c && a.r === b.r;
}

/**
 * Is the step between two orthogonally adjacent squares severed by a wall?
 *
 * Derived independently of the engine: a horizontal wall anchored at (wc, wr)
 * lies above squares (wc, wr) and (wc+1, wr), so it severs the vertical step
 * out of row wr for those two columns. A vertical wall anchored at (wc, wr)
 * lies to the right of squares (wc, wr) and (wc, wr+1).
 */
export function stepBlocked(walls: readonly Wall[], from: Pos, to: Pos): boolean {
  const dc = to.c - from.c;
  const dr = to.r - from.r;

  if (Math.abs(dc) + Math.abs(dr) !== 1) {
    throw new Error('stepBlocked expects orthogonally adjacent squares');
  }

  if (dc === 0) {
    const gapRow = dr > 0 ? from.r : to.r; // the row boundary being crossed
    return walls.some((w) => w.o === 'h' && w.r === gapRow && (w.c === from.c || w.c === from.c - 1));
  }
  const gapCol = dc > 0 ? from.c : to.c;
  return walls.some((w) => w.o === 'v' && w.c === gapCol && (w.r === from.r || w.r === from.r - 1));
}

export function canStep(walls: readonly Wall[], from: Pos, to: Pos): boolean {
  return onBoard(to) && !stepBlocked(walls, from, to);
}

const STEPS: readonly Pos[] = [
  { c: 0, r: 1 },
  { c: 1, r: 0 },
  { c: 0, r: -1 },
  { c: -1, r: 0 },
];

function add(p: Pos, d: Pos): Pos {
  return { c: p.c + d.c, r: p.r + d.r };
}

function perpendicular(d: Pos): [Pos, Pos] {
  return d.c === 0
    ? [
        { c: 1, r: 0 },
        { c: -1, r: 0 },
      ]
    : [
        { c: 0, r: 1 },
        { c: 0, r: -1 },
      ];
}

/** Spec-literal transcription of the movement and jump rules. */
export function referenceDestinations(
  walls: readonly Wall[],
  from: Pos,
  pawns: readonly Pos[],
): Pos[] {
  const occupied = (p: Pos) => pawns.some((q) => eq(p, q));
  const out: Pos[] = [];
  const push = (p: Pos) => {
    if (!out.some((q) => eq(p, q))) out.push(p);
  };

  for (const d of STEPS) {
    const neighbour = add(from, d);
    if (!canStep(walls, from, neighbour)) continue;

    if (!occupied(neighbour)) {
      push(neighbour);
      continue;
    }

    const behind = add(neighbour, d);
    if (canStep(walls, neighbour, behind) && !occupied(behind)) {
      push(behind);
      continue;
    }

    for (const side of perpendicular(d)) {
      const diagonal = add(neighbour, side);
      if (canStep(walls, neighbour, diagonal) && !occupied(diagonal)) push(diagonal);
    }
  }

  return out;
}

/**
 * Independent statement of wall compatibility, in geometric terms:
 * same-orientation walls clash when they would physically overlap, and
 * differently-oriented walls clash only when they would cross at the same
 * intersection.
 */
export function wallsCompatible(a: Wall, b: Wall): boolean {
  if (a.o === b.o) {
    return a.o === 'h'
      ? !(a.r === b.r && Math.abs(a.c - b.c) <= 1)
      : !(a.c === b.c && Math.abs(a.r - b.r) <= 1);
  }
  return !(a.c === b.c && a.r === b.r);
}

/** Plain BFS over squares, ignoring pawns, used to double-check path checks. */
export function referenceReaches(
  walls: readonly Wall[],
  from: Pos,
  goal: { kind: 'row' | 'col'; value: number },
): boolean {
  const seen = new Set<string>([`${from.c},${from.r}`]);
  const queue: Pos[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (goal.kind === 'row' ? cur.r === goal.value : cur.c === goal.value) return true;
    for (const d of STEPS) {
      const next = add(cur, d);
      const key = `${next.c},${next.r}`;
      if (seen.has(key)) continue;
      if (!canStep(walls, cur, next)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}
