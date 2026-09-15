import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, envelopeSalt, WrongPassphraseError } from './crypto';

describe('criptografia da sincronização', () => {
  it('cifra e decifra com a mesma senha', async () => {
    const text = JSON.stringify({ saldo: 56900, descricao: 'Almoço' });
    const env = await encryptText(text, 'minha senha forte');
    expect(env).not.toContain('Almoço');
    expect(await decryptText(env, 'minha senha forte')).toBe(text);
  });

  it('senha errada é recusada', async () => {
    const env = await encryptText('segredo', 'senha-certa');
    await expect(decryptText(env, 'senha-errada')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('reaproveitar o salt mantém a mesma senha válida e muda o conteúdo cifrado', async () => {
    const a = await encryptText('x', 'senha-123');
    const b = await encryptText('x', 'senha-123', envelopeSalt(a));
    expect(envelopeSalt(b)).toBe(envelopeSalt(a));
    expect(b).not.toBe(a);
    expect(await decryptText(b, 'senha-123')).toBe('x');
  });
});
