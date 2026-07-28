import { RestError, TableClient, type TableEntity } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import type { StorageConfig } from '../config.js';
import type { RoomRecord, StoredRoom } from './record.js';
import type { RoomStore } from './store.js';

/**
 * Table Storage keeps rooms alive across replica restarts and revision swaps -
 * which is the whole reason a scale-to-zero container app can host a game.
 *
 * Rooms live in one table keyed by `roomId`; codes live in a separate table so
 * "reserve this code" is a single atomic insert rather than a scan.
 */
export class TableRoomStore implements RoomStore {
  readonly #rooms: TableClient;
  readonly #codes: TableClient;
  #ready: Promise<void> | null = null;

  constructor(rooms: TableClient, codes: TableClient) {
    this.#rooms = rooms;
    this.#codes = codes;
  }

  static fromConfig(config: StorageConfig): TableRoomStore {
    const make = (table: string): TableClient => {
      if (config.connectionString) {
        return TableClient.fromConnectionString(config.connectionString, table, {
          allowInsecureConnection: config.connectionString.includes('http://'),
        });
      }
      if (!config.accountName) throw new Error('STORAGE_ACCOUNT_NAME is required');
      return new TableClient(
        `https://${config.accountName}.table.core.windows.net`,
        table,
        new DefaultAzureCredential(),
      );
    };
    return new TableRoomStore(make(config.roomsTable), make(config.codesTable));
  }

  /** Creating tables is idempotent, so this is safe to call on every request. */
  async #ensure(): Promise<void> {
    this.#ready ??= Promise.all([
      this.#rooms.createTable(),
      this.#codes.createTable(),
    ]).then(() => undefined);
    await this.#ready;
  }

  async reserveCode(code: string, roomId: string, expiresAt: number): Promise<boolean> {
    await this.#ensure();
    try {
      await this.#codes.createEntity({ partitionKey: 'code', rowKey: code, roomId, expiresAt });
      return true;
    } catch (error) {
      if (!isConflict(error)) throw error;
      // Someone holds it. If their reservation has lapsed, steal it - but only
      // by replacing the exact entity we just read, so the race stays safe.
      const existing = await this.#codes
        .getEntity<{ roomId: string; expiresAt: number }>('code', code)
        .catch((e: unknown) => (isNotFound(e) ? null : Promise.reject(e)));
      if (!existing || existing.expiresAt > Date.now()) return false;
      try {
        await this.#codes.updateEntity(
          { partitionKey: 'code', rowKey: code, roomId, expiresAt },
          'Replace',
          { etag: existing.etag },
        );
        return true;
      } catch (e) {
        if (isConflict(e) || isPreconditionFailed(e)) return false;
        throw e;
      }
    }
  }

  async releaseCode(code: string): Promise<void> {
    await this.#ensure();
    await this.#codes.deleteEntity('code', code).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
  }

  /**
   * Keeps our own reservation ahead of the room's deadline, so a long game can
   * never have its code recycled underneath it.
   */
  async touchCode(code: string, roomId: string, expiresAt: number): Promise<void> {
    await this.#ensure();
    const existing = await this.#codes
      .getEntity<{ roomId: string; expiresAt: number }>('code', code)
      .catch((error: unknown) => (isNotFound(error) ? null : Promise.reject(error)));
    if (!existing || existing.roomId !== roomId || existing.expiresAt >= expiresAt) return;
    await this.#codes
      .updateEntity({ partitionKey: 'code', rowKey: code, roomId, expiresAt }, 'Replace', {
        etag: existing.etag,
      })
      .catch((error: unknown) => {
        // Losing this race just means someone else refreshed it first.
        if (!isPreconditionFailed(error) && !isNotFound(error)) throw error;
      });
  }

  async lookupCode(code: string): Promise<string | null> {
    await this.#ensure();
    const entity = await this.#codes
      .getEntity<{ roomId: string; expiresAt: number }>('code', code)
      .catch((error: unknown) => (isNotFound(error) ? null : Promise.reject(error)));
    if (!entity) return null;
    if (entity.expiresAt <= Date.now()) return null;
    return entity.roomId;
  }

  async create(record: RoomRecord): Promise<StoredRoom> {
    await this.#ensure();
    const response = await this.#rooms.createEntity(toEntity(record));
    return { record, etag: await this.#etagOrReload(record.roomId, response.etag) };
  }

  async load(roomId: string): Promise<StoredRoom | null> {
    await this.#ensure();
    const entity = await this.#rooms
      .getEntity<RoomEntity>('room', roomId)
      .catch((error: unknown) => (isNotFound(error) ? null : Promise.reject(error)));
    if (!entity) return null;
    return { record: JSON.parse(entity.data) as RoomRecord, etag: entity.etag };
  }

  async save(record: RoomRecord, etag: string): Promise<StoredRoom | null> {
    await this.#ensure();
    try {
      const response = await this.#rooms.updateEntity(toEntity(record), 'Replace', { etag });
      return { record, etag: await this.#etagOrReload(record.roomId, response.etag) };
    } catch (error) {
      if (isPreconditionFailed(error) || isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Writes normally echo the new ETag. If a response ever omits it, read it
   * back rather than guessing - a wrong ETag would silently disable the CAS
   * that serialises every mutation.
   */
  async #etagOrReload(roomId: string, etag: string | undefined): Promise<string> {
    if (etag) return etag;
    const entity = await this.#rooms.getEntity<RoomEntity>('room', roomId);
    return entity.etag;
  }

  async delete(roomId: string, etag: string): Promise<void> {
    await this.#ensure();
    await this.#rooms.deleteEntity('room', roomId, { etag }).catch((error: unknown) => {
      if (!isNotFound(error) && !isPreconditionFailed(error)) throw error;
    });
  }

  /** Housekeeping for expired rooms; only reachable while a replica is awake. */
  async listExpired(now: number, limit = 50): Promise<string[]> {
    await this.#ensure();
    const out: string[] = [];
    const iterator = this.#rooms.listEntities<RoomEntity>({
      queryOptions: { filter: `PartitionKey eq 'room' and expiresAt lt ${doubleLiteral(now)}` },
    });
    for await (const entity of iterator) {
      out.push(entity.rowKey!);
      if (out.length >= limit) break;
    }
    return out;
  }
}

interface RoomEntity {
  partitionKey: string;
  rowKey: string;
  data: string;
  code: string;
  status: string;
  gameVersion: number;
  expiresAt: number;
  etag: string;
}

function toEntity(record: RoomRecord): TableEntity<Omit<RoomEntity, 'etag'>> {
  return {
    partitionKey: 'room',
    rowKey: record.roomId,
    data: JSON.stringify(record),
    code: record.code,
    status: record.status,
    gameVersion: record.gameVersion,
    expiresAt: record.expiresAt,
  };
}

function statusCode(error: unknown): number | undefined {
  return error instanceof RestError ? error.statusCode : undefined;
}

/**
 * Epoch milliseconds are stored as `Edm.Double`, and a bare integer in an OData
 * filter is parsed as `Edm.Int32` - which any millisecond timestamp overflows.
 * Emitting an explicit double literal keeps the comparison well-typed.
 */
function doubleLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError(`not a finite number: ${String(value)}`);
  return `${Math.trunc(value).toString()}.0`;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

function isConflict(error: unknown): boolean {
  return statusCode(error) === 409;
}

function isPreconditionFailed(error: unknown): boolean {
  return statusCode(error) === 412;
}
