/**
 * Entrega um arquivo gerado ao usuário.
 * No claude.ai o download direto é bloqueado: usa a capability `downloads`
 * (o usuário confirma). Fora dele, download normal do navegador.
 */
export type SaveOutcome = 'saved' | 'declined';

interface DownloadsApi {
  save(req: { filename: string; data: Blob }): Promise<unknown>;
}

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (typeof claude?.use === 'function') {
    const downloads = (await claude.use('downloads')) as DownloadsApi | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === 'declined') return 'declined';
        throw new Error(e?.message ?? 'Não foi possível salvar o arquivo aqui.');
      }
    }
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
