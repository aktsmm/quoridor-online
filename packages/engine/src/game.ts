import {
  BOARD_SIZE,
  IllegalMoveError,
  type GameState,
  type Goal,
  type Move,
  type PlayerCount,
  type PlayerState,
  type Pos,
  type SeatDirection,
  type Wall,
} from './types.js';
import { cellCol, cellIndex, cellRow, isPos, isWallAnchor, samePos } from './coords.js';
import { Board, allWalls } from './board.js';
import { Pathfinder, isGoalCell } from './path.js';
import { occupancyOf, pawnDestinations } from './moves.js';

/** Where each seat starts and which line it runs to. */
const SEAT_SETUP: Record<SeatDirection, { start: Pos; goal: Goal }> = {
  south: { start: { c: 4, r: 0 }, goal: { kind: 'row', value: BOARD_SIZE - 1 } },
  west: { start: { c: 0, r: 4 }, goal: { kind: 'col', value: BOARD_SIZE - 1 } },
  north: { start: { c: 4, r: BOARD_SIZE - 1 }, goal: { kind: 'row', value: 0 } },
  east: { start: { c: BOARD_SIZE - 1, r: 4 }, goal: { kind: 'col', value: 0 } },
};

/** Turn order runs clockwise around the board. */
export const CLOCKWISE_SEATS: readonly SeatDirection[] = ['south', 'west', 'north', 'east'];

export function seatSetup(seat: SeatDirection): { start: Pos; goal: Goal } {
  return SEAT_SETUP[seat];
}

export function defaultSeats(playerCount: PlayerCount): SeatDirection[] {
  switch (playerCount) {
    case 2:
      return ['south', 'north'];
    case 3:
      // Three-player Quoridor is unofficial; the north seat is left empty by
      // default and the caller may rotate which side that is.
      return seatsExcluding('north');
    case 4:
      return [...CLOCKWISE_SEATS];
  }
}

/** The clockwise seat order with one direction removed, for 3-player games. */
export function seatsExcluding(empty: SeatDirection): SeatDirection[] {
  return CLOCKWISE_SEATS.filter((s) => s !== empty);
}

export function defaultWallsPerPlayer(playerCount: PlayerCount): number {
  switch (playerCount) {
    case 2:
      return 10;
    case 3:
      return 7;
    case 4:
      return 5;
  }
}

export interface CreateGameOptions {
  playerCount: PlayerCount;
  /** Overrides the default seating, e.g. to rotate the empty side in 3-player games. */
  seats?: readonly SeatDirection[];
  wallsPerPlayer?: number;
  /** Index of the player to move first. Defaults to 0. */
  firstTurn?: number;
}

export function createGame(options: CreateGameOptions): GameState {
  const { playerCount } = options;
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
    throw new IllegalMoveError(`unsupported player count: ${String(playerCount)}`);
  }

  const seats = options.seats ? [...options.seats] : defaultSeats(playerCount);
  if (seats.length !== playerCount) {
    throw new IllegalMoveError('seat count does not match player count');
  }
  if (new Set(seats).size !== seats.length) {
    throw new IllegalMoveError('duplicate seat');
  }

  const wallsPerPlayer = options.wallsPerPlayer ?? defaultWallsPerPlayer(playerCount);
  if (!Number.isInteger(wallsPerPlayer) || wallsPerPlayer < 0) {
    throw new IllegalMoveError('wallsPerPlayer must be a non-negative integer');
  }

  const firstTurn = options.firstTurn ?? 0;
  if (!Number.isInteger(firstTurn) || firstTurn < 0 || firstTurn >= playerCount) {
    throw new IllegalMoveError('firstTurn out of range');
  }

  const players: PlayerState[] = seats.map((seat) => {
    const setup = SEAT_SETUP[seat];
    return { seat, pos: setup.start, wallsLeft: wallsPerPlayer, goal: setup.goal };
  });

  return { playerCount, players, walls: [], turn: firstTurn, winner: null, ply: 0 };
}

function playerCells(state: GameState): number[] {
  return state.players.map((p) => cellIndex(p.pos.c, p.pos.r));
}

/** Squares the player to move may step to. */
export function legalPawnMoves(state: GameState, playerIndex = state.turn): Pos[] {
  if (state.winner !== null) return [];
  const player = state.players[playerIndex];
  if (!player) return [];

  const board = Board.from(state.walls);
  const occupied = occupancyOf(playerCells(state));
  const cells = pawnDestinations(board, cellIndex(player.pos.c, player.pos.r), occupied);
  return cells.map((cell) => ({ c: cellCol(cell), r: cellRow(cell) }));
}

export function isLegalPawnMove(state: GameState, to: Pos, playerIndex = state.turn): boolean {
  if (!isPos(to)) return false;
  return legalPawnMoves(state, playerIndex).some((p) => samePos(p, to));
}

export type WallRejection =
  | 'out-of-range'
  | 'no-walls-left'
  | 'overlaps-existing-wall'
  | 'blocks-a-player';

/**
 * Why a wall cannot be placed, or null when it is legal.
 *
 * `board` and `pathfinder` may be supplied so bulk enumeration does not rebuild
 * them for every candidate.
 */
export function wallRejection(
  state: GameState,
  wall: Wall,
  playerIndex = state.turn,
  board?: Board,
  pathfinder?: Pathfinder,
): WallRejection | null {
  if (!isWallAnchor(wall)) return 'out-of-range';

  const player = state.players[playerIndex];
  if (!player || player.wallsLeft <= 0) return 'no-walls-left';

  const index = board ?? Board.from(state.walls);
  if (!index.fitsWithoutOverlap(wall)) return 'overlaps-existing-wall';

  const finder = pathfinder ?? new Pathfinder();
  index.add(wall);
  try {
    for (const other of state.players) {
      const from = cellIndex(other.pos.c, other.pos.r);
      if (!finder.canReachGoal(index, from, other.goal)) return 'blocks-a-player';
    }
  } finally {
    index.remove(wall);
  }
  return null;
}

export function isLegalWall(state: GameState, wall: Wall, playerIndex = state.turn): boolean {
  return state.winner === null && wallRejection(state, wall, playerIndex) === null;
}

/** Every wall the player to move may legally place. */
export function legalWalls(state: GameState, playerIndex = state.turn): Wall[] {
  if (state.winner !== null) return [];
  const player = state.players[playerIndex];
  if (!player || player.wallsLeft <= 0) return [];

  const board = Board.from(state.walls);
  const finder = new Pathfinder();
  const out: Wall[] = [];
  for (const wall of allWalls()) {
    if (wallRejection(state, wall, playerIndex, board, finder) === null) out.push(wall);
  }
  return out;
}

export function legalMoves(state: GameState, playerIndex = state.turn): Move[] {
  const moves: Move[] = legalPawnMoves(state, playerIndex).map((to) => ({
    type: 'pawn' as const,
    to,
  }));
  for (const wall of legalWalls(state, playerIndex)) moves.push({ type: 'wall', wall });
  return moves;
}

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

/** Validates and applies a move, returning a new state. Never mutates `state`. */
export function tryApplyMove(state: GameState, move: Move): ApplyResult {
  if (state.winner !== null) return { ok: false, reason: 'game-over' };

  const playerIndex = state.turn;
  const player = state.players[playerIndex];
  if (!player) return { ok: false, reason: 'no-such-player' };

  if (move.type === 'pawn') {
    if (!isPos(move.to)) return { ok: false, reason: 'out-of-range' };
    if (!isLegalPawnMove(state, move.to, playerIndex)) {
      return { ok: false, reason: 'illegal-pawn-move' };
    }

    const players = state.players.map((p, i) => (i === playerIndex ? { ...p, pos: move.to } : p));
    const reachedGoal = isGoalCell(player.goal, cellIndex(move.to.c, move.to.r));
    return {
      ok: true,
      state: {
        ...state,
        players,
        turn: reachedGoal ? playerIndex : nextTurn(state),
        winner: reachedGoal ? playerIndex : null,
        ply: state.ply + 1,
      },
    };
  }

  if (move.type === 'wall') {
    const rejection = wallRejection(state, move.wall, playerIndex);
    if (rejection !== null) return { ok: false, reason: rejection };

    const players = state.players.map((p, i) =>
      i === playerIndex ? { ...p, wallsLeft: p.wallsLeft - 1 } : p,
    );
    return {
      ok: true,
      state: {
        ...state,
        players,
        walls: [...state.walls, { ...move.wall }],
        turn: nextTurn(state),
        ply: state.ply + 1,
      },
    };
  }

  return { ok: false, reason: 'unknown-move-type' };
}

export function applyMove(state: GameState, move: Move): GameState {
  const result = tryApplyMove(state, move);
  if (!result.ok) throw new IllegalMoveError(result.reason);
  return result.state;
}

function nextTurn(state: GameState): number {
  return (state.turn + 1) % state.playerCount;
}

/** Steps the player still needs, or -1 when walled off (which never happens in legal play). */
export function distanceToGoal(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  if (!player) return -1;
  const board = Board.from(state.walls);
  return new Pathfinder().distanceToGoal(board, cellIndex(player.pos.c, player.pos.r), player.goal);
}

export function isGameOver(state: GameState): boolean {
  return state.winner !== null;
}

/**
 * Which seat played ply `index` (0-based), for colouring the move log.
 *
 * The first mover is randomised per game and is not stored anywhere, so it has
 * to be recovered from the state. While the game runs `turn` has advanced once
 * per ply; once someone wins, `turn` stops on the winner instead, so the last
 * ply is the anchor in that case.
 */
export function moverAtPly(state: GameState, index: number): number {
  const n = state.playerCount;
  const first =
    state.winner === null
      ? (((state.turn - state.ply) % n) + n) % n
      : (((state.winner - (state.ply - 1)) % n) + n) % n;
  return (first + index) % n;
}

