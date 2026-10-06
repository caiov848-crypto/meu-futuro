import { decryptText, encryptText, envelopeSalt, WrongPassphraseError } from '../lib/crypto';
import {
  applyRemote, createSerial, localResetAt, readLocal, replaceLocalWithRemote,
  setLocalResetAt, setSyncStatus, watchLocal,
} from './syncCore';
import { applyShardWrites, planPush, type Shard } from './syncMerge';

const CONFIG_KEY = 'meufuturo.autosync';
const POLL_VISIBLE_MS = 25_000;
const POLL_HIDDEN_MS = 120_000;
const PROD_ORIGIN = 'https://caiov848-crypto.github.io/meu-futuro/';
const LINK_PARAM = 'sync';

export interface SyncConfig {
  databaseUrl: string;
  bucketId: string;
  passphrase: string;
}

interface SyncBlob {
  app: 'meu-futuro';
  v: 1;
  resetAt: string;
  shards: Record<string, Shard>;
}

export function cleanDatabaseUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned;
}

/* ---------- Configuração salva neste navegador ---------- */

export function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const cfg = raw ? (JSON.parse(raw) as SyncConfig) : null;
    return cfg?.databaseUrl && cfg.bucketId && cfg.passphrase ? cfg : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SyncConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    throw new Error('Este navegador não permite salvar a configuração (modo privado?).');
  }
}

function clearConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* nada a limpar */
  }
}

export const isAutoSyncConfigured = () => loadConfig() !== null;

/* ---------- Comunicação Firebase Realtime Database ---------- */

class CloudError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readCloud(cfg: SyncConfig): Promise<string | null> {
  const url = `${cleanDatabaseUrl(cfg.databaseUrl)}/sync/${encodeURIComponent(cfg.bucketId)}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new CloudError(
      `O Firebase respondeu com erro ${res.status}. Verifique se a URL está correta e as regras do Realtime Database permitem leitura (.read: true).`,
      res.status,
    );
  }
  const data = await res.json();
  if (!data) return null;
  return typeof data.blob === 'string' ? data.blob : null;
}

async function writeCloud(cfg: SyncConfig, text: string): Promise<void> {
  const url = `${cleanDatabaseUrl(cfg.databaseUrl)}/sync/${encodeURIComponent(cfg.bucketId)}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob: text, updatedAt: new Date().toISOString() }),
  });
  if (!res.ok) {
    throw new CloudError(
      `Não foi possível salvar no Firebase (Erro ${res.status}). Verifique se as regras do Realtime Database permitem escrita (.write: true).`,
      res.status,
    );
  }
}

/* ---------- Estado de Sincronização ---------- */

let config: SyncConfig | null = null;
let remoteShards = new Map<string, Shard>();
let remoteResetAt = '';
let salt: string | undefined;
let running = false;
let stopWatching: (() => void) | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const serial = createSerial();

const effectiveReset = () => (localResetAt() > remoteResetAt ? localResetAt() : remoteResetAt);

async function decodeBlob(text: string, passphrase: string): Promise<SyncBlob> {
  const blob = JSON.parse(await decryptText(text, passphrase)) as SyncBlob;
  if (blob.app !== 'meu-futuro' || typeof blob.shards !== 'object') {
    throw new Error('Conteúdo de sincronização corrompido ou inválido.');
  }
  return blob;
}

async function encodeBlob(blob: SyncBlob, passphrase: string): Promise<string> {
  const text = await encryptText(JSON.stringify(blob), passphrase, salt);
  salt = envelopeSalt(text);
  return text;
}

let lastFetchedText = '';
async function fetchRemote(cfg: SyncConfig): Promise<boolean> {
  const text = await readCloud(cfg);
  if (text === null) return false;
  if (text === lastFetchedText) return false;

  const blob = await decodeBlob(text, cfg.passphrase);
  lastFetchedText = text;
  salt = envelopeSalt(text);
  remoteShards = new Map(Object.entries(blob.shards));
  remoteResetAt = blob.resetAt ?? '';
  if (remoteResetAt > localResetAt()) setLocalResetAt(remoteResetAt);
  return true;
}

async function cycle() {
  const cfg = config;
  if (!cfg || !running) return;
  try {
    if (await fetchRemote(cfg)) await applyRemote(remoteShards, effectiveReset());

    const lr = localResetAt();
    const reset = effectiveReset();
    const writes = planPush(await readLocal(), remoteShards, reset);
    if (writes.length || lr > remoteResetAt) {
      setSyncStatus({ state: 'saving' });
      const next = applyShardWrites(remoteShards, writes);
      const text = await encodeBlob(
        { app: 'meu-futuro', v: 1, resetAt: reset, shards: Object.fromEntries(next) },
        cfg.passphrase,
      );
      await writeCloud(cfg, text);
      lastFetchedText = text;
      remoteShards = next;
      remoteResetAt = reset;
    }
    setSyncStatus({ state: 'synced', backend: 'github', detail: '', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSyncStatus({ state: 'error', backend: 'github', detail: message });
    if (err instanceof WrongPassphraseError) stop();
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!running) return;
  const delay = document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
  pollTimer = setTimeout(() => void serial(cycle).finally(schedulePoll), delay);
}

function schedulePush(delay = 1000) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void serial(cycle), delay);
}

const onVisible = () => {
  if (document.visibilityState === 'visible' && running) {
    void serial(cycle);
    schedulePoll();
  }
};

function start(cfg: SyncConfig): Promise<void> {
  config = cfg;
  running = true;
  setSyncStatus({ state: 'connecting', backend: 'github', detail: '' });
  const first = serial(cycle);
  stopWatching?.();
  stopWatching = watchLocal(() => schedulePush(), (e) => setSyncStatus({ state: 'error', detail: String(e) }));
  document.addEventListener('visibilitychange', onVisible);
  schedulePoll();
  return first;
}

function stop() {
  running = false;
  clearTimeout(pollTimer);
  clearTimeout(pushTimer);
  stopWatching?.();
  stopWatching = null;
  document.removeEventListener('visibilitychange', onVisible);
}

/* ---------- API pública ---------- */

export async function initAutoSync(timeoutMs: number): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;
  await Promise.race([start(cfg), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function syncAutoNow() {
  if (running) void serial(cycle);
}

function encodeLinkPayload(databaseUrl: string, bucketId: string, passphrase: string): string {
  const json = JSON.stringify({ u: databaseUrl, b: bucketId, p: passphrase });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeLinkPayload(b64url: string): { databaseUrl: string; bucketId: string; passphrase: string } {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  const { u, b, p } = JSON.parse(json) as { u?: string; b?: string; p?: string };
  if (!u || !b || !p) throw new Error('Link de sincronização incompleto.');
  return { databaseUrl: u, bucketId: b, passphrase: p };
}

export function buildSyncLink(): string | null {
  const cfg = loadConfig();
  if (!cfg) return null;
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const origin = isLocal ? PROD_ORIGIN : `${window.location.origin}${window.location.pathname}`;
  return `${origin}#${LINK_PARAM}=${encodeLinkPayload(cfg.databaseUrl, cfg.bucketId, cfg.passphrase)}`;
}

function readLinkFromLocation(): { databaseUrl: string; bucketId: string; passphrase: string } | null {
  const hash = window.location.hash;
  const prefix = `#${LINK_PARAM}=`;
  if (!hash.startsWith(prefix)) return null;
  try {
    return decodeLinkPayload(hash.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function connectFromLinkIfPresent(): Promise<boolean> {
  const creds = readLinkFromLocation();
  if (!creds) return false;
  history.replaceState(null, '', window.location.pathname + window.location.search);

  await connectAutoSync(creds.databaseUrl, creds.bucketId, creds.passphrase);
  return true;
}

export async function connectAutoSync(
  databaseUrlInput: string,
  bucketIdInput?: string,
  passphraseInput?: string,
): Promise<void> {
  const databaseUrl = cleanDatabaseUrl(databaseUrlInput);
  let bucketId = bucketIdInput;
  let passphrase = passphraseInput;

  if (!bucketId || !passphrase) {
    bucketId = 'mf_' + crypto.randomUUID().slice(0, 12);
    passphrase = crypto.randomUUID() + crypto.randomUUID();
  }

  const cfg: SyncConfig = { databaseUrl, bucketId, passphrase };
  salt = undefined;
  lastFetchedText = '';

  const text = await readCloud(cfg);

  if (!text) {
    const reset = localResetAt();
    const shards = applyShardWrites(new Map(), planPush(await readLocal(), new Map(), reset));
    const newText = await encodeBlob(
      { app: 'meu-futuro', v: 1, resetAt: reset, shards: Object.fromEntries(shards) },
      passphrase,
    );
    await writeCloud(cfg, newText);
    remoteShards = shards;
    remoteResetAt = reset;
    saveConfig(cfg);
    await start(cfg);
    return;
  }

  await fetchRemote(cfg);
  await replaceLocalWithRemote(remoteShards, remoteResetAt);
  saveConfig(cfg);
  await start(cfg);
}

export function disconnectAutoSync() {
  stop();
  clearConfig();
  config = null;
  remoteShards = new Map();
  remoteResetAt = '';
  lastFetchedText = '';
  salt = undefined;
  setSyncStatus({ state: 'local', backend: 'none', detail: '', lastSyncedAt: null });
}
