import { describe, expect, it } from 'vitest';
import { parseClientMessage, sanitiseName } from '../src/ws/schema.js';
import { ConcurrencyLimiter, RateLimiter } from '../src/ratelimit.js';
import { isOriginAllowed, DEFAULT_LIMITS, type ServerConfig } from '../src/config.js';

const baseConfig: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  allowedOrigins: ['https://quoridor.example'],
  storage: { kind: 'memory', roomsTable: 'r', codesTable: 'c' },
  reconnectGraceMs: 60_000,
  abandonedRoomTtlMs: 600_000,
  roomTtlMs: 3_600_000,
  limits: DEFAULT_LIMITS,
  aiTimeBudgetMs: 500,
  aiMinThinkMs: 0,
};

describe('message validation', () => {
  it('accepts well-formed messages', () => {
    const cases = [
      { type: 'room.create', playerCount: 3, aiLevel: 'hard', fillWithCpu: true, name: 'A' },
      { type: 'room.join', code: '012345', name: 'B' },
      { type: 'room.reconnect', code: '012345', playerToken: 'x'.repeat(36) },
      { type: 'room.start' },
      { type: 'room.leave' },
      { type: 'game.move', expectedGameVersion: 3, move: { type: 'pawn', to: { c: 0, r: 8 } } },
      { type: 'game.move', expectedGameVersion: 3, move: { type: 'wall', wall: { c: 7, r: 7, o: 'v' } } },
      { type: 'ping', rid: 12 },
    ];
    for (const value of cases) {
      const result = parseClientMessage(JSON.stringify(value));
      expect(result.ok, `${JSON.stringify(value)} -> ${result.ok ? '' : result.reason}`).toBe(true);
    }
  });

  it('rejects everything malformed', () => {
    const cases: [string, string][] = [
      ['not json', 'bad json'],
      ['[]', 'array'],
      ['"hello"', 'string'],
      ['{}', 'no type'],
      ['{"type":"nope"}', 'unknown type'],
      ['{"type":"room.join","code":"12345","name":"x"}', 'short code'],
      ['{"type":"room.join","code":"abcdef","name":"x"}', 'non-numeric code'],
      [`{"type":"room.join","code":"123456","name":"${'x'.repeat(200)}"}`, 'long name'],
      ['{"type":"room.create","playerCount":5,"aiLevel":"easy","fillWithCpu":true,"name":"x"}', 'bad count'],
      ['{"type":"room.create","playerCount":2,"aiLevel":"godlike","fillWithCpu":true,"name":"x"}', 'bad level'],
      ['{"type":"room.create","playerCount":2,"aiLevel":"easy","fillWithCpu":true,"name":"x","extra":1}', 'extra prop'],
      ['{"type":"game.move","expectedGameVersion":1,"move":{"type":"pawn","to":{"c":9,"r":0}}}', 'off board'],
      ['{"type":"game.move","expectedGameVersion":1,"move":{"type":"wall","wall":{"c":8,"r":0,"o":"h"}}}', 'off wall grid'],
      ['{"type":"game.move","expectedGameVersion":1,"move":{"type":"wall","wall":{"c":0,"r":0,"o":"x"}}}', 'bad orientation'],
      ['{"type":"game.move","expectedGameVersion":-1,"move":{"type":"pawn","to":{"c":0,"r":0}}}', 'negative version'],
      ['{"type":"game.move","expectedGameVersion":1,"move":{"type":"pawn","to":{"c":0,"r":0},"wall":{"c":0,"r":0,"o":"h"}}}', 'both payloads'],
      ['{"type":"room.reconnect","code":"123456","playerToken":"short"}', 'short token'],
    ];
    for (const [raw, label] of cases) {
      expect(parseClientMessage(raw).ok, label).toBe(false);
    }
  });

  it('keeps the correlation id on validation failures when it is usable', () => {
    const result = parseClientMessage('{"type":"room.start","rid":5,"junk":true}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rid).toBe(5);
  });

  describe('hostPosition', () => {
    function create(playerCount: number, hostPosition: unknown): string {
      return JSON.stringify({
        type: 'room.create',
        playerCount,
        aiLevel: 'easy',
        fillWithCpu: true,
        name: 'x',
        hostPosition,
      });
    }

    it('accepts a whole number that fits the table, and null or nothing at all', () => {
      const cases = [
        create(2, 1),
        create(2, 2),
        create(3, 3),
        create(4, 4),
        create(2, null),
        '{"type":"room.create","playerCount":2,"aiLevel":"easy","fillWithCpu":true,"name":"x"}',
      ];
      for (const raw of cases) {
        const result = parseClientMessage(raw);
        expect(result.ok, `${raw} -> ${result.ok ? '' : result.reason}`).toBe(true);
      }
    });

    it('rejects anything outside 1..playerCount, and anything that is not an integer', () => {
      const cases: [string, string][] = [
        [create(2, 0), 'below the first position'],
        [create(2, -1), 'negative'],
        [create(2, 3), 'past a two-player table'],
        [create(3, 4), 'past a three-player table'],
        [create(4, 5), 'past the largest table'],
        [create(2, 1.5), 'fractional'],
        [create(2, '1'), 'string'],
        [create(2, true), 'boolean'],
      ];
      for (const [raw, label] of cases) {
        expect(parseClientMessage(raw).ok, label).toBe(false);
      }
    });
  });
});

describe('name sanitising', () => {
  it('trims, collapses and caps', () => {
    expect(sanitiseName('  Alice   Smith  ', 'x')).toBe('Alice Smith');
    expect(sanitiseName('a'.repeat(100), 'x')).toHaveLength(DEFAULT_LIMITS.maxNameLength);
    expect(sanitiseName('   ', 'Player 1')).toBe('Player 1');
  });

  it('strips control characters and bidi overrides', () => {
    expect(sanitiseName('Al\u0000ice\u202e', 'x')).toBe('Alice');
  });
});

describe('origin checks', () => {
  it('allows the configured origin and localhost, and blocks the rest', () => {
    expect(isOriginAllowed(baseConfig, 'https://quoridor.example')).toBe(true);
    expect(isOriginAllowed(baseConfig, 'https://quoridor.example/')).toBe(true);
    expect(isOriginAllowed(baseConfig, 'http://localhost:5173')).toBe(true);
    expect(isOriginAllowed(baseConfig, 'https://evil.example')).toBe(false);
    expect(isOriginAllowed(baseConfig, 'https://quoridor.example.evil.com')).toBe(false);
  });

  it('allows requests with no Origin at all', () => {
    // Only browsers send Origin; native clients and health probes do not.
    expect(isOriginAllowed(baseConfig, undefined)).toBe(true);
  });

  it('allows anything when no allowlist is configured', () => {
    expect(isOriginAllowed({ ...baseConfig, allowedOrigins: [] }, 'https://anywhere.example')).toBe(true);
  });
});

describe('rate limiting', () => {
  it('allows up to the limit then blocks until the window rolls', () => {
    let clock = 0;
    const limiter = new RateLimiter({ limit: 3, windowMs: 1_000 }, () => clock);

    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(false);
    // A different key has its own budget.
    expect(limiter.tryConsume('other')).toBe(true);

    clock += 1_001;
    expect(limiter.tryConsume('ip')).toBe(true);
  });

  it('forgets keys once their window has passed', () => {
    let clock = 0;
    const limiter = new RateLimiter({ limit: 1, windowMs: 1_000 }, () => clock);
    for (let i = 0; i < 50; i += 1) limiter.tryConsume(`ip-${i}`);
    expect(limiter.size).toBe(50);

    clock += 5_000;
    limiter.tryConsume('trigger-sweep');
    expect(limiter.size).toBe(1);
  });

  it('caps concurrent connections per key and releases them', () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.acquire('ip')).toBe(false);

    limiter.release('ip');
    expect(limiter.acquire('ip')).toBe(true);

    limiter.release('ip');
    limiter.release('ip');
    expect(limiter.size).toBe(0);
  });
});
