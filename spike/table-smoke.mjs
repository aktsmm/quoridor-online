// Throwaway smoke test: exercise TableRoomStore against real Azure Table Storage.
// Usage: node spike/table-smoke.mjs <accountName>
import { TableRoomStore } from '../packages/server/dist/rooms/tableStore.js';
import { RoomManager } from '../packages/server/dist/rooms/manager.js';
import { loadConfig } from '../packages/server/dist/config.js';

const account = process.argv[2];
if (!account) throw new Error('usage: node table-smoke.mjs <accountName>');

const suffix = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
const roomsTable = `smokerooms${suffix}`;
const codesTable = `smokecodes${suffix}`;
const store = TableRoomStore.fromConfig({
  kind: 'table',
  accountName: account,
  roomsTable,
  codesTable,
});

const ok = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

const config = loadConfig();
const manager = new RoomManager({ store, config });

console.log('--- code reservation ---');
const code = '424242';
ok('reserve fresh code', await store.reserveCode(code, 'room-a', Date.now() + 60_000));
ok(
  'duplicate reserve rejected',
  (await store.reserveCode(code, 'room-b', Date.now() + 60_000)) === false,
);
ok('lookup returns owner', (await store.lookupCode(code)) === 'room-a');
await store.touchCode(code, 'room-a', Date.now() + 600_000);
ok('touch kept owner', (await store.lookupCode(code)) === 'room-a');
await store.reserveCode('424243', 'old', Date.now() - 1000);
ok('reserve steals a lapsed code', await store.reserveCode('424243', 'new', Date.now() + 60_000));
await store.reserveCode('424244', 'gone', Date.now() - 1000);
ok('expired lookup returns null', (await store.lookupCode('424244')) === null);
await store.releaseCode(code);
ok('release clears code', (await store.lookupCode(code)) === null);

console.log('--- room lifecycle through RoomManager ---');
const created = await manager.createRoom({
  playerCount: 2,
  aiLevel: 'easy',
  fillWithCpu: true,
  name: 'Host',
});
const roomId = created.stored.record.roomId;
ok('create returns 6-digit code', /^\d{6}$/.test(created.stored.record.code));
ok('code resolves to the room', (await store.lookupCode(created.stored.record.code)) === roomId);
const started = await manager.start(roomId, created.seatIndex);
ok('start produced a game', started.record.game !== null);
ok('cpu seat was filled', started.record.seats.some((s) => s.kind === 'cpu'));

console.log('--- CAS ---');
const a = await store.load(roomId);
const b = await store.load(roomId);
const first = await store.save({ ...a.record, gameVersion: a.record.gameVersion + 1 }, a.etag);
ok('first save wins', first !== null);
const second = await store.save({ ...b.record, gameVersion: b.record.gameVersion + 1 }, b.etag);
ok('stale save rejected (returns null)', second === null);

console.log('--- reload after "restart" ---');
const reopened = TableRoomStore.fromConfig({
  kind: 'table',
  accountName: account,
  roomsTable,
  codesTable,
});
const fresh = await reopened.load(roomId);
ok('another store instance sees the same game', fresh?.record.game != null);

console.log('--- payload size ---');
const bytes = Buffer.byteLength(JSON.stringify(started.record), 'utf8');
console.log(`   room record JSON = ${bytes} bytes (Table string property limit 32k chars)`);
ok('record fits comfortably in a Table string property', bytes < 30_000);

console.log('--- expiry query ---');
const expired = await store.listExpired(Date.now() + 86_400_000 * 365);
ok('listExpired finds the room with a far-future cutoff', expired.includes(roomId));
ok('listExpired finds nothing with cutoff 0', (await store.listExpired(0)).length === 0);

console.log('--- delete ---');
const latest = await store.load(roomId);
await store.delete(roomId, latest.etag);
ok('room gone after delete', (await store.load(roomId)) === null);

console.log('cleaning up tables...');
const { TableClient } = await import('@azure/data-tables');
const { DefaultAzureCredential } = await import('@azure/identity');
for (const t of [roomsTable, codesTable]) {
  await new TableClient(`https://${account}.table.core.windows.net`, t, new DefaultAzureCredential())
    .deleteTable()
    .catch(() => {});
}
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
