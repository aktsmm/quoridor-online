/**
 * Client-side mirror of the server wire protocol.
 *
 * The web bundle deliberately does not import `@quoridor/server`: that package
 * pulls in Fastify, Azure SDKs and `ws`. Only the engine types are shared.
 */
import type { GameState, Move, PlayerCount, SeatDirection } from '@quoridor/engine';

export const PROTOCOL_VERSION = 3;

/**
 * Capability the server advertises in `hello` once it understands
 * `room.create.hostPosition`.
 *
 * The front end (Static Web Apps) and the server (Container Apps) are shipped
 * by separate workflows, so a new bundle can be live while the server is still
 * the previous build. That server validates inbound frames with
 * `additionalProperties: false` and would reject the whole message, not just
 * the unknown field - so the field is only ever sent after the capability has
 * actually been seen.
 */
export const FEATURE_FIRST_TURN = 'first-turn';

export type AiLevel = 'easy' | 'normal' | 'hard';
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type SeatConnection = 'empty' | 'connected' | 'disconnected' | 'cpu-controlled';

export type ErrorCode =
  | 'room-unavailable'
  | 'not-host'
  | 'already-started'
  | 'not-your-turn'
  | 'illegal-move'
  | 'version-conflict'
  | 'capacity'
  | 'invalid-request'
  | 'rate-limited'
  | 'bad-message'
  | 'protocol-mismatch'
  | 'internal';

export interface SeatView {
  index: number;
  seat: SeatDirection;
  name: string;
  kind: 'human' | 'cpu';
  connection: SeatConnection;
}

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
   * Seat that opens the next game, 0-based. Optional because a server built
   * before turn selection does not send it - the lobby simply omits the turn
   * order in that case.
   */
  nextFirstTurn?: number;
  /** How many seat-less watchers are currently attached. */
  spectators: number;
}

/**
 * Where a seat sits in the move order, 1-based, given the seat that opens.
 * Play runs clockwise from the opener, which is the order `turn` advances in.
 */
export function turnPosition(seatIndex: number, firstTurn: number, playerCount: number): number {
  return (((seatIndex - firstTurn) % playerCount) + playerCount) % playerCount + 1;
}

export type ClientMessage =
  | {
      type: 'room.create';
      rid?: number;
      playerCount: PlayerCount;
      aiLevel: AiLevel;
      fillWithCpu: boolean;
      name: string;
      /** 1-based position in the move order for the host; omitted means random. */
      hostPosition?: number;
    }
  | { type: 'room.join'; rid?: number; code: string; name: string }
  | { type: 'room.watch'; rid?: number; code: string }
  | { type: 'room.reconnect'; rid?: number; code: string; playerToken: string; lastGameVersion?: number }
  | { type: 'room.start'; rid?: number }
  | { type: 'room.rematch'; rid?: number }
  | { type: 'room.leave'; rid?: number }
  | { type: 'game.move'; rid?: number; expectedGameVersion: number; move: Move }
  | { type: 'ping'; rid?: number };

export type ServerMessage =
  | { type: 'hello'; protocolVersion: number; serverTime: number; features?: string[] }
  | { type: 'joined'; rid?: number; roomId: string; code: string; seatIndex: number; playerToken: string }
  | { type: 'watching'; rid?: number; roomId: string; code: string }
  | { type: 'room.state'; rid?: number; room: RoomView }
  | { type: 'game.state'; rid?: number; room: RoomView }
  | { type: 'game.finished'; room: RoomView; player: number; reason: 'goal' | 'resign' }
  | { type: 'game.over'; room: RoomView; winner: number; placings: number[] }
  | { type: 'error'; rid?: number; code: ErrorCode; message: string }
  | { type: 'pong'; rid?: number; serverTime: number };
