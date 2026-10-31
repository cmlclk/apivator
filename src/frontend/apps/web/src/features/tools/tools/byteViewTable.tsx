import { useMemo } from 'react';
import { charBreakdown, formatCodePoint, type ByteEncoding, type CharInfo } from '@apivator/core/tools';
import { cn } from '@apivator/ui';
import { useT } from '../../../i18n';

/** Tabloda gösterilen en fazla karakter (her biri bir satır). */
export const CHAR_TABLE_LIMIT = 1000;

const cellClass = 'border-b border-line px-2 py-0.5';
const headClass = 'border-b border-line px-2 py-1 font-medium';

/** Görünmeyen karakterler adının kısaltmasıyla (BOM, ZWSP…) gösterilir. */
function Glyph({ info }: { info: CharInfo }) {
  if (!info.name) return <span className="text-fg">{info.char}</span>;
  const short = info.name.split(/[\s/(]/)[0];
  return (
    <span
      className={cn(
        'rounded border px-1 text-[10px]',
        info.suspicious ? 'border-warning/60 text-fg' : 'border-line text-fg-subtle',
      )}
    >
      {short}
    </span>
  );
}

/** Karakter karakter döküm: kod noktası, seçilen kodlamadaki baytlar ve görünmez karakter adları. */
export function CharTable({ text, encoding }: { text: string; encoding: ByteEncoding }) {
  const t = useT('toolsMisc');
  const all = useMemo(() => charBreakdown(text, encoding, CHAR_TABLE_LIMIT + 1), [text, encoding]);
  const truncated = all.length > CHAR_TABLE_LIMIT;
  const rows = truncated ? all.slice(0, CHAR_TABLE_LIMIT) : all;
  return (
    <section className="flex max-h-80 min-h-0 shrink-0 flex-col gap-1 overflow-auto">
      <h3 className="text-xs font-semibold text-fg-muted">
        {truncated
          ? t('byteView.charactersTruncated', { limit: CHAR_TABLE_LIMIT })
          : t('byteView.characters')}
      </h3>
      <table className="w-full max-w-3xl border-collapse text-[12px]" aria-label={t('byteView.characters')}>
        <thead>
          <tr className="text-start text-[11px] tracking-wide text-fg-subtle uppercase">
            <th className={headClass}>{t('byteView.offset')}</th>
            <th className={headClass}>{t('byteView.character')}</th>
            <th className={headClass}>{t('byteView.codePoint')}</th>
            <th className={headClass}>{t('byteView.bytes')}</th>
            <th className={headClass}>{t('byteView.name')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((info) => (
            <tr key={info.offset} className={cn(info.suspicious && 'bg-warning/10')}>
              <td className={cn(cellClass, 'w-16 font-mono text-fg-subtle')}>{info.offset}</td>
              <td className={cn(cellClass, 'w-20 font-mono')}>
                <Glyph info={info} />
              </td>
              <td className={cn(cellClass, 'w-24 font-mono text-fg')}>{formatCodePoint(info.codePoint)}</td>
              <td className={cn(cellClass, 'w-32 font-mono text-fg')}>{info.bytes}</td>
              <td className={cn(cellClass, 'text-fg-muted')}>{info.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
