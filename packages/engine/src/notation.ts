import type { GameState, Move } from './types.js';
import { notationToPos, notationToWall, posToNotation, wallToNotation } from './coords.js';

/** `"e2"` for a pawn move, `"c5v"` for a wall - the usual wall-game shorthand. */
export function moveToNotation(move: Move): string {
  return move.type === 'pawn' ? posToNotation(move.to) : wallToNotation(move.wall);
}

export function notationToMove(text: string): Move | null {
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
  return `ply=${state.ply} ${players} walls=[${walls}]${
    state.winner === null ? '' : ` winner=${state.winner}`
  }`;
}
