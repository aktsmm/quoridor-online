import {
  Board,
  Pathfinder,
  cellCol,
  cellIndex,
  cellRow,
  isGoalCell,
  occupancyOf,
  pawnDestinations,
  type GameState,
  type Goal,
  type Move,
  type Pos,
  type Wall,
} from '@quoridor/engine';

export type Undo =
  | {
      readonly kind: 'pawn';
      readonly player: number;
      readonly from: number;
      readonly to: number;
      readonly prevTurn: number;
      readonly prevWinner: number | null;
    }
  | {
      readonly kind: 'wall';
      readonly player: number;
      readonly wall: Wall;
      readonly prevTurn: number;
    };

/**
 * Mutable mirror of a `GameState`, tuned for search.
 *
 * The immutable engine state is the source of truth for the server; this class
 * exists so alpha-beta can make and unmake thousands of moves per second
 * without allocating a new state object each time. All rules it implements are
 * the engine's rules, expressed against the same `Board` primitives.
 */
export class SearchPosition {
  readonly board: Board;
  readonly cells: number[];
  readonly wallsLeft: number[];
  readonly goals: readonly Goal[];
  readonly playerCount: number;
  readonly occupied: Uint8Array;
  readonly finder = new Pathfinder();
  turn: number;
  winner: number | null;
  private wallCount: number;

  private constructor(state: GameState) {
    this.board = Board.from(state.walls);
    this.cells = state.players.map((p) => cellIndex(p.pos.c, p.pos.r));
    this.wallsLeft = state.players.map((p) => p.wallsLeft);
    this.goals = state.players.map((p) => p.goal);
    this.playerCount = state.playerCount;
    this.occupied = occupancyOf(this.cells);
    this.turn = state.turn;
    this.winner = state.winner;
    this.wallCount = state.walls.length;
  }

  static from(state: GameState): SearchPosition {
    return new SearchPosition(state);
  }

  get totalWalls(): number {
    return this.wallCount;
  }

  distance(player: number): number {
    return this.finder.distanceToGoal(this.board, this.cells[player]!, this.goals[player]!);
  }

  distanceFrom(player: number, cell: number): number {
    return this.finder.distanceToGoal(this.board, cell, this.goals[player]!);
  }

  pawnMoves(player: number, out: number[] = []): number[] {
    return pawnDestinations(this.board, this.cells[player]!, this.occupied, out);
  }

  /**
   * Wall placements that are legal right now. Enumerating all 128 anchors and
   * running a reachability check on each is fast enough at the root; deeper
   * nodes narrow the candidate list before calling this.
   */
  legalWalls(player: number, candidates?: readonly Wall[]): Wall[] {
    if (this.wallsLeft[player]! <= 0) return [];
    const out: Wall[] = [];
    for (const wall of candidates ?? ALL_WALLS) {
      if (this.isWallLegal(wall)) out.push(wall);
    }
    return out;
  }

  isWallLegal(wall: Wall): boolean {
    if (!this.board.fitsWithoutOverlap(wall)) return false;
    this.board.add(wall);
    try {
      for (let i = 0; i < this.playerCount; i += 1) {
        if (!this.finder.canReachGoal(this.board, this.cells[i]!, this.goals[i]!)) return false;
      }
    } finally {
      this.board.remove(wall);
    }
    return true;
  }

  applyPawn(player: number, to: number): Undo {
    const from = this.cells[player]!;
    const undo: Undo = {
      kind: 'pawn',
      player,
      from,
      to,
      prevTurn: this.turn,
      prevWinner: this.winner,
    };
    this.occupied[from] = 0;
    this.occupied[to] = 1;
    this.cells[player] = to;
    if (isGoalCell(this.goals[player]!, to)) {
      this.winner = player;
    } else {
      this.turn = (this.turn + 1) % this.playerCount;
    }
    return undo;
  }

  applyWall(player: number, wall: Wall): Undo {
    const undo: Undo = { kind: 'wall', player, wall, prevTurn: this.turn };
    this.board.add(wall);
    this.wallsLeft[player]! -= 1;
    this.wallCount += 1;
    this.turn = (this.turn + 1) % this.playerCount;
    return undo;
  }

  undo(record: Undo): void {
    if (record.kind === 'pawn') {
      this.occupied[record.to] = 0;
      this.occupied[record.from] = 1;
      this.cells[record.player] = record.from;
      this.turn = record.prevTurn;
      this.winner = record.prevWinner;
      return;
    }
    this.board.remove(record.wall);
    this.wallsLeft[record.player]! += 1;
    this.wallCount -= 1;
    this.turn = record.prevTurn;
  }

  apply(move: Move): Undo {
    return move.type === 'pawn'
      ? this.applyPawn(this.turn, cellIndex(move.to.c, move.to.r))
      : this.applyWall(this.turn, move.wall);
  }
}

export function cellToPos(cell: number): Pos {
  return { c: cellCol(cell), r: cellRow(cell) };
}

export function pawnMove(cell: number): Move {
  return { type: 'pawn', to: cellToPos(cell) };
}

const ALL_WALLS: readonly Wall[] = (() => {
  const out: Wall[] = [];
  for (let c = 0; c < 8; c += 1) {
    for (let r = 0; r < 8; r += 1) {
      out.push({ c, r, o: 'h' }, { c, r, o: 'v' });
    }
  }
  return out;
})();

export { ALL_WALLS };
