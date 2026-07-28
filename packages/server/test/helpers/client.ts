import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/ws/protocol.js';

interface Waiter {
  match: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
}

/**
 * Minimal test client: sends typed frames and lets a test await the next
 * message matching a predicate, with a real timeout so a hang fails loudly.
 */
export class TestClient {
  readonly #socket: WebSocket;
  readonly #inbox: ServerMessage[] = [];
  readonly #waiters: Waiter[] = [];
  closeInfo: { code: number; reason: string } | null = null;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const index = this.#waiters.findIndex((w) => w.match(message));
      if (index >= 0) {
        const [waiter] = this.#waiters.splice(index, 1);
        waiter!.resolve(message);
      } else {
        this.#inbox.push(message);
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
    });
  }

  static connect(url: string, origin?: string): Promise<TestClient> {
    const socket = new WebSocket(url, origin === undefined ? {} : { origin });
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new TestClient(socket)));
      socket.once('error', reject);
    });
  }

  send(message: ClientMessage): void {
    this.#socket.send(JSON.stringify(message));
  }

  sendRaw(raw: string): void {
    this.#socket.send(raw);
  }

  /** Resolves with the next (or already buffered) message that matches. */
  next(match: (message: ServerMessage) => boolean, timeoutMs = 5_000): Promise<ServerMessage> {
    const index = this.#inbox.findIndex(match);
    if (index >= 0) return Promise.resolve(this.#inbox.splice(index, 1)[0]!);

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      };
      const timer = setTimeout(() => {
        const at = this.#waiters.indexOf(waiter);
        if (at >= 0) this.#waiters.splice(at, 1);
        reject(new Error(`timed out waiting for a message; inbox: ${JSON.stringify(this.#inbox)}`));
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  nextOfType<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.next((m) => m.type === type, timeoutMs) as Promise<
      Extract<ServerMessage, { type: T }>
    >;
  }

  waitForClose(timeoutMs = 5_000): Promise<{ code: number; reason: string }> {
    if (this.closeInfo) return Promise.resolve(this.closeInfo);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
      this.#socket.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  close(): void {
    this.#socket.close();
  }
}
