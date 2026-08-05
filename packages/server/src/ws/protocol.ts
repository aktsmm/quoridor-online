import type { GameState, Move, PlayerCount, SeatDirection } from '@quoridor/engine';
import type { AiLevel } from '@quoridor/ai';
import type { RoomErrorCode } from '../rooms/manager.js';
import { nextFirstTurn, type RoomRecord, type RoomStatus, type SeatConnection } from '../rooms/record.js';

/** Client -> server. Every message carries an optional correlation id. */
export type ClientMessage =
  | {
      type: 'room.create';
      rid?: number;
      playerCount: PlayerCount;
      aiLevel: AiLevel;
      fillWithCpu: boolean;
      name: string;
      /** 1-based position in the move order for the host; null means random. */
      hostPosition?: number | null;
    }
  | { type: 'room.join'; rid?: number; code: string; name: string }
  | { type: 'room.watch'; rid?: number; code: string }
  | { type: 'room.reconnect'; rid?: number; code: string; playerToken: string; lastGameVersion?: number }
  | { type: 'room.start'; rid?: number }
  | { type: 'room.rematch'; rid?: number }
  | { type: 'room.leave'; rid?: number }
  | { type: 'game.move'; rid?: number; expectedGameVersion: number; move: Move }
  | { type: 'ping'; rid?: number };

/** Server -> client. */
export type ServerMessage =
  | { type: 'hello'; protocolVersion: number; serverTime: number; features: readonly string[] }
  | { type: 'joined'; rid?: number; roomId: string; code: string; seatIndex: number; playerToken: string }
  | { type: 'watching'; rid?: number; roomId: string; code: string }
  | { type: 'room.state'; rid?: number; room: RoomView }
  | { type: 'game.state'; rid?: number; room: RoomView }
  /** Somebody left the board but the game goes on. */
  | { type: 'game.finished'; room: RoomView; player: number; reason: 'goal' | 'resign' }
  | { type: 'game.over'; room: RoomView; winner: number; placings: number[] }
  | { type: 'error'; rid?: number; code: RoomErrorCode | 'rate-limited' | 'bad-message' | 'internal'; message: string }
  | { type: 'pong'; rid?: number; serverTime: number };

export const PROTOCOL_VERSION = 3;

/**
 * Additive capabilities, advertised in `hello` and on `/health`.
 *
 * The client compares `protocolVersion` for exact equality, so bumping it is a
 * hard cut: every open tab and every not-yet-redeployed bundle stops working.
 * That is the right behaviour for a breaking change and the wrong one for a
 * new optional field, because the front end and the server are deployed by
 * separate workflows and either can land first.
 *
 * Features are the additive channel instead. A client only sends a new field
 * once it has seen the matching capability, so a new bundle talking to an old
 * server simply hides the feature rather than having its frames rejected by
 * that server's `additionalProperties: false`.
 */
export const FEATURE_FIRST_TURN = 'first-turn';

export const SERVER_FEATURES: readonly string[] = [FEATURE_FIRST_TURN];

/** Public projection of a room. Deliberately free of any secret material. */
export interface RoomView {
  roomId: string;
  code: string;
  status: RoomStatus;
  gameVersion: number;
  playerCount: PlayerCount;
  aiLevel: AiLevel;
  fillWithCpu: boolean;
  hostSeat: number | null;
  seats: SeatView[];
  game: GameState | null;
  moveLog: string[];
  /**
   * Seat that opens the next game, 0-based.
   *
   * Before the first game there is no `game` to read it from, so the lobby
   * would otherwise have nothing to show each seat's turn position from.
   */
  nextFirstTurn: number;
  /** How many seat-less watchers are currently attached. */
  spectators: number;
}

export interface SeatView {
  index: number;
  seat: SeatDirection;
  name: string;
  kind: 'human' | 'cpu';
  connection: SeatConnection;
}

/**
 * Strips `tokenHash` and anything else the client has no business seeing.
 * Every outbound room payload goes through here - there is no other path.
 *
 * `spectators` is a live connection count rather than stored state, so the hub
 * supplies it at broadcast time.
 */
export function toRoomView(record: RoomRecord, spectators = 0): RoomView {
  return {
    roomId: record.roomId,
    code: record.code,
    status: record.status,
    gameVersion: record.gameVersion,
    playerCount: record.playerCount,
    aiLevel: record.aiLevel,
    fillWithCpu: record.fillWithCpu,
    hostSeat: record.hostSeat,
    seats: record.seats.map((s) => ({
      index: s.index,
      seat: s.seat,
      name: s.name,
      kind: s.kind,
      connection: s.connection,
    })),
    game: record.game,
    moveLog: record.moveLog,
    nextFirstTurn: nextFirstTurn(record),
    spectators,
  };
}
