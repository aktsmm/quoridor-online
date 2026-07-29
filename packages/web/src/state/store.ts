import type { Move, PlayerCount } from '@quoridor/engine';
import { Connection, type ConnectionStatus } from '../net/connection.js';
import type { AiLevel, ErrorCode, RoomView, ServerMessage } from '../net/protocol.js';
import { clearCredentials, loadCredentials, saveCredentials, type Credentials } from './storage.js';

export type Screen = 'home' | 'lobby' | 'game';

export type SessionRole = 'player' | 'spectator';

export interface SessionSnapshot {
  readonly status: ConnectionStatus;
  readonly retryAt: number | null;
  /** True once the server has answered anything at all on this connection. */
  readonly greeted: boolean;
  readonly room: RoomView | null;
  readonly seatIndex: number | null;
  /** Watchers receive every broadcast but can never act. */
  readonly role: SessionRole;
  readonly error: { code: ErrorCode; message: string } | null;
  readonly busy: boolean;
  /** Set while the local player's move is shown before the server confirms it. */
  readonly optimistic: boolean;
}

export interface CreateOptions {
  playerCount: PlayerCount;
  aiLevel: AiLevel;
  fillWithCpu: boolean;
  name: string;
  /** Solo-vs-CPU: skip the lobby and deal straight away. */
  autoStart?: boolean;
}

type Listener = () => void;

const EMPTY: SessionSnapshot = {
  status: 'idle',
  retryAt: null,
  greeted: false,
  room: null,
  seatIndex: null,
  role: 'player',
  error: null,
  busy: false,
  optimistic: false,
};

/**
 * Owns the socket, the room state and the resume credentials.
 *
 * Kept outside React so reconnects, retries and optimistic rollbacks are not at
 * the mercy of render timing or stale closures; components just subscribe.
 */
export class SessionStore {
  #snapshot: SessionSnapshot = EMPTY;
  #listeners = new Set<Listener>();
  #connection: Connection;
  #credentials: Credentials | null = loadCredentials();
  /** Last state the server actually confirmed; the rollback target. */
  #serverRoom: RoomView | null = null;
  #started = false;
  /** Set by a solo-vs-CPU create so the lobby is dealt without a tap. */
  #autoStart = false;

  constructor() {
    this.#connection = new Connection({
      onStatus: (status, retryAt) => {
        this.#patch({ status, retryAt, ...(status === 'open' ? {} : { greeted: false }) });
      },
      onMessage: (message) => this.#handle(message),
      onOpen: () => this.#resume(),
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.#snapshot;

  /** Idempotent: React 19 StrictMode mounts effects twice in development. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#connection.connect();
  }

  stop(): void {
    this.#started = false;
    this.#connection.close();
  }

  retryNow(): void {
    this.#connection.retryNow();
  }

  get screen(): Screen {
    const room = this.#snapshot.room;
    if (!room) return 'home';
    return room.status === 'lobby' ? 'lobby' : 'game';
  }

  /** True when this client holds a seat that is still ours to play. */
  get isSeated(): boolean {
    return this.#snapshot.seatIndex !== null;
  }

  createRoom(options: CreateOptions): void {
    this.#autoStart = options.autoStart === true;
    this.#patch({ busy: true, error: null });
    this.#send({
      type: 'room.create',
      rid: this.#connection.nextRid(),
      playerCount: options.playerCount,
      aiLevel: options.aiLevel,
      fillWithCpu: options.fillWithCpu,
      name: options.name,
    });
  }

  joinRoom(code: string, name: string): void {
    this.#autoStart = false;
    this.#patch({ busy: true, error: null });
    this.#send({ type: 'room.join', rid: this.#connection.nextRid(), code, name });
  }

  /** Watch-only: no name, no seat, and every action stays disabled. */
  watchRoom(code: string): void {
    this.#autoStart = false;
    this.#patch({ busy: true, error: null, role: 'spectator', seatIndex: null });
    this.#send({ type: 'room.watch', rid: this.#connection.nextRid(), code });
  }

  startGame(): void {
    this.#autoStart = false;
    this.#patch({ busy: true, error: null });
    this.#send({ type: 'room.start', rid: this.#connection.nextRid() });
  }

  /** Deals the next game without breaking up the table. Host only. */
  rematch(): void {
    this.#autoStart = false;
    this.#patch({ busy: true, error: null });
    this.#send({ type: 'room.rematch', rid: this.#connection.nextRid() });
  }

  leaveRoom(): void {
    this.#send({ type: 'room.leave', rid: this.#connection.nextRid() });
    this.#forgetRoom();
  }

  dismissError(): void {
    this.#patch({ error: null });
  }

  /**
   * Applies the move locally first so the board responds to the tap, then lets
   * the server's broadcast overwrite it. Any error rolls straight back.
   */
  makeMove(move: Move, nextRoom: RoomView): void {
    const room = this.#snapshot.room;
    if (!room?.game) return;
    this.#patch({ room: nextRoom, optimistic: true, error: null });
    const sent = this.#send({
      type: 'game.move',
      rid: this.#connection.nextRid(),
      expectedGameVersion: room.gameVersion,
      move,
    });
    if (!sent) this.#rollback();
  }

  #resume(): void {
    const credentials = this.#credentials;
    if (!credentials) return;
    if (credentials.spectator === true) {
      this.#send({ type: 'room.watch', rid: this.#connection.nextRid(), code: credentials.code });
      return;
    }
    this.#send({
      type: 'room.reconnect',
      rid: this.#connection.nextRid(),
      code: credentials.code,
      playerToken: credentials.playerToken,
      lastGameVersion: this.#serverRoom?.gameVersion ?? 0,
    });
  }

  #handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.#patch({ greeted: true });
        return;

      case 'joined': {
        this.#credentials = {
          roomId: message.roomId,
          code: message.code,
          playerToken: message.playerToken,
        };
        saveCredentials(this.#credentials);
        this.#patch({ seatIndex: message.seatIndex, role: 'player', busy: false });
        return;
      }

      case 'watching': {
        this.#credentials = {
          roomId: message.roomId,
          code: message.code,
          playerToken: '',
          spectator: true,
        };
        saveCredentials(this.#credentials);
        this.#patch({ seatIndex: null, role: 'spectator', busy: false });
        return;
      }

      case 'room.state':
      case 'game.state':
      case 'game.over': {
        this.#serverRoom = message.room;
        this.#patch({ room: message.room, optimistic: false, busy: false, error: null });
        // The server turns the empty seats into CPUs on start, so solo play can
        // deal itself the moment the lobby lands rather than showing a code the
        // player never needed.
        if (this.#autoStart && message.room.status === 'lobby') {
          if (message.room.hostSeat === this.#snapshot.seatIndex) this.startGame();
        }
        return;
      }

      case 'error': {
        // A stale version just means someone moved first; the next broadcast is
        // authoritative, so roll the optimistic board back and stay quiet.
        this.#rollback();
        this.#patch({
          busy: false,
          error: { code: message.code, message: message.message },
        });
        if (message.code === 'room-unavailable') this.#forgetRoom();
        return;
      }

      case 'pong':
        return;
    }
  }

  #rollback(): void {
    if (!this.#snapshot.optimistic) return;
    this.#patch({ room: this.#serverRoom, optimistic: false });
  }

  #forgetRoom(): void {
    this.#credentials = null;
    this.#serverRoom = null;
    this.#autoStart = false;
    clearCredentials();
    this.#patch({ room: null, seatIndex: null, role: 'player', optimistic: false, busy: false, error: null });
  }

  #send(message: Parameters<Connection['send']>[0]): boolean {
    const sent = this.#connection.send(message);
    if (!sent) this.#patch({ busy: false });
    return sent;
  }

  #patch(partial: Partial<SessionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...partial };
    for (const listener of this.#listeners) listener();
  }
}
