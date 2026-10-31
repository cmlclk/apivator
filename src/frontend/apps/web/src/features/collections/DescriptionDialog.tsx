import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, Button, Spinner } from '@apivator/ui';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';

/** Markdown'u güvenle çizer: ham HTML işlenmez, bağlantılar yeni sekmede açılır. */
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="markdown text-[13.5px] leading-relaxed text-fg">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}

/** Collection açıklaması: Markdown yazılır, önizlemesi gösterilir. */
export function DescriptionDialog({
  title,
  initial,
  readOnly,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  readOnly: boolean;
  onSave: (description: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT('collections');
  const [text, setText] = useState(initial);
  const [view, setView] = useState<'edit' | 'preview'>(readOnly || initial ? 'preview' : 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? t('description.close') : t('description.cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} disabled={saving || text === initial}>
              {saving && <Spinner className="h-3.5 w-3.5" />} {t('description.save')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {!readOnly && (
        <div className="mb-3 border-b border-line">
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
      )}
      {view === 'edit' && !readOnly ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            aria-label={t('description.markdownLabel')}
            placeholder={t('description.placeholder')}
            className="w-full resize-y rounded-md border border-line bg-bg p-3 font-mono text-[12.5px] placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
          />
          <p className="mt-1 text-xs text-fg-subtle">{t('description.markdownHint')}</p>
        </>
      ) : text.trim() ? (
        <MarkdownView source={text} />
      ) : (
        <p className="py-8 text-center text-sm text-fg-subtle">{t('description.empty')}</p>
      )}
    </Dialog>
  );
}
