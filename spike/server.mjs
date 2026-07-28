// Phase 0a infrastructure spike: the smallest possible WebSocket server that
// still exercises everything we need to prove out before building the real
// game server.
//
// Verifies:
//   1. WebSocket upgrade works through Container Apps ingress (transport: auto)
//   2. A connection survives a long idle/heartbeat period (30 min soak)
//   3. The app scales to zero and comes back on the next request
//   4. SIGTERM handling: drain, then close with a reconnectable close code
//   5. Anonymous pull from ghcr.io works
//   6. Origin validation

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const BOOT_ID = randomUUID();
const BOOT_TIME = new Date().toISOString();

// Comma separated list. "*" disables the check (spike only).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  // Non-browser clients (node, wscat) send no Origin header at all.
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

let draining = false;

const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(draining ? 503 : 200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: draining ? 'draining' : 'ok',
        bootId: BOOT_ID,
        bootTime: BOOT_TIME,
        uptimeSeconds: Math.round(process.uptime()),
        connections: wss.clients.size,
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024,
});

httpServer.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req.headers.origin)) {
    console.log(`[ws] rejected origin=${req.headers.origin}`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  if (draining) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const id = randomUUID().slice(0, 8);
  console.log(`[ws] open id=${id} origin=${req.headers.origin ?? '-'} total=${wss.clients.size}`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.send(JSON.stringify({ type: 'hello', id, bootId: BOOT_ID, bootTime: BOOT_TIME }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid json' }));
      return;
    }
    ws.send(
      JSON.stringify({
        type: 'echo',
        received: msg,
        bootId: BOOT_ID,
        uptimeSeconds: Math.round(process.uptime()),
        serverTime: new Date().toISOString(),
      }),
    );
  });

  ws.on('close', (code) => {
    console.log(`[ws] close id=${id} code=${code} total=${wss.clients.size - 1}`);
  });
});

// Container Apps' idle timeout for a connection is ~4 minutes of inactivity,
// so a server-side heartbeat is mandatory for a long-lived game session.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      console.log('[ws] terminating unresponsive socket');
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

function shutdown(signal) {
  if (draining) return;
  draining = true;
  console.log(`[shutdown] ${signal} received, draining ${wss.clients.size} socket(s)`);
  clearInterval(heartbeat);

  for (const ws of wss.clients) {
    // 1012 "Service Restart" tells a well-behaved client to reconnect.
    try {
      ws.close(1012, 'server restarting');
    } catch {
      /* already gone */
    }
  }

  httpServer.close(() => {
    console.log('[shutdown] http server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.log('[shutdown] forced exit after grace period');
    process.exit(0);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

httpServer.listen(PORT, () => {
  console.log(`[boot] listening on :${PORT} bootId=${BOOT_ID} origins=${ALLOWED_ORIGINS.join(',')}`);
});
