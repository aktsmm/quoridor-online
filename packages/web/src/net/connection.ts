import { websocketUrl } from './endpoint.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface ConnectionEvents {
  onStatus: (status: ConnectionStatus, retryAt: number | null) => void;
  onMessage: (message: ServerMessage) => void;
  /** Fired after every successful (re)open so callers can resume their session. */
  onOpen: (attempt: number) => void;
}

const BASE_DELAY_MS = 600;
const MAX_DELAY_MS = 15_000;
const FACTOR = 1.7;
/** ±25% so a crowd of clients does not stampede a just-restarted replica. */
const JITTER = 0.25;
const HEARTBEAT_MS = 20_000;
/** Container Apps cold start has been measured at ~35 s; leave headroom. */
const OPEN_TIMEOUT_MS = 60_000;

/**
 * A WebSocket that keeps trying.
 *
 * Container Apps restarts replicas on every revision update, so a dropped
 * socket is routine rather than exceptional. Everything above this class can
 * assume the connection eventually comes back.
 */
export class Connection {
  #socket: WebSocket | null = null;
  #status: ConnectionStatus = 'idle';
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #openTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #retryAt: number | null = null;
  #closed = false;
  #rid = 0;
  readonly #events: ConnectionEvents;

  constructor(events: ConnectionEvents) {
    this.#events = events;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get isOpen(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  nextRid(): number {
    this.#rid += 1;
    return this.#rid;
  }

  connect(): void {
    this.#closed = false;
    this.#open();
  }

  /** Used by the "retry now" button and by `online` / `visibilitychange`. */
  retryNow(): void {
    if (this.#closed || this.isOpen) return;
    this.#clearRetry();
    this.#attempt = 0;
    this.#open();
  }

  send(message: ClientMessage): boolean {
    if (!this.isOpen) return false;
    this.#socket?.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.#closed = true;
    this.#clearRetry();
    this.#stopHeartbeat();
    this.#clearOpenTimer();
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close(1000, 'client closed');
    }
    this.#setStatus('idle', null);
  }

  #open(): void {
    if (this.#closed) return;
    this.#clearOpenTimer();
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting', null);

    let socket: WebSocket;
    try {
      socket = new WebSocket(websocketUrl());
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    // A socket stuck in CONNECTING never fires `close`, so cap it ourselves.
    this.#openTimer = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    }, OPEN_TIMEOUT_MS);

    socket.onopen = () => {
      this.#clearOpenTimer();
      const attempt = this.#attempt;
      this.#attempt = 0;
      this.#setStatus('open', null);
      this.#startHeartbeat();
      this.#events.onOpen(attempt);
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isServerMessage(parsed)) this.#events.onMessage(parsed);
    };

    socket.onerror = () => {
      // `close` always follows; retrying here would double-schedule.
    };

    socket.onclose = () => {
      this.#clearOpenTimer();
      this.#stopHeartbeat();
      if (this.#socket === socket) this.#socket = null;
      if (this.#closed) return;
      this.#scheduleRetry();
    };
  }

  #scheduleRetry(): void {
    this.#attempt += 1;
    const flat = Math.min(BASE_DELAY_MS * FACTOR ** (this.#attempt - 1), MAX_DELAY_MS);
    const delay = Math.round(flat * (1 + (Math.random() * 2 - 1) * JITTER));
    this.#retryAt = Date.now() + delay;
    this.#setStatus(this.#attempt <= 1 ? 'reconnecting' : 'offline', this.#retryAt);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#open();
    }, delay);
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#retryAt = null;
  }

  #clearOpenTimer(): void {
    if (this.#openTimer !== null) {
      clearTimeout(this.#openTimer);
      this.#openTimer = null;
    }
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    this.#heartbeat = setInterval(() => {
      this.send({ type: 'ping', rid: this.nextRid() });
    }, HEARTBEAT_MS);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
  }

  #setStatus(status: ConnectionStatus, retryAt: number | null): void {
    this.#status = status;
    this.#retryAt = retryAt;
    this.#events.onStatus(status, retryAt);
  }
}

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
