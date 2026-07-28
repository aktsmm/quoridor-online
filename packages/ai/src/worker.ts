import { parentPort } from 'node:worker_threads';
import { chooseMove } from './index.js';
import type { ChooseMoveOptions } from './types.js';

/**
 * Worker entry point.
 *
 * Search always runs here rather than on the main thread: on a 0.25 vCPU
 * container a blocking alpha-beta would stall the event loop badly enough that
 * even the search's own deadline timer would not fire.
 */
export interface WorkerRequest {
  id: number;
  options: Omit<ChooseMoveOptions, 'now'>;
}

export type WorkerResponse =
  | { id: number; ok: true; decision: ReturnType<typeof chooseMove> }
  | { id: number; ok: false; error: string };

if (parentPort) {
  const port = parentPort;
  port.on('message', (request: WorkerRequest) => {
    try {
      port.postMessage({
        id: request.id,
        ok: true,
        decision: chooseMove(request.options),
      } satisfies WorkerResponse);
    } catch (error) {
      port.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerResponse);
    }
  });
}
