// Phase 0a spike client. Usage:
//   node soak.mjs wss://<fqdn> [durationMinutes] [origin]
//
// Holds a single WebSocket open, pings every 20s, and records every gap,
// disconnect and server bootId change so we can tell a clean reconnect apart
// from a silently dropped connection.

import WebSocket from 'ws';

const url = process.argv[2];
const durationMin = Number(process.argv[3] ?? 30);
const origin = process.argv[4];

if (!url) {
  console.error('usage: node soak.mjs <wss-url> [durationMinutes] [origin]');
  process.exit(1);
}

const endAt = Date.now() + durationMin * 60_000;
const stats = {
  connects: 0,
  disconnects: 0,
  messages: 0,
  errors: 0,
  bootIds: new Set(),
  maxGapMs: 0,
  closeCodes: [],
};

let lastMessageAt = Date.now();
let attempt = 0;

function ts() {
  return new Date().toISOString().slice(11, 19);
}

function connect() {
  if (Date.now() >= endAt) return finish();

  const ws = new WebSocket(url, origin ? { origin } : undefined);
  let timer;

  ws.on('open', () => {
    attempt = 0;
    stats.connects += 1;
    console.log(`[${ts()}] open (#${stats.connects})`);
    timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: Date.now() }));
      }
    }, 20_000);
    ws.send(JSON.stringify({ t: Date.now(), hello: true }));
  });

  ws.on('message', (raw) => {
    const gap = Date.now() - lastMessageAt;
    lastMessageAt = Date.now();
    if (stats.messages > 0) stats.maxGapMs = Math.max(stats.maxGapMs, gap);
    stats.messages += 1;
    const msg = JSON.parse(raw.toString());
    if (msg.bootId && !stats.bootIds.has(msg.bootId)) {
      stats.bootIds.add(msg.bootId);
      console.log(`[${ts()}] server bootId=${msg.bootId} (${stats.bootIds.size} distinct)`);
    }
    if (stats.messages % 10 === 0) {
      console.log(`[${ts()}] ${stats.messages} msgs, maxGap=${Math.round(stats.maxGapMs / 1000)}s`);
    }
  });

  ws.on('close', (code) => {
    clearInterval(timer);
    stats.disconnects += 1;
    stats.closeCodes.push(code);
    console.log(`[${ts()}] close code=${code}`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    stats.errors += 1;
    console.log(`[${ts()}] error ${err.message}`);
  });
}

function scheduleReconnect() {
  if (Date.now() >= endAt) return finish();
  attempt += 1;
  // Exponential backoff with jitter, same policy the real client will use.
  const backoff = Math.min(500 * 2 ** (attempt - 1), 10_000);
  const delay = backoff / 2 + Math.random() * (backoff / 2);
  console.log(`[${ts()}] reconnecting in ${Math.round(delay)}ms`);
  setTimeout(connect, delay);
}

function finish() {
  console.log('\n=== SOAK RESULT ===');
  console.log(JSON.stringify({ ...stats, bootIds: [...stats.bootIds] }, null, 2));
  const clean = stats.disconnects === 0 && stats.bootIds.size === 1;
  console.log(clean ? 'PASS: single uninterrupted connection' : 'NOTE: connection was re-established at least once');
  process.exit(0);
}

connect();
