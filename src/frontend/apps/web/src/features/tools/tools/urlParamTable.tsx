import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@apivator/ui';
import type { UrlQueryParam } from '@apivator/core/tools';
import { useT } from '../../../i18n';

const cellInput =
  'h-8 w-full min-w-0 bg-transparent px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/50';
const iconButton = 'rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-30';

/** Adresteki hâli: değer düzenlendiyse yeniden kurulan adreste kodlanmış hâli farklı olabilir. */
const rawText = (p: UrlQueryParam) =>
  p.rawKey || p.rawValue ? `${p.rawKey}${p.hasValue ? `=${p.rawValue}` : ''}` : '';

/**
 * URL ayrıştırıcının query parametre tablosu: sıra korunur, tekrarlanan anahtarlar ayrı satırdır;
 * satırlar eklenir, silinir, taşınır ve kapatılabilir.
 */
export function UrlParamTable({
  params,
  onChange,
}: {
  params: UrlQueryParam[];
  onChange: (params: UrlQueryParam[]) => void;
}) {
  const t = useT('toolsMisc');
  const update = (index: number, patch: Partial<UrlQueryParam>) =>
    onChange(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const move = (index: number, delta: number) => {
    const next = [...params];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };
  const add = () =>
    onChange([...params, { key: '', value: '', hasValue: true, enabled: true, rawKey: '', rawValue: '' }]);

  return (
    <div className="flex flex-col gap-1">
      <table className="w-full table-fixed border-collapse text-sm" aria-label={t('urlParams.title')}>
        <thead>
          <tr className="text-start text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            <th className="w-8 border border-line" />
            <th className="border border-line px-2 py-1.5 font-medium">{t('urlParams.key')}</th>
            <th className="border border-line px-2 py-1.5 font-medium">{t('urlParams.value')}</th>
            <th className="hidden border border-line px-2 py-1.5 font-medium md:table-cell">
              {t('urlParams.raw')}
            </th>
            <th className="w-24 border border-line" />
          </tr>
        </thead>
        <tbody>
          {params.map((p, index) => (
            <tr key={index} className={p.enabled ? '' : 'opacity-50'}>
              <td className="border border-line text-center">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                  aria-label={t('urlParams.enabled', { n: index + 1 })}
                  className="h-3.5 w-3.5 accent-[var(--app-accent)]"
                />
              </td>
              <td className="border border-line p-0">
                <input
                  className={cellInput}
                  value={p.key}
                  aria-label={t('urlParams.keyOf', { n: index + 1 })}
                  onChange={(e) => update(index, { key: e.target.value })}
                />
              </td>
              <td className="border border-line p-0">
                <input
                  className={cellInput}
                  value={p.value}
                  aria-label={t('urlParams.valueOf', { n: index + 1 })}
                  onChange={(e) =>
                    update(index, { value: e.target.value, hasValue: p.hasValue || e.target.value !== '' })
                  }
                />
              </td>
              <td className="hidden truncate border border-line px-2 font-mono text-[11.5px] text-fg-subtle md:table-cell">
                <span title={rawText(p)}>{rawText(p)}</span>
              </td>
              <td className="border border-line text-center whitespace-nowrap">
                <button
                  type="button"
                  className={iconButton}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t('urlParams.moveUp', { n: index + 1 })}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  disabled={index === params.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t('urlParams.moveDown', { n: index + 1 })}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  onClick={() => onChange(params.filter((_, i) => i !== index))}
                  aria-label={t('urlParams.remove', { n: index + 1 })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> {t('urlParams.add')}
        </Button>
      </div>
    </div>
  );
}
