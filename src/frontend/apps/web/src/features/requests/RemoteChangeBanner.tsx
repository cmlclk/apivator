import { useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { DiffSections } from '../activity/DiffSections';
import { Dialog } from '../../components/ui/Dialog';
import { requestDiff } from '../../lib/diff';
import { useT } from '../../i18n';
import { useTabs, type RequestTab } from './tabsStore';

/** Siz düzenlerken başkası bu isteği kaydettiyse ya da sildiyse: farkı gösterir ve seçimi size bırakır. */
export function RemoteChangeBanner({ tab, onSave }: { tab: RequestTab; onSave: () => void }) {
  const t = useT('requests');
  const [diffOpen, setDiffOpen] = useState(false);
  const remote = tab.remote;
  if (!remote) return null;
  const who = remote.byName ?? t('remote.someone');
  const { markSaved, keepMine, detach, close } = useTabs.getState();

  if (remote.deleted || !remote.request) {
    return (
      <Alert tone="warning" className="mx-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{t('remote.deleted', { who })}</span>
        <Button size="sm" variant="secondary" onClick={() => detach(tab.id)}>
          {t('remote.keepAsNew')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => close(tab.id)}>
          {t('remote.closeTab')}
        </Button>
      </Alert>
    );
  }

  const theirs = remote.request;
  const takeTheirs = () => {
    setDiffOpen(false);
    markSaved(tab.id, theirs);
  };
  const saveMine = () => {
    setDiffOpen(false);
    keepMine(tab.id);
    onSave();
  };
  return (
    <>
      <Alert tone="warning" className="mx-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{t('remote.savedWhileEditing', { who })}</span>
        <Button size="sm" variant="ghost" onClick={() => setDiffOpen(true)}>
          <GitCompareArrows className="h-3.5 w-3.5" /> {t('remote.viewDiff')}
        </Button>
        <Button size="sm" variant="secondary" onClick={takeTheirs}>
          {t('remote.takeTheirs')}
        </Button>
        <Button size="sm" onClick={saveMine}>
          {t('remote.saveMine')}
        </Button>
      </Alert>
      {diffOpen && (
        <Dialog
          title={t('remote.diffTitle')}
          size="xl"
          onClose={() => setDiffOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={takeTheirs}>
                {t('remote.takeTheirs')}
              </Button>
              <Button onClick={saveMine}>{t('remote.saveMine')}</Button>
            </>
          }
        >
          <DiffView tab={tab} />
        </Dialog>
      )}
    </>
  );
}

function DiffView({ tab }: { tab: RequestTab }) {
  const t = useT('requests');
  const theirs = tab.remote?.request;
  if (!theirs) return null;
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <p className="text-fg-muted">
        {t.rich(
          'remote.legend',
          {
            minus: (c) => <span className="rounded bg-danger/15 px-1 text-danger">{c}</span>,
            plus: (c) => <span className="rounded bg-success/15 px-1 text-success">{c}</span>,
          },
          { who: tab.remote?.byName ?? t('remote.someone') },
        )}
      </p>
      <DiffSections
        sections={requestDiff({ name: tab.name, definition: tab.draft }, theirs)}
        empty={t('remote.noDiff')}
      />
    </div>
  );
}
