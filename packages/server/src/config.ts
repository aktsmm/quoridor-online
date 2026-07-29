/** Configuration is read once at startup so tests can build their own. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  /** Origins allowed to open a WebSocket. Empty disables the check (dev only). */
  readonly allowedOrigins: readonly string[];
  readonly storage: StorageConfig;
  /** How long a disconnected human keeps their seat before the CPU takes over. */
  readonly reconnectGraceMs: number;
  /** Rooms are dropped this long after the last human disconnects. */
  readonly abandonedRoomTtlMs: number;
  /** Hard cap so a full table never keeps a room alive forever. */
  readonly roomTtlMs: number;
  readonly limits: Limits;
  readonly aiTimeBudgetMs: number;
  /** Artificial delay before a CPU move so the board does not jump. */
  readonly aiMinThinkMs: number;
}

export interface StorageConfig {
  /** `memory` keeps everything in-process; `table` uses Azure Table Storage. */
  readonly kind: 'memory' | 'table';
  readonly accountName?: string | undefined;
  readonly connectionString?: string | undefined;
  readonly roomsTable: string;
  readonly codesTable: string;
}

export interface Limits {
  readonly maxRooms: number;
  readonly maxConnections: number;
  readonly maxConnectionsPerIp: number;
  readonly maxPayloadBytes: number;
  readonly maxNameLength: number;
  readonly maxPendingPerSocket: number;
  /** Seat-less watchers allowed per room, counted separately from players. */
  readonly maxSpectatorsPerRoom: number;
  /** Token bucket sizes, expressed as "N actions per window". */
  readonly createRoom: RateSpec;
  readonly joinFailure: RateSpec;
  readonly move: RateSpec;
  readonly message: RateSpec;
}

export interface RateSpec {
  readonly limit: number;
  readonly windowMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${raw}`);
  }
  return value;
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter((s) => s.length > 0);
}

export const DEFAULT_LIMITS: Limits = {
  maxRooms: 200,
  maxConnections: 400,
  maxConnectionsPerIp: 12,
  maxPayloadBytes: 8 * 1024,
  maxNameLength: 24,
  maxPendingPerSocket: 16,
  maxSpectatorsPerRoom: 10,
  createRoom: { limit: 10, windowMs: 60_000 },
  joinFailure: { limit: 20, windowMs: 60_000 },
  move: { limit: 90, windowMs: 60_000 },
  message: { limit: 240, windowMs: 60_000 },
};

export function loadConfig(): ServerConfig {
  const accountName = process.env['STORAGE_ACCOUNT_NAME'];
  const connectionString = process.env['STORAGE_CONNECTION_STRING'];
  const kind = accountName || connectionString ? 'table' : 'memory';

  return {
    port: envInt('PORT', 8080),
    host: process.env['HOST'] ?? '0.0.0.0',
    allowedOrigins: envList('ALLOWED_ORIGINS'),
    storage: {
      kind,
      accountName,
      connectionString,
      roomsTable: process.env['ROOMS_TABLE'] ?? 'rooms',
      codesTable: process.env['CODES_TABLE'] ?? 'roomcodes',
    },
    reconnectGraceMs: envInt('RECONNECT_GRACE_MS', 60_000),
    abandonedRoomTtlMs: envInt('ABANDONED_ROOM_TTL_MS', 10 * 60_000),
    roomTtlMs: envInt('ROOM_TTL_MS', 6 * 60 * 60_000),
    limits: DEFAULT_LIMITS,
    aiTimeBudgetMs: envInt('AI_TIME_BUDGET_MS', 1000),
    aiMinThinkMs: envInt('AI_MIN_THINK_MS', 350),
  };
}

/** Localhost origins are always allowed so `npm run dev` works unchanged. */
const DEV_ORIGINS = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isOriginAllowed(config: ServerConfig, origin: string | undefined): boolean {
  // Native clients and server-to-server callers send no Origin at all; only
  // browsers do, and those are the ones we need to pin down.
  if (origin === undefined || origin === '') return true;
  if (DEV_ORIGINS.test(origin)) return true;
  if (config.allowedOrigins.length === 0) return true;
  const normalised = origin.replace(/\/$/, '');
  return config.allowedOrigins.includes(normalised);
}
