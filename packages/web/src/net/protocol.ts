/**
 * Client-side mirror of the server wire protocol.
 *
 * The web bundle deliberately does not import `@quoridor/server`: that package
 * pulls in Fastify, Azure SDKs and `ws`. Only the engine types are shared.
 */
import type { GameState, Move, PlayerCount, SeatDirection } from '@quoridor/engine';

export const PROTOCOL_VERSION = 1;

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
}

export type ClientMessage =
  | {
      type: 'room.create';
      rid?: number;
      playerCount: PlayerCount;
      aiLevel: AiLevel;
      fillWithCpu: boolean;
      name: string;
    }
  | { type: 'room.join'; rid?: number; code: string; name: string }
  | { type: 'room.reconnect'; rid?: number; code: string; playerToken: string; lastGameVersion?: number }
  | { type: 'room.start'; rid?: number }
  | { type: 'room.leave'; rid?: number }
  | { type: 'game.move'; rid?: number; expectedGameVersion: number; move: Move }
  | { type: 'ping'; rid?: number };

export type ServerMessage =
  | { type: 'hello'; protocolVersion: number; serverTime: number }
  | { type: 'joined'; rid?: number; roomId: string; code: string; seatIndex: number; playerToken: string }
  | { type: 'room.state'; rid?: number; room: RoomView }
  | { type: 'game.state'; rid?: number; room: RoomView }
  | { type: 'game.over'; room: RoomView; winner: number }
  | { type: 'error'; rid?: number; code: ErrorCode; message: string }
  | { type: 'pong'; rid?: number; serverTime: number };
