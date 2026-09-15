/**
 * Criptografia ponta a ponta dos dados sincronizados.
 * AES-GCM 256 com chave derivada da senha do usuário (PBKDF2-SHA256).
 * A senha nunca sai do aparelho; a nuvem só guarda texto cifrado.
 */

const ITERATIONS = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class WrongPassphraseError extends Error {
  constructor() {
    super('Senha de sincronização incorreta.');
  }
}

interface Envelope {
  app: 'meu-futuro';
  v: 1;
  alg: 'AES-GCM-256/PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(passphrase: string, salt: string, iterations: number): Promise<CryptoKey> {
  const cacheKey = `${iterations}:${salt}:${passphrase}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: fromB64(salt) as BufferSource, iterations, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** Cifra um texto. Reaproveite `salt` de um envelope existente para não refazer a derivação. */
export async function encryptText(plain: string, passphrase: string, salt?: string): Promise<string> {
  const s = salt ?? toB64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, s, ITERATIONS);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plain));
  const env: Envelope = {
    app: 'meu-futuro', v: 1, alg: 'AES-GCM-256/PBKDF2-SHA256', iter: ITERATIONS, salt: s, iv: toB64(iv), data: toB64(new Uint8Array(cipher)),
  };
  return JSON.stringify(env);
}

export function envelopeSalt(text: string): string | undefined {
  try {
    const env = JSON.parse(text) as Partial<Envelope>;
    return typeof env.salt === 'string' ? env.salt : undefined;
  } catch {
    return undefined;
  }
}

export async function decryptText(text: string, passphrase: string): Promise<string> {
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    throw new Error('Arquivo de sincronização corrompido.');
  }
  if (env.app !== 'meu-futuro' || env.v !== 1) throw new Error('Arquivo de sincronização desconhecido.');
  const key = await deriveKey(passphrase, env.salt, env.iter);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.data) as BufferSource);
    return dec.decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}
