import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryRoomStore, type RoomStore } from './rooms/store.js';
import { TableRoomStore } from './rooms/tableStore.js';
import { WorkerAiPool } from './ai/pool.js';
import type { HubLogger } from './ws/hub.js';

const logger: HubLogger = {
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
  error: (message, fields) => log('error', message, fields),
};

function log(level: string, message: string, fields?: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ level, message, ...fields, time: new Date().toISOString() })}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store: RoomStore =
    config.storage.kind === 'table' ? TableRoomStore.fromConfig(config.storage) : new MemoryRoomStore();

  if (config.storage.kind === 'memory') {
    logger.warn('using in-memory room store; rooms will not survive a restart');
  }

  const app = createApp({ config, store, ai: WorkerAiPool.create(), logger });
  const port = await app.listen();
  logger.info('listening', { port, storage: config.storage.kind, origins: config.allowedOrigins.length });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    // Sockets are closed with 1012 so clients reconnect straight away, and the
    // room snapshots are already durable, so nothing is lost in the swap.
    void app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error('shutdown failed', { error: String(error) });
        process.exit(1);
      });
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  log('error', 'failed to start', { error: error instanceof Error ? error.stack : String(error) });
  process.exit(1);
});
