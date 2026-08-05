import { createServer, type IncomingMessage, type Server } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import type { ServerConfig } from './config.js';
import { isOriginAllowed } from './config.js';
import { Hub, CLOSE_POLICY, type HubLogger } from './ws/hub.js';
import { RoomManager } from './rooms/manager.js';
import type { RoomStore } from './rooms/store.js';
import type { AiPool } from './ai/pool.js';
import { PROTOCOL_VERSION, SERVER_FEATURES } from './ws/protocol.js';

export interface AppParts {
  config: ServerConfig;
  store: RoomStore;
  ai: AiPool;
  logger?: HubLogger;
}

export interface App {
  fastify: FastifyInstance;
  http: Server;
  hub: Hub;
  manager: RoomManager;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const HEARTBEAT_MS = 25_000;

export function createApp(parts: AppParts): App {
  const { config } = parts;
  const manager = new RoomManager({ store: parts.store, config });
  const hub = new Hub({ config, manager, ai: parts.ai, ...(parts.logger ? { logger: parts.logger } : {}) });

  const http = createServer();
  const fastify = Fastify({ serverFactory: (handler) => http.on('request', handler) });

  const startedAt = Date.now();
  // The front end lives on a different origin (Static Web Apps -> Container
  // Apps), so the prewarm fetch needs an explicit allow header. The WebSocket
  // upgrade uses the same allow-list, just enforced differently.
  fastify.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin;
    if (origin !== undefined && isOriginAllowed(config, origin)) {
      void reply.header('access-control-allow-origin', origin);
      void reply.header('vary', 'Origin');
    }
    done();
  });

  // Hit by the front end on page load: it wakes a scaled-to-zero replica up
  // before the player has finished reading the lobby.
  //
  // `features` is also what the web deploy workflow gates on: the front end is
  // published by a separate workflow, so it has to be able to tell "the server
  // already understands this" from "the protocol version happens to match".
  fastify.get('/health', () => ({
    status: 'ok',
    uptimeMs: Date.now() - startedAt,
    connections: hub.connectionCount,
    activeGames: hub.activeGameCount,
    protocolVersion: PROTOCOL_VERSION,
    features: SERVER_FEATURES,
  }));
  fastify.get('/', () => ({ service: 'quoridor-server' }));

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.limits.maxPayloadBytes });

  http.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (!isOriginAllowed(config, origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const ip = clientIp(request);
      if (ip === null) {
        ws.close(CLOSE_POLICY, 'unknown client');
        return;
      }
      hub.handleConnection(ws, ip);
    });
  });

  const heartbeat = setInterval(() => hub.sweepDeadConnections(), HEARTBEAT_MS);
  heartbeat.unref();

  return {
    fastify,
    http,
    hub,
    manager,
    async listen(): Promise<number> {
      await fastify.ready();
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          resolve();
        });
      });
      const address = http.address();
      return typeof address === 'object' && address !== null ? address.port : config.port;
    },
    async close(): Promise<void> {
      clearInterval(heartbeat);
      await hub.shutdown();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await fastify.close();
      await parts.store.close?.();
    },
  };
}

/**
 * Container Apps terminates TLS at the edge, so the real client address is only
 * in `x-forwarded-for`. Fall back to the socket address for local runs.
 */
function clientIp(request: IncomingMessage): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim();
  if (first) return stripPort(first);
  return request.socket.remoteAddress ?? null;
}

function stripPort(value: string): string {
  // IPv4 with port, e.g. "203.0.113.7:51234". IPv6 is left alone.
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  return match?.[1] ?? value;
}
