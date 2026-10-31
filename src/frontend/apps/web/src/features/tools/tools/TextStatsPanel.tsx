import { cn } from '@apivator/ui';
import { formatNumber, useT, type TFunction } from '../../../i18n';
import { useTextStats } from './useTextStats';

const number = (value: number) => formatNumber(value);
const decimal = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

function readingTime(t: TFunction<'toolsMisc'>, minutes: number): string {
  if (minutes === 0) return t('textStats.seconds', { n: 0 });
  if (minutes < 1) return t('textStats.seconds', { n: Math.max(1, Math.round(minutes * 60)) });
  return t('textStats.minutesApprox', { n: Math.round(minutes) });
}

/** Metin sayaçları; `compact` yalnızca temel sayıları tek satırda gösterir. */
export function TextStatsPanel({
  text,
  compact = false,
  label,
  className,
}: {
  text: string;
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  const t = useT('toolsMisc');
  const { stats, pending } = useTextStats(text);
  const title = label ?? t('textStats.title');
  if (!stats) {
    return <p className="text-xs text-fg-subtle">{t('textStats.calculating')}</p>;
  }
  const items: [string, string, string?][] = compact
    ? [
        [t('textStats.lines'), number(stats.lines)],
        [t('textStats.words'), number(stats.words)],
        [t('textStats.characters'), number(stats.graphemes)],
        ['UTF-8', t('shared.bytes', { n: stats.utf8Bytes })],
      ]
    : [
        [t('textStats.characters'), number(stats.graphemes), t('textStats.graphemeHint')],
        [t('textStats.codePoints'), number(stats.codePoints)],
        [t('textStats.utf16Length'), number(stats.utf16Length), 'JavaScript string.length'],
        [t('textStats.noSpaces'), number(stats.charsNoSpaces)],
        [t('textStats.words'), number(stats.words)],
        [t('textStats.lines'), number(stats.lines)],
        [t('textStats.paragraphs'), number(stats.paragraphs)],
        [t('textStats.sentences'), number(stats.sentences)],
        ['UTF-8', t('shared.bytes', { n: stats.utf8Bytes })],
        ['UTF-16', t('shared.bytes', { n: stats.utf16Bytes })],
        [t('textStats.avgWordLength'), decimal(stats.avgWordLength)],
        [
          t('textStats.longestLine'),
          stats.longestLine.line
            ? t('textStats.longestLineValue', {
                length: stats.longestLine.length,
                line: stats.longestLine.line,
              })
            : '0',
        ],
        [t('textStats.readingTime'), readingTime(t, stats.readingMinutes), t('textStats.readingHint')],
      ];

  return (
    <section
      aria-label={title}
      aria-busy={pending}
      className={cn('flex flex-col gap-2', pending && 'opacity-60', className)}
    >
      {!compact && <h3 className="text-xs font-semibold text-fg-muted">{title}</h3>}
      <dl className={cn(compact ? 'flex flex-wrap gap-x-4 gap-y-1' : 'grid grid-cols-2 gap-x-4 gap-y-1')}>
        {items.map(([name, value, title]) => (
          <div key={name} className="flex items-baseline justify-between gap-2 text-xs" title={title}>
            <dt className="text-fg-subtle">{name}</dt>
            <dd className="font-mono text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {!compact && stats.topWords.length > 0 && (
        <>
          <h3 className="mt-2 text-xs font-semibold text-fg-muted">{t('textStats.topWords')}</h3>
          <ol className="flex flex-col gap-0.5" aria-label={t('textStats.topWords')}>
            {stats.topWords.map(({ word, count }) => (
              <li key={word} className="flex justify-between gap-2 text-xs">
                <span className="truncate text-fg">{word}</span>
                <span className="font-mono text-fg-muted">{number(count)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
