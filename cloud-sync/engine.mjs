/** Draft automatic progress synchronization; not wired into the production UI.
 * One independent last-writer-wins register per workout field. Logical clocks
 * avoid depending on device wall clocks. The server must use the SAME ordering.
 * Access control belongs to the authenticated server, never to this merge code.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const ACTOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const copy = value => structuredClone(value);
const cellKey = row => row.workout_id + ':' + row.field;
const compare = (a, b) => a.stamp - b.stamp || (a.actor > b.actor ? 1 : a.actor < b.actor ? -1 : 0);

export function validateCell(input) {
  if (!input || !ID.test(input.workout_id) || !ACTOR.test(input.actor) ||
      !Number.isSafeInteger(input.stamp) || input.stamp < 1 || input.stamp > 9_000_000_000_000_000 ||
      !['done', 'note'].includes(input.field) ||
      (input.field === 'done' ? typeof input.value !== 'boolean' :
        typeof input.value !== 'string' || input.value.length > 2000)) {
    throw new Error('Ungültige Synchronisationsdaten.');
  }
  return {workout_id: input.workout_id, field: input.field, value: input.value,
    stamp: input.stamp, actor: input.actor};
}

export function mergeCells(...lists) {
  const cells = new Map();
  for (const list of lists) {
    if (!Array.isArray(list) || list.length > 10000) throw new Error('Ungültiger Datenumfang.');
    for (const value of list) {
      const row = validateCell(value), previous = cells.get(cellKey(row));
      if (!previous || compare(row, previous) > 0) cells.set(cellKey(row), row);
      else if (compare(row, previous) === 0 && row.value !== previous.value) {
        throw new Error('Widersprüchliche Synchronisationsversion.');
      }
    }
  }
  return [...cells.values()].sort((a, b) => cellKey(a).localeCompare(cellKey(b), 'en'));
}

export function toProgress(rows) {
  const progress = Object.create(null);
  for (const row of mergeCells(rows)) {
    const p = progress[row.workout_id] ||= {done: false, note: '', steps: {}, completedAt: null};
    p[row.field] = row.value;
  }
  return progress;
}

/**
 * transport.exchange(changes) returns {rows:[...]} from one atomic authenticated
 * server transaction. transport.subscribe(callback) is optional and returns an
 * unsubscribe function. Use separate browser storage in cross-device tests.
 * No passwords, tokens, URLs or plan descriptions are stored by this module.
 */
export function createSyncEngine({storage, userId, planId, transport,
  actor = globalThis.crypto.randomUUID(), onChange = () => {}, onStatus = () => {},
  intervalMs = 15000, isVisible = () => true}) {
  if (!storage || !userId || !ID.test(planId) || !ACTOR.test(actor) ||
      typeof transport?.exchange !== 'function') throw new Error('Synchronisierung nicht eingerichtet.');
  const prefix = `pista.sync.v1:${encodeURIComponent(userId)}:${planId}:`;
  const cacheKey = prefix + 'cache', pendingPrefix = prefix + 'pending:';
  let running = false, inFlight = null, timer = null, unsubscribe = null, refreshAgain = false;

  function cache() {
    const raw = storage.getItem(cacheKey);
    return raw === null ? [] : mergeCells(JSON.parse(raw));
  }
  function pending() {
    const result = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(pendingPrefix)) {
        const raw = storage.getItem(key);
        if (raw !== null) result.push({key, raw, row: validateCell(JSON.parse(raw))});
      }
    }
    return result.sort((a, b) => compare(a.row, b.row));
  }
  function rows() { return mergeCells(cache(), pending().map(entry => entry.row)); }
  function publish() { const value = rows(); onChange(toProgress(value)); return value; }
  function status(kind, queued = pending().length) {onStatus({kind, queued});}
  function nudge() {
    if (!running) return;
    if (inFlight) {refreshAgain = true; return;}
    void flush().catch(() => {});
  }

  function set(workoutId, field, value) {
    const all = rows();
    const stamp = Math.max(0, ...all.map(row => row.stamp), ...pending().map(x => x.row.stamp)) + 1;
    const row = validateCell({workout_id: workoutId, field, value, stamp, actor});
    // A failed write throws before optimistic UI or network publication. Each
    // operation has its own key: another tab cannot replace the whole outbox.
    storage.setItem(pendingPrefix + actor + '.' + stamp, JSON.stringify(row));
    publish(); status('pending'); nudge(); return copy(row);
  }

  function flush() {
    if (inFlight) return inFlight;
    const task = (async () => {
      let sent;
      try {
        sent = pending().slice(0, 100);
        status('syncing');
        const response = await transport.exchange(sent.map(entry => copy(entry.row)));
        const remote = mergeCells(response?.rows);
        const indexed = new Map(remote.map(row => [cellKey(row), row]));
        // An HTTP success is NOT enough: every submitted mutation must be in
        // the canonical response or superseded by a deterministically newer one.
        for (const {row} of sent) {
          const accepted = indexed.get(cellKey(row));
          if (!accepted || compare(accepted, row) < 0 ||
              (compare(accepted, row) === 0 && accepted.value !== row.value)) {
            throw new Error('Der Server hat die Änderung nicht bestätigt.');
          }
        }
        const combined = mergeCells(cache(), remote);
        storage.setItem(cacheKey, JSON.stringify(combined));
        for (const entry of sent) {
          if (storage.getItem(entry.key) === entry.raw) storage.removeItem(entry.key);
        }
        publish(); status(pending().length ? 'pending' : 'synced');
        return copy(combined);
      } catch (error) {
        // Never report success or discard an outbox after network/auth/storage
        // failure; the caller retains the original error for its safe UI mapping.
        onStatus({kind: 'error', queued: sent?.length ?? 0});
        throw error;
      }
    })();
    inFlight = task;
    task.then(() => {
      inFlight = null;
      const repeat = refreshAgain || pending().length > 0;
      refreshAgain = false;
      if (running && repeat) queueMicrotask(nudge);
    }, () => {inFlight = null;});
    return task;
  }

  async function start() {
    if (running) return inFlight;
    // Validate old data before enabling writes. Corruption is not silently reset.
    publish(); running = true;
    if (transport.subscribe) unsubscribe = transport.subscribe(nudge);
    if (intervalMs > 0) timer = setInterval(() => {if (isVisible()) nudge();}, intervalMs);
    return flush();
  }
  function stop() {running = false; clearInterval(timer); timer = null; unsubscribe?.(); unsubscribe = null;}
  return {set, flush, start, stop, snapshot: () => toProgress(rows()), pendingCount: () => pending().length};
}
