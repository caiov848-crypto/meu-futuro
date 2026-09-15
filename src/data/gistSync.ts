/**
 * Sincronização pelo GitHub (para o site publicado fora do claude.ai).
 *
 * Os dados ficam num Gist secreto da conta do usuário, criptografados com a
 * senha de sincronização escolhida por ele (ver `lib/crypto.ts`). Cada aparelho:
 * lê o Gist periodicamente (requisições condicionais, baratas), aplica o que for
 * mais novo e, quando há mudança local, lê → combina → grava.
 * Token e senha ficam apenas no navegador deste aparelho.
 */
import { decryptText, encryptText, envelopeSalt, WrongPassphraseError } from '../lib/crypto';
import {
  applyRemote, createSerial, hasMeaningfulLocalData, localResetAt, readLocal, replaceLocalWithRemote,
  restampAllLocal, setLocalResetAt, setSyncStatus, watchLocal,
} from './syncCore';
import { applyShardWrites, planPush, type Shard } from './syncMerge';

const CONFIG_KEY = 'meufuturo.github';
const FILE = 'meu-futuro-sync.json';
const DESCRIPTION = 'Meu Futuro - sincronização (criptografada)';
const API = 'https://api.github.com';
const POLL_VISIBLE_MS = 8_000;
const POLL_HIDDEN_MS = 60_000;

interface GistConfig {
  token: string;
  passphrase: string;
  gistId: string;
}

interface SyncBlob {
  app: 'meu-futuro';
  v: 1;
  resetAt: string;
  shards: Record<string, Shard>;
}

/* ---------- Configuração salva neste navegador ---------- */

function loadConfig(): GistConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const cfg = raw ? (JSON.parse(raw) as GistConfig) : null;
    return cfg?.token && cfg.passphrase && cfg.gistId ? cfg : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: GistConfig) {
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

export const isGithubConfigured = () => loadConfig() !== null;

/* ---------- API do GitHub ---------- */

class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function gh(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GithubError('Sem conexão com o GitHub. As alterações ficam salvas aqui e serão enviadas depois.', 0);
  }
  if (res.ok || res.status === 304) return res;
  if (res.status === 401) throw new GithubError('Token do GitHub inválido ou expirado.', 401);
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new GithubError('Limite de uso da API do GitHub atingido; tentando de novo em alguns minutos.', 403);
  }
  if (res.status === 403 || res.status === 404) {
    throw new GithubError('O token precisa da permissão "gist" (Gists: leitura e escrita).', res.status);
  }
  throw new GithubError(`O GitHub respondeu com erro ${res.status}.`, res.status);
}

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface GistJson { id: string; description?: string; files: Record<string, GistFile> }

async function findGist(token: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const list = (await (await gh(token, `/gists?per_page=100&page=${page}`)).json()) as GistJson[];
    const hit = list.find((g) => g.files && FILE in g.files);
    if (hit) return hit.id;
    if (list.length < 100) return null;
  }
  return null;
}

async function readGist(token: string, id: string, etag: string | null): Promise<{ notModified: true } | { notModified: false; etag: string | null; text: string }> {
  const res = await gh(token, `/gists/${id}`, etag ? { headers: { 'If-None-Match': etag } } : {});
  if (res.status === 304) return { notModified: true };
  const json = (await res.json()) as GistJson;
  const file = json.files?.[FILE];
  if (!file) throw new GithubError('O Gist de sincronização foi alterado ou apagado.', 404);
  let text = file.content ?? '';
  if (file.truncated && file.raw_url) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  return { notModified: false, etag: res.headers.get('etag'), text };
}

async function writeGist(token: string, id: string | null, text: string): Promise<string> {
  const body = JSON.stringify({ description: DESCRIPTION, ...(id ? {} : { public: false }), files: { [FILE]: { content: text } } });
  const res = await gh(token, id ? `/gists/${id}` : '/gists', { method: id ? 'PATCH' : 'POST', body });
  return ((await res.json()) as GistJson).id;
}

/* ---------- Estado ---------- */

let config: GistConfig | null = null;
let remoteShards = new Map<string, Shard>();
let remoteResetAt = '';
let etag: string | null = null;
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

/** Busca o Gist; devolve `true` se havia novidade. */
async function fetchRemote(cfg: GistConfig): Promise<boolean> {
  const r = await readGist(cfg.token, cfg.gistId, etag);
  if (r.notModified) return false;
  const blob = await decodeBlob(r.text, cfg.passphrase);
  salt = envelopeSalt(r.text);
  etag = r.etag;
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
      await writeGist(cfg.token, cfg.gistId, text);
      remoteShards = next;
      remoteResetAt = reset;
      etag = null;
    }
    setSyncStatus({ state: 'synced', backend: 'github', detail: '', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSyncStatus({ state: 'error', backend: 'github', detail: message });
    if (err instanceof WrongPassphraseError || (err instanceof GithubError && err.status === 401)) stop();
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

function start(cfg: GistConfig): Promise<void> {
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

/** Liga a sincronização salva neste navegador, esperando a primeira leitura. */
export async function initGistSync(timeoutMs: number): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;
  await Promise.race([start(cfg), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function syncGistNow() {
  if (running) void serial(cycle);
}

let pending: GistConfig | null = null;

export type ConnectResult = { kind: 'created' } | { kind: 'found'; hasLocalData: boolean };

/**
 * Primeiro passo da conexão: valida o token, procura o Gist e testa a senha.
 * Se não existir, cria com os dados deste aparelho e já começa a sincronizar.
 */
export async function connectGithub(tokenInput: string, passphraseInput: string): Promise<ConnectResult> {
  const token = tokenInput.trim();
  const passphrase = passphraseInput;
  if (!token) throw new Error('Cole o token do GitHub.');
  if (passphrase.length < 8) throw new Error('A senha de sincronização precisa ter pelo menos 8 caracteres.');

  const gistId = await findGist(token);
  if (!gistId) {
    salt = undefined;
    const reset = localResetAt();
    const shards = applyShardWrites(new Map(), planPush(await readLocal(), new Map(), reset));
    const text = await encodeBlob({ app: 'meu-futuro', v: 1, resetAt: reset, shards: Object.fromEntries(shards) }, passphrase);
    const id = await writeGist(token, null, text);
    const cfg = { token, passphrase, gistId: id };
    saveConfig(cfg);
    remoteShards = shards;
    remoteResetAt = reset;
    etag = null;
    await start(cfg);
    return { kind: 'created' };
  }

  // Existe: confirma a senha antes de qualquer mudança.
  etag = null;
  const cfg = { token, passphrase, gistId };
  await fetchRemote(cfg);
  pending = cfg;
  return { kind: 'found', hasLocalData: await hasMeaningfulLocalData() };
}

export type FinishMode = 'useCloud' | 'useThisDevice' | 'merge';

/** Segundo passo quando já existe sincronização: decide o que fazer com os dados deste aparelho. */
export async function finishGithubConnect(mode: FinishMode): Promise<void> {
  const cfg = pending;
  if (!cfg) throw new Error('Conecte novamente.');
  if (mode === 'useCloud') await replaceLocalWithRemote(remoteShards, remoteResetAt);
  if (mode === 'useThisDevice') await restampAllLocal(new Date().toISOString());
  saveConfig(cfg);
  pending = null;
  await start(cfg);
}

export function cancelGithubConnect() {
  pending = null;
}

/** Desliga a sincronização neste aparelho. Os dados locais e a cópia na nuvem continuam. */
export function disconnectGithub() {
  stop();
  clearConfig();
  config = null;
  remoteShards = new Map();
  remoteResetAt = '';
  etag = null;
  salt = undefined;
  setSyncStatus({ state: 'local', backend: 'none', detail: '', lastSyncedAt: null });
}
