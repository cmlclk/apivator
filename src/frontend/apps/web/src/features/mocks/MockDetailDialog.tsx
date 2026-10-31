import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, Eraser, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import type { MockCallDto, MockRouteDto, MockServerDto } from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CopyButton } from '../../components/ui/CopyButton';
import { Dialog } from '../../components/ui/Dialog';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useT } from '../../i18n';
import { fullTime, timeAgo } from '../activity/activity';
import { methodColor } from '../requests/methodColors';
import { useTabs } from '../requests/tabsStore';
import { MockSettingsDialog } from './MockSettingsDialog';
import { mockCallsQueryKey, mockCurl, mockUrl, mocksQueryKey, samplePath } from './useMocks';
import { loadRequest } from '../../lib/offlineCache';

type Tab = 'routes' | 'calls' | 'usage';

function statusTone(status: number) {
  if (status >= 500) return 'text-danger';
  if (status >= 400) return 'text-warning';
  if (status >= 200 && status < 300) return 'text-success';
  return 'text-fg-muted';
}

export function MockDetailDialog({
  mock,
  canEdit,
  onClose,
}: {
  mock: MockServerDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT('mocks');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('routes');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'regenerate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = mockUrl(mock);

  const routes = useQuery({ queryKey: ['mock-routes', mock.id], queryFn: () => api.mocks.routes(mock.id) });
  const calls = useQuery({
    queryKey: mockCallsQueryKey(mock.id),
    queryFn: () => api.mocks.calls(mock.id),
    // Çağrılar açıkken birkaç saniyede bir tazelenir.
    refetchInterval: tab === 'calls' ? 3000 : false,
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: mocksQueryKey(mock.workspaceId) });

  return (
    <Dialog title={t('detail.title', { name: mock.name })} size="xl" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        {error && <Alert tone="error">{error}</Alert>}

        <section aria-label={t('detail.address')} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-line bg-muted/40 px-2 py-1.5 font-mono text-xs">
              {url}
            </code>
            <CopyButton text={url} label={t('detail.copyAddress')} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="rounded bg-muted px-1.5 py-0.5">{mock.collectionName}</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5',
                mock.isPrivate ? 'bg-accent/10 text-accent' : 'bg-muted',
              )}
            >
              {mock.isPrivate ? t('detail.private') : t('detail.public')}
            </span>
            {mock.delayMs > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5">
                {t('detail.delay', { ms: mock.delayMs })}
              </span>
            )}
            {!mock.enabled && (
              <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">{t('detail.off')}</span>
            )}
            <span className="flex-1" />
            {canEdit && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  <Settings className="h-3.5 w-3.5" /> {t('detail.settings')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm('regenerate')}>
                  <RefreshCw className="h-3.5 w-3.5" /> {t('detail.newAddress')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setConfirm('delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t('detail.delete')}
                </Button>
              </>
            )}
          </div>
        </section>

        <SegmentedTabs<Tab>
          label={t('detail.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'routes', label: t('detail.tabRoutes'), badge: routes.data?.length ?? null },
            { id: 'calls', label: t('detail.tabCalls'), badge: calls.data?.length || null },
            { id: 'usage', label: t('detail.tabUsage') },
          ]}
        />

        {tab === 'routes' && (
          <RoutesTab
            mock={mock}
            routes={routes.data}
            loading={routes.isLoading}
            error={routes.error}
            onOpen={async (route) => {
              try {
                useTabs.getState().openSaved(mock.workspaceId, await loadRequest(route.requestId));
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        )}
        {tab === 'calls' && (
          <CallsTab
            calls={calls.data}
            loading={calls.isLoading}
            canEdit={canEdit}
            onClear={async () => {
              setError(null);
              try {
                await api.mocks.clearCalls(mock.id);
                await queryClient.invalidateQueries({ queryKey: mockCallsQueryKey(mock.id) });
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        )}
        {tab === 'usage' && <UsageTab mock={mock} firstRoute={routes.data?.[0]} />}
      </div>

      {editing && (
        <MockSettingsDialog
          workspaceId={mock.workspaceId}
          mock={mock}
          onSaved={() => {
            setEditing(false);
            void refreshList();
            void queryClient.invalidateQueries({ queryKey: ['mock-routes', mock.id] });
          }}
          onClose={() => setEditing(false)}
        />
      )}
      {confirm === 'regenerate' && (
        <ConfirmDialog
          title={t('detail.regenerateTitle')}
          confirmLabel={t('detail.regenerateConfirm')}
          onConfirm={async () => {
            await api.mocks.regenerateKey(mock.id);
            await refreshList();
          }}
          onClose={() => setConfirm(null)}
        >
          {t('detail.regenerateBody')}
        </ConfirmDialog>
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={t('detail.deleteTitle')}
          confirmLabel={t('detail.deleteConfirm')}
          onConfirm={async () => {
            await api.mocks.remove(mock.id);
            await refreshList();
            onClose();
          }}
          onClose={() => setConfirm(null)}
        >
          {t('detail.deleteBody', { name: mock.name })}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

function RoutesTab({
  mock,
  routes,
  loading,
  error,
  onOpen,
}: {
  mock: MockServerDto;
  routes: MockRouteDto[] | undefined;
  loading: boolean;
  error: unknown;
  onOpen: (route: MockRouteDto) => void;
}) {
  const t = useT('mocks');
  if (loading) return <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />;
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!routes?.length)
    return (
      <p className="py-6 text-center text-fg-muted">
        {t('routes.empty', { collection: mock.collectionName })}
      </p>
    );

  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {routes.map((route) => (
        <li key={route.exampleId} className="flex items-center gap-3 px-3 py-1.5">
          <span className={cn('w-14 shrink-0 font-mono text-xs font-semibold', methodColor(route.method))}>
            {route.method}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs">{route.path}</span>
            <span className="block truncate text-xs text-fg-subtle">
              {route.requestName} / {route.exampleName}
            </span>
          </span>
          <span className={cn('w-10 shrink-0 text-end font-mono text-xs', statusTone(route.status))}>
            {route.status}
          </span>
          <CopyButton
            compact
            text={mockCurl(mock, samplePath(route.path), undefined, route.method)}
            label={t('routes.copyCurl', { method: route.method, path: route.path })}
          />
          <Button
            size="icon"
            variant="ghost"
            title={t('routes.open')}
            aria-label={t('routes.openNamed', { name: route.requestName })}
            onClick={() => onOpen(route)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CallsTab({
  calls,
  loading,
  canEdit,
  onClear,
}: {
  calls: MockCallDto[] | undefined;
  loading: boolean;
  canEdit: boolean;
  onClear: () => Promise<void>;
}) {
  const t = useT('mocks');
  const [open, setOpen] = useState<string | null>(null);
  if (loading) return <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />;
  if (!calls?.length) return <p className="py-6 text-center text-fg-muted">{t('calls.empty')}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-fg-subtle">
        <span>{t('calls.summary', { count: calls.length })}</span>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => void onClear()}>
            <Eraser className="h-3.5 w-3.5" /> {t('calls.clear')}
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line rounded-md border border-line">
        {calls.map((call) => {
          const expanded = open === call.id;
          return (
            <li key={call.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : call.id)}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-start hover:bg-muted/60"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                )}
                <span
                  className={cn('w-14 shrink-0 font-mono text-xs font-semibold', methodColor(call.method))}
                >
                  {call.method}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{call.path}</span>
                  <span
                    className={cn(
                      'block truncate text-xs',
                      call.matchedName ? 'text-fg-subtle' : 'text-warning',
                    )}
                  >
                    {call.matchedName ?? call.error ?? t('calls.noMatch')}
                  </span>
                </span>
                <span className={cn('w-10 shrink-0 text-end font-mono text-xs', statusTone(call.status))}>
                  {call.status}
                </span>
                <span className="w-16 shrink-0 text-end text-xs text-fg-subtle">{call.durationMs} ms</span>
                <span className="w-24 shrink-0 text-end text-xs text-fg-subtle" title={fullTime(call.at)}>
                  {timeAgo(call.at)}
                </span>
              </button>
              {expanded && (
                <div className="flex flex-col gap-2 border-t border-line bg-muted/30 px-9 py-2 text-xs">
                  <table className="w-full">
                    <tbody>
                      {call.requestHeaders.map((h, i) => (
                        <tr key={`${h.key}-${i}`}>
                          <td className="w-48 py-0.5 pe-3 align-top font-mono text-fg-muted">{h.key}</td>
                          <td className="py-0.5 font-mono break-all">{h.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {call.requestBody && (
                    <pre className="max-h-48 overflow-auto rounded border border-line bg-surface p-2 font-mono whitespace-pre-wrap">
                      {call.requestBody}
                    </pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UsageTab({ mock, firstRoute }: { mock: MockServerDto; firstRoute: MockRouteDto | undefined }) {
  const t = useT('mocks');
  const code$ = (children: ReactNode) => <code className="rounded bg-muted px-1">{children}</code>;
  const example = mockCurl(
    mock,
    firstRoute ? samplePath(firstRoute.path) : '/',
    undefined,
    firstRoute?.method,
  );
  const code = `${example} \\\n  -H "x-mock-response-code: 404"`;
  return (
    <div className="flex flex-col gap-3 text-fg-muted">
      <p>{t.rich('usage.intro', { code: code$ }, { baseUrl: '{{baseUrl}}' })}</p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-muted/40 p-2 font-mono text-xs text-fg">
          {example}
        </pre>
        <CopyButton text={example} label={t('usage.copyCommand')} />
      </div>
      {mock.isPrivate && <p>{t.rich('usage.private', { code: code$ })}</p>}
      <h3 className="font-semibold text-fg">{t('usage.pickTitle')}</h3>
      <p>{t('usage.pickIntro')}</p>
      <ul className="list-disc space-y-1 ps-5">
        <li>{t.rich('usage.byCode', { code: code$ })}</li>
        <li>{t.rich('usage.byName', { code: code$ })}</li>
        <li>{t.rich('usage.byId', { code: code$ })}</li>
        <li>{t.rich('usage.byBody', { code: code$ })}</li>
        <li>{t.rich('usage.byHeaders', { code: code$ })}</li>
      </ul>
      <pre className="overflow-x-auto rounded-md border border-line bg-muted/40 p-2 font-mono text-xs text-fg">
        {code}
      </pre>
      <p>{t.rich('usage.fallback', { code: code$ })}</p>
    </div>
  );
}
