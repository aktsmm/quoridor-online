import type { Move, PlayerCount } from '@quoridor/engine';
import { Connection, type ConnectionStatus } from '../net/connection.js';
import {
  FEATURE_FIRST_TURN,
  PROTOCOL_VERSION,
  type AiLevel,
  type ClientMessage,
  type ErrorCode,
  type RoomView,
  type ServerMessage,
} from '../net/protocol.js';
import { clearCredentials, loadCredentials, saveCredentials, type Credentials } from './storage.js';

export type Screen = 'home' | 'lobby' | 'game';

export type SessionRole = 'player' | 'spectator';

/** A player reaching home or giving up, announced while the game carries on. */
export interface FinishNotice {
  readonly player: number;
  readonly reason: 'goal' | 'resign';
  /** Timestamp so a repeat of the same seat still restarts the banner timer. */
  readonly at: number;
}

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
  /** Somebody just left the board; shown briefly while the game carries on. */
  readonly notice: FinishNotice | null;
  /**
   * True once the connected server has advertised the turn-order capability.
   *
   * Drives whether the setup form offers the choice at all: against a server
   * that has not been rolled out yet the option is hidden rather than shown
   * and quietly ignored.
   */
  readonly canChooseFirstTurn: boolean;
}

export interface CreateOptions {
  playerCount: PlayerCount;
  aiLevel: AiLevel;
  fillWithCpu: boolean;
  name: string;
  /**
   * Where the host wants to be in the move order, 1-based, or null for a
   * random draw. Dropped entirely if the server has not advertised support.
   */
  hostPosition?: number | null;
  /** Solo-vs-CPU: skip the lobby and deal straight away. */
  autoStart?: boolean;
}

/** The subset of `Connection` the store drives; a seam for tests. */
export interface ConnectionLike {
  connect(): void;
  close(): void;
  retryNow(): void;
  nextRid(): number;
  send(message: ClientMessage): boolean;
}

export interface ConnectionEventsLike {
  onStatus: (status: ConnectionStatus, retryAt: number | null) => void;
  onMessage: (message: ServerMessage) => void;
  onOpen: (attempt: number) => void;
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
  notice: null,
  canChooseFirstTurn: false,
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
  #connection: ConnectionLike;
  #credentials: Credentials | null = loadCredentials();
  /** Last state the server actually confirmed; the rollback target. */
  #serverRoom: RoomView | null = null;
  #started = false;
  /** Set by a solo-vs-CPU create so the lobby is dealt without a tap. */
  #autoStart = false;
  /** Capabilities of the currently connected server, from its `hello`. */
  #features: readonly string[] = [];

  constructor(makeConnection?: (events: ConnectionEventsLike) => ConnectionLike) {
    const events: ConnectionEventsLike = {
      onStatus: (status, retryAt) => {
        // A new socket may land on a different replica - or a different build
        // of the server - so anything it told us last time is stale.
        if (status !== 'open') this.#features = [];
        this.#patch({
          status,
          retryAt,
          ...(status === 'open' ? {} : { greeted: false, canChooseFirstTurn: false }),
        });
      },
      onMessage: (message) => this.#handle(message),
      onOpen: () => this.#resume(),
    };
    this.#connection = makeConnection ? makeConnection(events) : new Connection(events);
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
    const hostPosition = options.hostPosition ?? null;
    // An older server validates with `additionalProperties: false`, so sending
    // this blind would get the whole frame rejected rather than the field
    // ignored. Omit it unless the capability was advertised.
    const wanted =
      hostPosition !== null && this.#features.includes(FEATURE_FIRST_TURN)
        ? { hostPosition }
        : {};
    this.#send({
      type: 'room.create',
      rid: this.#connection.nextRid(),
      playerCount: options.playerCount,
      aiLevel: options.aiLevel,
      fillWithCpu: options.fillWithCpu,
      name: options.name,
      ...wanted,
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

  dismissNotice(): void {
    this.#patch({ notice: null });
  }

  /** Gives up the game. Only offered once every wall has been spent. */
  resign(): void {
    const room = this.#snapshot.room;
    if (!room?.game) return;
    this.#patch({ busy: true, error: null });
    this.#send({
      type: 'game.move',
      rid: this.#connection.nextRid(),
      expectedGameVersion: room.gameVersion,
      move: { type: 'resign' },
    });
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
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          this.#connection.close();
          this.#patch({
            greeted: false,
            busy: false,
            error: {
              code: 'protocol-mismatch',
              message: `expected protocol ${PROTOCOL_VERSION}, got ${message.protocolVersion}`,
            },
          });
          return;
        }
        // A server built before capabilities existed simply omits the list.
        this.#features = Array.isArray(message.features) ? message.features : [];
        this.#patch({
          greeted: true,
          canChooseFirstTurn: this.#features.includes(FEATURE_FIRST_TURN),
        });
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

      case 'game.finished': {
        this.#serverRoom = message.room;
        this.#patch({
          room: message.room,
          optimistic: false,
          busy: false,
          error: null,
          notice: { player: message.player, reason: message.reason, at: Date.now() },
        });
        return;
      }

      case 'room.state':
      case 'game.state':
      case 'game.over': {
        this.#serverRoom = message.room;
        this.#patch({
          room: message.room,
          optimistic: false,
          busy: false,
          error: null,
          // A fresh deal has nobody to announce, so drop any leftover banner.
          ...(message.room.game?.completions.length ? {} : { notice: null }),
        });
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
    this.#patch({ room: null, seatIndex: null, role: 'player', optimistic: false, busy: false, error: null, notice: null });
  }

  #send(message: ClientMessage): boolean {
    const sent = this.#connection.send(message);
    if (!sent) this.#patch({ busy: false });
    return sent;
  }

  #patch(partial: Partial<SessionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...partial };
    for (const listener of this.#listeners) listener();
  }
}
