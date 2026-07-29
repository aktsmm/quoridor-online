import type { GameState, Move } from './types.js';
import { notationToPos, notationToWall, posToNotation, wallToNotation } from './coords.js';

/** What a resignation looks like in the move log. */
export const RESIGN_NOTATION = 'xx';

/** `"e2"` for a pawn move, `"c5v"` for a wall - the usual wall-game shorthand. */
export function moveToNotation(move: Move): string {
  if (move.type === 'pawn') return posToNotation(move.to);
  if (move.type === 'wall') return wallToNotation(move.wall);
  return RESIGN_NOTATION;
}

export function notationToMove(text: string): Move | null {
  if (text === RESIGN_NOTATION) return { type: 'resign' };
  const wall = notationToWall(text);
  if (wall) return { type: 'wall', wall };
  const pos = notationToPos(text);
  if (pos) return { type: 'pawn', to: pos };
  return null;
}

/** Compact, human-readable dump of a position. Used in test failures and logs. */
export function describeState(state: GameState): string {
  const players = state.players
    .map((p, i) => `${i === state.turn ? '*' : ' '}${p.seat}@${posToNotation(p.pos)}(${p.wallsLeft})`)
    .join(' ');
  const walls = state.walls.map(wallToNotation).join(',');
  const done = state.completions.map((c) => `${c.player}:${c.kind}@${c.ply}`).join(',');
  return `ply=${state.ply} ${players} walls=[${walls}]${done === '' ? '' : ` done=[${done}]`}`;
}
