import { decryptText, encryptText, envelopeSalt, WrongPassphraseError } from '../lib/crypto';
import {
  applyRemote, createSerial, localResetAt, readLocal, replaceLocalWithRemote,
  setLocalResetAt, setSyncStatus, watchLocal,
} from './syncCore';
import { applyShardWrites, planPush, type Shard } from './syncMerge';

const CONFIG_KEY = 'meufuturo.autosync';
const KEY = 'data';
const API = 'https://kvdb.io';
const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 60_000;

interface SyncConfig {
  bucketId: string;
  passphrase: string;
}

interface SyncBlob {
  app: 'meu-futuro';
  v: 1;
  resetAt: string;
  shards: Record<string, Shard>;
}

/* ---------- Configuração salva neste navegador ---------- */

export function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const cfg = raw ? (JSON.parse(raw) as SyncConfig) : null;
    return cfg?.bucketId && cfg.passphrase ? cfg : null;
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

/* ---------- API KVDB ---------- */

class CloudError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function createBucket(): Promise<string> {
  const body = new URLSearchParams();
  body.append('email', 'sync@meufuturo.com');
  const res = await fetch(API, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new CloudError('Não foi possível criar o espaço de sincronização na nuvem.', res.status);
  return res.text();
}

async function readCloud(bucketId: string): Promise<string | null> {
  const res = await fetch(`${API}/${bucketId}/${KEY}`, { cache: 'no-store' });
  if (res.status === 404) return null; // No data yet
  if (!res.ok) throw new CloudError(`O servidor respondeu com erro ${res.status}.`, res.status);
  return res.text();
}

async function writeCloud(bucketId: string, text: string): Promise<void> {
  const res = await fetch(`${API}/${bucketId}/${KEY}`, {
    method: 'POST',
    body: text,
  });
  if (!res.ok) throw new CloudError(`Não foi possível salvar na nuvem (Erro ${res.status}).`, res.status);
}

/* ---------- Estado ---------- */

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
  if (blob.app !== 'meu-futuro' || typeof blob.shards !== 'object') throw new Error('Conteúdo de sincronização inválido.');
  return blob;
}

async function encodeBlob(blob: SyncBlob, passphrase: string): Promise<string> {
  const text = await encryptText(JSON.stringify(blob), passphrase, salt);
  salt = envelopeSalt(text);
  return text;
}

/** Busca na nuvem; devolve `true` se havia novidade (neste caso simulamos um ETG ou apenas lemos). */
let lastFetchedText = '';
async function fetchRemote(cfg: SyncConfig): Promise<boolean> {
  const text = await readCloud(cfg.bucketId);
  if (!text) return false;
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
      const text = await encodeBlob({ app: 'meu-futuro', v: 1, resetAt: reset, shards: Object.fromEntries(next) }, cfg.passphrase);
      await writeCloud(cfg.bucketId, text);
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

function schedulePush(delay = 1200) {
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

const LINK_PARAM = 'sync';

function encodeLinkPayload(bucketId: string, passphrase: string): string {
  const json = JSON.stringify({ b: bucketId, p: passphrase });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeLinkPayload(b64url: string): { bucketId: string; passphrase: string } {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  const { b, p } = JSON.parse(json) as { b?: string; p?: string };
  if (!b || !p) throw new Error('Link de sincronização incompleto.');
  return { bucketId: b, passphrase: p };
}

export function buildSyncLink(origin = `${window.location.origin}${window.location.pathname}`): string | null {
  const cfg = loadConfig();
  if (!cfg) return null;
  return `${origin}#${LINK_PARAM}=${encodeLinkPayload(cfg.bucketId, cfg.passphrase)}`;
}

function readLinkFromLocation(): { bucketId: string; passphrase: string } | null {
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
  
  await connectAutoSync(creds.bucketId, creds.passphrase);
  return true;
}

export async function connectAutoSync(bucketIdInput?: string, passphraseInput?: string): Promise<void> {
  let bucketId = bucketIdInput;
  let passphrase = passphraseInput;

  if (!bucketId || !passphrase) {
    bucketId = await createBucket();
    passphrase = crypto.randomUUID() + crypto.randomUUID(); // Chave forte e aleatória
  }

  salt = undefined;
  lastFetchedText = '';

  const text = await readCloud(bucketId);
  
  if (!text) {
    const reset = localResetAt();
    const shards = applyShardWrites(new Map(), planPush(await readLocal(), new Map(), reset));
    const newText = await encodeBlob({ app: 'meu-futuro', v: 1, resetAt: reset, shards: Object.fromEntries(shards) }, passphrase);
    await writeCloud(bucketId, newText);
    const cfg = { bucketId, passphrase };
    remoteShards = shards;
    remoteResetAt = reset;
    saveConfig(cfg);
    await start(cfg);
    return;
  }

  const cfg = { bucketId, passphrase };
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
