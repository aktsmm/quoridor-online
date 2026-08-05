import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMove,
  distanceToGoal,
  isActive,
  legalPawnMoves,
  CLOCKWISE_SEATS,
  type GameState,
  type PlayerCount,
  type Pos,
  type SeatDirection,
} from '@quoridor/engine';
import { DEFAULT_LIMITS, type ServerConfig } from '../src/config.js';
import { MemoryRoomStore } from '../src/rooms/store.js';
import {
  RoomManager,
  RoomError,
  isCpuToMove,
  seatToMove,
  firstTurnForHostPosition,
} from '../src/rooms/manager.js';
import {
  ROOM_SCHEMA_VERSION,
  turnPosition,
  type RoomRecord,
  type StoredRoom,
} from '../src/rooms/record.js';
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

  it('hands a disconnected lobby seat to the CPU when the host starts', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const guest = await manager.joinRoom(host.stored.record.code, 'Guest');
    await manager.markDisconnected(host.stored.record.roomId, guest.seatIndex);

    const started = await manager.start(host.stored.record.roomId, host.seatIndex);
    expect(started.record.seats[guest.seatIndex]!.connection).toBe('cpu-controlled');
    expect(started.record.seats[guest.seatIndex]!.disconnectedAt).toBeNull();

    const back = await manager.reconnect(host.stored.record.code, guest.playerToken);
    expect(back.stored.record.seats[guest.seatIndex]!.connection).toBe('connected');
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

describe('rematch', () => {
  /** Races both pawns straight at their goal rows until someone arrives. */
  async function finishedRoom() {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    const code = host.stored.record.code;
    const guest = await manager.joinRoom(code, 'Guest');
    let stored = await manager.start(roomId, 0);

    for (let ply = 0; ply < 60 && stored.record.status === 'playing'; ply += 1) {
      const game = stored.record.game!;
      const seat = game.turn;
      const goalRow = seat === 0 ? 8 : 0;
      const to = [...legalPawnMoves(game)].sort(
        (a, b) => Math.abs(a.r - goalRow) - Math.abs(b.r - goalRow),
      )[0]!;
      stored = await manager.applyMove(roomId, seat, stored.record.gameVersion, {
        type: 'pawn',
        to,
      });
    }

    expect(stored.record.status).toBe('finished');
    return { manager, roomId, code, stored, guest };
  }

  it('starts the next game without breaking up the table', async () => {
    const { manager, roomId, stored } = await finishedRoom();
    const before = stored.record;
    const names = before.seats.map((s) => s.name);
    const hashes = before.seats.map((s) => s.tokenHash);

    const next = await manager.rematch(roomId, 0);
    expect(next.record.status).toBe('playing');
    expect(next.record.moveLog).toEqual([]);
    expect(next.record.game!.ply).toBe(0);
    expect(next.record.game!.completions).toEqual([]);
    expect(next.record.gameVersion).toBeGreaterThan(before.gameVersion);

    // The whole point: same code, same seats, same tokens, so nobody has to
    // rejoin between games.
    expect(next.record.code).toBe(before.code);
    expect(next.record.seats.map((s) => s.name)).toEqual(names);
    expect(next.record.seats.map((s) => s.tokenHash)).toEqual(hashes);
    expect(next.record.seats.map((s) => s.seat)).toEqual(before.seats.map((s) => s.seat));
  });

  it('only lets the host call it, and only between games', async () => {
    const { manager, roomId } = await finishedRoom();

    await expect(manager.rematch(roomId, 1)).rejects.toMatchObject({ code: 'not-host' });

    await manager.rematch(roomId, 0);
    // A second one mid-game would silently wipe the position out from under
    // everybody, so it has to be refused.
    await expect(manager.rematch(roomId, 0)).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('frees a seat that leaves after the game, so someone else can take it', async () => {
    const { manager, roomId, code, stored } = await finishedRoom();

    await manager.leave(roomId, 1);
    const afterLeave = await manager.get(roomId);
    expect(afterLeave!.record.seats[1]!.connection).toBe('empty');
    expect(afterLeave!.record.seats[1]!.tokenHash).toBeNull();

    const newcomer = await manager.joinRoom(code, 'Newcomer');
    expect(newcomer.seatIndex).toBe(1);
    expect(newcomer.stored.record.seats[1]!.name).toBe('Newcomer');
    // The host seat is untouched, so the host still owns the rematch button.
    expect(newcomer.stored.record.hostSeat).toBe(stored.record.hostSeat);

    const next = await manager.rematch(roomId, 0);
    expect(next.record.status).toBe('playing');
  });

  it('hands a disconnected rematch seat to the CPU until its player reconnects', async () => {
    const { manager, roomId, code, guest } = await finishedRoom();
    await manager.markDisconnected(roomId, 1);

    const next = await manager.rematch(roomId, 0);
    expect(next.record.seats[1]!.connection).toBe('cpu-controlled');
    expect(next.record.seats[1]!.disconnectedAt).toBeNull();

    const back = await manager.reconnect(code, guest.playerToken);
    expect(back.seatIndex).toBe(1);
    expect(back.stored.record.seats[1]!.connection).toBe('connected');
  });

  it('hands a mid-game leaver to the CPU rather than emptying the seat', async () => {
    const { manager } = makeManager();
    const host = await manager.createRoom({
      playerCount: 2,
      aiLevel: 'easy',
      fillWithCpu: false,
      name: 'Host',
    });
    const roomId = host.stored.record.roomId;
    await manager.joinRoom(host.stored.record.code, 'Guest');
    await manager.start(roomId, 0);

    const after = await manager.leave(roomId, 1);
    expect(after!.record.seats[1]!.connection).toBe('cpu-controlled');
    expect(after!.record.status).toBe('playing');
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

describe('turn order', () => {
  /** Greedy racer: nobody builds walls, so every game finishes quickly. */
  function racingMove(game: GameState): Pos {
    const seat = game.turn;
    let best: Pos | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const to of legalPawnMoves(game)) {
      const after = applyMove(game, { type: 'pawn', to });
      // Reaching the goal retires the pawn, and a retired pawn has no distance
      // left to measure, so treat it as the best possible outcome.
      const distance = isActive(after, seat) ? distanceToGoal(after, seat) : -1;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = to;
      }
    }
    return best!;
  }

  async function playToFinish(manager: RoomManager, roomId: string): Promise<StoredRoom> {
    let stored = (await manager.get(roomId))!;
    for (let ply = 0; ply < 400 && stored.record.status === 'playing'; ply += 1) {
      const game = stored.record.game!;
      stored = await manager.applyMove(roomId, game.turn, stored.record.gameVersion, {
        type: 'pawn',
        to: racingMove(game),
      });
    }
    expect(stored.record.status).toBe('finished');
    return stored;
  }

  const counts: PlayerCount[] = [2, 3, 4];

  describe('the host picks a position', () => {
    for (const playerCount of counts) {
      it(`opens on the seat the host asked for with ${playerCount} players`, async () => {
        for (let hostPosition = 1; hostPosition <= playerCount; hostPosition += 1) {
          const { manager } = makeManager();
          const host = await manager.createRoom({
            playerCount,
            aiLevel: 'easy',
            fillWithCpu: true,
            name: 'Host',
            hostPosition,
          });
          const roomId = host.stored.record.roomId;

          // Stored 0-based, so the wire value never leaks into the engine.
          expect(host.stored.record.initialFirstTurn).toBe(
            firstTurnForHostPosition(0, hostPosition, playerCount),
          );

          const started = await manager.start(roomId, 0);
          const firstTurn = started.record.game!.firstTurn;
          expect(started.record.game!.turn).toBe(firstTurn);
          // The host holds seat 0, so its place in the order is what was asked.
          expect(turnPosition(0, firstTurn, playerCount)).toBe(hostPosition);
        }
      });
    }

    it('shows the coming order in the lobby, before any game exists', async () => {
      const { manager } = makeManager();
      const host = await manager.createRoom({
        playerCount: 3,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: 'Host',
        hostPosition: 3,
      });
      const view = toRoomView(host.stored.record);
      expect(view.game).toBeNull();
      expect(view.nextFirstTurn).toBe(1);
      expect(view.seats.map((s) => turnPosition(s.index, view.nextFirstTurn, 3))).toEqual([3, 1, 2]);
    });

    it('refuses a position that is out of range or not a whole number', async () => {
      const { manager } = makeManager();
      for (const hostPosition of [0, -1, 3, 4, 1.5, Number.NaN]) {
        await expect(
          manager.createRoom({
            playerCount: 2,
            aiLevel: 'easy',
            fillWithCpu: true,
            name: 'Host',
            hostPosition,
          }),
        ).rejects.toMatchObject({ code: 'invalid-request' });
      }
      // Rejecting before the code is reserved keeps the 6-digit space clean.
      const grant = await manager.createRoom({
        playerCount: 2,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: 'Host',
        hostPosition: 2,
      });
      expect(grant.stored.record.code).toMatch(/^\d{6}$/);
    });
  });

  describe('rematch rotation', () => {
    for (const playerCount of counts) {
      it(`moves the opening seat on by one and comes full circle with ${playerCount} players`, async () => {
        const { manager } = makeManager();
        const host = await manager.createRoom({
          playerCount,
          aiLevel: 'easy',
          fillWithCpu: true,
          name: 'Host',
          hostPosition: 1,
        });
        const roomId = host.stored.record.roomId;

        await manager.start(roomId, 0);
        const seen: number[] = [(await manager.get(roomId))!.record.game!.firstTurn];
        await playToFinish(manager, roomId);

        // One lap of the table: the last rematch must land back on the start.
        for (let round = 1; round <= playerCount; round += 1) {
          const next = await manager.rematch(roomId, 0);
          seen.push(next.record.game!.firstTurn);
          if (round < playerCount) await playToFinish(manager, roomId);
        }

        const expected = Array.from(
          { length: playerCount + 1 },
          (_, i) => (seen[0]! + i) % playerCount,
        );
        expect(seen).toEqual(expected);
        expect(seen.at(-1)).toBe(seen[0]);
      });
    }

    it('draws once for an unspecified position and then rotates instead of redrawing', async () => {
      // A fresh draw each game could hand the same seat the opening move twice
      // in a row, which is exactly what the rotation exists to prevent.
      const drawing = new RoomManager({
        store: new MemoryRoomStore(now),
        config: makeConfig(),
        now,
        random: () => 0.6,
      });

      const host = await drawing.createRoom({
        playerCount: 2,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: 'Host',
      });
      const roomId = host.stored.record.roomId;
      expect(host.stored.record.initialFirstTurn).toBe(1);

      await drawing.start(roomId, 0);
      expect((await drawing.get(roomId))!.record.game!.firstTurn).toBe(1);
      await playToFinish(drawing, roomId);

      // `random` still returns 0.6, so a redraw would give 1 again.
      const second = await drawing.rematch(roomId, 0);
      expect(second.record.game!.firstTurn).toBe(0);
    });
  });

  describe('records saved before this feature existed', () => {
    it('starts and rotates normally without an initialFirstTurn', async () => {
      const { manager, store } = makeManager();
      const host = await manager.createRoom({
        playerCount: 2,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: 'Host',
      });
      const roomId = host.stored.record.roomId;

      // Exactly what a v2 record looks like: the field simply is not there.
      const legacy: RoomRecord = { ...host.stored.record };
      delete (legacy as { initialFirstTurn?: number }).initialFirstTurn;
      expect(legacy.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
      const saved = await store.save(legacy, host.stored.etag);
      expect(saved).not.toBeNull();
      expect('initialFirstTurn' in saved!.record).toBe(false);

      const started = await manager.start(roomId, 0);
      expect(started.record.game!.firstTurn).toBe(0);
      await playToFinish(manager, roomId);
      const next = await manager.rematch(roomId, 0);
      expect(next.record.game!.firstTurn).toBe(1);
    });
  });
});

