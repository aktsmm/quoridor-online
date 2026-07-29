import { afterEach, describe, expect, it } from 'vitest';
import {
  distanceToGoal,
  legalPawnMoves,
  tryApplyMove,
  winnerOf,
  type GameState,
  type Move,
} from '@quoridor/engine';
import { createApp, type App } from '../src/app.js';
import { DEFAULT_LIMITS, type ServerConfig } from '../src/config.js';
import { MemoryRoomStore } from '../src/rooms/store.js';
import { InlineAiPool } from '../src/ai/pool.js';
import { CLOSE_POLICY, CLOSE_SUPERSEDED } from '../src/ws/hub.js';
import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '../src/ws/protocol.js';
import { TestClient } from './helpers/client.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    allowedOrigins: [],
    storage: { kind: 'memory', roomsTable: 'rooms', codesTable: 'codes' },
    reconnectGraceMs: 60_000,
    abandonedRoomTtlMs: 10 * 60_000,
    roomTtlMs: 60 * 60_000,
    limits: DEFAULT_LIMITS,
    aiTimeBudgetMs: 50,
    aiMinThinkMs: 0,
    ...overrides,
  };
}

const started: App[] = [];
const clients: TestClient[] = [];

async function startApp(store: MemoryRoomStore, config = makeConfig()): Promise<{ app: App; url: string }> {
  const app = createApp({ config, store, ai: new InlineAiPool() });
  const port = await app.listen();
  started.push(app);
  return { app, url: `ws://127.0.0.1:${port}` };
}

async function connect(url: string, origin?: string): Promise<TestClient> {
  const client = await TestClient.connect(url, origin);
  clients.push(client);
  await client.nextOfType('hello');
  return client;
}

function roomOf(message: ServerMessage): RoomView {
  if (message.type !== 'room.state' && message.type !== 'game.state' && message.type !== 'game.over') {
    throw new Error(`expected a room payload, got ${message.type}`);
  }
  return message.room;
}

/** Any legal move for whoever is to move. */
function anyMove(game: GameState): { type: 'pawn'; to: { c: number; r: number } } {
  return { type: 'pawn', to: legalPawnMoves(game)[0]! };
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const app of started.splice(0)) await app.close();
});

describe('websocket vertical slice', () => {
  it('runs a two-human game end to end', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: false, name: 'Host' });
    const joined = await host.nextOfType('joined');
    expect(joined.code).toMatch(/^\d{6}$/);
    await host.nextOfType('room.state');

    const guest = await connect(url);
    guest.send({ type: 'room.join', code: joined.code, name: 'Guest' });
    const guestJoined = await guest.nextOfType('joined');
    expect(guestJoined.seatIndex).toBe(1);

    // The host is told about the new arrival without asking.
    const lobby = roomOf(await host.nextOfType('room.state'));
    expect(lobby.seats.map((s) => s.name)).toEqual(['Host', 'Guest']);

    host.send({ type: 'room.start' });
    let state = roomOf(await guest.nextOfType('game.state'));
    expect(state.status).toBe('playing');
    expect(state.game).not.toBeNull();

    // Play a handful of alternating moves through the real socket path.
    for (let i = 0; i < 4; i += 1) {
      const mover = state.game!.turn === 0 ? host : guest;
      mover.send({
        type: 'game.move',
        expectedGameVersion: state.gameVersion,
        move: anyMove(state.game!),
      });
      state = await afterVersion(host, state.gameVersion);
      expect(state.game!.ply).toBe(i + 1);
    }
    expect(state.moveLog).toHaveLength(4);
  });

  it('never sends another player their opponent token', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: false, name: 'Host' });
    const hostJoined = await host.nextOfType('joined');
    await host.nextOfType('room.state');

    const guest = await connect(url);
    guest.send({ type: 'room.join', code: hostJoined.code, name: 'Guest' });
    await guest.nextOfType('joined');

    const broadcast = JSON.stringify(await guest.nextOfType('room.state').catch(() => ({})));
    expect(broadcast).not.toContain(hostJoined.playerToken);
  });

  it('plays CPU seats automatically', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 4, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    await host.nextOfType('joined');
    await host.nextOfType('room.state');

    host.send({ type: 'room.start' });
    // Seat 0 is the only human; every other seat has to play itself.
    let state = await myTurn(host);
    const firstPly = state.game!.ply;
    state = await playOneMove(host, state);
    state = await myTurn(host);

    // Three CPU moves plus the human's own must have landed.
    expect(state.game!.ply).toBe(firstPly + 4);
    expect(state.game!.turn).toBe(0);
    expect(state.moveLog.length).toBeGreaterThanOrEqual(4);
  });

  it('restores a game after the process restarts', async () => {
    const store = new MemoryRoomStore();
    const first = await startApp(store);

    const host = await connect(first.url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });

    const state = await myTurn(host);
    await playOneMove(host, state);
    // Wait for the CPU's reply too, so the snapshot is a settled position.
    const beforeRestart = await myTurn(host);

    // Kill the server the way a revision swap would.
    const closed = host.waitForClose();
    await first.app.close();
    started.length = 0;
    expect((await closed).code).toBe(1012);

    // A new process, same durable store.
    const second = await startApp(store);
    const back = await connect(second.url);
    back.send({ type: 'room.reconnect', code: joined.code, playerToken: joined.playerToken });
    const rejoined = await back.nextOfType('joined');
    expect(rejoined.seatIndex).toBe(0);

    const restored = roomOf(await back.nextOfType('game.state'));
    expect(restored.status).toBe('playing');
    expect(restored.moveLog).toEqual(beforeRestart.moveLog);
    expect(restored.game!.walls).toEqual(beforeRestart.game!.walls);
    expect(restored.game!.players.map((p) => p.pos)).toEqual(
      beforeRestart.game!.players.map((p) => p.pos),
    );

    // And the restored game is still playable.
    await playOneMove(back, restored);
  });

  it('kicks the older socket when a seat is taken over', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const first = await connect(url);
    first.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await first.nextOfType('joined');
    await first.nextOfType('room.state');

    const second = await connect(url);
    second.send({ type: 'room.reconnect', code: joined.code, playerToken: joined.playerToken });
    await second.nextOfType('joined');

    expect((await first.waitForClose()).code).toBe(CLOSE_SUPERSEDED);
  });

  it('rejects a stale game version instead of applying it', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });
    const state = await myTurn(host);

    host.send({
      type: 'game.move',
      rid: 7,
      expectedGameVersion: state.gameVersion - 1,
      move: anyMove(state.game!),
    });
    const error = await host.nextOfType('error');
    expect(error.code).toBe('version-conflict');
    expect(error.rid).toBe(7);
  });

  it('rejects malformed and oversized frames', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);
    const client = await connect(url);

    client.sendRaw('not json');
    expect((await client.nextOfType('error')).code).toBe('bad-message');

    client.sendRaw(JSON.stringify({ type: 'room.create', playerCount: 9 }));
    expect((await client.nextOfType('error')).code).toBe('bad-message');

    client.sendRaw(JSON.stringify({ type: 'game.move', expectedGameVersion: 1, move: { type: 'pawn', to: { c: 99, r: 0 } } }));
    expect((await client.nextOfType('error')).code).toBe('bad-message');
  });

  it('answers ping with pong', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);
    const client = await connect(url);

    client.send({ type: 'ping', rid: 3 });
    const pong = await client.nextOfType('pong');
    expect(pong.rid).toBe(3);
  });

  it('refuses a WebSocket from an origin that is not allowed', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store, makeConfig({ allowedOrigins: ['https://quoridor.example'] }));

    await expect(TestClient.connect(url, 'https://evil.example')).rejects.toThrow();
    const ok = await TestClient.connect(url, 'https://quoridor.example');
    clients.push(ok);
    expect((await ok.nextOfType('hello')).protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('serves a health endpoint for prewarming', async () => {
    const store = new MemoryRoomStore();
    const { app, url } = await startApp(store);
    const response = await fetch(`${url.replace('ws://', 'http://')}/health`);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health.status).toBe('ok');
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(app.hub.connectionCount).toBe(0);
  });

  it('reports games in progress so a deploy can wait for them', async () => {
    const store = new MemoryRoomStore();
    const { app, url } = await startApp(store);
    const health = `${url.replace('ws://', 'http://')}/health`;

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    await host.nextOfType('joined');
    await host.nextOfType('room.state');

    // A room sitting in the lobby is not worth blocking a deploy for.
    expect(app.hub.activeGameCount).toBe(0);
    expect((await (await fetch(health)).json()).activeGames).toBe(0);

    host.send({ type: 'room.start' });
    await host.nextOfType('game.state');
    expect(app.hub.activeGameCount).toBe(1);
    expect((await (await fetch(health)).json()).activeGames).toBe(1);

    // The count follows the sockets: once nobody is watching, nothing is at risk.
    host.close();
    await waitFor(() => app.hub.activeGameCount === 0);
  });

  it('answers the prewarm fetch with CORS headers for allowed origins only', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store, makeConfig({ allowedOrigins: ['https://quoridor.example'] }));
    const health = `${url.replace('ws://', 'http://')}/health`;

    const allowed = await fetch(health, { headers: { origin: 'https://quoridor.example' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://quoridor.example');

    const blocked = await fetch(health, { headers: { origin: 'https://evil.example' } });
    // The body is harmless, so the request still succeeds; the browser is the
    // one that must be told not to read it.
    expect(blocked.status).toBe(200);
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses more than the allowed number of connections from one address', async () => {
    const store = new MemoryRoomStore();
    const cap = 3;
    const { url } = await startApp(
      store,
      makeConfig({ limits: { ...DEFAULT_LIMITS, maxConnectionsPerIp: cap } }),
    );

    for (let i = 0; i < cap; i += 1) await connect(url);

    // The socket still opens - the guard runs after the upgrade - so the
    // rejection shows up as a policy close rather than a failed connect.
    const overflow = await TestClient.connect(url);
    clients.push(overflow);
    const closed = await overflow.waitForClose();
    expect(closed.code).toBe(CLOSE_POLICY);
    expect(closed.reason).toBe('too many connections');
  });

  it('frees an address slot when a connection goes away', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store, makeConfig({ limits: { ...DEFAULT_LIMITS, maxConnectionsPerIp: 1 } }));

    const first = await connect(url);
    first.close();
    await waitFor(() => first.closeInfo !== null);

    const second = await TestClient.connect(url);
    clients.push(second);
    // A hello means the slot was released rather than leaked.
    await second.next((m) => m.type === 'hello');
  });
});

describe('watching a room', () => {
  it('lets a latecomer watch a game already in progress', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });
    let state = await myTurn(host);

    const watcher = await connect(url);
    watcher.send({ type: 'room.watch', rid: 5, code: joined.code });
    const watching = await watcher.nextOfType('watching');
    expect(watching.rid).toBe(5);
    expect(watching.code).toBe(joined.code);

    // The position arrives without asking, and the watcher is counted.
    const seen = roomOf(await watcher.next((m) => m.type === 'game.state'));
    expect(seen.status).toBe('playing');
    expect(seen.game!.ply).toBe(state.game!.ply);
    expect(seen.spectators).toBe(1);
    // A watcher must never be handed the players' credentials.
    expect(JSON.stringify(seen)).not.toContain(joined.playerToken);

    // And it keeps following the game afterwards.
    state = await playOneMove(host, state);
    const followed = await watcher.next(
      (m) => m.type === 'game.state' && m.room.gameVersion >= state.gameVersion,
    );
    expect(roomOf(followed).moveLog.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to let a watcher touch the game', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });
    const state = await myTurn(host);

    const watcher = await connect(url);
    watcher.send({ type: 'room.watch', code: joined.code });
    await watcher.nextOfType('watching');
    await watcher.next((m) => m.type === 'game.state');

    watcher.send({
      type: 'game.move',
      rid: 1,
      expectedGameVersion: state.gameVersion,
      move: anyMove(state.game!),
    });
    expect((await watcher.nextOfType('error')).code).toBe('invalid-request');

    watcher.send({ type: 'room.start', rid: 2 });
    expect((await watcher.nextOfType('error')).code).toBe('invalid-request');

    watcher.send({ type: 'room.rematch', rid: 3 });
    expect((await watcher.nextOfType('error')).code).toBe('invalid-request');

    // If any of that had landed, the position would have moved on and the
    // host's own move would now fail with a version conflict.
    const after = await playOneMove(host, state);
    expect(after.game!.ply).toBe(state.game!.ply + 1);
  });

  it('caps the number of watchers per room', async () => {
    const store = new MemoryRoomStore();
    const cap = 2;
    expect(DEFAULT_LIMITS.maxSpectatorsPerRoom).toBe(10);
    const { url } = await startApp(
      store,
      makeConfig({ limits: { ...DEFAULT_LIMITS, maxSpectatorsPerRoom: cap } }),
    );

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');

    for (let i = 0; i < cap; i += 1) {
      const watcher = await connect(url);
      watcher.send({ type: 'room.watch', code: joined.code });
      await watcher.nextOfType('watching');
    }

    const overflow = await connect(url);
    overflow.send({ type: 'room.watch', code: joined.code });
    expect((await overflow.nextOfType('error')).code).toBe('capacity');
  });

  it('frees a watcher slot when the watcher leaves', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(
      store,
      makeConfig({ limits: { ...DEFAULT_LIMITS, maxSpectatorsPerRoom: 1 } }),
    );

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');

    const first = await connect(url);
    first.send({ type: 'room.watch', code: joined.code });
    await first.nextOfType('watching');
    expect(roomOf(await first.next((m) => m.type === 'room.state')).spectators).toBe(1);

    first.send({ type: 'room.leave' });
    // The host sees the count drop, which is also how the slot is known to be free.
    await host.next((m) => m.type === 'room.state' && m.room.spectators === 0);

    const second = await connect(url);
    second.send({ type: 'room.watch', code: joined.code });
    await second.nextOfType('watching');
  });

  it('meters a watch on a code that does not exist', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);
    const client = await connect(url);

    client.send({ type: 'room.watch', rid: 9, code: '000000' });
    const error = await client.nextOfType('error');
    expect(error.code).toBe('room-unavailable');
    expect(error.rid).toBe(9);
  });

  it('keeps a seated client in its room when it tries another attachment', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);
    const host = await connect(url);

    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');

    host.send({ type: 'room.create', rid: 8, playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Other' });
    expect(await host.nextOfType('error')).toMatchObject({ code: 'invalid-request', rid: 8 });

    host.send({ type: 'room.join', rid: 9, code: joined.code, name: 'Other' });
    expect(await host.nextOfType('error')).toMatchObject({ code: 'invalid-request', rid: 9 });

    host.send({ type: 'room.watch', rid: 10, code: joined.code });
    expect(await host.nextOfType('error')).toMatchObject({ code: 'invalid-request', rid: 10 });

    host.send({ type: 'room.start' });
    const playing = roomOf(
      await host.next((message) => message.type === 'game.state' && message.room.status === 'playing'),
    );
    expect(playing.seats[0]!.connection).toBe('connected');
  });

  it('lets a socket attach again after its old room was deleted', async () => {
    const store = new MemoryRoomStore();
    const { app, url } = await startApp(store);
    const first = await connect(url);
    const second = await connect(url);

    first.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'First' });
    const old = await first.nextOfType('joined');
    await first.nextOfType('room.state');

    second.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Second' });
    const current = await second.nextOfType('joined');
    await second.nextOfType('room.state');

    await app.manager.destroy(old.roomId);
    first.send({ type: 'room.watch', code: current.code });
    expect((await first.nextOfType('watching')).code).toBe(current.code);
  });
});

describe('playing again', () => {
  it('starts the next game in the same room when the host asks', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });

    const over = roomOf(await raceToTheEnd(host));
    expect(over.status).toBe('finished');
    expect(over.moveLog.length).toBeGreaterThan(0);

    host.send({ type: 'room.rematch' });
    const next = roomOf(
      await host.next(
        (m) =>
          m.type === 'game.state' &&
          m.room.status === 'playing' &&
          m.room.gameVersion > over.gameVersion,
      ),
    );
    expect(next.moveLog).toEqual([]);
    expect(next.game!.ply).toBe(0);
    // Same room, same code: nobody had to go back to the home screen.
    expect(next.code).toBe(joined.code);
    expect(next.seats.map((s) => s.name)).toEqual(over.seats.map((s) => s.name));
  }, 30_000);

  it('lets a new player take a seat that was left after the game', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: false, name: 'Host' });
    const joined = await host.nextOfType('joined');
    await host.nextOfType('room.state');

    const guest = await connect(url);
    guest.send({ type: 'room.join', code: joined.code, name: 'Guest' });
    await guest.nextOfType('joined');
    await host.nextOfType('room.state');

    host.send({ type: 'room.start' });
    const over = roomOf(await raceToTheEnd(host, guest));
    expect(over.status).toBe('finished');

    guest.send({ type: 'room.leave' });
    await host.next(
      (m) =>
        (m.type === 'room.state' || m.type === 'game.state') && m.room.seats[1]!.name === '',
      10_000,
    );

    const newcomer = await connect(url);
    newcomer.send({ type: 'room.join', code: joined.code, name: 'Newcomer' });
    expect((await newcomer.nextOfType('joined')).seatIndex).toBe(1);
  }, 30_000);
});

describe('finishing order', () => {
  it('reports the whole placing order when the game ends', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });

    const over = await raceToTheEnd(host);
    if (over.type !== 'game.over') throw new Error('expected the game to end');

    // Everybody gets a place, and the winner heads the list.
    expect([...over.placings].sort()).toEqual([0, 1]);
    expect(over.placings[0]).toBe(over.winner);
  }, 30_000);

  it('refuses to let a player give up while they still hold walls', async () => {
    const store = new MemoryRoomStore();
    const { url } = await startApp(store);

    const host = await connect(url);
    host.send({ type: 'room.create', playerCount: 2, aiLevel: 'easy', fillWithCpu: true, name: 'Host' });
    await host.nextOfType('joined');
    await host.nextOfType('room.state');
    host.send({ type: 'room.start' });
    const state = await myTurn(host);
    expect(state.game!.players[0]!.wallsLeft).toBeGreaterThan(0);

    host.send({
      type: 'game.move',
      rid: 11,
      expectedGameVersion: state.gameVersion,
      move: { type: 'resign' },
    });
    const error = await host.nextOfType('error');
    expect(error.code).toBe('illegal-move');
    expect(error.message).toBe('resign-not-allowed');
    expect(error.rid).toBe(11);
  }, 20_000);
});

async function playOneMove(client: TestClient, state: RoomView): Promise<RoomView> {
  client.send({
    type: 'game.move',
    expectedGameVersion: state.gameVersion,
    move: anyMove(state.game!),
  });
  return afterVersion(client, state.gameVersion);
}

/** Polls until a condition holds, so a bookkeeping race fails loudly. */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition did not become true in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The next broadcast strictly newer than `version`. */
function afterVersion(client: TestClient, version: number): Promise<RoomView> {
  return client
    .next((m) => (m.type === 'game.state' || m.type === 'room.state') && m.room.gameVersion > version)
    .then(roomOf);
}

/** Waits until seat 0 (the test's human) is on the move again. */
function myTurn(client: TestClient, seatIndex = 0): Promise<RoomView> {
  return client
    .next((m) => m.type === 'game.state' && m.room.game?.turn === seatIndex, 10_000)
    .then(roomOf);
}

/** The step that gets this player closest to their goal, or wins outright. */
function goalMove(game: GameState, seat: number): Move {
  let best: Move | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const to of legalPawnMoves(game)) {
    const move: Move = { type: 'pawn', to };
    const result = tryApplyMove(game, move);
    if (!result.ok) continue;
    if (winnerOf(result.state) === seat) return move;
    const distance = distanceToGoal(result.state, seat);
    if (distance >= 0 && distance < bestDistance) {
      bestDistance = distance;
      best = move;
    }
  }

  if (!best) throw new Error('no legal pawn move to play');
  return best;
}

/**
 * Plays the given seats straight at their goals until the game ends.
 *
 * Rushing is the quickest way to reach a finished room over a real socket,
 * which is what the rematch tests actually need.
 */
async function raceToTheEnd(host: TestClient, guest?: TestClient): Promise<ServerMessage> {
  const bySeat = new Map<number, TestClient>([[0, host]]);
  if (guest) bySeat.set(1, guest);
  let acted = -1;

  for (let i = 0; i < 300; i += 1) {
    const message = await host.next(
      (m) =>
        m.type === 'game.over' ||
        (m.type === 'game.state' &&
          m.room.status === 'playing' &&
          m.room.game !== null &&
          m.room.gameVersion > acted &&
          bySeat.has(m.room.game.turn)),
      15_000,
    );
    if (message.type === 'game.over') return message;

    const room = roomOf(message);
    acted = room.gameVersion;
    const seat = room.game!.turn;
    bySeat.get(seat)!.send({
      type: 'game.move',
      expectedGameVersion: room.gameVersion,
      move: goalMove(room.game!, seat),
    });
  }

  throw new Error('the game never finished');
}
