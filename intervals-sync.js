// Intervals.icu API bridge. The athlete's personal API key lives only in memory.
// No tracking state, backup, localStorage, sessionStorage or service-worker messages are used.
export const INTERVALS_API_BASE = 'https://intervals.icu/api/v1/athlete/0';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const numberKm = value => {
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new Error('Ungültige Laufdistanz.');
  return Math.round(n * 1000);
};
const distanceToken = meters => meters % 1000 === 0 ? (meters / 1000) + 'km' : meters + 'mtr';

export function canSyncRunningWorkout(workout) {
  return Boolean(workout && ['easy', 'interval'].includes(workout.runKind) &&
    Number.isFinite(workout.runDistanceKm) && workout.runDistanceKm > 0 &&
    Array.isArray(workout.steps) && DATE.test(workout.date));
}

export function structuredRun(workout) {
  if (!canSyncRunningWorkout(workout)) {
    throw new Error('Für dieses Training fehlen eindeutige Laufabschnitte. Es wird nichts übertragen.');
  }
  const total = Math.round(workout.runDistanceKm * 1000);
  if (workout.runKind === 'easy') {
    const run = workout.steps.find(step => step.id === 'run');
    const match = run && /^Dauerlauf\s*·\s*(\d+(?:,\d+)?)\s*km/u.exec(run.title);
    if (!match || numberKm(match[1]) !== total) {
      throw new Error('Dauerlauf und Distanz stimmen nicht überein. Bitte den Plan in Pista prüfen.');
    }
    return {kind: 'easy', total, effort: '3–4/10'};
  }
  const run = workout.steps.find(step => step.id === 'run');
  const title = run && /^Intervalle\s*·\s*(\d+)\s*×\s*(\d+)\s*m\s*·\s*(\d+(?:,\d+)?)\s*km gesamt$/u.exec(run.title);
  const warmStep = workout.steps.find(step => step.id === 'run-warmup');
  const warm = warmStep
    ? /^Einlaufen\s*·\s*(\d+(?:,\d+)?)\s*km/u.exec(warmStep.title)
    : run && /(\d+(?:,\d+)?)\s*km locker einlaufen/u.exec(run.details);
  const recovery = run && /dazwischen jeweils\s+(\d+)\s*m/u.exec(run.details);
  const cool = run && /zuletzt\s+(\d+(?:,\d+)?)\s*km locker auslaufen/u.exec(run.details);
  const effort = run && /Anstrengung\s+(\d+)\/10/u.exec(run.details);
  if (!title || !warm || !recovery || !cool || !effort) {
    throw new Error('Die Intervalle können nicht zuverlässig gelesen werden. Keine Übertragung.');
  }
  const reps = Number(title[1]), fast = Number(title[2]), recover = Number(recovery[1]);
  const warmMeters = numberKm(warm[1]), coolMeters = numberKm(cool[1]);
  const rpe = Number(effort[1]);
  if (reps < 1 || reps > 30 || fast < 50 || fast > 10000 || recover < 50 || recover > 10000 ||
      rpe < 1 || rpe > 10 || total !== numberKm(title[3]) ||
      warmMeters + reps * fast + (reps - 1) * recover + coolMeters !== total) {
    throw new Error('Intervall-Wiederholungen, Pausen oder Gesamtdistanz widersprechen dem Plan. Keine Übertragung.');
  }
  return {kind: 'interval', total, reps, fast, recover, warmMeters, coolMeters, effort: rpe};
}

export function buildIntervalsEvent(workout, planId) {
  if (typeof planId !== 'string' || !planId || !/^[\w.-]{1,120}$/.test(planId) ||
      typeof workout?.id !== 'string' || !/^[\w.-]{1,120}$/.test(workout.id)) {
    throw new Error('Die Trainings-ID kann nicht sicher übertragen werden.');
  }
  const run = structuredRun(workout);
  let lines;
  if (run.kind === 'easy') {
    lines = ['Dauerlauf', '- Locker im Sprechtempo, Zone 2 (Anstrengung 3 bis 4 von 10) ' +
      distanceToken(run.total) + ' intensity=active'];
  } else {
    lines = [
      'Aufwaermen',
      '- Locker einlaufen ' + distanceToken(run.warmMeters) + ' intensity=warmup',
      '',
      'Intervalle kontrolliert, kein Sprint'
    ];
    for (let i = 0; i < run.reps; i++) {
      lines.push('- Zuegig, Anstrengung ' + run.effort + ' von 10 ' +
        distanceToken(run.fast) + ' intensity=active');
      if (i < run.reps - 1) {
        lines.push('- Sehr locker traben ' + distanceToken(run.recover) + ' intensity=recovery');
      }
    }
    lines.push('', 'Auslaufen',
      '- Locker auslaufen ' + distanceToken(run.coolMeters) + ' intensity=cooldown');
  }
  const externalId = 'pista:v1:' + planId + ':' + workout.id;
  if (externalId.length > 255) throw new Error('Die Trainings-ID ist zu lang.');
  return {
    category: 'WORKOUT',
    type: 'Run',
    external_id: externalId,
    start_date_local: workout.date + 'T00:00:00',
    name: ('Pista · ' + workout.title).slice(0, 120),
    description: lines.join('\n')
  };
}

export function createIntervalsClient({fetchImpl = globalThis.fetch, base = INTERVALS_API_BASE} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch fehlt.');
  if (base !== INTERVALS_API_BASE) throw new Error('Nur die offizielle Intervals.icu-API ist erlaubt.');
  let secret = null;

  async function request(route, method, body, credential) {
    const headers = {Authorization: 'Basic ' + btoa('API_KEY:' + credential)};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(base + route, {
        method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        mode: 'cors', cache: 'no-store', credentials: 'omit',
        redirect: 'error', referrerPolicy: 'no-referrer'
      });
    } catch {
      throw new Error('Intervals.icu ist nicht erreichbar. Internetverbindung und Browserzugriff prüfen.');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Intervals.icu hat den API-Schlüssel abgelehnt.');
      if (response.status === 429) throw new Error('Intervals.icu begrenzt gerade Anfragen. Bitte später erneut versuchen.');
      throw new Error('Intervals.icu hat mit HTTP ' + response.status + ' geantwortet.');
    }
    try { return await response.json(); }
    catch { throw new Error('Intervals.icu hat keine lesbare Antwort zurückgegeben.'); }
  }

  return {
    get connected() { return Boolean(secret); },
    async connect(value, day) {
      if (typeof value !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(value)) {
        throw new Error('Bitte einen gültigen API-Schlüssel ohne Leerzeichen eingeben.');
      }
      if (!DATE.test(day)) throw new Error('Ungültiges Datum.');
      // Verify calendar access before retaining the key in the session.
      const list = await request('/events?oldest=' + day + '&newest=' + day, 'GET', undefined, value);
      if (!Array.isArray(list)) throw new Error('Intervals.icu hat die Kalenderverbindung nicht bestätigt.');
      secret = value;
      return true;
    },
    async sync(planId, workouts) {
      if (!secret) throw new Error('Bitte zuerst mit Intervals.icu verbinden.');
      if (!Array.isArray(workouts) || !workouts.length || workouts.length > 50) {
        throw new Error('Bitte ein bis 50 Lauftrainings auswählen.');
      }
      // Fail closed: validate every workout before making any network write.
      const events = workouts.map(workout => buildIntervalsEvent(workout, planId));
      const ids = new Set(events.map(event => event.external_id));
      if (ids.size !== events.length) throw new Error('Doppelte Trainings-ID. Keine Übertragung.');
      const saved = await request('/events/bulk?upsert=true', 'POST', events, secret);
      if (!Array.isArray(saved) || saved.length !== events.length ||
          events.some(event => !saved.some(row => row.external_id === event.external_id &&
            row.category === 'WORKOUT' && row.type === 'Run' &&
            Array.isArray(row.workout_doc?.steps) && row.workout_doc.steps.length))) {
        throw new Error('Intervals.icu konnte die Trainingsstruktur nicht bestätigen. Bitte dort den Kalender prüfen, bevor du erneut synchronisierst.');
      }
      return {count: saved.length, events: saved};
    },
    disconnect() { secret = null; }
  };
}
