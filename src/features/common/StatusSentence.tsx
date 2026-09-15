import type { FinancialStatus } from '../../engine';
import { StatusText } from '../../ui/primitives';

const SENTENCES: Record<FinancialStatus, string> = {
  comfortable: 'Acima da sua segurança.',
  attention: 'Perto do seu limite de segurança.',
  risk: 'Abaixo da sua segurança.',
};

export function StatusSentence({ status, text }: { status: FinancialStatus; text?: string }) {
  return <StatusText status={status}>{text ?? SENTENCES[status]}</StatusText>;
}
