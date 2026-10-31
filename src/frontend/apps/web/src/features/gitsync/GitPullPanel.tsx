import { useState } from 'react';
import { ArrowDownToLine, Minus, PenLine, Plus } from 'lucide-react';
import { Alert, Button, cn, Spinner } from '@apivator/ui';
import type {
  GitChangeDto,
  GitChangeType,
  GitPullPreviewDto,
  GitResolution,
  GitSyncDto,
} from '@apivator/core';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

function ChangeIcon({ change }: { change: GitChangeType }) {
  const Icon = change === 'Added' ? Plus : change === 'Removed' ? Minus : PenLine;
  const tone = change === 'Added' ? 'text-success' : change === 'Removed' ? 'text-danger' : 'text-warning';
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', tone)} aria-hidden="true" />;
}

/** İki tarafın içeriği yan yana; yer tutucular ({{...}}) gizli değerlerin yerini gösterir. */
function Sides({ change }: { change: GitChangeDto }) {
  const t = useT('gitsync');
  return (
    <div className="grid grid-cols-2 gap-2 px-3 pb-2">
      {(
        [
          ['mine', change.mine],
          ['theirs', change.theirs],
        ] as const
      ).map(([side, body]) => (
        <div key={side}>
          <p className="mb-1 text-xs font-medium text-fg-muted">{t(`pull.sides.${side}`)}</p>
          <pre className="max-h-48 overflow-auto rounded border border-line bg-muted/40 p-2 text-xs">
            {body ?? t('pull.sides.none')}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** "Repodan al": uzaktaki değişiklikleri listeler, çakışmalarda "depodakini al / benimkini koru" seçtirir ve uygular. */
export function GitPullPanel({
  collectionId,
  onDone,
}: {
  collectionId: string;
  onDone: (status: GitSyncDto) => void;
}) {
  const t = useT('gitsync');
  const [preview, setPreview] = useState<GitPullPreviewDto | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, GitResolution>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const unresolved = preview?.changes.filter((c) => c.conflict && !resolutions[c.key]).length ?? 0;

  async function load() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setPreview(await api.gitSync.previewPull(collectionId));
      setResolutions({});
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.gitSync.pull(collectionId, preview.remoteHead, resolutions);
      setPreview(null);
      setDone(t('pull.applied', { applied: result.applied, skipped: result.skipped }));
      onDone(result.status);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('pull.title')} className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">{t('pull.title')}</h3>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => void load()} loading={busy && !preview}>
          {t('pull.showDiff')}
        </Button>
        {preview && preview.changes.length > 0 && (
          <Button size="sm" onClick={() => void apply()} loading={busy} disabled={unresolved > 0}>
            <ArrowDownToLine className="h-3.5 w-3.5" /> {t('pull.applySelected')}
          </Button>
        )}
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      {busy && !preview && <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />}
      {unresolved > 0 && <Alert tone="warning">{t('pull.unresolved', { count: unresolved })}</Alert>}
      {preview && preview.changes.length === 0 && <p className="py-2 text-fg-subtle">{t('pull.nothing')}</p>}
      {preview && preview.changes.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {preview.changes.map((c) => (
            <li key={c.key}>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  aria-expanded={open === c.key}
                  onClick={() => setOpen(open === c.key ? null : c.key)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start hover:underline"
                >
                  {c.remote && <ChangeIcon change={c.remote} />}
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="truncate text-fg-subtle">
                    {t(`pull.kinds.${c.kind}`)}
                    {c.path && ` · ${c.path}`} · {c.remote ? t(`pull.changes.${c.remote}`) : ''}
                  </span>
                </button>
                {c.conflict ? (
                  <select
                    aria-label={t('pull.choiceFor', { name: c.name })}
                    value={resolutions[c.key] ?? ''}
                    onChange={(e) =>
                      setResolutions((r) => ({ ...r, [c.key]: e.target.value as GitResolution }))
                    }
                    className="h-7 rounded border border-line bg-surface px-1 text-xs"
                  >
                    <option value="" disabled>
                      {t('pull.choose')}
                    </option>
                    <option value="theirs">{t('pull.takeTheirs')}</option>
                    <option value="mine">{t('pull.keepMine')}</option>
                    <option value="skip">{t('pull.skip')}</option>
                  </select>
                ) : (
                  <label className="flex items-center gap-1 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={resolutions[c.key] !== 'skip'}
                      onChange={(e) =>
                        setResolutions((r) => ({ ...r, [c.key]: e.target.checked ? 'theirs' : 'skip' }))
                      }
                    />
                    {t('pull.take')}
                  </label>
                )}
              </div>
              {c.warning && (
                <div className="px-3 pb-2">
                  <Alert tone="warning">{c.warning}</Alert>
                </div>
              )}
              {open === c.key && <Sides change={c} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
