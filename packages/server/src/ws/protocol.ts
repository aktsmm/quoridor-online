import type { GameState, Move, PlayerCount, SeatDirection } from '@quoridor/engine';
import type { AiLevel } from '@quoridor/ai';
import type { RoomErrorCode } from '../rooms/manager.js';
import type { RoomRecord, RoomStatus, SeatConnection } from '../rooms/record.js';

/** Client -> server. Every message carries an optional correlation id. */
export type ClientMessage =
  | { type: 'room.create'; rid?: number; playerCount: PlayerCount; aiLevel: AiLevel; fillWithCpu: boolean; name: string }
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
  | { type: 'hello'; protocolVersion: number; serverTime: number }
  | { type: 'joined'; rid?: number; roomId: string; code: string; seatIndex: number; playerToken: string }
  | { type: 'watching'; rid?: number; roomId: string; code: string }
  | { type: 'room.state'; rid?: number; room: RoomView }
  | { type: 'game.state'; rid?: number; room: RoomView }
  | { type: 'game.over'; room: RoomView; winner: number }
  | { type: 'error'; rid?: number; code: RoomErrorCode | 'rate-limited' | 'bad-message' | 'internal'; message: string }
  | { type: 'pong'; rid?: number; serverTime: number };

export const PROTOCOL_VERSION = 1;

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
    spectators,
  };
}
