import { useState } from 'react';
import { useT } from '../../i18n';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { MarkdownView } from '../collections/DescriptionDialog';

/**
 * İsteğin Markdown açıklaması (editördeki "Açıklama" bölümü). Dokümantasyon sayfasında istek başlığının altında
 * gösterilir; istekle birlikte kaydedilir.
 */
export function DescriptionEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT('docs');
  const [view, setView] = useState<'edit' | 'preview'>(value.trim() ? 'preview' : 'edit');
  return (
    <div className="flex h-full min-h-0 max-w-4xl flex-col gap-2">
      <div className="border-b border-line">
        <SegmentedTabs
          label={t('description.viewLabel')}
          value={view}
          onChange={setView}
          tabs={[
            { id: 'edit', label: t('description.edit') },
            { id: 'preview', label: t('description.preview') },
          ]}
        />
      </div>
      {view === 'edit' ? (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={t('description.fieldLabel')}
            placeholder={t('description.placeholder')}
            className="min-h-32 w-full flex-1 resize-none rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          />
          <p className="text-xs text-fg-subtle">{t('description.hint')}</p>
        </>
      ) : value.trim() ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <MarkdownView source={value} />
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-fg-subtle">{t('description.empty')}</p>
      )}
    </div>
  );
}
