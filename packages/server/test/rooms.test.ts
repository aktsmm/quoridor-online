import { beforeEach, describe, expect, it } from 'vitest';
import { legalPawnMoves, CLOCKWISE_SEATS, type SeatDirection } from '@quoridor/engine';
import { DEFAULT_LIMITS, type ServerConfig } from '../src/config.js';
import { MemoryRoomStore } from '../src/rooms/store.js';
import { RoomManager, RoomError, isCpuToMove, seatToMove } from '../src/rooms/manager.js';
import { hashToken } from '../src/rooms/code.js';
import { toRoomView } from '../src/ws/protocol.js';

let clock = 1_000_000;
const now = (): number => clock;

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

function makeManager(config = makeConfig()): { manager: RoomManager; store: MemoryRoomStore } {
  const store = new MemoryRoomStore(now);
  // A fixed "random" keeps seat layout and first turn deterministic.
  const manager = new RoomManager({ store, config, now, random: () => 0 });
  return { manager, store };
}

beforeEach(() => {
  clock = 1_000_000;
});

describe('room lifecycle', () => {
  it('creates a room with a 6-digit code and seats the host', async () => {
    const { manager } = makeManager();
    const grant = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });

    expect(grant.stored.record.code).toMatch(/^\d{6}$/);
    expect(grant.seatIndex).toBe(0);
    expect(grant.stored.record.seats).toHaveLength(2);
    expect(grant.stored.record.seats[0]!.connection).toBe('connected');
    expect(grant.stored.record.seats[1]!.connection).toBe('empty');
    expect(grant.stored.record.hostSeat).toBe(0);
  });

  it('never puts the raw token in the record or the broadcast view', async () => {
    const { manager } = makeManager();
    const grant = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });

    const serialised = JSON.stringify(grant.stored.record);
    expect(serialised).not.toContain(grant.playerToken);
    expect(grant.stored.record.seats[0]!.tokenHash).toBe(hashToken(grant.playerToken));

    const view = JSON.stringify(toRoomView(grant.stored.record));
    expect(view).not.toContain(grant.playerToken);
    expect(view).not.toContain('tokenHash');
  });

  it('lets a second player join by code', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const guest = await manager.joinRoom(host.stored.record.code, 'Guest');

    expect(guest.seatIndex).toBe(1);
    expect(guest.stored.record.seats[1]!.name).toBe('Guest');
    expect(guest.playerToken).not.toBe(host.playerToken);
  });

  it('reports a full room the same way as a missing one', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    await manager.joinRoom(host.stored.record.code, 'Guest');

    await expect(manager.joinRoom(host.stored.record.code, 'Third')).rejects.toMatchObject({
      code: 'room-unavailable',
    });
    await expect(manager.joinRoom('000000', 'Third')).rejects.toMatchObject({
      code: 'room-unavailable',
    });
  });

  it('rejects joins once the game has started', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    await manager.start(host.stored.record.roomId, 0);

    await expect(manager.joinRoom(host.stored.record.code, 'Sneak')).rejects.toMatchObject({
      code: 'room-unavailable',
    });
  });

  it('only lets the host start', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    await manager.joinRoom(host.stored.record.code, 'Guest');

    await expect(manager.start(host.stored.record.roomId, 1)).rejects.toMatchObject({
      code: 'not-host',
    });
    const started = await manager.start(host.stored.record.roomId, 0);
    expect(started.record.status).toBe('playing');
    expect(started.record.game).not.toBeNull();
  });

  it('refuses to start with an empty seat unless CPUs fill in', async () => {
    const { manager } = makeManager();
    const strict = await manager.createRoom({
      playerCount: 3,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    await expect(manager.start(strict.stored.record.roomId, 0)).rejects.toMatchObject({
      code: 'not-ready',
    });

    const filled = await manager.createRoom({
      playerCount: 3,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const started = await manager.start(filled.stored.record.roomId, 0);
    expect(started.record.seats.filter((s) => s.kind === 'cpu')).toHaveLength(2);
  });
});

describe('three-player seat layout', () => {
  // `#layoutSeats` draws the empty side first, then the rotation, so feeding
  // these two values enumerates every layout the server can produce.
  function managerDrawing(empty: number, offset: number): RoomManager {
    const draws = [empty / 4, offset / 3];
    let call = 0;
    return new RoomManager({
      store: new MemoryRoomStore(now),
      config: makeConfig(),
      now,
      random: () => draws[call++ % draws.length]!,
    });
  }

  async function layout(empty: number, offset: number): Promise<string[]> {
    const room = await managerDrawing(empty, offset).createRoom({
      playerCount: 3,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    return room.stored.record.seats.map((s) => s.seat);
  }

  it('gives every seat index each direction equally often', async () => {
    const counts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
    for (let empty = 0; empty < 4; empty += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        const seats = await layout(empty, offset);
        seats.forEach((seat, index) => {
          const perSeat = counts[index]!;
          perSeat.set(seat, (perSeat.get(seat) ?? 0) + 1);
        });
      }
    }
    // Directions may or may not be equally strong -- the evidence is noisy --
    // so an uneven mapping would risk handing the host a permanent edge over
    // whoever joins last for no benefit at all.
    for (const perSeat of counts) {
      expect([...perSeat.values()]).toEqual([3, 3, 3, 3]);
    }
  });

  it('keeps the turn order clockwise', async () => {
    for (let empty = 0; empty < 4; empty += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        const seats = await layout(empty, offset);
        expect(new Set(seats).size).toBe(3);
        const positions = seats.map((s) => CLOCKWISE_SEATS.indexOf(s as SeatDirection));
        // Walking the seats in order must never turn anticlockwise: exactly one
        // step wraps past the end of the clockwise ring.
        const wraps = positions.filter(
          (p, i) => p < positions[(i + positions.length - 1) % positions.length]!,
        );
        expect(wraps).toHaveLength(1);
      }
    }
  });
});

describe('moves', () => {
  async function startedRoom(playerCount: 2 | 3 | 4 = 2) {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const stored = await manager.start(host.stored.record.roomId, 0);
    return { manager, roomId: host.stored.record.roomId, stored };
  }

  it('accepts a legal move from the player to move', async () => {
    const { manager, roomId, stored } = await startedRoom();
    const turn = stored.record.game!.turn;
    const to = legalPawnMoves(stored.record.game!)[0]!;

    const next = await manager.applyMove(roomId, turn, stored.record.gameVersion, {
      type: 'pawn',
      to,
    });
    expect(next.record.game!.ply).toBe(1);
    expect(next.record.moveLog).toHaveLength(1);
    expect(next.record.gameVersion).toBeGreaterThan(stored.record.gameVersion);
  });

  it('rejects a stale expectedGameVersion', async () => {
    const { manager, roomId, stored } = await startedRoom();
    const turn = stored.record.game!.turn;
    const to = legalPawnMoves(stored.record.game!)[0]!;

    await expect(
      manager.applyMove(roomId, turn, stored.record.gameVersion - 1, { type: 'pawn', to }),
    ).rejects.toMatchObject({ code: 'version-conflict' });
  });

  it('rejects a move from the wrong seat', async () => {
    const { manager, roomId, stored } = await startedRoom();
    const turn = stored.record.game!.turn;
    const other = (turn + 1) % stored.record.playerCount;
    const to = legalPawnMoves(stored.record.game!)[0]!;

    await expect(
      manager.applyMove(roomId, other, stored.record.gameVersion, { type: 'pawn', to }),
    ).rejects.toMatchObject({ code: 'not-your-turn' });
  });

  it('rejects an illegal move', async () => {
    const { manager, roomId, stored } = await startedRoom();
    const turn = stored.record.game!.turn;

    await expect(
      manager.applyMove(roomId, turn, stored.record.gameVersion, {
        type: 'pawn',
        to: { c: 0, r: 0 },
      }),
    ).rejects.toMatchObject({ code: 'illegal-move' });
  });

  it('only one of two concurrent moves for the same version wins', async () => {
    const { manager, roomId, stored } = await startedRoom();
    const turn = stored.record.game!.turn;
    const moves = legalPawnMoves(stored.record.game!);

    const results = await Promise.allSettled([
      manager.applyMove(roomId, turn, stored.record.gameVersion, { type: 'pawn', to: moves[0]! }),
      manager.applyMove(roomId, turn, stored.record.gameVersion, { type: 'pawn', to: moves[1]! }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(RoomError);
  });
});

describe('reconnect state machine', () => {
  it('holds the seat during the grace period and hands it to the CPU after', async () => {
    const config = makeConfig({ reconnectGraceMs: 60_000 });
    const { manager } = makeManager(config);
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    await manager.start(roomId, 0);

    await manager.markDisconnected(roomId, 0);
    clock += 30_000;
    let stored = (await manager.get(roomId))!;
    expect(stored.record.seats[0]!.connection).toBe('disconnected');

    const back = await manager.reconnect(host.stored.record.code, host.playerToken);
    expect(back.seatIndex).toBe(0);
    expect(back.stored.record.seats[0]!.connection).toBe('connected');

    await manager.markDisconnected(roomId, 0);
    clock += 61_000;
    stored = (await manager.get(roomId))!;
    expect(stored.record.seats[0]!.connection).toBe('cpu-controlled');
    // The token still works, so the human can come back and take over.
    const retaken = await manager.reconnect(host.stored.record.code, host.playerToken);
    expect(retaken.stored.record.seats[0]!.connection).toBe('connected');
  });

  it('frees the seat instead when the grace expires in the lobby', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const guest = await manager.joinRoom(host.stored.record.code, 'Guest');

    await manager.markDisconnected(host.stored.record.roomId, 1);
    clock += 61_000;
    const stored = (await manager.get(host.stored.record.roomId))!;
    expect(stored.record.seats[1]!.connection).toBe('empty');
    expect(stored.record.seats[1]!.tokenHash).toBeNull();
    await expect(
      manager.reconnect(host.stored.record.code, guest.playerToken),
    ).rejects.toMatchObject({ code: 'room-unavailable' });
  });

  it('delegates the host only when the host is gone for good', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    await manager.joinRoom(host.stored.record.code, 'Guest');

    await manager.markDisconnected(roomId, 0);
    clock += 30_000;
    expect((await manager.get(roomId))!.record.hostSeat).toBe(0);

    clock += 61_000;
    expect((await manager.get(roomId))!.record.hostSeat).toBe(1);
  });

  it('lets a CPU-controlled seat keep playing and identifies whose turn it is', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    await manager.start(roomId, 0);

    const stored = (await manager.get(roomId))!;
    const seat = seatToMove(stored.record)!;
    expect(seat.index).toBe(stored.record.game!.turn);
    // Seat 1 was filled by a CPU, seat 0 is the connected human.
    expect(isCpuToMove(stored.record)).toBe(seat.index === 1);
  });
});

describe('expiry', () => {
  it('drops a room once every human has been gone past the abandon window', async () => {
    const config = makeConfig({ abandonedRoomTtlMs: 10 * 60_000 });
    const { manager, store } = makeManager(config);
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    await manager.start(roomId, 0);
    await manager.markDisconnected(roomId, 0);

    clock += 11 * 60_000;
    expect(await manager.get(roomId)).toBeNull();
    expect(store.size).toBe(0);
    expect(await store.lookupCode(host.stored.record.code)).toBeNull();
  });

  it('keeps a room alive while someone is connected', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: true,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;

    for (let i = 0; i < 12; i += 1) {
      clock += 5 * 60_000;
      expect(await manager.get(roomId)).not.toBeNull();
    }
  });
});

describe('room codes', () => {
  it('hands out distinct codes', async () => {
    const { manager } = makeManager();
    const codes = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const grant = await manager.createRoom({
        playerCount: 2,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: `Host ${i}`,
      });
      codes.add(grant.stored.record.code);
    }
    expect(codes.size).toBe(60);
  });

  it('refuses to reserve a code that is already held', async () => {
    const store = new MemoryRoomStore();
    expect(await store.reserveCode('123456', 'a', Date.now() + 60_000)).toBe(true);
    expect(await store.reserveCode('123456', 'b', Date.now() + 60_000)).toBe(false);
  });
});
