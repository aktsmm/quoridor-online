import type { WebSocket } from 'ws';
import { isAiLevel } from '@quoridor/ai';
import type { ServerConfig } from '../config.js';
import { ConcurrencyLimiter, RateLimiter } from '../ratelimit.js';
import { RoomError, isCpuToMove, seatToMove } from '../rooms/manager.js';
import type { RoomManager } from '../rooms/manager.js';
import type { StoredRoom } from '../rooms/record.js';
import { fallbackMove, type AiPool } from '../ai/pool.js';
import { PROTOCOL_VERSION, toRoomView, type ClientMessage, type ServerMessage } from './protocol.js';
import { parseClientMessage, sanitiseName } from './schema.js';

/** Sent when the process is going away but the client should come straight back. */
export const CLOSE_RESTARTING = 1012;
export const CLOSE_POLICY = 1008;
/** Our own code for "you were replaced by a newer session for this seat". */
export const CLOSE_SUPERSEDED = 4001;

export interface ClientState {
  socket: WebSocket;
  ip: string;
  roomId: string | null;
  seatIndex: number | null;
  pending: number;
  alive: boolean;
}

export interface HubLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const silentLogger: HubLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Fan-out and message handling.
 *
 * The hub owns no game state of its own: everything authoritative lives in the
 * room store, and the hub only mirrors the results of accepted mutations out to
 * the sockets that care.
 */
export class Hub {
  readonly #config: ServerConfig;
  readonly #manager: RoomManager;
  readonly #ai: AiPool;
  readonly #log: HubLogger;

  readonly #clients = new Set<ClientState>();
  readonly #byRoom = new Map<string, Set<ClientState>>();
  readonly #thinking = new Set<string>();

  readonly #ipConnections: ConcurrencyLimiter;
  readonly #createLimiter: RateLimiter;
  readonly #joinFailureLimiter: RateLimiter;
  readonly #moveLimiter: RateLimiter;
  readonly #messageLimiter: RateLimiter;

  #shuttingDown = false;

  constructor(options: {
    config: ServerConfig;
    manager: RoomManager;
    ai: AiPool;
    logger?: HubLogger;
  }) {
    this.#config = options.config;
    this.#manager = options.manager;
    this.#ai = options.ai;
    this.#log = options.logger ?? silentLogger;

    const limits = options.config.limits;
    this.#ipConnections = new ConcurrencyLimiter(limits.maxConnectionsPerIp);
    this.#createLimiter = new RateLimiter(limits.createRoom);
    this.#joinFailureLimiter = new RateLimiter(limits.joinFailure);
    this.#moveLimiter = new RateLimiter(limits.move);
    this.#messageLimiter = new RateLimiter(limits.message);
  }

  get connectionCount(): number {
    return this.#clients.size;
  }

  handleConnection(socket: WebSocket, ip: string): void {
    if (this.#shuttingDown || this.#clients.size >= this.#config.limits.maxConnections) {
      socket.close(CLOSE_POLICY, 'server busy');
      return;
    }
    if (!this.#ipConnections.acquire(ip)) {
      socket.close(CLOSE_POLICY, 'too many connections');
      return;
    }

    const client: ClientState = { socket, ip, roomId: null, seatIndex: null, pending: 0, alive: true };
    this.#clients.add(client);

    socket.on('message', (data) => {
      void this.#onMessage(client, typeof data === 'string' ? data : data.toString());
    });
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('error', () => socket.close());
    socket.on('close', () => {
      void this.#onClose(client);
    });

    this.#send(client, { type: 'hello', protocolVersion: PROTOCOL_VERSION, serverTime: Date.now() });
  }

  async #onMessage(client: ClientState, raw: string): Promise<void> {
    if (!this.#messageLimiter.tryConsume(client.ip)) {
      this.#sendError(client, 'rate-limited', 'slow down');
      return;
    }
    if (client.pending >= this.#config.limits.maxPendingPerSocket) {
      this.#sendError(client, 'rate-limited', 'too many requests in flight');
      return;
    }

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.#sendError(client, 'bad-message', parsed.reason, parsed.rid);
      return;
    }

    client.pending += 1;
    try {
      await this.#dispatch(client, parsed.message);
    } catch (error) {
      if (error instanceof RoomError) {
        this.#sendError(client, error.code, error.message, parsed.message.rid);
      } else {
        this.#log.error('handler failed', {
          type: parsed.message.type,
          error: error instanceof Error ? error.message : String(error),
        });
        this.#sendError(client, 'internal', 'something went wrong', parsed.message.rid);
      }
    } finally {
      client.pending -= 1;
    }
  }

  async #dispatch(client: ClientState, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'ping':
        this.#send(client, { type: 'pong', serverTime: Date.now(), ...ridOf(message) });
        return;

      case 'room.create': {
        if (!this.#createLimiter.tryConsume(client.ip)) throw new RoomError('capacity', 'too many rooms');
        if (!isAiLevel(message.aiLevel)) throw new RoomError('invalid-request');
        const grant = await this.#manager.createRoom({
          playerCount: message.playerCount,
          aiLevel: message.aiLevel,
          fillWithCpu: message.fillWithCpu,
          name: sanitiseName(message.name, 'Player 1'),
        });
        this.#attach(client, grant.stored.record.roomId, grant.seatIndex);
        this.#send(client, {
          type: 'joined',
          roomId: grant.stored.record.roomId,
          code: grant.stored.record.code,
          seatIndex: grant.seatIndex,
          playerToken: grant.playerToken,
          ...ridOf(message),
        });
        this.#broadcast(grant.stored);
        return;
      }

      case 'room.join': {
        let grant;
        try {
          grant = await this.#manager.joinRoom(
            message.code,
            sanitiseName(message.name, `Player ${client.ip.length % 4 + 1}`),
          );
        } catch (error) {
          // Failures are metered so the 6-digit space cannot be swept.
          this.#joinFailureLimiter.tryConsume(client.ip);
          throw error;
        }
        this.#attach(client, grant.stored.record.roomId, grant.seatIndex);
        this.#send(client, {
          type: 'joined',
          roomId: grant.stored.record.roomId,
          code: grant.stored.record.code,
          seatIndex: grant.seatIndex,
          playerToken: grant.playerToken,
          ...ridOf(message),
        });
        this.#broadcast(grant.stored);
        return;
      }

      case 'room.reconnect': {
        let result;
        try {
          result = await this.#manager.reconnect(message.code, message.playerToken);
        } catch (error) {
          this.#joinFailureLimiter.tryConsume(client.ip);
          throw error;
        }
        // A seat has exactly one live socket; the newest wins.
        this.#evictSeat(result.stored.record.roomId, result.seatIndex, client);
        this.#attach(client, result.stored.record.roomId, result.seatIndex);
        this.#send(client, {
          type: 'joined',
          roomId: result.stored.record.roomId,
          code: result.stored.record.code,
          seatIndex: result.seatIndex,
          playerToken: message.playerToken,
          ...ridOf(message),
        });
        this.#broadcast(result.stored);
        void this.#driveCpu(result.stored.record.roomId);
        return;
      }

      case 'room.start': {
        const { roomId, seatIndex } = this.#requireSeat(client);
        const stored = await this.#manager.start(roomId, seatIndex);
        this.#broadcast(stored);
        void this.#driveCpu(roomId);
        return;
      }

      case 'room.leave': {
        const { roomId, seatIndex } = this.#requireSeat(client);
        const stored = await this.#manager.leave(roomId, seatIndex);
        this.#detach(client);
        if (stored) {
          this.#broadcast(stored);
          void this.#driveCpu(roomId);
        }
        return;
      }

      case 'game.move': {
        const { roomId, seatIndex } = this.#requireSeat(client);
        if (!this.#moveLimiter.tryConsume(client.ip)) {
          throw new RoomError('capacity', 'too many moves');
        }
        const stored = await this.#manager.applyMove(
          roomId,
          seatIndex,
          message.expectedGameVersion,
          message.move,
        );
        this.#broadcast(stored, ridOf(message).rid);
        void this.#driveCpu(roomId);
        return;
      }
    }
  }

  #requireSeat(client: ClientState): { roomId: string; seatIndex: number } {
    if (client.roomId === null || client.seatIndex === null) {
      throw new RoomError('invalid-request', 'join a room first');
    }
    return { roomId: client.roomId, seatIndex: client.seatIndex };
  }

  #attach(client: ClientState, roomId: string, seatIndex: number): void {
    this.#detach(client);
    client.roomId = roomId;
    client.seatIndex = seatIndex;
    let set = this.#byRoom.get(roomId);
    if (!set) {
      set = new Set();
      this.#byRoom.set(roomId, set);
    }
    set.add(client);
  }

  #detach(client: ClientState): void {
    if (client.roomId === null) return;
    const set = this.#byRoom.get(client.roomId);
    set?.delete(client);
    if (set && set.size === 0) this.#byRoom.delete(client.roomId);
    client.roomId = null;
    client.seatIndex = null;
  }

  #evictSeat(roomId: string, seatIndex: number, keep: ClientState): void {
    const set = this.#byRoom.get(roomId);
    if (!set) return;
    for (const other of [...set]) {
      if (other === keep || other.seatIndex !== seatIndex) continue;
      this.#detach(other);
      other.socket.close(CLOSE_SUPERSEDED, 'seat taken over by a newer session');
    }
  }

  async #onClose(client: ClientState): Promise<void> {
    this.#clients.delete(client);
    this.#ipConnections.release(client.ip);
    const roomId = client.roomId;
    const seatIndex = client.seatIndex;
    this.#detach(client);
    if (roomId === null || seatIndex === null || this.#shuttingDown) return;

    try {
      const stored = await this.#manager.markDisconnected(roomId, seatIndex);
      if (stored) this.#broadcast(stored);
    } catch (error) {
      this.#log.warn('disconnect bookkeeping failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Plays out every consecutive CPU turn.
   *
   * The AI's answer is applied with the game version it was computed against,
   * so a result that arrives after a human has already moved is dropped rather
   * than clobbering the newer position.
   */
  async #driveCpu(roomId: string): Promise<void> {
    if (this.#thinking.has(roomId)) return;
    this.#thinking.add(roomId);
    try {
      for (;;) {
        const stored = await this.#manager.get(roomId);
        if (!stored) return;
        const record = stored.record;
        if (record.status !== 'playing' || !record.game) return;
        if (!isCpuToMove(record)) return;

        const seat = seatToMove(record);
        if (!seat) return;

        const version = record.gameVersion;
        const startedAt = Date.now();
        let move;
        try {
          const decision = await this.#ai.think({
            state: record.game,
            level: record.aiLevel,
            playerIndex: seat.index,
            timeBudgetMs: this.#config.aiTimeBudgetMs,
          });
          move = decision.move;
        } catch (error) {
          this.#log.warn('ai failed, using fallback', {
            error: error instanceof Error ? error.message : String(error),
          });
          move = fallbackMove(record.game, seat.index);
        }
        if (!move) return;

        // A move that lands instantly is disorienting; give it a beat.
        const remaining = this.#config.aiMinThinkMs - (Date.now() - startedAt);
        if (remaining > 0) await delay(remaining);
        if (this.#shuttingDown) return;

        try {
          const next = await this.#manager.applyMove(roomId, seat.index, version, move);
          this.#broadcast(next);
        } catch (error) {
          if (error instanceof RoomError && error.code === 'version-conflict') return;
          if (error instanceof RoomError && error.code === 'room-unavailable') return;
          throw error;
        }
      }
    } catch (error) {
      this.#log.error('cpu driver stopped', {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#thinking.delete(roomId);
    }
  }

  /** Pushes the accepted state to everyone in the room. */
  #broadcast(stored: StoredRoom, rid?: number): void {
    const set = this.#byRoom.get(stored.record.roomId);
    if (!set || set.size === 0) return;

    const room = toRoomView(stored.record);
    const message: ServerMessage =
      stored.record.status === 'lobby'
        ? { type: 'room.state', room }
        : { type: 'game.state', room };

    for (const client of set) {
      this.#send(client, client.seatIndex !== null && rid !== undefined ? { ...message, rid } : message);
    }

    const winner = stored.record.game?.winner;
    if (stored.record.status === 'finished' && winner !== null && winner !== undefined) {
      const over: ServerMessage = { type: 'game.over', room, winner };
      for (const client of set) this.#send(client, over);
    }
  }

  #send(client: ClientState, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }

  #sendError(
    client: ClientState,
    code: Extract<ServerMessage, { type: 'error' }>['code'],
    message: string,
    rid?: number,
  ): void {
    this.#send(client, rid === undefined ? { type: 'error', code, message } : { type: 'error', code, message, rid });
  }

  /** Pings every socket and drops the ones that stopped answering. */
  sweepDeadConnections(): void {
    for (const client of [...this.#clients]) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
  }

  /**
   * Stops accepting work and closes every socket with a code that tells the
   * client to reconnect immediately. State is already durable, so there is
   * nothing to flush beyond finishing in-flight writes.
   */
  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    for (const client of [...this.#clients]) {
      try {
        client.socket.close(CLOSE_RESTARTING, 'server restarting');
      } catch {
        client.socket.terminate();
      }
    }
    await this.#ai.close();
  }
}

function ridOf(message: { rid?: number }): { rid?: number } {
  return message.rid === undefined ? {} : { rid: message.rid };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
