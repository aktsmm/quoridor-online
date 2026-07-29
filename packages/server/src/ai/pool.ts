import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { legalMoves, type GameState, type Move } from '@quoridor/engine';
import {
  SearchPosition,
  chooseGreedyMove,
  chooseMove,
  makeRng,
  type AiDecision,
  type AiLevel,
} from '@quoridor/ai';
import type { WorkerRequest, WorkerResponse } from '@quoridor/ai/worker';

export interface AiRequest {
  state: GameState;
  level: AiLevel;
  playerIndex: number;
  timeBudgetMs: number;
  seed?: number;
}

export interface AiPool {
  think(request: AiRequest): Promise<AiDecision>;
  close(): Promise<void>;
}

interface Pending {
  resolve: (decision: AiDecision) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * A single worker thread with a request queue.
 *
 * One worker is deliberate: the container has 0.25 vCPU, so two concurrent
 * searches would just make both slower and starve the socket handling.
 */
export class WorkerAiPool implements AiPool {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;

  constructor(workerUrl: URL) {
    this.#worker = new Worker(workerUrl);
    this.#worker.unref();
    this.#worker.on('message', (message: WorkerResponse) => {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.decision);
      else pending.reject(new Error(message.error));
    });
    this.#worker.on('error', (error) => this.#failAll(error));
    this.#worker.on('exit', (code) => {
      if (!this.#closed) this.#failAll(new Error(`ai worker exited with code ${code}`));
    });
  }

  static create(): WorkerAiPool {
    return new WorkerAiPool(resolveWorkerUrl());
  }

  think(request: AiRequest): Promise<AiDecision> {
    if (this.#closed) return Promise.reject(new Error('ai pool is closed'));
    const id = this.#nextId++;
    return new Promise<AiDecision>((resolve, reject) => {
      // Generous relative to the budget: if the worker blows through it
      // something is wrong and the caller should fall back, not hang.
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('ai worker timed out'));
      }, request.timeBudgetMs * 4 + 5_000);
      timer.unref();
      this.#pending.set(id, { resolve, reject, timer });

      const message: WorkerRequest = {
        id,
        options: {
          state: request.state,
          level: request.level,
          playerIndex: request.playerIndex,
          timeBudgetMs: request.timeBudgetMs,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      };
      this.#worker.postMessage(message);
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#failAll(new Error('ai pool is closing'));
    await this.#worker.terminate();
  }
}

/** Same interface, no threads. Used by tests to keep them deterministic. */
export class InlineAiPool implements AiPool {
  think(request: AiRequest): Promise<AiDecision> {
    return Promise.resolve(
      chooseMove({
        state: request.state,
        level: request.level,
        playerIndex: request.playerIndex,
        timeBudgetMs: request.timeBudgetMs,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Last-resort move so a CPU seat can never stall the game, even if the worker
 * crashed or returned something unusable.
 *
 * The greedy engine costs one breadth-first sweep and always walks towards its
 * goal, so a worker failure looks like a weak move rather than a nonsense one.
 * The very first legal move is kept as the final backstop.
 */
export function fallbackMove(state: GameState, playerIndex: number): Move | null {
  if (state.winner === null) {
    try {
      return chooseGreedyMove(
        SearchPosition.from(state),
        playerIndex,
        makeRng(Math.floor(Math.random() * 0xffffffff)),
      );
    } catch {
      // Fall through to the dumb answer below.
    }
  }
  const moves = legalMoves(state, playerIndex);
  return moves[0] ?? null;
}

function resolveWorkerUrl(): URL {
  const require = createRequire(import.meta.url);
  // `pathToFileURL` rather than `new URL(path, 'file:')`: on Windows a bare
  // "C:\..." would otherwise be read as a URL with a "c:" scheme.
  return pathToFileURL(require.resolve('@quoridor/ai/worker'));
}
