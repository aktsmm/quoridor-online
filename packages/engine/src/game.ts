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
      // Three-player is a house rule; the north seat is left empty by
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

  return {
    playerCount,
    players,
    walls: [],
    turn: firstTurn,
    firstTurn,
    completions: [],
    ply: 0,
  };
}

/** Whether the player is still in the game (has neither finished nor given up). */
export function isActive(state: GameState, playerIndex: number): boolean {
  return !state.completions.some((c) => c.player === playerIndex);
}

/** Indices of everyone still playing, in seat order. */
export function activePlayers(state: GameState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.playerCount; i++) if (isActive(state, i)) out.push(i);
  return out;
}

/**
 * Final placings, best first.
 *
 * Whoever reaches their goal line is placed in arrival order, the last player
 * left standing takes the next place, and everyone who gave up is placed from
 * the bottom in the order they did so - giving up first costs you the most.
 * Returns an empty array while the game is still running.
 */
export function finalPlacings(state: GameState): number[] {
  if (!isGameOver(state)) return [];
  const goals = state.completions.filter((c) => c.kind === 'goal').map((c) => c.player);
  const resigned = state.completions.filter((c) => c.kind === 'resign').map((c) => c.player);
  return [...goals, ...activePlayers(state), ...resigned.reverse()];
}

/** Who won, or null while the game is still running. */
export function winnerOf(state: GameState): number | null {
  return finalPlacings(state)[0] ?? null;
}

/** Giving up is only allowed once you have no walls left to play with. */
export function canResign(state: GameState, playerIndex = state.turn): boolean {
  if (isGameOver(state)) return false;
  if (!isActive(state, playerIndex)) return false;
  if (state.turn !== playerIndex) return false;
  const player = state.players[playerIndex];
  return player !== undefined && player.wallsLeft === 0;
}

/** Cells occupied by pawns that are still on the board. Retired pawns are gone. */
function playerCells(state: GameState): number[] {
  const cells: number[] = [];
  state.players.forEach((p, i) => {
    if (isActive(state, i)) cells.push(cellIndex(p.pos.c, p.pos.r));
  });
  return cells;
}

/** Squares the player to move may step to. */
export function legalPawnMoves(state: GameState, playerIndex = state.turn): Pos[] {
  if (isGameOver(state)) return [];
  if (!isActive(state, playerIndex)) return [];
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
  if (!isActive(state, playerIndex)) return 'no-walls-left';

  const index = board ?? Board.from(state.walls);
  if (!index.fitsWithoutOverlap(wall)) return 'overlaps-existing-wall';

  const finder = pathfinder ?? new Pathfinder();
  index.add(wall);
  try {
    // Retired players no longer need a route, so their old goal cannot veto a wall.
    for (let i = 0; i < state.playerCount; i++) {
      if (!isActive(state, i)) continue;
      const other = state.players[i];
      if (!other) continue;
      const from = cellIndex(other.pos.c, other.pos.r);
      if (!finder.canReachGoal(index, from, other.goal)) return 'blocks-a-player';
    }
  } finally {
    index.remove(wall);
  }
  return null;
}

export function isLegalWall(state: GameState, wall: Wall, playerIndex = state.turn): boolean {
  return !isGameOver(state) && wallRejection(state, wall, playerIndex) === null;
}

/** Every wall the player to move may legally place. */
export function legalWalls(state: GameState, playerIndex = state.turn): Wall[] {
  if (isGameOver(state)) return [];
  if (!isActive(state, playerIndex)) return [];
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
  if (isGameOver(state)) return { ok: false, reason: 'game-over' };

  const playerIndex = state.turn;
  const player = state.players[playerIndex];
  if (!player) return { ok: false, reason: 'no-such-player' };
  if (!isActive(state, playerIndex)) return { ok: false, reason: 'already-finished' };

  if (move.type === 'pawn') {
    if (!isPos(move.to)) return { ok: false, reason: 'out-of-range' };
    if (!isLegalPawnMove(state, move.to, playerIndex)) {
      return { ok: false, reason: 'illegal-pawn-move' };
    }

    const players = state.players.map((p, i) => (i === playerIndex ? { ...p, pos: move.to } : p));
    const reachedGoal = isGoalCell(player.goal, cellIndex(move.to.c, move.to.r));
    return {
      ok: true,
      state: reachedGoal
        ? retire({ ...state, players }, playerIndex, 'goal')
        : { ...state, players, turn: nextTurn(state, playerIndex), ply: state.ply + 1 },
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
        turn: nextTurn(state, playerIndex),
        ply: state.ply + 1,
      },
    };
  }

  if (move.type === 'resign') {
    if (!canResign(state, playerIndex)) return { ok: false, reason: 'resign-not-allowed' };
    return { ok: true, state: retire(state, playerIndex, 'resign') };
  }

  return { ok: false, reason: 'unknown-move-type' };
}

/** Takes a player off the board and hands the turn to whoever is left. */
function retire(state: GameState, playerIndex: number, kind: 'goal' | 'resign'): GameState {
  const ply = state.ply + 1;
  const completions = [...state.completions, { player: playerIndex, kind, ply }];
  const next: GameState = { ...state, completions, ply };
  // When the game is over there is nobody to hand the turn to, so it rests on
  // the player who just left.
  return { ...next, turn: isGameOver(next) ? playerIndex : nextTurn(next, playerIndex) };
}

export function applyMove(state: GameState, move: Move): GameState {
  const result = tryApplyMove(state, move);
  if (!result.ok) throw new IllegalMoveError(result.reason);
  return result.state;
}

/** The next player still in the game, skipping anyone who has retired. */
function nextTurn(state: GameState, from: number): number {
  const n = state.playerCount;
  for (let step = 1; step <= n; step++) {
    const candidate = (from + step) % n;
    if (isActive(state, candidate)) return candidate;
  }
  return from;
}

/** Steps the player still needs, or -1 when walled off (which never happens in legal play). */
export function distanceToGoal(state: GameState, playerIndex: number): number {
  const player = state.players[playerIndex];
  if (!player) return -1;
  const board = Board.from(state.walls);
  return new Pathfinder().distanceToGoal(board, cellIndex(player.pos.c, player.pos.r), player.goal);
}

/**
 * Whether the game has finished.
 *
 * A two-player game ends the moment somebody retires; with three or four the
 * board keeps going until only one player is left, so everyone gets a placing.
 */
export function isGameOver(state: GameState): boolean {
  return state.completions.length >= state.playerCount - 1;
}

/**
 * Which seat played ply `index` (0-based), for colouring the move log.
 *
 * Turn order skips retired players, so this replays it from the recorded first
 * mover rather than trying to work backwards from the current turn.
 */
export function moverAtPly(state: GameState, index: number): number {
  const n = state.playerCount;
  let mover = ((state.firstTurn % n) + n) % n;
  for (let played = 0; played < index; played++) {
    const after = played + 1;
    const retired = new Set(
      state.completions.filter((c) => c.ply <= after).map((c) => c.player),
    );
    let next = mover;
    for (let step = 1; step <= n; step++) {
      const candidate = (mover + step) % n;
      if (!retired.has(candidate)) {
        next = candidate;
        break;
      }
    }
    mover = next;
  }
  return mover;
}

