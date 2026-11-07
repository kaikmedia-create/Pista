import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, normalizeState, setDone, progressFor} from '../core.js';
import {createGitHubBackup, parseGitHubRepository, GITHUB_BACKUP_PATH, MAX_GITHUB_BACKUP_BYTES} from '../github-backup.js';

const REPO = 'example-user/pista-private';
const TOKEN = 'github_pat_example_not_a_real_token_12345';
const OLD_SHA = 'a'.repeat(40), NEW_SHA = 'b'.repeat(40);
const metadata = overrides => ({full_name: REPO, private: true, visibility: 'private', default_branch: 'main', permissions: {push: true}, ...overrides});
const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const state = () => {
  const current = initialState('2026-11-07');
  setDone(current, 'demo-move', true, '2026-11-07T12:00:00.000Z');
  current.progress['demo-move'].note = 'Ruhig gelaufen. Grüße aus Berlin! 🏃‍♀️';
  return current;
};
const backup = (current = state()) => ({kind: 'pista-backup', schemaVersion: 1, exportedAt: '2026-11-07T12:01:00.000Z', state: current});
const remoteFile = (data = backup(), overrides = {}) => {
  const bytes = Buffer.from(JSON.stringify(data));
  return {type: 'file', path: GITHUB_BACKUP_PATH, sha: OLD_SHA, encoding: 'base64', size: bytes.length, content: bytes.toString('base64'), ...overrides};
};
function fixture(replies, options = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, init});
    assert.ok(replies.length, 'Unexpected network request.');
    const next = replies.shift();
    if (typeof next === 'function') return next(url, init);
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createGitHubBackup({repository: REPO, token: TOKEN, fetcher, ...options});
  return {client, calls};
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('GitHub configuration accepts only a repository name or a clean github.com URL', () => {
  assert.equal(parseGitHubRepository(' example-user/pista-private '), REPO);
  assert.equal(parseGitHubRepository('https://github.com/example-user/pista-private.git/'), REPO);
  for (const value of ['https://example.test/a/b', 'https://user:secret@github.com/a/b', 'https://github.com/a/b?token=secret', 'https://github.com/a/b#main', 'a/b/tree/main', '../secret', 'a/..', 'a/%2e%2e', 'a/b\\other', 'a/b?token=x']) {
    assert.throws(() => parseGitHubRepository(value), error => error.code === 'config');
  }
  assert.throws(() => createGitHubBackup({repository: REPO, token: 'ghp_classic_broad_scope'}), error => error.code === 'token');
});

test('a new remote backup requires an explicit read and preserves checks and Unicode notes', async () => {
  const f = fixture([response(metadata()), response({message: 'Not Found'}, 404), response(metadata()), response({content: {path: GITHUB_BACKUP_PATH, sha: NEW_SHA}}, 201)]);
  const current = state(), untouched = structuredClone(current);
  await rejectsCode(f.client.save(current, {expectedSha: null}), 'read-required');
  assert.equal(f.calls.length, 0);
  const found = await f.client.read();
  assert.equal(found.sha, null); assert.equal(found.backup, null);
  const saved = await f.client.save(current, {expectedSha: found.sha});
  assert.equal(saved.sha, NEW_SHA);
  assert.equal(saved.repository, REPO);
  assert.deepEqual(saved.backup.state, normalizeState(current));
  assert.deepEqual(current, untouched, 'Remote backup must not mutate local state.');
  const upload = JSON.parse(f.calls[3].init.body);
  assert.equal(upload.sha, undefined); assert.equal(upload.branch, 'main');
  const stored = JSON.parse(Buffer.from(upload.content, 'base64').toString('utf8'));
  assert.equal(stored.kind, 'pista-backup');
  assert.equal(stored.state.progress['demo-move'].note, current.progress['demo-move'].note);
  assert.equal(stored.state.progress['demo-move'].done, true);
  assert.equal(stored.exportedAt, saved.exportedAt);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false);
  for (const {url, init} of f.calls) {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(url.includes(TOKEN), false);
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
  }
  await rejectsCode(f.client.save(current, {expectedSha: NEW_SHA}), 'read-required');
});

test('read validates and normalizes a remote snapshot without writing or importing it', async () => {
  const source = backup();
  source.state.unrelatedSecret = 'must-not-restore';
  source.state.plan.unrelatedMetadata = 'must-not-restore';
  const f = fixture([response(metadata({default_branch: 'backup/main'})), response(remoteFile(source))]);
  const found = await f.client.read();
  assert.equal(found.repository, REPO); assert.equal(found.branch, 'backup/main');
  assert.equal(found.path, GITHUB_BACKUP_PATH); assert.equal(found.sha, OLD_SHA);
  assert.equal(progressFor(found.backup.state, 'demo-move').done, true);
  assert.equal(found.backup.state.unrelatedSecret, undefined);
  assert.equal(found.backup.state.plan.unrelatedMetadata, undefined);
  assert.match(f.calls[1].url, /\?ref=backup%2Fmain$/);
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});

test('updates use exactly the previewed SHA and never substitute a newer remote SHA', async () => {
  const f = fixture([response(metadata()), response(remoteFile()), response(metadata()), response({content: {path: GITHUB_BACKUP_PATH, sha: NEW_SHA}})]);
  const found = await f.client.read();
  await rejectsCode(f.client.save(state(), {expectedSha: null}), 'read-required');
  await rejectsCode(f.client.save(state(), {expectedSha: 'c'.repeat(40)}), 'read-required');
  assert.equal(f.calls.length, 2);
  await f.client.save(state(), {expectedSha: found.sha});
  assert.equal(JSON.parse(f.calls[3].init.body).sha, OLD_SHA);
});

test('public, mismatched, archived and read-only repositories are blocked before any data transfer', async () => {
  for (const [meta, code] of [
    [metadata({private: false, visibility: 'public'}), 'public-repository'],
    [metadata({visibility: 'internal'}), 'public-repository'],
    [metadata({full_name: 'different-owner/another-repo'}), 'repository-mismatch'],
    [metadata({archived: true}), 'read-only'],
    [metadata({permissions: {push: false}}), 'read-only'],
  ]) {
    const f = fixture([response(meta)]);
    await rejectsCode(f.client.read(), code);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.method, 'GET');
  }
  const f = fixture([response(metadata()), response(remoteFile()), response(metadata({private: false, visibility: 'public'}))]);
  await f.client.read();
  await rejectsCode(f.client.save(state(), {expectedSha: OLD_SHA}), 'public-repository');
  assert.ok(f.calls.every(call => call.init.method === 'GET'), 'Recheck privacy immediately before uploading.');
});

test('concurrent edits and branch changes fail safely instead of retrying an overwrite', async () => {
  for (const status of [409, 422]) {
    const f = fixture([response(metadata()), response(remoteFile()), response(metadata()), response({message: 'RAW SERVER MESSAGE ' + TOKEN}, status)]);
    await f.client.read();
    await assert.rejects(f.client.save(state(), {expectedSha: OLD_SHA}), error => error.code === 'conflict' && !error.message.includes(TOKEN) && !error.message.includes('RAW'));
    assert.equal(f.calls.filter(call => call.init.method === 'PUT').length, 1);
    await rejectsCode(f.client.save(state(), {expectedSha: OLD_SHA}), 'read-required');
  }
  const f = fixture([response(metadata()), response(remoteFile()), response(metadata({default_branch: 'new-main'}))]);
  await f.client.read();
  await rejectsCode(f.client.save(state(), {expectedSha: OLD_SHA}), 'conflict');
  assert.ok(f.calls.every(call => call.init.method === 'GET'));
});

test('malformed, oversized or non-backup remote files cannot be restored or overwritten', async () => {
  for (const file of [
    remoteFile({kind: 'not-a-backup'}),
    remoteFile({...backup(), state: {version: 2}}),
    remoteFile(backup(), {content: 'invalid base64 !'}),
    remoteFile(backup(), {type: 'dir'}),
    remoteFile(backup(), {path: 'some-other-file.json'}),
    remoteFile(backup(), {size: MAX_GITHUB_BACKUP_BYTES + 1, content: '', encoding: 'none'}),
  ]) {
    const f = fixture([response(metadata()), response(file)]);
    await assert.rejects(f.client.read(), error => ['invalid-backup', 'size'].includes(error.code));
    await rejectsCode(f.client.save(state(), {expectedSha: OLD_SHA}), 'read-required');
    assert.equal(f.calls.length, 2);
  }
});

test('upload validation rejects invalid or oversized state before sending private data', async () => {
  const f = fixture([response(metadata()), response({}, 404)]);
  await f.client.read();
  await rejectsCode(f.client.save({version: 99}, {expectedSha: null}), 'invalid-state');
  const large = state(), example = large.plan.workouts[0];
  large.plan.workouts = Array.from({length: 600}, (_, i) => ({...example, id: 'entry-' + i}));
  large.progress = Object.fromEntries(large.plan.workouts.map(workout => [workout.id, {done: false, steps: {}, note: 'x'.repeat(2000), completedAt: null}]));
  await rejectsCode(f.client.save(large, {expectedSha: null}), 'size');
  assert.equal(f.calls.length, 2);
});

test('server and connection errors never include raw GitHub responses or credentials', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'forbidden'], [404, 'not-found'], [429, 'rate-limit'], [500, 'network']]) {
    const f = fixture([response({message: 'SECRET ' + TOKEN}, status)]);
    await assert.rejects(f.client.read(), error => error.code === code && !error.message.includes('SECRET') && !error.message.includes(TOKEN));
  }
  const f = fixture([new Error('Fetch failed with ' + TOKEN)]);
  await assert.rejects(f.client.read(), error => error.code === 'network' && !error.message.includes(TOKEN));
});

test('a timeout cannot be reported as a successful backup', async () => {
  const f = fixture([(url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))], {timeout: 10});
  await rejectsCode(f.client.read(), 'timeout');
});

test('disconnect cancels pending work and prevents any further use of the token', async () => {
  let pendingSignal;
  const f = fixture([(url, init) => new Promise((resolve, reject) => {
    pendingSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  })]);
  const running = f.client.read();
  await rejectsCode(f.client.read(), 'busy');
  f.client.disconnect();
  assert.equal(pendingSignal.aborted, true);
  await rejectsCode(running, 'disconnected');
  await rejectsCode(f.client.read(), 'disconnected');
  await rejectsCode(f.client.save(state(), {expectedSha: null}), 'disconnected');
  assert.equal(f.calls.length, 1);
});

test('a failed refresh invalidates the previous preview and ambiguous writes require re-reading', async () => {
  const f = fixture([response(metadata()), response(remoteFile()), response(metadata()), new Error('offline')]);
  await f.client.read();
  await rejectsCode(f.client.read(), 'network');
  await rejectsCode(f.client.save(state(), {expectedSha: OLD_SHA}), 'read-required');
  const g = fixture([response(metadata()), response(remoteFile()), response(metadata()), response({content: {path: GITHUB_BACKUP_PATH}})]);
  await g.client.read();
  await rejectsCode(g.client.save(state(), {expectedSha: OLD_SHA}), 'response');
  await rejectsCode(g.client.save(state(), {expectedSha: OLD_SHA}), 'read-required');
});
