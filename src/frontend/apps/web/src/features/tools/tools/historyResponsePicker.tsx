import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Alert, Button, Input, cn } from '@apivator/ui';
import { Dialog } from '../../../components/ui/Dialog';
import { api } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { useWorkspaces } from '../../../lib/useWorkspaces';
import { usePreferences } from '../../account/preferences';
import { useConsole } from '../../console/consoleStore';
import { useTabs } from '../../requests/tabsStore';
import { methodColor, methodLabel } from '../../requests/methodColors';
import { formatDateTime, formatTime, useT } from '../../../i18n';

/** Fark aracına yüklenebilecek bir yanıt. */
interface Choice {
  id: string;
  method: string;
  url: string;
  status: number | null;
  time: number | null;
  /** Gövde; sunucuda saklanan yanıtlarda seçilince `load` ile getirilir. */
  body: string;
  load?: () => Promise<string>;
  /** Sunucuda saklanan yanıtın gönderilme zamanı. */
  executedAt?: string;
  /** Gövde konsolda kısaltılarak saklanmış. */
  truncated: boolean;
  source: 'history' | 'tab' | 'saved';
}

/** Sunucuda saklanan yanıtların ilk sayfası (en yeni 200 kayıt). */
const SAVED_LIMIT = 200;

/**
 * Önceki oturumların saklanan yanıtları ("yanıtları sakla" tercihi açıksa). Bu oturumda gönderilenler konsol
 * kaydında zaten var; tekrar listelenmesin diye konsoldaki en eski kayıttan önce gönderilenler alınır.
 */
function useSavedChoices(enabled: boolean, before: number | null) {
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  const query = useQuery({
    queryKey: ['history', workspaceId, 'saved-responses'],
    queryFn: () => api.history.list(workspaceId!, undefined, SAVED_LIMIT),
    enabled: enabled && !!workspaceId,
    staleTime: 0,
  });
  const choices = useMemo(
    () =>
      (query.data ?? [])
        .filter((h) => h.hasResponse && (before === null || Date.parse(h.executedAt) < before))
        .map((h): Choice => ({
          id: `s-${h.id}`,
          method: h.method,
          url: h.url,
          status: h.status,
          time: h.timeMs,
          body: '',
          load: async () => (await api.history.response(h.id)).body,
          executedAt: h.executedAt,
          truncated: false,
          source: 'saved',
        })),
    [query.data, before],
  );
  return { choices, loading: query.isLoading && query.fetchStatus !== 'idle' };
}

const CONSOLE_MAX_BODY = 20_000;

function statusTone(status: number | null) {
  if (status === null || status >= 400) return 'text-danger';
  return status >= 300 ? 'text-warning' : 'text-success';
}

/**
 * Bu oturumda gönderilen isteklerin (konsol kaydı) ve açık sekmelerdeki son yanıtların listesi; gövdeler yerel
 * kayıtlardan gelir. Önceki oturumlar `useSavedChoices` ile eklenir. Liste yalnızca pencere açılınca okunur.
 */
function useChoices(): Choice[] {
  const records = useConsole((s) => s.records);
  const tabs = useTabs((s) => s.tabs);
  return useMemo(() => {
    const fromHistory = [...records].reverse().map((r): Choice => ({
      id: `h-${r.id}`,
      method: r.method,
      url: r.url,
      status: r.status,
      time: r.time,
      body: r.responseBody,
      truncated: r.responseBody.length > CONSOLE_MAX_BODY,
      source: 'history',
    }));
    const fromTabs = tabs.flatMap((tab): Choice[] =>
      tab.response && tab.response.bodyEncoding === 'text' && tab.response.body
        ? [
            {
              id: `t-${tab.id}`,
              method: tab.draft.method,
              url: tab.response.finalUrl ?? tab.draft.url,
              status: tab.response.status,
              time: null,
              body: tab.response.body,
              truncated: tab.response.truncated,
              source: 'tab',
            },
          ]
        : [],
    );
    return [...fromHistory, ...fromTabs].filter((c) => c.body);
  }, [records, tabs]);
}

function PickerDialog({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (body: string) => void;
  onClose: () => void;
}) {
  const t = useT('toolsData');
  const session = useChoices();
  const records = useConsole((s) => s.records);
  const saving = usePreferences().data?.saveHistoryResponses ?? false;
  const oldestRecord = records.length ? Math.min(...records.map((r) => r.time)) : null;
  const saved = useSavedChoices(saving, oldestRecord);
  const choices = useMemo(() => [...session, ...saved.choices], [session, saved.choices]);
  const [filter, setFilter] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = filter.trim().toLowerCase();
  const visible = term
    ? choices.filter((c) => c.url.toLowerCase().includes(term) || c.method.toLowerCase() === term)
    : choices;

  async function pick(choice: Choice) {
    if (!choice.load) {
      onPick(choice.body);
      onClose();
      return;
    }
    setError(null);
    setLoadingId(choice.id);
    try {
      onPick(await choice.load());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Dialog title={title} onClose={onClose} size="lg">
      {choices.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">
            {saved.loading ? t('historyPicker.loadingSaved') : t('historyPicker.empty')}
          </p>
          {!saving && <p className="text-xs text-fg-subtle">{t('historyPicker.enableSaving')}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {error && <Alert tone="error">{error}</Alert>}
          <Input
            aria-label={t('historyPicker.search')}
            placeholder={t('historyPicker.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 text-xs"
          />
          <ul
            aria-label={t('historyPicker.responses')}
            className="divide-y divide-line rounded-md border border-line"
          >
            {visible.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-muted disabled:opacity-60"
                  disabled={loadingId !== null}
                  aria-busy={loadingId === choice.id}
                  onClick={() => void pick(choice)}
                >
                  <span className={cn('w-12 shrink-0 font-mono font-semibold', methodColor(choice.method))}>
                    {methodLabel(choice.method)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono" title={choice.url}>
                    {choice.url}
                  </span>
                  <span className={cn('shrink-0 font-mono', statusTone(choice.status))}>
                    {choice.status ?? t('historyPicker.error')}
                  </span>
                  <span className="w-16 shrink-0 text-end text-fg-subtle">
                    {choice.source === 'tab'
                      ? t('historyPicker.openTab')
                      : choice.time !== null
                        ? formatTime(choice.time)
                        : ''}
                  </span>
                  {choice.executedAt && (
                    <span className="shrink-0 text-fg-subtle" title={t('historyPicker.savedTitle')}>
                      {formatDateTime(choice.executedAt, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  {choice.truncated && (
                    <span className="shrink-0 text-warning">{t('historyPicker.truncated')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="text-xs text-fg-muted">{t('historyPicker.noMatch')}</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Alan başlığındaki "Geçmişten seç" düğmesi: seçilen yanıtın gövdesi alana yüklenir. */
export function HistoryResponsePicker({
  side,
  onPick,
}: {
  side: 'left' | 'right';
  onPick: (body: string) => void;
}) {
  const t = useT('toolsData');
  const [open, setOpen] = useState(false);
  const sideLabel = t(`diff.${side}`);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('historyPicker.pickFrom', { side: sideLabel })}
        title={t('historyPicker.loadTitle')}
        onClick={() => setOpen(true)}
      >
        <History className="h-3.5 w-3.5" /> {t('historyPicker.pick')}
      </Button>
      {open && (
        <PickerDialog
          title={t('historyPicker.dialogTitle', { side: sideLabel })}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
