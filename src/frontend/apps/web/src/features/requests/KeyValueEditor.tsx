import { useRef } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import type { KeyValueItem } from '@apivator/core';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';

/** form-data için dosya alanı desteği: seçilen dosya üst bileşende saklanır, satıra adı yazılır. */
export interface FileFieldSupport {
  onPick: (file: File) => void;
  /** Dosya bu oturumda seçilmiş mi (sayfa yenilenince kaybolur)? */
  isLoaded: (name: string) => boolean;
}

const cellInput =
  'h-8 w-full min-w-0 bg-transparent px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent/50';

/**
 * Anahtar/değer tablosu (header, parametre, form alanı). Son satır her zaman boştur; yazmaya
 * başlayınca gerçek satıra dönüşür.
 */
export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  allowDisable = true,
  label,
  files,
}: {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  allowDisable?: boolean;
  label: string;
  files?: FileFieldSupport;
}) {
  const t = useT('requests');
  keyPlaceholder ??= t('kv.key');
  valuePlaceholder ??= t('kv.value');
  const rows = [...items, { key: '', value: '', enabled: true }];

  function update(index: number, patch: Partial<KeyValueItem>) {
    if (index === items.length) {
      onChange([...items, { key: '', value: '', enabled: true, ...patch }]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <table className="w-full table-fixed border-collapse text-sm" aria-label={label}>
      <thead>
        <tr className="text-start text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {allowDisable && <th className="w-8 border border-line" />}
          <th className="border border-line px-2 py-1.5 font-medium">{keyPlaceholder}</th>
          <th className="border border-line px-2 py-1.5 font-medium">{valuePlaceholder}</th>
          <th className="w-9 border border-line" />
        </tr>
      </thead>
      <tbody>
        {rows.map((item, index) => {
          const isPlaceholder = index === items.length;
          return (
            <tr key={index} className={item.enabled || isPlaceholder ? '' : 'opacity-50'}>
              {allowDisable && (
                <td className="border border-line text-center">
                  {!isPlaceholder && (
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => update(index, { enabled: e.target.checked })}
                      aria-label={t('kv.rowEnabled', { name: item.key || t('kv.row') })}
                      className="h-3.5 w-3.5 accent-[var(--app-accent)]"
                    />
                  )}
                </td>
              )}
              <td className="border border-line p-0">
                <div className="flex items-center">
                  <input
                    className={cellInput}
                    value={item.key}
                    placeholder={isPlaceholder ? keyPlaceholder : ''}
                    aria-label={t('kv.keyN', { label, n: index + 1 })}
                    onChange={(e) => update(index, { key: e.target.value })}
                  />
                  {files && (
                    <select
                      value={item.type ?? 'Text'}
                      onChange={(e) =>
                        update(
                          index,
                          e.target.value === 'File'
                            ? { type: 'File', value: '' }
                            : { type: undefined, value: '' },
                        )
                      }
                      aria-label={t('kv.typeN', { label, n: index + 1 })}
                      className="me-1 h-6 shrink-0 rounded border-0 bg-transparent text-[11px] text-fg-subtle hover:bg-muted focus:outline-none"
                    >
                      <option value="Text">{t('kv.text')}</option>
                      <option value="File">{t('kv.file')}</option>
                    </select>
                  )}
                </div>
              </td>
              <td className="border border-line p-0">
                {files && item.type === 'File' ? (
                  <FilePicker
                    name={item.value}
                    loaded={files.isLoaded(item.value)}
                    label={t('kv.fileN', { label, n: index + 1 })}
                    onPick={(file) => {
                      files.onPick(file);
                      update(index, { value: file.name, type: 'File' });
                    }}
                  />
                ) : (
                  <input
                    className={cellInput}
                    value={item.value}
                    placeholder={isPlaceholder ? valuePlaceholder : ''}
                    aria-label={t('kv.valueN', { label, n: index + 1 })}
                    onChange={(e) => update(index, { value: e.target.value })}
                  />
                )}
              </td>
              <td className="border border-line text-center">
                {!isPlaceholder && (
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                    aria-label={item.key ? t('kv.deleteNamed', { name: item.key }) : t('kv.deleteRow')}
                    className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Dosya seçme düğmesi; dosya bu oturumda yüklenmemişse yeniden seçilmesi gerektiğini belirtir. */
export function FilePicker({
  name,
  loaded,
  label,
  onPick,
  className,
}: {
  name: string | null | undefined;
  loaded: boolean;
  label: string;
  onPick: (file: File) => void;
  className?: string;
}) {
  const t = useT('requests');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn('flex h-8 min-w-0 items-center gap-2 px-2', className)}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11.5px] text-fg-muted hover:bg-muted hover:text-fg"
      >
        <FileUp className="h-3 w-3" aria-hidden="true" />
        {name ? t('kv.change') : t('kv.pickFile')}
      </button>
      {name && (
        <span className={cn('min-w-0 truncate font-mono text-[12px]', loaded ? 'text-fg' : 'text-warning')}>
          {name}
          {!loaded && <span className="ms-1.5 font-sans text-[11px]">· {t('kv.reselect')}</span>}
        </span>
      )}
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
