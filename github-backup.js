// Optional manual backup. Credentials live only in this client instance, never
// in training state, browser storage, URLs or application source.
import {MAX_FILE_BYTES, normalizeState} from './core.js';

export const GITHUB_BACKUP_PATH = 'backups/pista-backup.json';
// The GitHub Contents API supplies inline Base64 content up to 1 MiB.
export const MAX_GITHUB_BACKUP_BYTES = Math.min(MAX_FILE_BYTES, 1024 * 1024);
const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

export class GitHubBackupError extends Error {
  constructor(code, message) { super(message); this.name = 'GitHubBackupError'; this.code = code; }
}
const fail = (code, message) => { throw new GitHubBackupError(code, message); };

export function parseGitHubRepository(value) {
  if (typeof value !== 'string') fail('config', 'Bitte das private Repository als Name/Repository angeben.');
  let repository = value.trim();
  if (/^https:/i.test(repository)) {
    let url;
    try { url = new URL(repository); } catch { fail('config', 'Bitte eine gültige GitHub-Repository-Adresse angeben.'); }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) {
      fail('config', 'Bitte nur ein Repository auf github.com angeben.');
    }
    repository = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  repository = repository.replace(/\.git$/, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(repository) || ['.', '..'].includes(repository.split('/')[1])) {
    fail('config', 'Bitte das private Repository als Name/Repository angeben.');
  }
  return repository;
}

function encodeBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > MAX_GITHUB_BACKUP_BYTES * 1.5) fail('invalid-backup', 'Die GitHub-Sicherung ist zu groß oder nicht lesbar.');
  const clean = value.replace(/[\r\n\t ]/g, '');
  if (!clean || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) {
    fail('invalid-backup', 'Die Datei auf GitHub ist keine lesbare Pista-Sicherung.');
  }
  try {
    const bytes = Uint8Array.from(atob(clean), character => character.charCodeAt(0));
    if (bytes.length > MAX_GITHUB_BACKUP_BYTES) fail('size', 'Die GitHub-Sicherung darf höchstens 1 MB groß sein.');
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch (error) {
    if (error instanceof GitHubBackupError) throw error;
    fail('invalid-backup', 'Die Datei auf GitHub ist keine lesbare Pista-Sicherung.');
  }
}

function validateBackup(value) {
  if (value?.kind !== 'pista-backup' || value.schemaVersion !== 1 || typeof value.exportedAt !== 'string' ||
      value.exportedAt.length > 80 || !Number.isFinite(Date.parse(value.exportedAt))) {
    fail('invalid-backup', 'Die Datei auf GitHub ist keine gültige Pista-Sicherung.');
  }
  let state;
  try { state = normalizeState(value.state); }
  catch { fail('invalid-backup', 'Die GitHub-Sicherung enthält keinen gültigen Trainingsstand. Deine Daten wurden nicht verändert.'); }
  return {kind: 'pista-backup', schemaVersion: 1, exportedAt: value.exportedAt, state};
}

async function limitedText(response, maxBytes) {
  const declared = Number(response.headers?.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) fail('size', 'Die Antwort von GitHub ist zu groß.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) fail('size', 'Die Antwort von GitHub ist zu groß.');
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); fail('size', 'Die Antwort von GitHub ist zu groß.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

/**
 * createGitHubBackup({repository, token, fetcher?, timeout?})
 *
 * read(): {repository, branch, path, sha, backup}
 *   sha/backup are null only after GitHub confirms that the backup file is absent.
 * save(state, {expectedSha}): {repository, branch, path, sha, exportedAt, backup}
 *   Requires a successful read and its exact sha (including null for a new file).
 * disconnect(): forget credentials and abort outstanding requests.
 *
 * Restoring the returned state and persisting non-secret UI preferences belong to
 * the caller. This module never mutates local training data or browser storage.
 */
export function createGitHubBackup({repository, token, fetcher = globalThis.fetch, timeout = 15000} = {}) {
  const target = parseGitHubRepository(repository);
  if (typeof token !== 'string' || !/^github_pat_[a-zA-Z0-9_]{20,250}$/.test(token.trim())) {
    fail('token', 'Bitte einen feingranularen GitHub-Token für dieses private Repository eingeben.');
  }
  if (typeof fetcher !== 'function') fail('unsupported', 'Dieser Browser unterstützt die GitHub-Sicherung nicht.');
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000) fail('config', 'Die GitHub-Verbindung konnte nicht eingerichtet werden.');
  let credential = token.trim(), busy = false, snapshot = null;
  const controllers = new Set();
  const repoPath = '/repos/' + target.split('/').map(encodeURIComponent).join('/');
  const filePath = repoPath + '/contents/' + GITHUB_BACKUP_PATH;
  const assertConnected = () => { if (!credential) fail('disconnected', 'Bitte erneut mit GitHub verbinden.'); };

  async function request(path, {method = 'GET', body, missing = false, maxBytes = 2 * 1024 * 1024} = {}) {
    assertConnected();
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
      const response = await fetcher(API + path, {
        method, mode: 'cors', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: {'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + credential,
          'X-GitHub-Api-Version': API_VERSION, ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
      assertConnected();
      if (response.redirected || (response.url && new URL(response.url).origin !== API)) fail('network', 'Die GitHub-Adresse hat sich geändert. Bitte die Verbindung neu einrichten.');
      if (response.status === 404 && missing) return null;
      if (!response.ok) {
        if (response.status === 401) fail('auth', 'Der GitHub-Token ist ungültig oder abgelaufen. Bitte erneuern.');
        if (response.status === 403) fail('forbidden', 'GitHub verweigert den Zugriff. Prüfe Token-Rechte und versuche es später erneut.');
        if (response.status === 404) fail('not-found', 'Das private Repository wurde nicht gefunden. Prüfe Namen und Token-Zugriff.');
        if (response.status === 409 || response.status === 422) fail('conflict', 'Die GitHub-Sicherung hat sich geändert oder konnte nicht geschrieben werden. Bitte neu laden und vergleichen.');
        if (response.status === 429) fail('rate-limit', 'GitHub erhält gerade zu viele Anfragen. Bitte später erneut versuchen.');
        fail('network', 'GitHub ist gerade nicht erreichbar. Bitte später erneut versuchen.');
      }
      const text = await limitedText(response, maxBytes);
      assertConnected();
      try { return JSON.parse(text); }
      catch { fail('response', 'GitHub hat keine lesbare Antwort geliefert. Bitte erneut versuchen.'); }
    } catch (error) {
      if (error instanceof GitHubBackupError) throw error;
      if (!credential) fail('disconnected', 'Die Verbindung zu GitHub wurde getrennt.');
      if (timedOut) fail('timeout', 'GitHub antwortet nicht rechtzeitig. Bitte erneut versuchen.');
      fail('network', 'Keine Verbindung zu GitHub. Bitte Internetverbindung prüfen.');
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }

  async function privateRepository() {
    const meta = await request(repoPath, {maxBytes: 128 * 1024});
    if (typeof meta?.full_name !== 'string' || meta.full_name.toLowerCase() !== target.toLowerCase()) {
      fail('repository-mismatch', 'Die GitHub-Antwort gehört nicht zum gewählten Repository.');
    }
    if (meta.private !== true || (meta.visibility && meta.visibility !== 'private')) {
      fail('public-repository', 'Sicherungen sind nur in einem privaten Repository erlaubt. Bitte ein separates privates Repository wählen.');
    }
    if (meta.archived === true || meta.disabled === true || meta.permissions?.push === false) {
      fail('read-only', 'Dieses Repository ist schreibgeschützt. Wähle ein beschreibbares privates Repository.');
    }
    if (typeof meta.default_branch !== 'string' || !meta.default_branch || meta.default_branch.length > 255) {
      fail('response', 'Die GitHub-Verbindung konnte nicht geprüft werden.');
    }
    return {repository: meta.full_name, branch: meta.default_branch, path: GITHUB_BACKUP_PATH};
  }

  async function serialized(operation) {
    assertConnected();
    if (busy) fail('busy', 'Eine GitHub-Anfrage läuft bereits. Bitte kurz warten.');
    busy = true;
    try { return await operation(); }
    finally { busy = false; }
  }

  return {
    read() {
      return serialized(async () => {
        snapshot = null;
        const meta = await privateRepository();
        const file = await request(filePath + '?ref=' + encodeURIComponent(meta.branch), {missing: true});
        if (file === null) {
          snapshot = {...meta, sha: null};
          return {...snapshot, backup: null};
        }
        if (file.type !== 'file' || file.path !== GITHUB_BACKUP_PATH || !SHA.test(file.sha || '') ||
            typeof file.size !== 'number' || file.size < 0) fail('invalid-backup', 'Die Datei auf GitHub ist keine lesbare Pista-Sicherung.');
        if (file.size > MAX_GITHUB_BACKUP_BYTES) fail('size', 'Die GitHub-Sicherung darf höchstens 1 MB groß sein.');
        if (file.encoding !== 'base64') fail('invalid-backup', 'Die Datei auf GitHub ist keine lesbare Pista-Sicherung.');
        let data;
        try { data = JSON.parse(decodeBase64(file.content)); }
        catch (error) {
          if (error instanceof GitHubBackupError) throw error;
          fail('invalid-backup', 'Die Datei auf GitHub ist keine gültige Pista-Sicherung.');
        }
        const backup = validateBackup(data);
        snapshot = {...meta, sha: file.sha};
        return {...snapshot, backup};
      });
    },
    save(state, {expectedSha} = {}) {
      return serialized(async () => {
        if (!snapshot || expectedSha !== snapshot.sha) fail('read-required', 'Bitte die GitHub-Sicherung zuerst laden und prüfen.');
        let normalized;
        try { normalized = normalizeState(state); }
        catch { fail('invalid-state', 'Der aktuelle Trainingsstand ist nicht gültig und wurde nicht hochgeladen.'); }
        const backup = {kind: 'pista-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), state: normalized};
        const bytes = new TextEncoder().encode(JSON.stringify(backup, null, 2));
        if (bytes.length > MAX_GITHUB_BACKUP_BYTES) fail('size', 'Die GitHub-Sicherung darf höchstens 1 MB groß sein. Bitte stattdessen eine Datei-Sicherung herunterladen.');
        const meta = await privateRepository();
        if (meta.branch !== snapshot.branch) { snapshot = null; fail('conflict', 'Der GitHub-Zweig hat sich geändert. Bitte die Sicherung erneut laden.'); }
        // Even an interrupted write can already have reached GitHub. Re-read
        // before retrying so a timeout cannot silently overwrite newer data.
        snapshot = null;
        const result = await request(filePath, {method: 'PUT', body: {
          message: 'Pista: Trainingsstand sichern', content: encodeBase64(bytes), branch: meta.branch,
          ...(expectedSha !== null ? {sha: expectedSha} : {}),
        }, maxBytes: 256 * 1024});
        // A failed response is never advertised as a successful remote backup.
        if (result?.content?.path !== GITHUB_BACKUP_PATH || !SHA.test(result.content.sha || '')) {
          fail('response', 'GitHub hat die Sicherung nicht eindeutig bestätigt. Bitte den Stand erneut laden.');
        }
        return {...meta, sha: result.content.sha, exportedAt: backup.exportedAt, backup};
      });
    },
    disconnect() {
      credential = ''; snapshot = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
