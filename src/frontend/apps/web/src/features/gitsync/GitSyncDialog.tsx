import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpFromLine, Unplug } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { ApiError, type CollectionTreeDto, type GitSyncDto } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Dialog } from '../../components/ui/Dialog';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { selectClass } from '../../lib/teams';
import { fullTime } from '../activity/activity';
import { collectionsQueryKey } from '../collections/useCollections';
import { GitPullPanel } from './GitPullPanel';

const INTERVALS = [
  { value: '', key: 'off' },
  { value: '1', key: 'hourly' },
  { value: '6', key: 'every6h' },
  { value: '24', key: 'daily' },
] as const;

/** Bağlantı formu (workspace yöneticisi). Belirteç hiç geri gösterilmez; boş bırakılırsa mevcut korunur. */
function ConnectForm({
  collectionId,
  current,
  onSaved,
}: {
  collectionId: string;
  current: GitSyncDto | null;
  onSaved: (status: GitSyncDto) => void;
}) {
  const t = useT('gitsync');
  const [url, setUrl] = useState(current?.remoteUrl ?? '');
  const [branch, setBranch] = useState(current?.branch ?? 'main');
  const [folder, setFolder] = useState(current?.folderPath ?? 'apivator');
  const [username, setUsername] = useState(current?.username ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const status = await api.gitSync.connect(collectionId, {
        remoteUrl: url.trim(),
        branch: branch.trim(),
        folderPath: folder.trim() || null,
        username: username.trim() || null,
        token: token || null,
      });
      setToken('');
      onSaved(status);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Input
        label={t('connect.url')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/firma/api-collections.git"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('connect.branch')}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          required
        />
        <Input
          label={t('connect.folder')}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          hint={t('connect.folderHint')}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label={t('connect.username')} value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input
          label={t('connect.token')}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint={current?.hasToken ? t('connect.tokenSaved') : t('connect.tokenHint')}
        />
      </div>
      <div>
        <Button type="submit" loading={busy} disabled={!url.trim() || !branch.trim()}>
          {current ? t('connect.saveSettings') : t('connect.connect')}
        </Button>
      </div>
    </form>
  );
}

/** Collection'ı Git deposuna bağlama, durum, "Repoya gönder" ve "Repodan al". */
export function GitSyncDialog({
  collection,
  canEdit,
  canAdmin,
  onClose,
}: {
  collection: CollectionTreeDto;
  canEdit: boolean;
  canAdmin: boolean;
  onClose: () => void;
}) {
  const t = useT('gitsync');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<GitSyncDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [secretWarning, setSecretWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    api.gitSync
      .get(collection.id)
      .then(setStatus)
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 404)) setError(errorMessage(e));
      })
      .finally(() => setLoading(false));
  }, [collection.id]);

  async function push(acknowledge = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.gitSync.push(collection.id, message.trim(), acknowledge);
      setSecretWarning(null);
      setStatus(result.status);
      setMessage('');
      setNotice(result.noChanges ? t('push.upToDate') : t('push.pushed', { count: result.changed }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'git.secrets_suspected') setSecretWarning(e.message);
      else setError(errorMessage(e));
      api.gitSync
        .get(collection.id)
        .then(setStatus)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api.gitSync.disconnect(collection.id);
    setStatus(null);
  }

  async function setSchedule(value: string) {
    try {
      setStatus(await api.gitSync.setSchedule(collection.id, value ? Number(value) : null));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Dialog title={t('dialog.title', { name: collection.name })} size="xl" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {loading && <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />}

        {!loading && !status && (
          <>
            <p className="text-fg-muted">{t('dialog.intro')}</p>
            {canAdmin ? (
              <ConnectForm collectionId={collection.id} current={null} onSaved={setStatus} />
            ) : (
              <Alert tone="info">{t('dialog.adminOnly')}</Alert>
            )}
          </>
        )}

        {status && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-fg-muted">{t('status.repo')}</dt>
              <dd className="break-all">
                {status.remoteUrl} · {status.branch} · {status.folderPath}/
              </dd>
              <dt className="text-fg-muted">{t('status.token')}</dt>
              <dd>{status.hasToken ? t('status.tokenSaved') : t('status.tokenNone')}</dd>
              <dt className="text-fg-muted">{t('status.lastSync')}</dt>
              <dd>
                {status.lastSyncedAt
                  ? t('status.lastSyncValue', {
                      time: fullTime(status.lastSyncedAt),
                      hasBy: status.lastSyncedByName ? 'y' : 'n',
                      by: status.lastSyncedByName ?? '',
                      commit: status.lastCommit?.slice(0, 7) ?? '',
                    })
                  : t('status.never')}
              </dd>
              <dt className="text-fg-muted">{t('status.state')}</dt>
              <dd>
                {t('status.stateValue', {
                  ahead: status.ahead,
                  behind: status.behind,
                  hasChecked: status.lastCheckedAt ? 'y' : 'n',
                  checked: status.lastCheckedAt ? fullTime(status.lastCheckedAt) : '',
                })}
              </dd>
              {canEdit && (
                <>
                  <dt className="text-fg-muted">{t('status.autoCheck')}</dt>
                  <dd>
                    <select
                      aria-label={t('status.autoCheck')}
                      value={status.checkIntervalHours?.toString() ?? ''}
                      onChange={(e) => void setSchedule(e.target.value)}
                      className={`${selectClass} h-7`}
                    >
                      {INTERVALS.map((i) => (
                        <option key={i.value} value={i.value}>
                          {t(`status.intervals.${i.key}`)}
                        </option>
                      ))}
                    </select>
                  </dd>
                </>
              )}
            </dl>
            {status.lastError && (
              <Alert tone="error">{t('status.lastError', { error: status.lastError })}</Alert>
            )}

            {canEdit ? (
              <>
                <section aria-label={t('push.title')} className="flex flex-col gap-2">
                  <h3 className="font-semibold">{t('push.title')}</h3>
                  <p className="text-fg-muted">{t('push.intro')}</p>
                  {secretWarning && (
                    <Alert tone="warning">
                      {secretWarning}
                      <div className="mt-2">
                        <Button size="sm" variant="secondary" onClick={() => void push(true)} loading={busy}>
                          {t('push.force')}
                        </Button>
                      </div>
                    </Alert>
                  )}
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={t('push.message')}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t('push.messagePlaceholder', { name: collection.name })}
                        maxLength={500}
                      />
                    </div>
                    <Button onClick={() => void push(false)} loading={busy}>
                      <ArrowUpFromLine className="h-3.5 w-3.5" /> {t('push.submit')}
                    </Button>
                  </div>
                </section>
                <GitPullPanel
                  collectionId={collection.id}
                  onDone={(next) => {
                    setStatus(next);
                    void queryClient.invalidateQueries({
                      queryKey: collectionsQueryKey(collection.workspaceId),
                    });
                  }}
                />
              </>
            ) : (
              <Alert tone="info">{t('push.noPermission')}</Alert>
            )}

            {canAdmin && (
              <section
                aria-label={t('connection.settings')}
                className="flex flex-col gap-2 border-t border-line pt-3"
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{t('connection.title')}</h3>
                  <span className="flex-1" />
                  <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
                    {editing ? t('connection.hide') : t('connection.edit')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDisconnecting(true)}>
                    <Unplug className="h-3.5 w-3.5" /> {t('connection.disconnect')}
                  </Button>
                </div>
                {editing && (
                  <ConnectForm
                    collectionId={collection.id}
                    current={status}
                    onSaved={(next) => {
                      setStatus(next);
                      setEditing(false);
                    }}
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>

      {disconnecting && (
        <ConfirmDialog
          title={t('connection.disconnectTitle')}
          confirmLabel={t('connection.disconnectConfirm')}
          onConfirm={disconnect}
          onClose={() => setDisconnecting(false)}
        >
          {t('connection.disconnectMessage')}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
