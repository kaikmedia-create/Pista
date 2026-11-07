import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncEngine, mergeCells, toProgress, validateCell} from '../cloud-sync/engine.mjs';
import {createSupabaseTransport} from '../cloud-sync/supabase-transport.mjs';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
class MemoryStorage {
  data = new Map();
  get length() {return this.data.size;}
  key(i) {return [...this.data.keys()][i] ?? null;}
  getItem(key) {return this.data.get(key) ?? null;}
  setItem(key, value) {this.data.set(key, String(value));}
  removeItem(key) {this.data.delete(key);}
}
function server() {
  let data = []; let fail = false; let loseAck = false;
  return {transport: {async exchange(changes) {
    if (fail) throw new Error('offline');
    data = mergeCells(data, changes);
    if (loseAck) {loseAck = false; throw new Error('response lost');}
    return {rows: structuredClone(data)};
  }}, offline(value) {fail = value;}, dropAck() {loseAck = true;}, rows() {return data;}};
}
function device(s, actor = A, storage = new MemoryStorage(), extra = {}) {
  return createSyncEngine({storage, actor, userId: 'athlete', planId: 'tp-ab-2026-2027',
    transport: s.transport, intervalMs: 0, ...extra});
}

test('independent devices and a fresh device retain a checked workout', async () => {
  const s = server(), a = device(s), b = device(s, B);
  a.set('tpab-2026-11-11-a', 'done', true); await a.flush(); await b.flush();
  assert.equal(b.snapshot()['tpab-2026-11-11-a'].done, true);
  const fresh = device(s, B); await fresh.flush();
  assert.equal(fresh.snapshot()['tpab-2026-11-11-a'].done, true);
});
test('unchecking is also synchronized', async () => {
  const s = server(), a = device(s), b = device(s, B);
  a.set('w1', 'done', true); await a.flush(); await b.flush();
  b.set('w1', 'done', false); await b.flush(); await a.flush();
  assert.equal(a.snapshot().w1.done, false);
});
test('notes and checkmarks merge independently without overwriting another device', async () => {
  const s = server(), a = device(s), b = device(s, B);
  a.set('w1', 'done', true); b.set('w1', 'note', 'Grüße, äöü und ß.');
  await a.flush(); await b.flush(); await a.flush();
  assert.equal(a.snapshot().w1.done, true);
  assert.equal(a.snapshot().w1.note, 'Grüße, äöü und ß.');
});
test('simultaneous changes to different workouts both survive', async () => {
  const s = server(), a = device(s), b = device(s, B);
  a.set('w1', 'done', true); b.set('w2', 'done', true);
  await Promise.all([a.flush(), b.flush()]); await a.flush(); await b.flush();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().w1.done && a.snapshot().w2.done, true);
});
test('offline outbox survives an update/restart and replays on reconnect', async () => {
  const s = server(), storage = new MemoryStorage(), a = device(s, A, storage);
  s.offline(true); a.set('w1', 'done', true);
  await assert.rejects(a.flush()); assert.equal(a.pendingCount(), 1);
  const restarted = device(s, B, storage); assert.equal(restarted.snapshot().w1.done, true);
  s.offline(false); await restarted.flush(); assert.equal(restarted.pendingCount(), 0);
  const fresh = device(s); await fresh.flush(); assert.equal(fresh.snapshot().w1.done, true);
});
test('a lost server response can be retried idempotently', async () => {
  const s = server(), a = device(s);
  a.set('w1', 'done', true); s.dropAck(); await assert.rejects(a.flush());
  assert.equal(a.pendingCount(), 1); await a.flush();
  assert.equal(a.pendingCount(), 0); assert.equal(s.rows().length, 1);
});
test('rapid toggling converges to the final local choice', async () => {
  const s = server(), a = device(s);
  a.set('w1', 'done', true); a.set('w1', 'done', false); a.set('w1', 'done', true);
  await a.flush(); assert.equal(a.snapshot().w1.done, true);
  assert.equal(a.pendingCount(), 0);
});
test('concurrent edits to one field converge independent of arrival order', () => {
  const a = {workout_id: 'w1', field: 'done', value: true, stamp: 5, actor: A};
  const b = {...a, value: false, actor: B};
  assert.deepEqual(mergeCells([a], [b]), mergeCells([b], [a]));
  assert.equal(toProgress(mergeCells([a], [b])).w1.done, false);
});
test('a stale offline edit cannot roll back a logically newer server value', async () => {
  const s = server(), a = device(s), b = device(s, B);
  b.set('w1', 'done', false);
  a.set('w1', 'done', false); a.set('w1', 'done', true); await a.flush();
  await b.flush(); assert.equal(b.snapshot().w1.done, true); assert.equal(b.pendingCount(), 0);
});
test('an unconfirmed or malformed response never clears pending edits', async () => {
  const statuses = [], a = device({transport: {async exchange() {return {rows: []};}}}, A,
    new MemoryStorage(), {onStatus: status => statuses.push(status.kind)});
  a.set('w1', 'done', true); await assert.rejects(a.flush(), /nicht bestätigt/);
  assert.equal(a.pendingCount(), 1); assert.equal(statuses.includes('synced'), false);
});
test('local corruption is preserved and reported, never reset', () => {
  const s = server(), storage = new MemoryStorage();
  storage.setItem('pista.sync.v1:athlete:tp-ab-2026-2027:cache', '{broken');
  assert.throws(() => device(s, A, storage).snapshot());
  assert.equal(storage.getItem('pista.sync.v1:athlete:tp-ab-2026-2027:cache'), '{broken');
});
test('validation rejects malformed, excessive and executable identifiers', () => {
  const row = {workout_id: 'w1', field: 'done', value: true, stamp: 1, actor: A};
  for (const patch of [{workout_id: '<script>'}, {field: 'steps'}, {value: 'true'},
    {stamp: Infinity}, {stamp: -1}, {actor: 'bad'}, {field: 'note', value: 'x'.repeat(2001)}]) {
    assert.throws(() => validateCell({...row, ...patch}));
  }
});
test('cloud mutation is refused without the correct signed-in user', async () => {
  let called = false;
  const client = {rpc() {called = true;}, auth: {async getSession() {return {data: {session: {user: {id: 'other'}}}};}}};
  const transport = createSupabaseTransport(client, {userId: 'athlete', planId: 'plan'});
  await assert.rejects(transport.exchange([]), /persönlichen Zugang/); assert.equal(called, false);
});
test('starting synchronization saves subsequent changes automatically', async () => {
  const s = server(), a = device(s); await a.start();
  a.set('w1', 'done', true); await a.flush();
  assert.equal(s.rows()[0].value, true); a.stop();
});
