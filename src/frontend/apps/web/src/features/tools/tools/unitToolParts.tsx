import type { ReactNode } from 'react';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';

/** Sayı tabanı, bayt birimleri ve renk araçlarının ortak parçaları. */

export const unitInputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

/** Etiket, değer ve kopyala düğmesi olan sonuç satırı. */
export function ValueRow({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  const t = useT('toolsMisc');
  return (
    <div className="flex items-center gap-2 border-b border-line px-2 py-1 last:border-b-0">
      <span className="w-32 shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-fg">{value}</span>
      {extra}
      <CopyButton text={value} label={t('shared.copyRow', { label })} compact />
    </div>
  );
}

export function ResultCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      {title && <h3 className="text-xs font-semibold text-fg-muted">{title}</h3>}
      <div className="rounded-md border border-line">{children}</div>
    </section>
  );
}
