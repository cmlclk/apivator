import { lazy, Suspense, useState } from 'react';
import { Braces } from 'lucide-react';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';
import type { ModelSource } from './sources';

const ModelDialog = lazy(() => import('./ModelDialog').then((m) => ({ default: m.ModelDialog })));

/** "Model" düğmesi: tıklanınca model penceresi (ve üretici kodu) yüklenir. */
export function ModelButton({
  sources,
  className,
  title,
}: {
  /** Tıklanınca hesaplanır (gövde metni o anki hâliyle alınır). */
  sources: () => ModelSource[];
  className?: string;
  title?: string;
}) {
  const t = useT('models');
  const [open, setOpen] = useState<ModelSource[] | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(sources())}
        title={title ?? t('button.title')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-muted hover:text-fg',
          className,
        )}
      >
        <Braces className="h-3.5 w-3.5" /> {t('button.label')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ModelDialog sources={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </>
  );
}
